using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Xml.Linq;

namespace PacForgeBridge.HardwareExtractors
{
    // ============================================================
    // GSDML parser
    //
    // Parses PROFINET Generic Station Description files (GSDML v2.x) into a typed
    // structure that downstream extractors (DriveExtractor, RollerCardClassifier,
    // IoLinkMasterWalker, PartnerPlcExtractor) interpret.
    //
    // The parser is schema-tolerant: it targets v2.31–v2.44 as seen in real projects
    // (CVL-2129 test set) but only reads elements it cares about, so newer minor
    // revisions that only add fields pass through unchanged.
    //
    // Namespace: http://www.profibus.com/GSDML/2003/11/DeviceProfile
    //
    // These DTOs are bridge-internal — never JSON-serialised. Downstream extractors
    // convert them to the JSON-facing shapes in Models.cs.
    //
    // See PAC_AUDIT_DERIVED_SPEC.md §12.6 + step 0 spike output
    // audit_spike_20260421_200754/gsdml__cache_paths.json.
    // ============================================================
    public class GsdmlParser
    {
        private static readonly XNamespace NsDeviceProfile =
            "http://www.profibus.com/GSDML/2003/11/DeviceProfile";

        // SHA → parsed result. Keyed by file-content hash so the same GSDML shipped under
        // a different filename is only parsed once. Instance-level (not static) so each
        // bridge session starts clean; lifetime matches the bridge process.
        private readonly Dictionary<string, ParsedGsdml> _cache =
            new Dictionary<string, ParsedGsdml>(StringComparer.Ordinal);

        /// <summary>
        /// Parse a GSDML file from disk. Returns the cached result if the file's SHA
        /// has been seen before, otherwise parses and caches.
        /// </summary>
        public ParsedGsdml Parse(string filePath)
        {
            if (string.IsNullOrEmpty(filePath)) throw new ArgumentException("filePath");
            if (!File.Exists(filePath)) throw new FileNotFoundException(filePath);

            byte[] bytes = File.ReadAllBytes(filePath);
            string sha = ComputeSha256Hex(bytes);
            if (_cache.TryGetValue(sha, out var cached))
                return cached;

            string content = Encoding.UTF8.GetString(bytes);
            var parsed = ParseContent(content, Path.GetFileName(filePath), sha);
            _cache[sha] = parsed;
            return parsed;
        }

        /// <summary>
        /// Parse GSDML content from a string. Useful for tests or when content is held in memory.
        /// </summary>
        public ParsedGsdml ParseContent(string xmlContent, string sourceFilename, string precomputedSha = null)
        {
            string sha = precomputedSha ?? ComputeSha256Hex(Encoding.UTF8.GetBytes(xmlContent));

            // Strip UTF-8 BOM if present — Siemens ships SINAMICS GSDMLs with a BOM, Beckhoff doesn't.
            // XDocument.Parse(string) rejects BOMs; Load(Stream) handles them, but staying with Parse
            // keeps ParseContent usable for in-memory strings.
            if (!string.IsNullOrEmpty(xmlContent) && xmlContent[0] == '﻿')
                xmlContent = xmlContent.Substring(1);

            XDocument doc;
            try { doc = XDocument.Parse(xmlContent); }
            catch (Exception ex) { throw new InvalidDataException($"GSDML '{sourceFilename}' is not valid XML: {ex.Message}", ex); }

            XElement root = doc.Root;
            if (root == null || root.Name.LocalName != "ISO15745Profile")
                throw new InvalidDataException($"GSDML '{sourceFilename}' root is not ISO15745Profile (got {root?.Name.LocalName ?? "null"})");

            XElement profileBody = root.Element(NsDeviceProfile + "ProfileBody");
            if (profileBody == null)
                throw new InvalidDataException($"GSDML '{sourceFilename}' has no ProfileBody");

            var result = new ParsedGsdml
            {
                ContentSha = sha,
                SourceFilename = sourceFilename,
                SchemaVersion = ReadSchemaVersionHint(root),
            };

            // Device identity (vendor + device ID + vendor name)
            XElement deviceIdentity = profileBody.Element(NsDeviceProfile + "DeviceIdentity");
            if (deviceIdentity != null)
            {
                result.VendorId = ParseHexOrInt(Attr(deviceIdentity, "VendorID"));
                result.DeviceId = ParseHexOrInt(Attr(deviceIdentity, "DeviceID"));
                XElement vendorName = deviceIdentity.Element(NsDeviceProfile + "VendorName");
                result.VendorName = Attr(vendorName, "Value");
            }

            // Device family hint (Drives / I/O / Safety / HMI / ...)
            XElement deviceFunction = profileBody.Element(NsDeviceProfile + "DeviceFunction");
            XElement topFamily = deviceFunction?.Element(NsDeviceProfile + "Family");
            result.MainFamily = Attr(topFamily, "MainFamily");
            result.ProductFamily = Attr(topFamily, "ProductFamily");

            XElement applicationProcess = profileBody.Element(NsDeviceProfile + "ApplicationProcess");
            if (applicationProcess == null) return result;  // nothing else to parse

            // External text list — PrimaryLanguage (English) only for v1.
            // Localised languages (de/es/fr/it/zh) are present but we don't surface them.
            result.Texts = ReadPrimaryLanguageTexts(applicationProcess);

            // Value list — parameter enum maps
            result.ValueEnums = ReadValueEnums(applicationProcess, result.Texts);

            // Device access points (firmware variants of the device)
            XElement dapList = applicationProcess.Element(NsDeviceProfile + "DeviceAccessPointList");
            if (dapList != null)
            {
                foreach (XElement dap in dapList.Elements(NsDeviceProfile + "DeviceAccessPointItem"))
                {
                    result.DeviceAccessPoints.Add(ParseDap(dap, result.Texts));
                }
            }

            // Module list — pluggable modules (drives have IDM_DRIVE; IO blocks have DIO_MASTER etc.)
            XElement moduleList = applicationProcess.Element(NsDeviceProfile + "ModuleList");
            if (moduleList != null)
            {
                foreach (XElement mod in moduleList.Elements(NsDeviceProfile + "ModuleItem"))
                {
                    result.Modules.Add(ParseModule(mod, result.Texts));
                }
            }

            // Submodule list — for drives these are telegrams (TEL1, TEL20, TEL352, etc.);
            // for IO blocks these are individual DI/DO/AI/AO channels.
            XElement submoduleList = applicationProcess.Element(NsDeviceProfile + "SubmoduleList");
            if (submoduleList != null)
            {
                foreach (XElement sm in submoduleList.Elements(NsDeviceProfile + "SubmoduleItem"))
                {
                    result.Submodules.Add(ParseSubmodule(sm, result.Texts));
                }
            }

            return result;
        }

        // ── Sub-parsers ────────────────────────────────────────────

        private GsdmlDap ParseDap(XElement dap, Dictionary<string, string> texts)
        {
            var d = new GsdmlDap
            {
                Id = Attr(dap, "ID"),
                DnsCompatibleName = Attr(dap, "DNS_CompatibleName"),
                PhysicalSlots = Attr(dap, "PhysicalSlots"),
                ModuleIdentNumber = ParseHexOrIntNullable(Attr(dap, "ModuleIdentNumber")),
            };

            XElement modInfo = dap.Element(NsDeviceProfile + "ModuleInfo");
            if (modInfo != null)
            {
                d.Name = ResolveText(modInfo.Element(NsDeviceProfile + "Name"), texts);
                d.InfoText = ResolveText(modInfo.Element(NsDeviceProfile + "InfoText"), texts);
                d.OrderNumber = Attr(modInfo.Element(NsDeviceProfile + "OrderNumber"), "Value");
                d.HardwareRelease = Attr(modInfo.Element(NsDeviceProfile + "HardwareRelease"), "Value");
                d.SoftwareRelease = Attr(modInfo.Element(NsDeviceProfile + "SoftwareRelease"), "Value");
                XElement fam = modInfo.Element(NsDeviceProfile + "Family");
                if (fam != null)
                {
                    d.MainFamily = Attr(fam, "MainFamily");
                    d.ProductFamily = Attr(fam, "ProductFamily");
                }
            }

            XElement certInfo = dap.Element(NsDeviceProfile + "CertificationInfo");
            XElement profList = certInfo?.Element(NsDeviceProfile + "ProfileList");
            if (profList != null)
            {
                foreach (XElement p in profList.Elements(NsDeviceProfile + "ProfileItem"))
                {
                    string name = Attr(p, "ProfileName");
                    if (!string.IsNullOrEmpty(name)) d.SupportedProfiles.Add(name);
                }
            }

            XElement ioCfg = dap.Element(NsDeviceProfile + "IOConfigData");
            if (ioCfg != null)
            {
                d.MaxInputLength = ParseIntNullable(Attr(ioCfg, "MaxInputLength"));
                d.MaxOutputLength = ParseIntNullable(Attr(ioCfg, "MaxOutputLength"));
            }

            XElement useable = dap.Element(NsDeviceProfile + "UseableModules");
            if (useable != null)
            {
                foreach (XElement r in useable.Elements(NsDeviceProfile + "ModuleItemRef"))
                {
                    string target = Attr(r, "ModuleItemTarget");
                    if (!string.IsNullOrEmpty(target)) d.UseableModuleIds.Add(target);
                }
            }

            // Virtual + system-defined submodules embedded in the DAP (interface, ports, DAP-level submodule).
            // Keep ID refs only — full definitions live in SubmoduleList.
            foreach (XElement container in new[]
            {
                dap.Element(NsDeviceProfile + "VirtualSubmoduleList"),
                dap.Element(NsDeviceProfile + "SystemDefinedSubmoduleList"),
            })
            {
                if (container == null) continue;
                foreach (XElement sm in container.Elements())
                {
                    string id = Attr(sm, "ID");
                    if (!string.IsNullOrEmpty(id)) d.EmbeddedSubmoduleIds.Add(id);
                }
            }

            return d;
        }

        private GsdmlModule ParseModule(XElement mod, Dictionary<string, string> texts)
        {
            var m = new GsdmlModule
            {
                Id = Attr(mod, "ID"),
                ModuleIdentNumber = ParseHexOrIntNullable(Attr(mod, "ModuleIdentNumber")),
                PhysicalSubslots = Attr(mod, "PhysicalSubslots"),
            };

            XElement modInfo = mod.Element(NsDeviceProfile + "ModuleInfo");
            if (modInfo != null)
            {
                m.Name = ResolveText(modInfo.Element(NsDeviceProfile + "Name"), texts);
                m.InfoText = ResolveText(modInfo.Element(NsDeviceProfile + "InfoText"), texts);
                m.OrderNumber = Attr(modInfo.Element(NsDeviceProfile + "OrderNumber"), "Value");
            }

            XElement useable = mod.Element(NsDeviceProfile + "UseableSubmodules");
            if (useable != null)
            {
                foreach (XElement r in useable.Elements(NsDeviceProfile + "SubmoduleItemRef"))
                {
                    string target = Attr(r, "SubmoduleItemTarget");
                    string allowedSubslots = Attr(r, "AllowedInSubslots");
                    if (!string.IsNullOrEmpty(target))
                    {
                        m.UseableSubmodules.Add(new GsdmlUseableSubmoduleRef
                        {
                            SubmoduleId = target,
                            AllowedInSubslots = allowedSubslots,
                            FixedInSubslots = Attr(r, "FixedInSubslots"),
                        });
                    }
                }
            }

            // VirtualSubmoduleList directly on the module (rare for modules, common for DAPs)
            XElement vsml = mod.Element(NsDeviceProfile + "VirtualSubmoduleList");
            if (vsml != null)
            {
                foreach (XElement sm in vsml.Elements(NsDeviceProfile + "VirtualSubmoduleItem"))
                {
                    string id = Attr(sm, "ID");
                    if (!string.IsNullOrEmpty(id)) m.EmbeddedSubmoduleIds.Add(id);
                }
            }

            return m;
        }

        private GsdmlSubmodule ParseSubmodule(XElement sm, Dictionary<string, string> texts)
        {
            var s = new GsdmlSubmodule
            {
                Id = Attr(sm, "ID"),
                SubmoduleIdentNumber = ParseHexOrIntNullable(Attr(sm, "SubmoduleIdentNumber")),
                Api = ParseIntNullable(Attr(sm, "API")),
                ProfiSafeSupported = string.Equals(Attr(sm, "PROFIsafeSupported"), "1", StringComparison.Ordinal)
                                  || string.Equals(Attr(sm, "PROFIsafeSupported"), "true", StringComparison.OrdinalIgnoreCase),
            };

            XElement modInfo = sm.Element(NsDeviceProfile + "ModuleInfo");
            if (modInfo != null)
            {
                s.Name = ResolveText(modInfo.Element(NsDeviceProfile + "Name"), texts);
                s.InfoText = ResolveText(modInfo.Element(NsDeviceProfile + "InfoText"), texts);
            }

            XElement ioData = sm.Element(NsDeviceProfile + "IOData");
            if (ioData != null)
            {
                s.IopsLength = ParseIntNullable(Attr(ioData, "IOPS_Length"));
                s.IocsLength = ParseIntNullable(Attr(ioData, "IOCS_Length"));

                XElement input = ioData.Element(NsDeviceProfile + "Input");
                if (input != null) ReadDataItems(input, s.Inputs, texts);
                XElement output = ioData.Element(NsDeviceProfile + "Output");
                if (output != null) ReadDataItems(output, s.Outputs, texts);

                s.InputByteLength = DataItemsByteLength(s.Inputs);
                s.OutputByteLength = DataItemsByteLength(s.Outputs);
            }

            // Parameter records — Index + per-Ref value items
            XElement recList = sm.Element(NsDeviceProfile + "RecordDataList");
            if (recList != null)
            {
                foreach (XElement rec in recList.Elements(NsDeviceProfile + "ParameterRecordDataItem"))
                {
                    var pr = new GsdmlParameterRecord
                    {
                        Index = ParseIntNullable(Attr(rec, "Index")),
                        Length = ParseIntNullable(Attr(rec, "Length")),
                        TransferSequence = ParseIntNullable(Attr(rec, "TransferSequence")),
                        Name = ResolveText(rec.Element(NsDeviceProfile + "Name"), texts),
                    };
                    foreach (XElement refEl in rec.Elements(NsDeviceProfile + "Ref"))
                    {
                        pr.Refs.Add(new GsdmlParameterRef
                        {
                            ValueItemTarget = Attr(refEl, "ValueItemTarget"),
                            DataType = Attr(refEl, "DataType"),
                            ByteOffset = ParseIntNullable(Attr(refEl, "ByteOffset")),
                            Length = ParseIntNullable(Attr(refEl, "Length")),
                            DefaultValue = Attr(refEl, "DefaultValue"),
                            AllowedValues = Attr(refEl, "AllowedValues"),
                            Changeable = string.Equals(Attr(refEl, "Changeable"), "true", StringComparison.OrdinalIgnoreCase),
                            Visible = string.Equals(Attr(refEl, "Visible"), "true", StringComparison.OrdinalIgnoreCase),
                            Text = ResolveTextById(Attr(refEl, "TextId"), texts),
                        });
                    }
                    s.Parameters.Add(pr);
                }
            }

            return s;
        }

        private void ReadDataItems(XElement container, List<GsdmlDataItem> sink, Dictionary<string, string> texts)
        {
            foreach (XElement di in container.Elements(NsDeviceProfile + "DataItem"))
            {
                string dataType = Attr(di, "DataType");
                sink.Add(new GsdmlDataItem
                {
                    DataType = dataType,
                    ByteLength = DataTypeBytes(dataType),
                    UseAsBits = string.Equals(Attr(di, "UseAsBits"), "true", StringComparison.OrdinalIgnoreCase),
                    TextId = Attr(di, "TextId"),
                    Text = ResolveTextById(Attr(di, "TextId"), texts),
                });
            }
        }

        private Dictionary<string, string> ReadPrimaryLanguageTexts(XElement applicationProcess)
        {
            var map = new Dictionary<string, string>(StringComparer.Ordinal);
            XElement extList = applicationProcess.Element(NsDeviceProfile + "ExternalTextList");
            if (extList == null) return map;

            XElement primary = extList.Element(NsDeviceProfile + "PrimaryLanguage");
            if (primary == null) return map;

            foreach (XElement t in primary.Elements(NsDeviceProfile + "Text"))
            {
                string id = Attr(t, "TextId");
                string val = Attr(t, "Value");
                if (!string.IsNullOrEmpty(id)) map[id] = val ?? string.Empty;
            }
            return map;
        }

        private Dictionary<string, Dictionary<string, string>> ReadValueEnums(
            XElement applicationProcess,
            Dictionary<string, string> texts)
        {
            var enums = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
            XElement valueList = applicationProcess.Element(NsDeviceProfile + "ValueList");
            if (valueList == null) return enums;

            foreach (XElement vi in valueList.Elements(NsDeviceProfile + "ValueItem"))
            {
                string id = Attr(vi, "ID");
                if (string.IsNullOrEmpty(id)) continue;
                var map = new Dictionary<string, string>(StringComparer.Ordinal);
                XElement assignments = vi.Element(NsDeviceProfile + "Assignments");
                if (assignments != null)
                {
                    foreach (XElement a in assignments.Elements(NsDeviceProfile + "Assign"))
                    {
                        string content = Attr(a, "Content");
                        if (string.IsNullOrEmpty(content)) continue;
                        map[content] = ResolveTextById(Attr(a, "TextId"), texts);
                    }
                }
                enums[id] = map;
            }
            return enums;
        }

        // ── Helpers ────────────────────────────────────────────────

        private static string Attr(XElement el, string name)
        {
            if (el == null) return null;
            XAttribute a = el.Attribute(name);
            return a?.Value;
        }

        /// <summary>Resolves the TextId attribute on a &lt;Name&gt; or &lt;InfoText&gt; element to its primary-language string.</summary>
        private static string ResolveText(XElement el, Dictionary<string, string> texts)
        {
            if (el == null) return null;
            string id = Attr(el, "TextId");
            return ResolveTextById(id, texts);
        }

        private static string ResolveTextById(string textId, Dictionary<string, string> texts)
        {
            if (string.IsNullOrEmpty(textId)) return null;
            if (texts != null && texts.TryGetValue(textId, out var val)) return val;
            return textId;  // fall back to the ID itself so the caller never loses the signal
        }

        private static int ParseHexOrInt(string raw)
        {
            return ParseHexOrIntNullable(raw) ?? 0;
        }

        private static int? ParseHexOrIntNullable(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return null;
            raw = raw.Trim();
            try
            {
                if (raw.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ||
                    raw.StartsWith("0X", StringComparison.Ordinal))
                    return Convert.ToInt32(raw.Substring(2), 16);
                return int.Parse(raw, System.Globalization.CultureInfo.InvariantCulture);
            }
            catch { return null; }
        }

        private static int? ParseIntNullable(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return null;
            return int.TryParse(raw.Trim(), System.Globalization.NumberStyles.Integer,
                                System.Globalization.CultureInfo.InvariantCulture, out int v) ? (int?)v : null;
        }

        /// <summary>Byte width of a GSDML DataType. Returns 0 for unknowns; callers treat 0 as "don't aggregate".</summary>
        private static int DataTypeBytes(string dataType)
        {
            if (string.IsNullOrEmpty(dataType)) return 0;
            switch (dataType)
            {
                case "Bit":
                case "BitArea":
                case "Integer8":
                case "Unsigned8":
                case "OctetString":
                    return 1;
                case "Integer16":
                case "Unsigned16":
                    return 2;
                case "Integer32":
                case "Unsigned32":
                case "Float32":
                    return 4;
                case "Integer64":
                case "Unsigned64":
                case "Float64":
                    return 8;
                default:
                    return 0;
            }
        }

        private static int DataItemsByteLength(List<GsdmlDataItem> items)
        {
            int sum = 0;
            foreach (var di in items) sum += di.ByteLength;
            return sum;
        }

        private static string ReadSchemaVersionHint(XElement root)
        {
            // xsi:schemaLocation path hints at the version, e.g. "..\xsd\GSDML-DeviceProfile-V2.31.xsd"
            var loc = (string)root.Attribute(XNamespace.Get("http://www.w3.org/2001/XMLSchema-instance") + "schemaLocation");
            if (string.IsNullOrEmpty(loc)) return null;
            int ix = loc.IndexOf("GSDML-DeviceProfile-", StringComparison.OrdinalIgnoreCase);
            if (ix < 0) return null;
            int start = ix + "GSDML-DeviceProfile-".Length;
            int end = loc.IndexOf(".xsd", start, StringComparison.OrdinalIgnoreCase);
            return end > start ? loc.Substring(start, end - start) : null;
        }

        private static string ComputeSha256Hex(byte[] bytes)
        {
            using (var sha = SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(bytes);
                var sb = new StringBuilder(hash.Length * 2);
                foreach (byte b in hash) sb.Append(b.ToString("x2"));
                return sb.ToString();
            }
        }
    }

    // ── DTOs (bridge-internal) ────────────────────────────────────

    public class ParsedGsdml
    {
        public string ContentSha { get; set; }
        public string SourceFilename { get; set; }
        public string SchemaVersion { get; set; }   // e.g. "V2.31"

        public int VendorId { get; set; }
        public int DeviceId { get; set; }
        public string VendorName { get; set; }

        public string MainFamily { get; set; }       // "Drives" / "I/O" / "Safety" / "HMI" / ...
        public string ProductFamily { get; set; }    // "SINAMICS" / "IMPACT67" / ...

        public List<GsdmlDap> DeviceAccessPoints { get; set; } = new List<GsdmlDap>();
        public List<GsdmlModule> Modules { get; set; } = new List<GsdmlModule>();
        public List<GsdmlSubmodule> Submodules { get; set; } = new List<GsdmlSubmodule>();

        /// <summary>Resolved PrimaryLanguage (English) TextId → string. Localised languages not surfaced in v1.</summary>
        public Dictionary<string, string> Texts { get; set; } = new Dictionary<string, string>(StringComparer.Ordinal);

        /// <summary>ValueItem ID → (Content → Text). Used to decode parameter enum values.</summary>
        public Dictionary<string, Dictionary<string, string>> ValueEnums { get; set; }
            = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);

        public GsdmlSubmodule FindSubmodule(string id)
        {
            if (string.IsNullOrEmpty(id)) return null;
            foreach (var s in Submodules) if (s.Id == id) return s;
            return null;
        }
    }

    public class GsdmlDap
    {
        public string Id { get; set; }
        public string DnsCompatibleName { get; set; }
        public string PhysicalSlots { get; set; }
        public int? ModuleIdentNumber { get; set; }

        public string Name { get; set; }
        public string InfoText { get; set; }
        public string OrderNumber { get; set; }
        public string HardwareRelease { get; set; }
        public string SoftwareRelease { get; set; }
        public string MainFamily { get; set; }
        public string ProductFamily { get; set; }

        public List<string> SupportedProfiles { get; set; } = new List<string>();
        public int? MaxInputLength { get; set; }
        public int? MaxOutputLength { get; set; }

        public List<string> UseableModuleIds { get; set; } = new List<string>();
        public List<string> EmbeddedSubmoduleIds { get; set; } = new List<string>();
    }

    public class GsdmlModule
    {
        public string Id { get; set; }
        public int? ModuleIdentNumber { get; set; }
        public string PhysicalSubslots { get; set; }

        public string Name { get; set; }
        public string InfoText { get; set; }
        public string OrderNumber { get; set; }

        public List<GsdmlUseableSubmoduleRef> UseableSubmodules { get; set; } = new List<GsdmlUseableSubmoduleRef>();
        public List<string> EmbeddedSubmoduleIds { get; set; } = new List<string>();
    }

    public class GsdmlUseableSubmoduleRef
    {
        public string SubmoduleId { get; set; }
        public string AllowedInSubslots { get; set; }
        public string FixedInSubslots { get; set; }
    }

    public class GsdmlSubmodule
    {
        public string Id { get; set; }
        public int? SubmoduleIdentNumber { get; set; }   // For drive telegrams this is the telegram number (e.g. 0x160 = 352)
        public int? Api { get; set; }
        public bool ProfiSafeSupported { get; set; }

        public string Name { get; set; }
        public string InfoText { get; set; }

        public int? IopsLength { get; set; }
        public int? IocsLength { get; set; }

        public List<GsdmlDataItem> Inputs { get; set; } = new List<GsdmlDataItem>();
        public List<GsdmlDataItem> Outputs { get; set; } = new List<GsdmlDataItem>();
        public int InputByteLength { get; set; }
        public int OutputByteLength { get; set; }

        public List<GsdmlParameterRecord> Parameters { get; set; } = new List<GsdmlParameterRecord>();
    }

    public class GsdmlDataItem
    {
        public string DataType { get; set; }       // "Unsigned16" / "Integer32" / "Bit" / ...
        public int ByteLength { get; set; }         // 0 when unknown — callers decide how to aggregate
        public bool UseAsBits { get; set; }
        public string TextId { get; set; }
        public string Text { get; set; }            // resolved PrimaryLanguage or TextId fallback
    }

    public class GsdmlParameterRecord
    {
        public int? Index { get; set; }
        public int? Length { get; set; }
        public int? TransferSequence { get; set; }
        public string Name { get; set; }
        public List<GsdmlParameterRef> Refs { get; set; } = new List<GsdmlParameterRef>();
    }

    public class GsdmlParameterRef
    {
        public string ValueItemTarget { get; set; }  // joins to ParsedGsdml.ValueEnums
        public string DataType { get; set; }
        public int? ByteOffset { get; set; }
        public int? Length { get; set; }
        public string DefaultValue { get; set; }
        public string AllowedValues { get; set; }
        public bool Changeable { get; set; }
        public bool Visible { get; set; }
        public string Text { get; set; }
    }
}
