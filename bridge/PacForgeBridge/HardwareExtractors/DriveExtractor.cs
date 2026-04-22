using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Siemens.Engineering;
using Siemens.Engineering.HW;
using Siemens.Engineering.HW.Features;

namespace PacForgeBridge.HardwareExtractors
{
    // ============================================================
    // DriveExtractor
    //
    // Per-drive Sinamics detail extraction via:
    //     driveItem.GetService<Siemens.Engineering.MC.Drives.DriveObjectContainer>()
    //       → DriveObjects[*] { Parameters[*], Telegrams[*] }
    //
    // All reflection-based — Siemens.Engineering.MC.Drives exists on both V18
    // and V20 per Step 0 V3 findings (§12.0 + §12.0a of PAC_AUDIT_DERIVED_SPEC)
    // but using reflection keeps this file compilable even against vendor DLLs
    // that don't ship the MC.Drives namespace (e.g. non-Siemens stand-ins in
    // CI). The typed surface is trivially re-introducible if we ever reference
    // the namespace directly.
    //
    // One-call defensive policy: every GetAttribute/property lookup is wrapped
    // in try/catch. Startdrive-integrated projects surface nameplate data; non-
    // Startdrive projects return null for P304/P305/P311/P1120/P1121/P1135 —
    // that's the whole point of ParameterSource on the DTO (§12.6).
    //
    // get_DriveObjectNumber on DriveObject is known-broken on V18 + V20 (§12.0a
    // follow-up #1) — we never call it.
    // ============================================================
    public static class DriveExtractor
    {
        private const string DriveObjectContainerTypeName = "Siemens.Engineering.MC.Drives.DriveObjectContainer";

        /// <summary>
        /// Extract one drive's detail. Returns null only when this device isn't a drive at all
        /// (no DriveObjectContainer service). Warnings append to the supplied sink.
        /// </summary>
        public static PacForgeBridge.ExtractedDriveDetailDto Extract(
            Device device,
            DeviceItem driveItem,
            List<string> sharedWarnings)
        {
            if (device == null || driveItem == null) return null;

            // Type handle for GetService<T>() — cached once. MC.Drives isn't referenced at
            // compile time to stay tolerant of Openness installations that omit it.
            Type containerType = FindTypeByName(DriveObjectContainerTypeName);
            if (containerType == null)
            {
                sharedWarnings?.Add($"Drive extractor: Siemens.Engineering.MC.Drives.DriveObjectContainer type missing from Openness — skipping.");
                return null;
            }

            object container = GetServiceGeneric(driveItem, containerType);
            if (container == null)
            {
                // DeviceItem is not drive-shaped — not an error, just skip.
                return null;
            }

            var dto = new PacForgeBridge.ExtractedDriveDetailDto
            {
                DeviceName = SafeStringProp(device, "Name"),
                Comment = SafeGetAttribute(driveItem, "Comment") as string
                          ?? SafeGetAttribute(device, "Comment") as string,
            };

            // MLFB / firmware from the drive-item TypeIdentifier (e.g. "OrderNumber:6SL3210-1KE18-8AF1/4.7.13").
            string tid = null;
            try { tid = driveItem.TypeIdentifier; } catch { }
            dto.Mlfb = PacForgeBridge.TiaPortalService.ParseMlfb(tid);
            dto.FirmwareVersion = PacForgeBridge.TiaPortalService.ParseFirmwareVersion(tid);
            dto.DriveFamily = GuessDriveFamily(tid, SafeStringProp(device, "TypeIdentifier"), dto.Mlfb);

            // IP + station name — walk from device root for PROFINET interface.
            var net = TryReadNetworkAddress(device.DeviceItems);
            if (net != null)
            {
                dto.IpAddress = net.Item1;
                dto.StationName = net.Item2;
            }

            int totalProbed = 0, valuedProbed = 0;

            // Enumerate DriveObjects via reflection.
            PropertyInfo driveObjectsProp = container.GetType().GetProperty("DriveObjects");
            IEnumerable driveObjectsColl = null;
            try { driveObjectsColl = driveObjectsProp?.GetValue(container) as IEnumerable; }
            catch (Exception ex) { dto.Warnings.Add($"DriveObjects enum: {ex.Message}"); }

            if (driveObjectsColl != null)
            {
                foreach (var driveObj in driveObjectsColl)
                {
                    if (driveObj == null) continue;

                    // Parameters pass — by number.
                    var paramsByNumber = BuildParameterIndex(driveObj, dto.Warnings);

                    // Nameplate (P304 / P305 / P311).
                    dto.MotorRatedPowerKw = ReadDouble(paramsByNumber, 304, dto.SelectedParameters, ref totalProbed, ref valuedProbed);
                    dto.MotorRatedCurrentA = ReadDouble(paramsByNumber, 305, dto.SelectedParameters, ref totalProbed, ref valuedProbed);
                    dto.MotorRatedSpeedRpm = ReadDouble(paramsByNumber, 311, dto.SelectedParameters, ref totalProbed, ref valuedProbed);
                    // P304 typically carries kW; rated voltage is P304.0 on some families and P305 on others.
                    // Siemens published parameter map: P304 = rated power, P305 = rated current, P304[3] = rated voltage
                    // for some drives. Keep it simple — probe P304 group element if present for voltage.
                    // For now: not reading voltage from a dedicated param; leave null and surface later if needed.

                    // Ramps (P1120 / P1121 / P1135).
                    dto.RampUpSeconds = ReadDouble(paramsByNumber, 1120, dto.SelectedParameters, ref totalProbed, ref valuedProbed);
                    dto.RampDownSeconds = ReadDouble(paramsByNumber, 1121, dto.SelectedParameters, ref totalProbed, ref valuedProbed);
                    dto.RampOffStopSeconds = ReadDouble(paramsByNumber, 1135, dto.SelectedParameters, ref totalProbed, ref valuedProbed);

                    // P922 — telegram selection (redundant with Telegrams but useful cross-check).
                    ReadDouble(paramsByNumber, 922, dto.SelectedParameters, ref totalProbed, ref valuedProbed);

                    // Telegrams pass.
                    PropertyInfo telegramsProp = driveObj.GetType().GetProperty("Telegrams");
                    IEnumerable tColl = null;
                    try { tColl = telegramsProp?.GetValue(driveObj) as IEnumerable; }
                    catch (Exception ex) { dto.Warnings.Add($"Telegrams enum: {ex.Message}"); }

                    if (tColl != null)
                    {
                        foreach (var tel in tColl)
                        {
                            if (tel == null) continue;
                            var tdto = BuildTelegramDto(tel, dto.Warnings);
                            if (tdto == null) continue;
                            dto.Telegrams.Add(tdto);
                            if (string.Equals(tdto.Type, "MainTelegram", StringComparison.OrdinalIgnoreCase) &&
                                dto.MainTelegramNumber == null)
                                dto.MainTelegramNumber = tdto.TelegramNumber;
                            if (string.Equals(tdto.Type, "SafetyTelegram", StringComparison.OrdinalIgnoreCase) &&
                                dto.SafetyTelegramNumber == null)
                                dto.SafetyTelegramNumber = tdto.TelegramNumber;
                        }
                    }

                    // One DriveObject per drive device is the G120C norm; later MultiAxis drives expose
                    // more but Sinamics scope for Pac-Audit keeps us on single-axis. Still, break out of
                    // the enumeration after the first to keep extraction deterministic — any second axis
                    // is extracted when we encounter its own parent DeviceItem.
                    break;
                }
            }
            else
            {
                dto.Warnings.Add("DriveObjects collection not accessible — parameter source unavailable.");
            }

            dto.ParameterSource = totalProbed == 0 ? "not_available"
                               : valuedProbed == totalProbed ? "starter"
                               : valuedProbed > 0 ? "partial"
                               : "not_available";

            return dto;
        }

        // ── Parameter access helpers ─────────────────────────────

        /// <summary>
        /// Builds a Number → DriveParameter lookup for the given DriveObject. We iterate the
        /// `Parameters` collection once and index by the `Number` property; callers probe by
        /// parameter number rather than name to avoid p304/P304 casing headaches.
        /// </summary>
        private static Dictionary<int, object> BuildParameterIndex(object driveObject, List<string> warnings)
        {
            var idx = new Dictionary<int, object>();
            PropertyInfo paramsProp = driveObject.GetType().GetProperty("Parameters");
            IEnumerable coll = null;
            try { coll = paramsProp?.GetValue(driveObject) as IEnumerable; }
            catch (Exception ex) { warnings.Add($"Parameters enum: {ex.Message}"); return idx; }
            if (coll == null) return idx;

            foreach (var p in coll)
            {
                if (p == null) continue;
                int? num = TryReadInt(p, "Number");
                if (!num.HasValue) continue;
                // Duplicate numbers happen for indexed params (e.g. P1001[0..7]) — keep the first.
                if (!idx.ContainsKey(num.Value)) idx[num.Value] = p;
            }
            return idx;
        }

        /// <summary>
        /// Reads a double-valued parameter by number. Writes a snapshot to selectedParams regardless
        /// of success (so the engineer can see which params were probed and what came back).
        /// </summary>
        private static double? ReadDouble(
            Dictionary<int, object> idx,
            int number,
            List<PacForgeBridge.ExtractedDriveParameterDto> selectedParams,
            ref int totalProbed,
            ref int valuedProbed)
        {
            totalProbed++;
            if (!idx.TryGetValue(number, out var param) || param == null)
            {
                selectedParams.Add(new PacForgeBridge.ExtractedDriveParameterDto
                {
                    Number = number, Name = "p" + number, Text = null, Value = null, Unit = null,
                });
                return null;
            }

            string name = TryReadString(param, "Name");
            string text = TryReadString(param, "ParameterText");
            string unit = TryReadString(param, "Unit");
            object raw = TryReadObject(param, "Value");
            string valueStr = raw == null ? null : Convert.ToString(raw, System.Globalization.CultureInfo.InvariantCulture);

            selectedParams.Add(new PacForgeBridge.ExtractedDriveParameterDto
            {
                Number = number, Name = name, Text = text, Value = valueStr, Unit = unit,
            });

            double? d = TryToDouble(raw);
            if (d.HasValue) valuedProbed++;
            return d;
        }

        // ── Telegram helpers ─────────────────────────────────────

        private static PacForgeBridge.ExtractedDriveTelegramDto BuildTelegramDto(object telegram, List<string> warnings)
        {
            int? num = TryReadInt(telegram, "TelegramNumber");
            string type = TryReadString(telegram, "Type");
            if (!num.HasValue && string.IsNullOrEmpty(type)) return null;

            var result = new PacForgeBridge.ExtractedDriveTelegramDto
            {
                TelegramNumber = num ?? 0,
                Type = type,
            };

            // Addresses — HW.Address entries. Usually one input + one output.
            try
            {
                PropertyInfo addrProp = telegram.GetType().GetProperty("Addresses");
                var addrs = addrProp?.GetValue(telegram) as IEnumerable;
                if (addrs != null)
                {
                    foreach (var a in addrs)
                    {
                        if (a == null) continue;
                        string formatted = FormatAddress(a);
                        string io = TryReadString(a, "IoType");
                        if (string.Equals(io, "Input", StringComparison.OrdinalIgnoreCase) && string.IsNullOrEmpty(result.InputAddress))
                            result.InputAddress = formatted;
                        else if (string.Equals(io, "Output", StringComparison.OrdinalIgnoreCase) && string.IsNullOrEmpty(result.OutputAddress))
                            result.OutputAddress = formatted;
                    }
                }
            }
            catch (Exception ex) { warnings.Add($"Telegram {num} addresses: {ex.Message}"); }

            return result;
        }

        private static string FormatAddress(object addr)
        {
            int? start = TryReadInt(addr, "StartAddress");
            int? len = TryReadInt(addr, "Length");
            string io = TryReadString(addr, "IoType");
            if (!start.HasValue) return null;
            string prefix = string.Equals(io, "Output", StringComparison.OrdinalIgnoreCase) ? "Q" : "I";
            // PROFIdrive telegrams are word-aligned; express as IW/QW range.
            if (!len.HasValue || len.Value <= 0)
                return $"%{prefix}W{start.Value}";
            int bytes = Math.Max(2, len.Value / 8);
            int endByte = start.Value + bytes - 1;
            return $"%{prefix}W{start.Value}..%{prefix}W{endByte}";
        }

        // ── Network walk (re-used pattern from AuditHardware) ───

        private static Tuple<string, string> TryReadNetworkAddress(DeviceItemComposition items)
        {
            foreach (DeviceItem item in items)
            {
                try
                {
                    NetworkInterface ni = ((IEngineeringServiceProvider)item).GetService<NetworkInterface>();
                    if (ni != null)
                    {
                        string ip = null;
                        string station = null;
                        try
                        {
                            foreach (var node in ni.Nodes)
                            {
                                try { ip = node.GetAttribute("Address") as string; } catch { }
                                if (!string.IsNullOrEmpty(ip)) break;
                            }
                        }
                        catch { }
                        try { station = item.GetAttribute("PnInterfaceData_StationName") as string; }
                        catch { }
                        if (!string.IsNullOrEmpty(ip) || !string.IsNullOrEmpty(station))
                            return Tuple.Create(ip, station);
                    }
                }
                catch { }
                var nested = TryReadNetworkAddress(item.DeviceItems);
                if (nested != null) return nested;
            }
            return null;
        }

        // ── Reflection primitives ────────────────────────────────

        private static Type FindTypeByName(string fullName)
        {
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                try
                {
                    var t = asm.GetType(fullName, throwOnError: false, ignoreCase: false);
                    if (t != null) return t;
                }
                catch { }
            }
            return null;
        }

        private static object GetServiceGeneric(IEngineeringServiceProvider provider, Type serviceType)
        {
            if (provider == null || serviceType == null) return null;
            try
            {
                var mi = typeof(IEngineeringServiceProvider)
                    .GetMethods()
                    .FirstOrDefault(m => m.Name == "GetService" && m.IsGenericMethodDefinition);
                if (mi == null) return null;
                return mi.MakeGenericMethod(serviceType).Invoke(provider, null);
            }
            catch
            {
                return null;
            }
        }

        private static object SafeGetAttribute(IEngineeringObject obj, string attrName)
        {
            if (obj == null) return null;
            try { return obj.GetAttribute(attrName); } catch { return null; }
        }

        private static string SafeStringProp(object obj, string propName)
        {
            if (obj == null) return null;
            try
            {
                var p = obj.GetType().GetProperty(propName);
                return p?.GetValue(obj) as string;
            }
            catch { return null; }
        }

        private static object TryReadObject(object obj, string propName)
        {
            if (obj == null) return null;
            try { return obj.GetType().GetProperty(propName)?.GetValue(obj); }
            catch { return null; }
        }

        private static string TryReadString(object obj, string propName)
        {
            object v = TryReadObject(obj, propName);
            if (v == null) return null;
            return v as string ?? v.ToString();
        }

        private static int? TryReadInt(object obj, string propName)
        {
            object v = TryReadObject(obj, propName);
            if (v == null) return null;
            if (v is int i) return i;
            if (v is short s) return s;
            if (v is long l) return (int)l;
            if (int.TryParse(v.ToString(), out int parsed)) return parsed;
            return null;
        }

        private static double? TryToDouble(object v)
        {
            if (v == null) return null;
            if (v is double d) return d;
            if (v is float f) return f;
            if (v is int i) return i;
            if (v is long l) return l;
            if (v is short s) return s;
            if (v is decimal dec) return (double)dec;
            if (double.TryParse(v.ToString(),
                System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out double parsed))
                return parsed;
            return null;
        }

        private static string GuessDriveFamily(string deviceItemTid, string deviceTid, string mlfb)
        {
            string blob = ((deviceItemTid ?? "") + " " + (deviceTid ?? "") + " " + (mlfb ?? "")).ToUpperInvariant();
            if (blob.Contains("G120C")) return "G120C";
            if (blob.Contains("G120")) return "G120";
            if (blob.Contains("S120")) return "S120";
            if (blob.Contains("S210")) return "S210";
            if (blob.Contains("V90")) return "V90";
            // MLFB prefix hints — 6SL3210-1 = G120C; 6SL3210-5 = V90; 6SL3224 = G120.
            if (!string.IsNullOrEmpty(mlfb))
            {
                string m = mlfb.Replace(" ", "").ToUpperInvariant();
                if (m.StartsWith("6SL3210-5")) return "V90";
                if (m.StartsWith("6SL3210")) return "G120C";
                if (m.StartsWith("6SL3224")) return "G120";
                if (m.StartsWith("6SL312") || m.StartsWith("6SL313")) return "S120";
                if (m.StartsWith("6SL350") || m.StartsWith("6SL351")) return "S210";
            }
            return null;
        }
    }
}
