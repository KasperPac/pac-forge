using System;
using System.Collections.Generic;
using System.Threading;
using Newtonsoft.Json;

namespace PacForgeBridge
{
    /// <summary>
    /// Service that manages PLCSIM Advanced V6 virtual controller lifecycle
    /// and provides tag read/write access for automated testing.
    /// Uses the PlcsimBridge C++/CLI wrapper for native API access.
    /// </summary>
    public class PlcsimService
    {
        private PlcsimBridge.PlcsimRuntime _runtime;
        private bool _connected;
        private string _instanceName;

        // CPU type constants from PLCSIM Advanced API (ECPUType enum)
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

        // IO Area constants
        public static class IoArea
        {
            public const int Input = 1;
            public const int Marker = 2;
            public const int Output = 3;
            public const int DataBlock = 6;
        }

        public bool IsConnected => _connected;
        public string InstanceName => _instanceName;
        public string LastError => _runtime?.LastError ?? "Not initialized";

        public PlcsimService()
        {
            _connected = false;
            _instanceName = null;
        }

        /// <summary>
        /// Initialize the PLCSIM Advanced API and register a virtual controller instance.
        /// </summary>
        public PlcsimStartResult Start(string instanceName, int cpuType = 0, int timeoutMs = 30000)
        {
            var result = new PlcsimStartResult();

            try
            {
                if (_runtime != null && _connected)
                {
                    result.Success = true;
                    result.Message = $"Already connected to instance '{_instanceName}'";
                    result.OperatingState = _runtime.GetOperatingState();
                    return result;
                }

                _runtime = new PlcsimBridge.PlcsimRuntime();

                // Step 1: Initialize API
                Console.WriteLine("[PLCSIM] Initializing PLCSIM Advanced API...");
                if (!_runtime.Initialize())
                {
                    result.Message = $"API initialization failed: {_runtime.LastError}";
                    return result;
                }
                Console.WriteLine("[PLCSIM] API initialized.");

                // Step 2: Register instance
                if (cpuType == 0) cpuType = CpuTypes.S7_1515; // default
                Console.WriteLine($"[PLCSIM] Registering instance '{instanceName}' (CPU type: 0x{cpuType:X})...");
                if (!_runtime.RegisterInstance(instanceName, cpuType))
                {
                    result.Message = $"RegisterInstance failed: {_runtime.LastError}";
                    return result;
                }
                Console.WriteLine("[PLCSIM] Instance registered.");

                // Step 3: Power on
                Console.WriteLine("[PLCSIM] Powering on...");
                if (!_runtime.PowerOn(timeoutMs))
                {
                    result.Message = $"PowerOn failed: {_runtime.LastError}";
                    return result;
                }
                Console.WriteLine("[PLCSIM] Powered on.");

                // Wait for instance to fully initialize (PLCSIM needs 2-5s after PowerOn)
                Console.WriteLine("[PLCSIM] Waiting for instance to stabilize...");
                var deadline = DateTime.Now.AddMilliseconds(timeoutMs);
                string state = "";
                while (DateTime.Now < deadline)
                {
                    state = _runtime.GetOperatingState();
                    Console.WriteLine($"[PLCSIM] State: {state}");
                    // STOP or RUN means the instance is ready to accept downloads/commands
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
                _connected = true;
                result.Success = true;
                result.Message = $"PLCSIM instance '{instanceName}' started and ready (state: {state})";
                result.OperatingState = state;
            }
            catch (Exception ex)
            {
                result.Message = $"Exception: {ex.Message}";
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

            if (!_connected || _runtime == null)
            {
                result.Message = "Not connected to PLCSIM instance";
                return result;
            }

            try
            {
                bool ok;
                if (mode.Equals("run", StringComparison.OrdinalIgnoreCase))
                {
                    ok = _runtime.Run(timeoutMs);
                }
                else if (mode.Equals("stop", StringComparison.OrdinalIgnoreCase))
                {
                    ok = _runtime.Stop(timeoutMs);
                }
                else
                {
                    result.Message = $"Invalid mode: '{mode}'. Use 'run' or 'stop'.";
                    return result;
                }

                if (!ok)
                {
                    result.Message = $"SetMode({mode}) failed: {_runtime.LastError}";
                    return result;
                }

                result.Success = true;
                result.Message = $"PLC mode set to {mode.ToUpper()}";
            }
            catch (Exception ex)
            {
                result.Message = $"Exception: {ex.Message}";
            }

            return result;
        }

        /// <summary>
        /// Refresh tag list after TIA download. Must be called before symbolic tag R/W.
        /// </summary>
        public PlcsimResult UpdateTagList()
        {
            var result = new PlcsimResult();
            if (!_connected || _runtime == null)
            {
                result.Message = "Not connected to PLCSIM instance";
                return result;
            }

            try
            {
                Console.WriteLine("[PLCSIM] Updating tag list...");
                if (!_runtime.UpdateTagList())
                {
                    result.Message = $"UpdateTagList failed: {_runtime.LastError}";
                    return result;
                }
                Console.WriteLine("[PLCSIM] Tag list updated.");
                result.Success = true;
                result.Message = "Tag list updated";
            }
            catch (Exception ex)
            {
                result.Message = $"Exception: {ex.Message}";
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
                Connected = _connected,
                InstanceName = _instanceName,
                OperatingState = _connected ? _runtime?.GetOperatingState() ?? "Unknown" : "Disconnected",
                HasInstance = _runtime?.HasInstance ?? false,
            };
        }

        /// <summary>
        /// Write a tag value by symbolic name.
        /// </summary>
        public PlcsimResult WriteTag(string tagName, object value, string dataType)
        {
            var result = new PlcsimResult();

            if (!_connected || _runtime == null)
            {
                result.Message = "Not connected to PLCSIM instance";
                return result;
            }

            try
            {
                bool ok;
                switch (dataType.ToLower())
                {
                    case "bool":
                        ok = _runtime.WriteBool(tagName, Convert.ToBoolean(value));
                        break;
                    case "int":
                    case "int16":
                    case "sint":
                        ok = _runtime.WriteInt16(tagName, Convert.ToInt16(value));
                        break;
                    case "dint":
                    case "int32":
                        ok = _runtime.WriteInt32(tagName, Convert.ToInt32(value));
                        break;
                    case "real":
                    case "float":
                        ok = _runtime.WriteFloat(tagName, Convert.ToSingle(value));
                        break;
                    case "time":
                        // S7 TIME is a 32-bit signed integer in milliseconds.
                        // Accept either raw ms (int) or T# format string (T#2s, T#100ms, T#1m30s).
                        int timeMs;
                        var valStr = value?.ToString() ?? "";
                        if (valStr.StartsWith("T#", StringComparison.OrdinalIgnoreCase))
                        {
                            timeMs = ParseTimeString(valStr);
                        }
                        else
                        {
                            timeMs = Convert.ToInt32(value);
                        }
                        ok = _runtime.WriteInt32(tagName, timeMs);
                        break;
                    default:
                        result.Message = $"Unsupported data type: '{dataType}'";
                        return result;
                }

                if (!ok)
                {
                    result.Message = $"WriteTag({tagName}) failed: {_runtime.LastError}";
                    return result;
                }

                result.Success = true;
                result.Message = $"Written {tagName} = {value}";
            }
            catch (Exception ex)
            {
                result.Message = $"Exception writing {tagName}: {ex.Message}";
            }

            return result;
        }

        /// <summary>
        /// Read tag values by symbolic name.
        /// </summary>
        public PlcsimReadResult ReadTags(List<TagReadRequest> tags)
        {
            var result = new PlcsimReadResult();

            if (!_connected || _runtime == null)
            {
                result.Message = "Not connected to PLCSIM instance";
                return result;
            }

            try
            {
                result.Values = new List<TagReadValue>();

                foreach (var tag in tags)
                {
                    var readResult = ReadSingleTag(tag.TagName, tag.DataType);
                    result.Values.Add(readResult);
                }

                result.Success = true;
                result.Message = $"Read {tags.Count} tags";
            }
            catch (Exception ex)
            {
                result.Message = $"Exception: {ex.Message}";
            }

            return result;
        }

        private TagReadValue ReadSingleTag(string tagName, string dataType)
        {
            var val = new TagReadValue { TagName = tagName, DataType = dataType };

            try
            {
                PlcsimBridge.TagReadResult r;
                switch (dataType.ToLower())
                {
                    case "bool":
                        r = _runtime.ReadBool(tagName);
                        break;
                    case "int":
                    case "int16":
                    case "sint":
                        r = _runtime.ReadInt16(tagName);
                        break;
                    case "dint":
                    case "int32":
                        r = _runtime.ReadInt32(tagName);
                        break;
                    case "real":
                    case "float":
                        r = _runtime.ReadFloat(tagName);
                        break;
                    case "time":
                        // TIME is stored as Int32 (milliseconds) in the PLC.
                        // Convert to T# format string so comparisons work against T#2s etc.
                        r = _runtime.ReadInt32(tagName);
                        if (r.Success && r.Value is int ms)
                        {
                            r = new PlcsimBridge.TagReadResult { Success = true, Value = FormatTimeString(ms) };
                        }
                        break;
                    default:
                        val.Error = $"Unsupported data type: '{dataType}'";
                        return val;
                }

                if (r.Success)
                {
                    val.Value = r.Value;
                    val.Success = true;
                }
                else
                {
                    val.Error = r.ErrorMessage;
                }
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
                if (_runtime != null)
                {
                    Console.WriteLine("[PLCSIM] Shutting down...");
                    _runtime.Shutdown();
                    _runtime = null;
                }

                _connected = false;
                _instanceName = null;
                result.Success = true;
                result.Message = "PLCSIM instance stopped";
            }
            catch (Exception ex)
            {
                result.Message = $"Exception: {ex.Message}";
            }

            return result;
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
            // Mixed: e.g. 1500ms → T#1s500ms
            int s = ms / 1000;
            int remainder = ms % 1000;
            return $"T#{s}s{remainder}ms";
        }

        /// <summary>
        /// Parse S7 TIME literal (T#2s, T#100ms, T#1m30s, T#500us) to milliseconds.
        /// </summary>
        private static int ParseTimeString(string value)
        {
            // Strip T# prefix
            var s = value;
            if (s.StartsWith("T#", StringComparison.OrdinalIgnoreCase))
                s = s.Substring(2);

            int totalMs = 0;
            int i = 0;
            while (i < s.Length)
            {
                // Read numeric part
                int start = i;
                while (i < s.Length && (char.IsDigit(s[i]) || s[i] == '.'))
                    i++;
                if (i == start) break;
                double num = double.Parse(s.Substring(start, i - start),
                    System.Globalization.CultureInfo.InvariantCulture);

                // Read unit
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
                        // If no unit, assume milliseconds
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
