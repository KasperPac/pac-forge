using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;
using PacForgeBridge.HardwareExtractors;
using Siemens.Engineering;
using Siemens.Engineering.HW;
using Siemens.Engineering.HW.Features;
using Siemens.Engineering.Hmi;
using Siemens.Engineering.Hmi.Screen;

namespace PacForgeBridge
{
    // ============================================================
    // Pac-Audit: Hardware extraction — Phase 1 (Step 3)
    //
    // Deterministic, reflection-guarded per-channel IO enumeration + HMI panel inventory.
    // See PAC_AUDIT_DERIVED_SPEC.md §16 step 3 and §12.6.
    //
    // HmiTargets is NOT exposed on `_project.HmiTargets` on V18 (confirmed by spike,
    // §12.0) — so this walks all Devices + DeviceItems and finds `HmiTarget` through
    // the existing `SoftwareContainer` service path, same as the legacy `GetHmiTarget()`.
    // ============================================================
    public partial class TiaPortalService
    {
        // ─── Module channels ──────────────────────────────────────

        /// <summary>
        /// Walks every Device's DeviceItem tree, finds IO modules (non-null TypeIdentifier
        /// starting with "OrderNumber:" or "GSD:"), unrolls their StartAddress range into
        /// one row per physical channel, and joins symbolic tags by address.
        /// </summary>
        private List<ExtractedModuleChannelDto> ExtractModuleChannels(
            List<ExtractedTagTableDto> tagTables,
            List<string> warnings)
        {
            var result = new List<ExtractedModuleChannelDto>();
            if (_project == null) return result;

            Dictionary<string, string> tagByAddress = BuildTagAddressLookup(tagTables);

            var sw = Stopwatch.StartNew();
            int moduleCount = 0;

            try
            {
                foreach (Device device in EnumerateAllTopLevelDevices())
                {
                    try
                    {
                        WalkDeviceItemsForChannels(device.DeviceItems, rack: 0, slot: 0,
                                                   tagByAddress, result, warnings, ref moduleCount);
                    }
                    catch (Exception ex)
                    {
                        warnings.Add($"Module channels: device '{SafeName(device)}' — {ex.Message}");
                    }
                }
            }
            catch (Exception ex)
            {
                warnings.Add($"Module channels: project walk failed — {ex.Message}");
            }

            sw.Stop();
            Console.WriteLine($"[Audit hw] module channels: {result.Count} rows from {moduleCount} modules in {sw.Elapsed.TotalSeconds:F1}s");
            return result;
        }

        private void WalkDeviceItemsForChannels(
            DeviceItemComposition items,
            int rack,
            int slot,
            Dictionary<string, string> tagByAddress,
            List<ExtractedModuleChannelDto> sink,
            List<string> warnings,
            ref int moduleCount)
        {
            foreach (DeviceItem item in items)
            {
                string typeId = null;
                try { typeId = item.TypeIdentifier; } catch { }

                bool looksLikeModule = typeId != null && (typeId.Contains("OrderNumber:") || typeId.Contains("GSD:"));

                // Always try the module — EmitChannelsForModule silently returns when there's
                // nothing addressable, but ET200SP modules carry their OrderNumber on the parent
                // while addresses hang off this same item (via the Addresses collection). Some
                // families also hang addresses off a child submodule — handled by the recursion
                // below, which is unconditional.
                {
                    int moduleSlot = slot;
                    try { moduleSlot = item.PositionNumber; } catch { }

                    try
                    {
                        int rowsBefore = sink.Count;
                        EmitChannelsForModule(item, rack, moduleSlot, tagByAddress, sink);
                        if (sink.Count > rowsBefore) moduleCount++;
                    }
                    catch (Exception ex)
                    {
                        warnings.Add($"Module channels: '{SafeName(item)}' — {ex.Message}");
                    }
                }

                // Recurse regardless — channels of a DP slave may hang off a sub-DeviceItem.
                try { WalkDeviceItemsForChannels(item.DeviceItems, rack, slot + 1, tagByAddress, sink, warnings, ref moduleCount); }
                catch { }
            }
        }

        private void EmitChannelsForModule(
            DeviceItem module,
            int rack,
            int slot,
            Dictionary<string, string> tagByAddress,
            List<ExtractedModuleChannelDto> sink)
        {
            string moduleName = SafeName(module);
            string typeId = null;
            try { typeId = module.TypeIdentifier; } catch { }
            string mlfb = ParseMlfb(typeId);
            bool isSafety = InferIsSafety(moduleName, typeId);

            // Primary path — DeviceItem.Addresses is an IoAddress collection populated for
            // ET200SP / ET200MP / local-rack IO cards. Each entry has a StartAddress (int, byte
            // offset), a Length (int, bits), and an IoType (Input/Output/None). The legacy
            // `GetAttribute("StartAddress")` path we previously used returns null for these
            // modules — drives used it, IO modules don't.
            var addresses = TryReadAddresses(module);
            if (addresses.Count > 0)
            {
                // Some modules expose one Address per IoType direction (common); F-I/O modules
                // often expose multiple Addresses per direction (data frame + diagnostic/ACK
                // frame). We want one row per functional *physical* channel — so: for each
                // IoType we emit channels against the FIRST Address in that direction, capped
                // by the MLFB/name-based channel count. The remaining Addresses for the same
                // direction are safety-framing overhead, not additional channels.
                var firstByIo = new Dictionary<string, ReflectedAddress>();
                foreach (var a in addresses)
                {
                    if (a.IoType == "Input" || a.IoType == "Output")
                    {
                        if (!firstByIo.ContainsKey(a.IoType)) firstByIo[a.IoType] = a;
                    }
                }

                foreach (var kv in firstByIo)
                {
                    string prefix = kv.Key == "Input" ? "I" : "Q";
                    var a = kv.Value;

                    var heur = InferSignalType(new ParsedAddress { Prefix = prefix, IsInput = prefix == "I", IsBit = true }, moduleName, typeId);
                    bool isBit = heur == "DI" || heur == "DO" || heur == "DQ" || heur == "DIQ"
                              || heur.StartsWith("F-D", StringComparison.Ordinal);

                    // Prefer name/MLFB-based channel count (authoritative for known Siemens
                    // cards — e.g. "F-DI 8x" → 8, "DI 16x" → 16). Fall back to the address
                    // bit-length when the name doesn't give us a count.
                    ChannelCountResult nameCount = InferChannelCount(moduleName, typeId, heur,
                                                                     /* bits */ null, /* bytes */ null);
                    int channelCount;
                    string countSource;
                    if (nameCount.Count > 0)
                    {
                        channelCount = nameCount.Count;
                        countSource = "name_cap_" + (nameCount.Source ?? "name");
                    }
                    else if (isBit)
                    {
                        channelCount = a.LengthBits;
                        countSource = "addresses_collection_bits";
                    }
                    else
                    {
                        channelCount = Math.Max(1, a.LengthBits / 16);
                        countSource = "addresses_collection_words";
                    }

                    for (int ch = 0; ch < channelCount; ch++)
                    {
                        string channelAddress;
                        if (isBit)
                        {
                            int byteOffset = a.StartAddress + (ch / 8);
                            int bitOffset = ch % 8;
                            channelAddress = $"%{prefix}{byteOffset}.{bitOffset}";
                        }
                        else
                        {
                            int byteOffset = a.StartAddress + (ch * 2);
                            channelAddress = $"%{prefix}W{byteOffset}";
                        }

                        string symbolicTag = null;
                        if (tagByAddress != null) tagByAddress.TryGetValue(channelAddress, out symbolicTag);

                        sink.Add(new ExtractedModuleChannelDto
                        {
                            ModuleName = moduleName,
                            ModuleMlfb = mlfb,
                            ChannelNumber = ch,
                            IoAddress = channelAddress,
                            SignalType = heur,
                            SymbolicTag = symbolicTag,
                            IsSafety = isSafety,
                            ChannelComment = null,
                            ChannelCountSource = countSource,
                            Rack = rack,
                            Slot = slot,
                        });
                    }
                }
                return;
            }

            // Legacy path — GetAttribute-based address (drives, PROFINET telegram submodules).
            // Kept for backwards compatibility; was the only path before DeviceItem.Addresses
            // was exploited.
            object startAttr = TryGetAttribute(module, "StartAddress");
            object lengthBitsAttr = TryGetAttribute(module, "LengthInBits");
            object lengthAttr = TryGetAttribute(module, "Length");

            ParsedAddress addr = ParseAddress(startAttr);
            if (addr == null) return;  // no recognisable address → silent skip

            string signalType = InferSignalType(addr, moduleName, typeId);
            ChannelCountResult count = InferChannelCount(moduleName, typeId, signalType,
                                                         lengthBitsAttr, lengthAttr);
            if (count.Count <= 0)
            {
                count.Count = 1;
                count.Source = "single_row";
            }

            for (int ch = 0; ch < count.Count; ch++)
            {
                string channelAddress = FormatChannelAddress(addr, signalType, ch);
                string symbolicTag = null;
                if (channelAddress != null && tagByAddress != null)
                    tagByAddress.TryGetValue(channelAddress, out symbolicTag);

                sink.Add(new ExtractedModuleChannelDto
                {
                    ModuleName = moduleName,
                    ModuleMlfb = mlfb,
                    ChannelNumber = ch,
                    IoAddress = channelAddress,
                    SignalType = signalType,
                    SymbolicTag = symbolicTag,
                    IsSafety = isSafety,
                    ChannelComment = null,
                    ChannelCountSource = count.Source,
                    Rack = rack,
                    Slot = slot,
                });
            }
        }

        private struct ReflectedAddress
        {
            public int StartAddress;   // byte offset
            public int LengthBits;     // length in bits
            public string IoType;      // "Input" / "Output" / "None" / other
        }

        /// <summary>
        /// Reads `DeviceItem.Addresses` — the proper `HW.Address` collection for IO modules.
        /// Uses reflection since the exact Address type shape varies slightly V18↔V20 and we
        /// want one code path to survive both. Returns an empty list when no addresses are
        /// available (drives, head stations, rails, etc.).
        /// </summary>
        private static List<ReflectedAddress> TryReadAddresses(DeviceItem module)
        {
            var result = new List<ReflectedAddress>();
            if (module == null) return result;

            IEnumerable col = null;
            try { col = module.GetType().GetProperty("Addresses")?.GetValue(module) as IEnumerable; }
            catch { return result; }
            if (col == null) return result;

            foreach (var a in col)
            {
                if (a == null) continue;
                var t = a.GetType();
                int start = 0, lengthBits = 0;
                string ioType = "None";
                try
                {
                    object s = t.GetProperty("StartAddress")?.GetValue(a);
                    if (s is int si) start = si;
                    else if (s != null) int.TryParse(s.ToString(), out start);

                    object len = t.GetProperty("Length")?.GetValue(a);
                    if (len is int li) lengthBits = li;
                    else if (len != null) int.TryParse(len.ToString(), out lengthBits);

                    object io = t.GetProperty("IoType")?.GetValue(a);
                    if (io != null) ioType = io.ToString();
                }
                catch { continue; }

                result.Add(new ReflectedAddress { StartAddress = start, LengthBits = lengthBits, IoType = ioType });
            }
            return result;
        }

        private static Dictionary<string, string> BuildTagAddressLookup(List<ExtractedTagTableDto> tagTables)
        {
            var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (tagTables == null) return map;
            foreach (var table in tagTables)
            {
                if (table?.Tags == null) continue;
                foreach (var tag in table.Tags)
                {
                    if (string.IsNullOrEmpty(tag.Address) || string.IsNullOrEmpty(tag.Name)) continue;
                    if (!map.ContainsKey(tag.Address)) map[tag.Address] = tag.Name;
                }
            }
            return map;
        }

        // Address-prefix parsing. Openness V18 `StartAddress` attribute usually returns a string
        // like "%I0.0" or "%IW256", but some devices yield an `Address` object — handled via
        // reflection to survive both shapes and V20 drift.
        private class ParsedAddress
        {
            public string Prefix;       // "I" / "Q" / "IW" / "QW" / "IB" / "QB" / "ID" / "QD"
            public int ByteOffset;
            public int BitOffset;       // only valid for bit-level addresses (%I / %Q)
            public bool IsInput;
            public bool IsBit;
            public int WidthBits;       // per-element width (1 for DI/DO, 16 for AI/AO words, …)
        }

        private static ParsedAddress ParseAddress(object attr)
        {
            if (attr == null) return null;

            string raw = null;
            try { raw = attr.ToString(); } catch { }

            // Some Openness builds return an Address object whose ToString() already yields "%I0.0";
            // others yield the class name. If the string doesn't look addressy, try reflection.
            if (!LooksLikeAddress(raw))
            {
                string viaReflect = TryReflectAddressString(attr);
                if (!string.IsNullOrEmpty(viaReflect)) raw = viaReflect;
            }

            if (string.IsNullOrEmpty(raw) || !LooksLikeAddress(raw)) return null;

            // Regex: optional %, prefix (I/Q/IW/QW/IB/QB/ID/QD/IL/QL), byte offset, optional .bit.
            var m = Regex.Match(raw.Trim(), @"^%?(?<prefix>I[BWDL]?|Q[BWDL]?)(?<byte>\d+)(?:\.(?<bit>\d+))?$",
                                 RegexOptions.IgnoreCase);
            if (!m.Success) return null;

            string prefix = m.Groups["prefix"].Value.ToUpperInvariant();
            int byteOffset = int.Parse(m.Groups["byte"].Value);
            int bitOffset = m.Groups["bit"].Success ? int.Parse(m.Groups["bit"].Value) : 0;
            bool isInput = prefix[0] == 'I';
            bool isBit = prefix.Length == 1;

            int widthBits;
            switch (prefix)
            {
                case "I": case "Q":   widthBits = 1;  break;
                case "IB": case "QB": widthBits = 8;  break;
                case "IW": case "QW": widthBits = 16; break;
                case "ID": case "QD": widthBits = 32; break;
                case "IL": case "QL": widthBits = 64; break;
                default:              widthBits = 1;  break;
            }

            return new ParsedAddress
            {
                Prefix = prefix,
                ByteOffset = byteOffset,
                BitOffset = bitOffset,
                IsInput = isInput,
                IsBit = isBit,
                WidthBits = widthBits,
            };
        }

        private static bool LooksLikeAddress(string s)
        {
            if (string.IsNullOrEmpty(s)) return false;
            return Regex.IsMatch(s, @"^%?(I|Q)[BWDL]?\d", RegexOptions.IgnoreCase);
        }

        private static string TryReflectAddressString(object attr)
        {
            if (attr == null) return null;
            try
            {
                // Common property names on Address-like objects in various Openness versions.
                foreach (var propName in new[] { "Address", "Value", "Operand", "AbsoluteAddress" })
                {
                    var p = attr.GetType().GetProperty(propName);
                    if (p == null) continue;
                    object v = p.GetValue(attr);
                    if (v == null) continue;
                    string s = v.ToString();
                    if (LooksLikeAddress(s)) return s;
                }
            }
            catch { }
            return null;
        }

        private static string InferSignalType(ParsedAddress addr, string moduleName, string typeId)
        {
            string blob = (moduleName ?? "") + " " + (typeId ?? "");
            string hay = blob.ToUpperInvariant();

            // Specialised cases first.
            if (hay.Contains("RS485") || hay.Contains("RS-485") || hay.Contains("MODBUS")) return "RS485";
            if (hay.Contains("DIQ"))  return "DIQ";

            // Address-prefix driven (the reliable signal).
            if (addr != null)
            {
                if (addr.IsBit) return addr.IsInput ? "DI" : "DO";
                return addr.IsInput ? "AI" : "AO";
            }

            return "other";
        }

        private static bool InferIsSafety(string moduleName, string typeId)
        {
            string blob = ((moduleName ?? "") + " " + (typeId ?? "")).ToUpperInvariant();
            // Siemens F-I/O naming — FDI/FDO or "F-DI"/"F-DO", and SM 336F / 326F family.
            return blob.Contains("FDI") || blob.Contains("FDO")
                || blob.Contains("F-DI") || blob.Contains("F-DO")
                || Regex.IsMatch(blob, @"\bF[-_ ]?(AI|AO|DI|DO)\b")
                || Regex.IsMatch(blob, @"\bSM \d+F\b");
        }

        private struct ChannelCountResult
        {
            public int Count;
            public string Source;  // "length_in_bits" | "length_bytes" | "name_pattern" | "single_row"
        }

        /// <summary>
        /// Determines how many channels a module exposes. Prefers Openness's own authoritative
        /// `LengthInBits` / `Length` attributes over display-string parsing — the MLFB on the
        /// DTO is the catalog handle for any further lookup (e.g. GSDML submodule data).
        /// </summary>
        private static ChannelCountResult InferChannelCount(
            string moduleName,
            string typeId,
            string signalType,
            object lengthBitsAttr,
            object lengthAttr)
        {
            // Primary — LengthInBits. Authoritative per the project's HW config / GSDML.
            int totalBits = CoerceInt(lengthBitsAttr);
            if (totalBits > 0)
            {
                int n = ChannelsFromBitLength(totalBits, signalType);
                if (n > 0) return new ChannelCountResult { Count = n, Source = "length_in_bits" };
            }

            // Secondary — Length (bytes). Same authority, different unit.
            int totalBytes = CoerceInt(lengthAttr);
            if (totalBytes > 0)
            {
                int n = ChannelsFromBitLength(totalBytes * 8, signalType);
                if (n > 0) return new ChannelCountResult { Count = n, Source = "length_bytes" };
            }

            // Last resort — parse the "NxV" / "N DI" pattern in the module name. Only used
            // when Openness didn't surface a length; tagged so the engineer sees it.
            string hay = (moduleName ?? "") + " " + (typeId ?? "");
            // Pattern 1: "8x24VDC" / "16x24V" (channels × voltage spec) — look-ahead at voltage/current.
            var m2 = Regex.Match(hay, @"\b(\d+)\s*[xX]\s*(?:U|I|R|TC|V|mA|\d+\s*V)",
                                  RegexOptions.IgnoreCase);
            if (m2.Success && int.TryParse(m2.Groups[1].Value, out int n2) && n2 > 0 && n2 <= 256)
                return new ChannelCountResult { Count = n2, Source = "name_pattern" };
            // Pattern 2: "N DI" / "N-DI" / "NxDI" — channels before IO-type word (incl. DQ).
            var m = Regex.Match(hay, @"(\d+)\s*(?:-|\s|x)?(?:ch|AI|AO|DI|DO|DQ|IN|OUT)",
                                 RegexOptions.IgnoreCase);
            if (m.Success && int.TryParse(m.Groups[1].Value, out int n1) && n1 > 0 && n1 <= 256)
                return new ChannelCountResult { Count = n1, Source = "name_pattern" };

            // Give up — caller will emit one row for the whole module.
            return new ChannelCountResult { Count = 0, Source = "single_row" };
        }

        private static int ChannelsFromBitLength(int totalBits, string signalType)
        {
            switch (signalType)
            {
                case "DI": case "DO": case "DIQ": return totalBits;  // one bit per digital channel
                case "AI": case "AO": return Math.Max(1, totalBits / 16);  // 16 bits per analog word
                default: return 0;
            }
        }

        private static int CoerceInt(object o)
        {
            if (o == null) return 0;
            try { return Convert.ToInt32(o); }
            catch { }
            try { return int.TryParse(o.ToString(), out int n) ? n : 0; }
            catch { return 0; }
        }

        private static string FormatChannelAddress(ParsedAddress addr, string signalType, int channelIndex)
        {
            if (addr == null) return null;

            // DI / DO — always bit-addressed.
            if (signalType == "DI" || signalType == "DO" || signalType == "DIQ")
            {
                int flatBit = addr.ByteOffset * 8 + addr.BitOffset + channelIndex;
                int byteOff = flatBit / 8;
                int bitOff = flatBit % 8;
                char prefixChar = (signalType == "DO") ? 'Q' : (signalType == "DI" ? 'I' : (addr.IsInput ? 'I' : 'Q'));
                return $"%{prefixChar}{byteOff}.{bitOff}";
            }

            // AI / AO — word-addressed (16-bit per channel unless we could tell otherwise).
            if (signalType == "AI" || signalType == "AO")
            {
                int stepBits = addr.IsBit ? 16 : addr.WidthBits; // default to word width
                if (stepBits <= 0) stepBits = 16;
                int byteOff = addr.ByteOffset + channelIndex * (stepBits / 8);
                string p = (signalType == "AO") ? "QW" : "IW";
                return $"%{p}{byteOff}";
            }

            // Fallback — keep the original start address so the row isn't orphaned.
            return $"%{addr.Prefix}{addr.ByteOffset}{(addr.IsBit ? "." + addr.BitOffset : "")}";
        }

        private static object TryGetAttribute(IEngineeringObject obj, string name)
        {
            if (obj == null) return null;
            try { return obj.GetAttribute(name); }
            catch { return null; }
        }

        // ─── HMI targets ──────────────────────────────────────────

        /// <summary>
        /// Walks all Devices, finds each HmiTarget via the existing SoftwareContainer service
        /// path (same as GetHmiTarget, but enumerates every target instead of returning the
        /// first). _project.HmiTargets is absent on V18 (spike §12.0).
        /// </summary>
        private List<ExtractedHmiTargetDto> ExtractHmiTargetsForAudit(List<string> warnings)
        {
            var result = new List<ExtractedHmiTargetDto>();
            if (_project == null) return result;

            var sw = Stopwatch.StartNew();

            try
            {
                foreach (Device device in EnumerateAllTopLevelDevices())
                {
                    try
                    {
                        CollectHmiTargetsForDevice(device, result, warnings);
                    }
                    catch (Exception ex)
                    {
                        warnings.Add($"HMI targets: device '{SafeName(device)}' — {ex.Message}");
                    }
                }
            }
            catch (Exception ex)
            {
                warnings.Add($"HMI targets: project walk failed — {ex.Message}");
            }

            sw.Stop();
            Console.WriteLine($"[Audit hw] HMI targets: {result.Count} panels in {sw.Elapsed.TotalSeconds:F1}s");
            return result;
        }

        private void CollectHmiTargetsForDevice(Device device, List<ExtractedHmiTargetDto> sink, List<string> warnings)
        {
            // Pre-walk the device's DeviceItem tree; for each item that carries an HmiTarget
            // software container, emit one panel row.
            FindHmiTargetsRecursive(device.DeviceItems, device, sink, warnings);
        }

        private void FindHmiTargetsRecursive(DeviceItemComposition items, Device parentDevice,
                                             List<ExtractedHmiTargetDto> sink, List<string> warnings)
        {
            foreach (DeviceItem item in items)
            {
                HmiTarget hmi = null;
                try
                {
                    SoftwareContainer sc = ((IEngineeringServiceProvider)item).GetService<SoftwareContainer>();
                    hmi = sc?.Software as HmiTarget;
                }
                catch { /* not every item exposes a container; keep walking */ }

                if (hmi != null)
                {
                    try
                    {
                        sink.Add(BuildHmiTargetDto(hmi, parentDevice, item, warnings));
                    }
                    catch (Exception ex)
                    {
                        warnings.Add($"HMI target '{SafeName(parentDevice)}': {ex.Message}");
                    }
                    continue;  // don't keep descending under an HMI software item.
                }

                try { FindHmiTargetsRecursive(item.DeviceItems, parentDevice, sink, warnings); }
                catch { }
            }
        }

        private ExtractedHmiTargetDto BuildHmiTargetDto(HmiTarget hmi, Device parentDevice, DeviceItem hostItem, List<string> warnings)
        {
            var dto = new ExtractedHmiTargetDto
            {
                Name = SafeName(hmi),
                DeviceName = SafeName(parentDevice),
                TypeId = SafeTypeId(parentDevice),
                PanelClass = hmi.GetType().Name,
            };

            // parentDevice.TypeIdentifier is often a System:Device.* handle (e.g. "System:Device.PC"
            // for WinCC RT Advanced) which has no embedded MLFB. Walk the DeviceItem subtree to find
            // the first child whose TypeIdentifier carries an OrderNumber — that's the panel catalog
            // handle we actually want (e.g. "OrderNumber:6AV2 124-0MC01-0AX0/15.1.0.0").
            string mlfbTypeId = FindFirstOrderNumberTypeId(parentDevice.DeviceItems) ?? dto.TypeId;
            dto.OrderNumber = ParseMlfb(mlfbTypeId);
            dto.FirmwareVersion = ParseFirmwareVersion(mlfbTypeId);

            // IP + station name — walk device items for a PROFINET interface.
            var netInfo = TryReadPrimaryNetworkAddress(parentDevice.DeviceItems);
            if (netInfo != null)
            {
                dto.IpAddress = netInfo.Item1;
                dto.StationName = netInfo.Item2;
            }

            // Screen inventory.
            try
            {
                var screens = new List<Siemens.Engineering.Hmi.Screen.Screen>();
                CollectScreensWithPaths(hmi.ScreenFolder, "", screens, dto.Screens);
                dto.ScreenCount = screens.Count;
            }
            catch (Exception ex)
            {
                warnings.Add($"HMI '{dto.Name}' screens: {ex.Message}");
            }

            // Tag-table count (names-only — full contents come through the existing HMI export path).
            try
            {
                int n = 0;
                foreach (var _ in hmi.TagFolder.TagTables) n++;
                dto.TagTableCount = n;
            }
            catch (Exception ex)
            {
                warnings.Add($"HMI '{dto.Name}' tag tables: {ex.Message}");
            }

            return dto;
        }

        private void CollectScreensWithPaths(
            ScreenFolder folder,
            string pathSoFar,
            List<Siemens.Engineering.Hmi.Screen.Screen> flat,
            List<ExtractedHmiScreenDto> dtoSink)
        {
            if (folder == null) return;
            try
            {
                foreach (var screen in folder.Screens)
                {
                    flat.Add(screen);
                    int? number = null;
                    try
                    {
                        var prop = screen.GetType().GetProperty("Number");
                        if (prop != null) number = prop.GetValue(screen) as int?;
                    }
                    catch { }
                    dtoSink.Add(new ExtractedHmiScreenDto
                    {
                        Name = screen.Name,
                        FolderPath = pathSoFar,
                        Number = number,
                    });
                }
            }
            catch { }

            try
            {
                foreach (var sub in folder.Folders)
                {
                    string childPath = string.IsNullOrEmpty(pathSoFar) ? sub.Name : pathSoFar + "/" + sub.Name;
                    CollectScreensWithPaths(sub, childPath, flat, dtoSink);
                }
            }
            catch { }
        }

        /// <summary>Returns (ip, stationName) of the first interface that exposes them, or null.</summary>
        private static Tuple<string, string> TryReadPrimaryNetworkAddress(DeviceItemComposition items)
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
                            // Nodes is the collection of PN interface nodes on this device.
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

                var nested = TryReadPrimaryNetworkAddress(item.DeviceItems);
                if (nested != null) return nested;
            }
            return null;
        }

        // ─── Small helpers shared by this file ────────────────────

        private static string SafeName(IEngineeringObject obj)
        {
            if (obj == null) return null;
            try { return (string)obj.GetType().GetProperty("Name")?.GetValue(obj); }
            catch { return null; }
        }

        private static string SafeTypeId(IEngineeringObject obj)
        {
            if (obj == null) return null;
            try { return (string)obj.GetType().GetProperty("TypeIdentifier")?.GetValue(obj); }
            catch { return null; }
        }

        /// <summary>
        /// Yields every top-level Device in the project. TIA V20 splits devices across several
        /// collections: `Project.Devices` holds ungrouped stations directly added to the project
        /// root, while `Project.UngroupedDevicesGroup.Devices` holds PROFINET I/O slaves and
        /// GSD-imported devices (e.g. ET200SP heads, Beckhoff couplers). User-organized folders
        /// live in `Project.DeviceGroups`. Walking only `Project.Devices` misses remote I/O
        /// entirely — this helper unifies them so every device flows through the extractors.
        /// </summary>
        internal IEnumerable<Device> EnumerateAllTopLevelDevices()
        {
            if (_project == null) yield break;

            // 1. Canonical `Project.Devices`.
            IEnumerable canonical = null;
            try { canonical = _project.Devices; } catch { }
            if (canonical != null)
            {
                foreach (Device d in canonical) yield return d;
            }

            // 2. `Project.UngroupedDevicesGroup.Devices` + nested Groups (reflection — property
            //    is present on V17+ but not part of the strongly-typed Project surface we use).
            object ungrouped = null;
            try { ungrouped = _project.GetType().GetProperty("UngroupedDevicesGroup")?.GetValue(_project); } catch { }
            if (ungrouped != null)
            {
                foreach (Device d in EnumerateFromDeviceGroup(ungrouped)) yield return d;
            }

            // 3. `Project.DeviceGroups` — user-created folders (may be empty).
            IEnumerable userGroups = null;
            try { userGroups = _project.DeviceGroups; } catch { }
            if (userGroups != null)
            {
                foreach (var g in userGroups)
                    foreach (Device d in EnumerateFromDeviceGroup(g)) yield return d;
            }
        }

        private static IEnumerable<Device> EnumerateFromDeviceGroup(object group)
        {
            if (group == null) yield break;
            Type t = group.GetType();

            IEnumerable devices = null;
            try { devices = t.GetProperty("Devices")?.GetValue(group) as IEnumerable; } catch { }
            if (devices != null)
            {
                foreach (Device d in devices) yield return d;
            }

            IEnumerable subGroups = null;
            try { subGroups = t.GetProperty("Groups")?.GetValue(group) as IEnumerable; } catch { }
            if (subGroups != null)
            {
                foreach (var sub in subGroups)
                    foreach (Device d in EnumerateFromDeviceGroup(sub)) yield return d;
            }
        }

        /// <summary>
        /// Walks a DeviceItem tree depth-first and returns the first TypeIdentifier that starts
        /// with `OrderNumber:` — i.e. the first item carrying a real catalog handle. Used to recover
        /// MLFB/firmware for devices whose root TypeIdentifier is a generic `System:Device.*` stub.
        /// </summary>
        private static string FindFirstOrderNumberTypeId(DeviceItemComposition items)
        {
            if (items == null) return null;
            foreach (DeviceItem item in items)
            {
                string tid = null;
                try { tid = item.TypeIdentifier; } catch { }
                if (!string.IsNullOrEmpty(tid) && tid.StartsWith("OrderNumber:", StringComparison.OrdinalIgnoreCase))
                    return tid;

                try
                {
                    string nested = FindFirstOrderNumberTypeId(item.DeviceItems);
                    if (nested != null) return nested;
                }
                catch { }
            }
            return null;
        }

        /// <summary>
        /// Parses the catalog number (MLFB) out of a TypeIdentifier like
        /// `"OrderNumber:6ES7 521-1BH50-0AA0/V1.2"` → `"6ES7 521-1BH50-0AA0"`.
        /// Returns null for GSD-keyed identifiers (`"GSD:..."`) or anything without an OrderNumber prefix.
        /// </summary>
        internal static string ParseMlfb(string typeIdentifier)
        {
            if (string.IsNullOrEmpty(typeIdentifier)) return null;
            var m = Regex.Match(typeIdentifier, @"OrderNumber:\s*(?<order>[^/]+)",
                                 RegexOptions.IgnoreCase);
            return m.Success ? m.Groups["order"].Value.Trim() : null;
        }

        /// <summary>
        /// Parses the firmware version out of a TypeIdentifier like
        /// `"OrderNumber:6ES7 521-1BH50-0AA0/V1.2"` → `"V1.2"`. Returns null when absent.
        /// </summary>
        internal static string ParseFirmwareVersion(string typeIdentifier)
        {
            if (string.IsNullOrEmpty(typeIdentifier)) return null;
            var m = Regex.Match(typeIdentifier, @"OrderNumber:\s*[^/]+/(?<fw>.+)",
                                 RegexOptions.IgnoreCase);
            return m.Success ? m.Groups["fw"].Value.Trim() : null;
        }

        // ─── Phase 2: device classification + drive details (§16 step 4) ─────────

        /// <summary>
        /// Returns the directory holding the open project — parent of the `.ap*` file.
        /// Null when the project isn't open or the path can't be read.
        /// </summary>
        private string GetOpenProjectDirectory()
        {
            try
            {
                string ap = _project?.Path?.FullName;
                return string.IsNullOrEmpty(ap) ? null : Path.GetDirectoryName(ap);
            }
            catch { return null; }
        }

        /// <summary>
        /// Walks all top-level devices and enriches each ExtractedDeviceDto (found in
        /// hardware.Devices) with Comment, Category, VendorName, GsdmlFilename, IpAddress,
        /// StationName. Also returns per-drive details for every device classified as a
        /// Sinamics drive. See PAC_AUDIT_DERIVED_SPEC §12.6 + §16 step 4.
        /// </summary>
        internal void ClassifyAndExtractDrives(
            ExtractedHardwareDto hardware,
            List<ExtractedDriveDetailDto> driveDetails,
            List<string> warnings)
        {
            if (hardware == null || _project == null) return;

            var sw = Stopwatch.StartNew();

            // Load project-local GSDMLs — confirmed path per §12.0 (§12.6): <project_dir>/AdditionalFiles/GSD.
            var gsdml = new GsdmlLoader();
            string projectDir = GetOpenProjectDirectory();
            if (!string.IsNullOrEmpty(projectDir))
            {
                gsdml.LoadFromProjectDirectory(projectDir, warnings);
            }
            else
            {
                warnings.Add("Device classification: could not resolve open-project directory — proceeding without GSDMLs.");
            }
            Console.WriteLine($"[Audit hw] GSDML loader: {gsdml.FileCount} file(s) parsed from {projectDir ?? "<unknown>"}");

            // Index the device DTOs by name for quick merge-in.
            var dtoByName = new Dictionary<string, ExtractedDeviceDto>(StringComparer.Ordinal);
            foreach (var dto in hardware.Devices)
            {
                if (!string.IsNullOrEmpty(dto.Name) && !dtoByName.ContainsKey(dto.Name))
                    dtoByName[dto.Name] = dto;
            }

            int classified = 0, drivesExtracted = 0;

            foreach (Device device in EnumerateAllTopLevelDevices())
            {
                string deviceName = SafeName(device);
                if (!dtoByName.TryGetValue(deviceName ?? "", out var dto))
                {
                    // Device didn't make it into the earlier ExtractHardwareConfig pass (schema drift) —
                    // synthesise a lightweight entry so classification still lands somewhere.
                    dto = new ExtractedDeviceDto
                    {
                        Name = deviceName,
                        TypeId = SafeTypeId(device),
                        OrderNumber = ParseMlfb(SafeTypeId(device)),
                        FirmwareVersion = ParseFirmwareVersion(SafeTypeId(device)),
                    };
                    hardware.Devices.Add(dto);
                    if (deviceName != null) dtoByName[deviceName] = dto;
                }

                // Comment attribute — primary physical-device label (§12.6).
                try { dto.Comment = device.GetAttribute("Comment") as string; } catch { }
                // Some drives carry the Comment on the Device wrapper; others on the drive DeviceItem.
                // Walk children for the first non-empty Comment when the top-level is blank.
                if (string.IsNullOrEmpty(dto.Comment))
                {
                    dto.Comment = FindFirstComment(device.DeviceItems);
                }

                // Find a drive-shaped DeviceItem under this device (typically one child with OrderNumber
                // starting with "6SL"). Used for DriveExtractor AND for TypeIdentifier-driven classification
                // when the top-level Device TypeIdentifier is the generic "System:Device.<family>" stub.
                DeviceItem driveItem = FindDriveItem(device.DeviceItems);
                string driveItemTid = null;
                try { driveItemTid = driveItem?.TypeIdentifier; } catch { }
                string gsdmlFile = GsdmlLoader.ExtractGsdmlFilename(SafeTypeId(device))
                                ?? GsdmlLoader.ExtractGsdmlFilename(driveItemTid);
                dto.GsdmlFilename = gsdmlFile;

                // Resolve GSDML — prefer the Device TypeIdentifier, then driveItem, then order number.
                ParsedGsdml parsed = gsdml.LookupByTypeIdentifier(SafeTypeId(device));
                if (parsed == null && !string.IsNullOrEmpty(driveItemTid))
                    parsed = gsdml.LookupByTypeIdentifier(driveItemTid);
                if (parsed == null && !string.IsNullOrEmpty(dto.OrderNumber))
                    parsed = gsdml.LookupByOrderNumber(dto.OrderNumber);

                // Classify. For Sinamics drives the GSDML's first-DAP OrderNumber is
                // often a list of MLFBs that don't look like drive frames — the concrete
                // drive-item TypeIdentifier carries the real MLFB, so prefer that as
                // the classifier input.
                string tidForClass = driveItemTid;
                if (string.IsNullOrEmpty(tidForClass)) tidForClass = SafeTypeId(device);
                var cls = RollerCardClassifier.Classify(deviceName, tidForClass, parsed);
                dto.Category = cls.Category;
                dto.VendorName = cls.VendorName ?? parsed?.VendorName;
                // Second-pass subfamily upgrade — when the GSDML path matched but
                // couldn't pin a subfamily (generic "drive.sinamics"), try the
                // drive-item MLFB which is always concrete.
                if (dto.Category == "drive.sinamics" && !string.IsNullOrEmpty(driveItemTid))
                {
                    string mlfb = ParseMlfb(driveItemTid);
                    string sub = InferSinamicsSubfamilyFromMlfb(mlfb);
                    if (sub != null) dto.Category = "drive.sinamics." + sub;
                }
                if (dto.Category != null) classified++;

                // IP + station name — walk to find first PN interface.
                var net = TryReadPrimaryNetworkAddress(device.DeviceItems);
                if (net != null)
                {
                    if (string.IsNullOrEmpty(dto.IpAddress)) dto.IpAddress = net.Item1;
                    if (string.IsNullOrEmpty(dto.StationName)) dto.StationName = net.Item2;
                }

                // Drive detail extraction — only when category marks the device as a Sinamics drive.
                if (dto.Category != null && dto.Category.StartsWith("drive.sinamics", StringComparison.Ordinal)
                    && driveItem != null)
                {
                    try
                    {
                        var detail = DriveExtractor.Extract(device, driveItem, warnings);
                        if (detail != null)
                        {
                            // Copy forward fields the classifier already resolved.
                            if (string.IsNullOrEmpty(detail.Comment)) detail.Comment = dto.Comment;
                            if (string.IsNullOrEmpty(detail.IpAddress)) detail.IpAddress = dto.IpAddress;
                            if (string.IsNullOrEmpty(detail.StationName)) detail.StationName = dto.StationName;
                            driveDetails.Add(detail);
                            drivesExtracted++;
                        }
                    }
                    catch (Exception ex)
                    {
                        warnings.Add($"Drive extract '{deviceName}': {ex.Message}");
                    }
                }
            }

            sw.Stop();
            Console.WriteLine($"[Audit hw] classification + drives: {classified} categorised, {drivesExtracted} drive details in {sw.Elapsed.TotalSeconds:F1}s");
        }

        /// <summary>
        /// Depth-first walk for the first DeviceItem whose TypeIdentifier is a SINAMICS
        /// OrderNumber (6SL*) — the child that actually owns the DriveObjectContainer service.
        /// On catalog-placed G120C drives this is typically one level below the Device root.
        /// </summary>
        private static DeviceItem FindDriveItem(DeviceItemComposition items)
        {
            if (items == null) return null;
            foreach (DeviceItem item in items)
            {
                string tid = null;
                try { tid = item.TypeIdentifier; } catch { }
                if (!string.IsNullOrEmpty(tid))
                {
                    var m = Regex.Match(tid, @"OrderNumber:\s*6SL", RegexOptions.IgnoreCase);
                    if (m.Success) return item;
                }
                DeviceItem nested = null;
                try { nested = FindDriveItem(item.DeviceItems); } catch { }
                if (nested != null) return nested;
            }
            return null;
        }

        /// <summary>
        /// Maps a SINAMICS MLFB to its subfamily label ("g120c"/"g120"/"s120"/"s210"/"v90").
        /// Mirrors the logic in DriveExtractor but kept local so the classifier doesn't need
        /// to depend on reflected drive types. Null when the MLFB isn't a recognised Sinamics.
        /// </summary>
        private static string InferSinamicsSubfamilyFromMlfb(string mlfb)
        {
            if (string.IsNullOrEmpty(mlfb)) return null;
            string m = mlfb.Replace(" ", "").ToUpperInvariant();
            if (m.StartsWith("6SL3210-5") || m.StartsWith("6SL35")) return "v90";
            if (m.StartsWith("6SL3210")) return "g120c";
            if (m.StartsWith("6SL3224")) return "g120";
            if (m.StartsWith("6SL312") || m.StartsWith("6SL313")) return "s120";
            if (m.StartsWith("6SL350") || m.StartsWith("6SL351")) return "s210";
            return null;
        }

        /// <summary>
        /// First non-empty `Comment` attribute across a DeviceItem subtree. Used when the top-level
        /// Device has no Comment but a child DeviceItem does (happens when the engineer tagged the
        /// drive station rather than the logical device).
        /// </summary>
        private static string FindFirstComment(DeviceItemComposition items)
        {
            if (items == null) return null;
            foreach (DeviceItem item in items)
            {
                try
                {
                    string c = item.GetAttribute("Comment") as string;
                    if (!string.IsNullOrEmpty(c)) return c;
                }
                catch { }
                try
                {
                    string nested = FindFirstComment(item.DeviceItems);
                    if (!string.IsNullOrEmpty(nested)) return nested;
                }
                catch { }
            }
            return null;
        }
    }
}
