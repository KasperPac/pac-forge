#if !TIA_V18
using System;
using System.Collections.Generic;
using System.Threading;
using Newtonsoft.Json;
using Siemens.Simatic.Simulation.Runtime;

namespace PacForgeBridge
{
    /// <summary>
    /// Service that manages PLCSIM Advanced V6 virtual controller lifecycle
    /// and provides tag read/write access for automated testing.
    /// Uses the official managed Siemens.Simatic.Simulation.Runtime API.
    /// </summary>
    public class PlcsimService
    {
        private IInstance _instance;
        private string _instanceName;
        private string _lastError;

        // CPU type constants — underlying integers match ECPUType enum,
        // kept as int so HTTP callers don't need to reference the Siemens assembly.
        public static class CpuTypes
        {
            public const int S7_1500_Unspecified = 0x000005DC;
            public const int S7_1511 = 0x000005E7;
            public const int S7_1513 = 0x000005E9;
            public const int S7_1515 = 0x000005EB;
            public const int S7_1516 = 0x000005EC;
            public const int S7_1517 = 0x000005ED;
            public const int S7_1518 = 0x000005EE;
            public const int S7_1511F = 0x000105E7;
            public const int S7_1513F = 0x000105E9;
            public const int S7_1515F = 0x000105EB;
            public const int S7_1516F = 0x000105EC;
            public const int S7_1517F = 0x000105ED;
            public const int S7_1518F = 0x000105EE;
        }

        public bool IsConnected => _instance != null;
        public string InstanceName => _instanceName;
        public string LastError => _lastError ?? "";

        public PlcsimService()
        {
            _instance = null;
            _instanceName = null;
            _lastError = null;
        }

        private void SetError(Exception ex)
        {
            if (ex is SimulationRuntimeException sre)
                _lastError = $"{sre.RuntimeErrorCode}: {sre.Message}";
            else
                _lastError = ex.Message;
        }

        /// <summary>
        /// Initialize the PLCSIM Advanced API and register a virtual controller instance.
        /// </summary>
        public PlcsimStartResult Start(string instanceName, int cpuType = 0, int timeoutMs = 30000)
        {
            var result = new PlcsimStartResult();

            try
            {
                if (_instance != null)
                {
                    result.Success = true;
                    result.Message = $"Already connected to instance '{_instanceName}'";
                    result.OperatingState = _instance.OperatingState.ToString();
                    return result;
                }

                if (cpuType == 0) cpuType = CpuTypes.S7_1515; // default
                Console.WriteLine($"[PLCSIM] Registering instance '{instanceName}' (CPU type: 0x{cpuType:X})...");

                _instance = SimulationRuntimeManager.RegisterInstance((ECPUType)cpuType, instanceName);
                Console.WriteLine("[PLCSIM] Instance registered.");

                Console.WriteLine("[PLCSIM] Powering on...");
                ERuntimeErrorCode powerRc = _instance.PowerOn((uint)timeoutMs);
                if (powerRc != ERuntimeErrorCode.OK && powerRc != ERuntimeErrorCode.WarningAlreadyExists)
                {
                    result.Message = $"PowerOn failed: {powerRc}";
                    _lastError = powerRc.ToString();
                    return result;
                }
                Console.WriteLine("[PLCSIM] Powered on.");

                // Wait for instance to reach Stop or Run (ready to accept downloads/commands)
                Console.WriteLine("[PLCSIM] Waiting for instance to stabilize...");
                var deadline = DateTime.Now.AddMilliseconds(timeoutMs);
                string state = "";
                while (DateTime.Now < deadline)
                {
                    state = _instance.OperatingState.ToString();
                    Console.WriteLine($"[PLCSIM] State: {state}");
                    if (state == "Stop" || state == "Run")
                        break;
                    Thread.Sleep(500);
                }

                if (state != "Stop" && state != "Run")
                {
                    Console.WriteLine($"[PLCSIM] Warning: instance in state '{state}' after timeout — may not be ready for download");
                }
                else
                {
                    Console.WriteLine($"[PLCSIM] Instance ready (state: {state})");
                }

                _instanceName = instanceName;
                result.Success = true;
                result.Message = $"PLCSIM instance '{instanceName}' started and ready (state: {state})";
                result.OperatingState = state;
            }
            catch (Exception ex)
            {
                SetError(ex);
                result.Message = $"Exception: {_lastError}";
                Console.WriteLine($"[PLCSIM] Error: {ex}");
            }

            return result;
        }

        /// <summary>
        /// Set PLC operating mode (Run or Stop).
        /// </summary>
        public PlcsimResult SetMode(string mode, int timeoutMs = 10000)
        {
            var result = new PlcsimResult();

            if (_instance == null)
            {
                result.Message = "Not connected to PLCSIM instance";
                return result;
            }

            try
            {
                if (mode.Equals("run", StringComparison.OrdinalIgnoreCase))
                {
                    _instance.Run((uint)timeoutMs);
                }
                else if (mode.Equals("stop", StringComparison.OrdinalIgnoreCase))
                {
                    _instance.Stop((uint)timeoutMs);
                }
                else
                {
                    result.Message = $"Invalid mode: '{mode}'. Use 'run' or 'stop'.";
                    return result;
                }

                result.Success = true;
                result.Message = $"PLC mode set to {mode.ToUpper()}";
            }
            catch (Exception ex)
            {
                SetError(ex);
                result.Message = $"SetMode({mode}) failed: {_lastError}";
            }

            return result;
        }

        /// <summary>
        /// Refresh tag list after TIA download. Must be called before symbolic tag R/W.
        /// </summary>
        public PlcsimResult UpdateTagList()
        {
            var result = new PlcsimResult();
            if (_instance == null)
            {
                result.Message = "Not connected to PLCSIM instance";
                return result;
            }

            try
            {
                Console.WriteLine("[PLCSIM] Updating tag list...");
                _instance.UpdateTagList();
                Console.WriteLine("[PLCSIM] Tag list updated.");
                result.Success = true;
                result.Message = "Tag list updated";
            }
            catch (Exception ex)
            {
                SetError(ex);
                result.Message = $"UpdateTagList failed: {_lastError}";
            }
            return result;
        }

        /// <summary>
        /// Get current PLCSIM status.
        /// </summary>
        public PlcsimStatusResult GetStatus()
        {
            return new PlcsimStatusResult
            {
                Connected = _instance != null,
                InstanceName = _instanceName,
                OperatingState = _instance != null ? _instance.OperatingState.ToString() : "Disconnected",
                HasInstance = _instance != null,
            };
        }

        /// <summary>
        /// Write a tag value by symbolic name.
        /// </summary>
        public PlcsimResult WriteTag(string tagName, object value, string dataType)
        {
            var result = new PlcsimResult();

            if (_instance == null)
            {
                result.Message = "Not connected to PLCSIM instance";
                return result;
            }

            try
            {
                switch (dataType.ToLower())
                {
                    case "bool":
                        _instance.WriteBool(tagName, Convert.ToBoolean(value));
                        break;
                    case "int":
                    case "int16":
                    case "sint":
                        _instance.WriteInt16(tagName, Convert.ToInt16(value));
                        break;
                    case "dint":
                    case "int32":
                        _instance.WriteInt32(tagName, Convert.ToInt32(value));
                        break;
                    case "word":
                    case "uint16":
                        _instance.WriteUInt16(tagName, ParseUInt16(value));
                        break;
                    case "dword":
                    case "uint32":
                        _instance.WriteUInt32(tagName, ParseUInt32(value));
                        break;
                    case "real":
                    case "float":
                        _instance.WriteFloat(tagName, Convert.ToSingle(value));
                        break;
                    case "time":
                        // S7 TIME is a 32-bit signed integer in milliseconds.
                        // Accept either raw ms (int) or T# format string (T#2s, T#100ms, T#1m30s).
                        int timeMs;
                        var valStr = value?.ToString() ?? "";
                        if (valStr.StartsWith("T#", StringComparison.OrdinalIgnoreCase))
                            timeMs = ParseTimeString(valStr);
                        else
                            timeMs = Convert.ToInt32(value);
                        _instance.WriteInt32(tagName, timeMs);
                        break;
                    default:
                        result.Message = $"Unsupported data type: '{dataType}'";
                        return result;
                }

                result.Success = true;
                result.Message = $"Written {tagName} = {value}";
            }
            catch (Exception ex)
            {
                SetError(ex);
                result.Message = $"WriteTag({tagName}) failed: {_lastError}";
            }

            return result;
        }

        /// <summary>
        /// Read tag values by symbolic name.
        /// </summary>
        public PlcsimReadResult ReadTags(List<TagReadRequest> tags)
        {
            var result = new PlcsimReadResult();

            if (_instance == null)
            {
                result.Message = "Not connected to PLCSIM instance";
                return result;
            }

            try
            {
                result.Values = new List<TagReadValue>();
                foreach (var tag in tags)
                {
                    result.Values.Add(ReadSingleTag(tag.TagName, tag.DataType));
                }

                result.Success = true;
                result.Message = $"Read {tags.Count} tags";
            }
            catch (Exception ex)
            {
                SetError(ex);
                result.Message = $"Exception: {_lastError}";
            }

            return result;
        }

        private TagReadValue ReadSingleTag(string tagName, string dataType)
        {
            var val = new TagReadValue { TagName = tagName, DataType = dataType };

            try
            {
                switch (dataType.ToLower())
                {
                    case "bool":
                        val.Value = _instance.ReadBool(tagName);
                        break;
                    case "int":
                    case "int16":
                    case "sint":
                        val.Value = (int)_instance.ReadInt16(tagName);
                        break;
                    case "dint":
                    case "int32":
                        val.Value = _instance.ReadInt32(tagName);
                        break;
                    case "word":
                    case "uint16":
                        val.Value = (int)_instance.ReadUInt16(tagName);
                        break;
                    case "dword":
                    case "uint32":
                        val.Value = (long)_instance.ReadUInt32(tagName);
                        break;
                    case "real":
                    case "float":
                        val.Value = (double)_instance.ReadFloat(tagName);
                        break;
                    case "time":
                        // TIME is stored as Int32 (milliseconds). Convert to T# literal.
                        int ms = _instance.ReadInt32(tagName);
                        val.Value = FormatTimeString(ms);
                        break;
                    default:
                        val.Error = $"Unsupported data type: '{dataType}'";
                        return val;
                }

                val.Success = true;
            }
            catch (SimulationRuntimeException sre)
            {
                val.Error = $"{sre.RuntimeErrorCode}: {sre.Message}";
            }
            catch (Exception ex)
            {
                val.Error = ex.Message;
            }

            return val;
        }

        /// <summary>
        /// Stop and clean up the PLCSIM instance.
        /// </summary>
        public PlcsimResult Stop()
        {
            var result = new PlcsimResult();

            try
            {
                if (_instance != null)
                {
                    Console.WriteLine("[PLCSIM] Shutting down instance...");

                    // Best-effort graceful shutdown
                    var state = _instance.OperatingState;
                    if (state == EOperatingState.Run || state == EOperatingState.Stop)
                    {
                        try { _instance.PowerOff(5000); } catch { /* ignore */ }
                    }

                    try { _instance.UnregisterInstance(); } catch { /* ignore */ }
                    _instance = null;
                }

                _instanceName = null;
                result.Success = true;
                result.Message = "PLCSIM instance stopped";
            }
            catch (Exception ex)
            {
                SetError(ex);
                result.Message = $"Exception: {_lastError}";
            }

            return result;
        }

        /// <summary>
        /// Parse a Word value that may be an integer or a hex literal (16#FF or 0xFF).
        /// </summary>
        private static ushort ParseUInt16(object value)
        {
            var s = value?.ToString() ?? "0";
            if (s.StartsWith("16#", StringComparison.OrdinalIgnoreCase))
                return Convert.ToUInt16(s.Substring(3), 16);
            if (s.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
                return Convert.ToUInt16(s.Substring(2), 16);
            return Convert.ToUInt16(value);
        }

        /// <summary>
        /// Parse a DWord value that may be an integer or a hex literal (16#FFFFFFFF or 0xFFFFFFFF).
        /// </summary>
        private static uint ParseUInt32(object value)
        {
            var s = value?.ToString() ?? "0";
            if (s.StartsWith("16#", StringComparison.OrdinalIgnoreCase))
                return Convert.ToUInt32(s.Substring(3), 16);
            if (s.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
                return Convert.ToUInt32(s.Substring(2), 16);
            return Convert.ToUInt32(value);
        }

        /// <summary>
        /// Format milliseconds as S7 TIME literal (T#2s, T#100ms, T#1m30s).
        /// </summary>
        private static string FormatTimeString(int ms)
        {
            if (ms == 0) return "T#0ms";
            if (ms < 1000) return $"T#{ms}ms";
            if (ms % 1000 == 0)
            {
                int sec = ms / 1000;
                if (sec < 60) return $"T#{sec}s";
                int min = sec / 60;
                sec = sec % 60;
                if (sec == 0) return $"T#{min}m";
                return $"T#{min}m{sec}s";
            }
            int s = ms / 1000;
            int remainder = ms % 1000;
            return $"T#{s}s{remainder}ms";
        }

        /// <summary>
        /// Parse S7 TIME literal (T#2s, T#100ms, T#1m30s, T#500us) to milliseconds.
        /// </summary>
        private static int ParseTimeString(string value)
        {
            var s = value;
            if (s.StartsWith("T#", StringComparison.OrdinalIgnoreCase))
                s = s.Substring(2);

            int totalMs = 0;
            int i = 0;
            while (i < s.Length)
            {
                int start = i;
                while (i < s.Length && (char.IsDigit(s[i]) || s[i] == '.'))
                    i++;
                if (i == start) break;
                double num = double.Parse(s.Substring(start, i - start),
                    System.Globalization.CultureInfo.InvariantCulture);

                int unitStart = i;
                while (i < s.Length && char.IsLetter(s[i]))
                    i++;
                string unit = s.Substring(unitStart, i - unitStart).ToLower();

                switch (unit)
                {
                    case "d":   totalMs += (int)(num * 86400000); break;
                    case "h":   totalMs += (int)(num * 3600000); break;
                    case "m":   totalMs += (int)(num * 60000); break;
                    case "s":   totalMs += (int)(num * 1000); break;
                    case "ms":  totalMs += (int)num; break;
                    case "us":  totalMs += (int)(num / 1000); break;
                    default:
                        totalMs += (int)num;
                        break;
                }
            }

            return totalMs;
        }
    }

    // ── DTOs ────────────────────────────────────────────────────────────

    public class PlcsimResult
    {
        [JsonProperty("success")] public bool Success { get; set; }
        [JsonProperty("message")] public string Message { get; set; }
    }

    public class PlcsimStartResult : PlcsimResult
    {
        [JsonProperty("operating_state")] public string OperatingState { get; set; }
    }

    public class PlcsimStatusResult
    {
        [JsonProperty("connected")] public bool Connected { get; set; }
        [JsonProperty("instance_name")] public string InstanceName { get; set; }
        [JsonProperty("operating_state")] public string OperatingState { get; set; }
        [JsonProperty("has_instance")] public bool HasInstance { get; set; }
    }

    public class TagReadRequest
    {
        [JsonProperty("tag_name")] public string TagName { get; set; }
        [JsonProperty("data_type")] public string DataType { get; set; }
    }

    public class TagReadValue
    {
        [JsonProperty("tag_name")] public string TagName { get; set; }
        [JsonProperty("data_type")] public string DataType { get; set; }
        [JsonProperty("value")] public object Value { get; set; }
        [JsonProperty("success")] public bool Success { get; set; }
        [JsonProperty("error")] public string Error { get; set; }
    }

    public class PlcsimReadResult : PlcsimResult
    {
        [JsonProperty("values")] public List<TagReadValue> Values { get; set; }
    }

    public class PlcsimWriteRequest
    {
        [JsonProperty("tag_name")] public string TagName { get; set; }
        [JsonProperty("value")] public object Value { get; set; }
        [JsonProperty("data_type")] public string DataType { get; set; }
    }

    public class DownloadResult
    {
        [JsonProperty("success")] public bool Success { get; set; }
        [JsonProperty("message")] public string Message { get; set; }
    }

    public class PlcsimStartRequest
    {
        [JsonProperty("instance_name")] public string InstanceName { get; set; }
        [JsonProperty("cpu_type")] public int CpuType { get; set; }
        [JsonProperty("timeout_ms")] public int TimeoutMs { get; set; }
    }

    public class PlcsimModeRequest
    {
        [JsonProperty("mode")] public string Mode { get; set; }
        [JsonProperty("timeout_ms")] public int TimeoutMs { get; set; }
    }
}
#endif // !TIA_V18
