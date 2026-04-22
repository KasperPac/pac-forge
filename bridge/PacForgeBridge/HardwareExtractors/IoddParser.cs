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
    // IODD parser
    //
    // Parses IO-Link Device Description files into a minimal typed structure.
    //
    // The CVL-2129 test project has ZERO IODD files (IO-Link not in use there).
    // This parser is built against the published IODD 1.1 spec and will be refined
    // the first time a real IO-Link-equipped project hits the extractor. Treat its
    // output as best-effort until validated against real devices.
    //
    // Namespace: http://www.io-link.com/IODD/2010/10
    //
    // See PAC_AUDIT_DERIVED_SPEC.md §12.6 — IO-Link masters + attached devices.
    // ============================================================
    public class IoddParser
    {
        private static readonly XNamespace NsIodd =
            "http://www.io-link.com/IODD/2010/10";

        private readonly Dictionary<string, ParsedIodd> _cache =
            new Dictionary<string, ParsedIodd>(StringComparer.Ordinal);

        public ParsedIodd Parse(string filePath)
        {
            if (string.IsNullOrEmpty(filePath)) throw new ArgumentException("filePath");
            if (!File.Exists(filePath)) throw new FileNotFoundException(filePath);

            byte[] bytes = File.ReadAllBytes(filePath);
            string sha = ComputeSha256Hex(bytes);
            if (_cache.TryGetValue(sha, out var cached)) return cached;

            var parsed = ParseContent(Encoding.UTF8.GetString(bytes), Path.GetFileName(filePath), sha);
            _cache[sha] = parsed;
            return parsed;
        }

        public ParsedIodd ParseContent(string xmlContent, string sourceFilename, string precomputedSha = null)
        {
            string sha = precomputedSha ?? ComputeSha256Hex(Encoding.UTF8.GetBytes(xmlContent));

            // Strip UTF-8 BOM if present (same reason as GsdmlParser — XDocument.Parse(string) rejects them).
            if (!string.IsNullOrEmpty(xmlContent) && xmlContent[0] == '﻿')
                xmlContent = xmlContent.Substring(1);

            XDocument doc;
            try { doc = XDocument.Parse(xmlContent); }
            catch (Exception ex) { throw new InvalidDataException($"IODD '{sourceFilename}' is not valid XML: {ex.Message}", ex); }

            XElement root = doc.Root;
            if (root == null || root.Name.LocalName != "IODevice")
                throw new InvalidDataException($"IODD '{sourceFilename}' root is not IODevice (got {root?.Name.LocalName ?? "null"})");

            // The namespace in practice varies slightly across IODD revisions; use the root's
            // default namespace rather than hard-coding NsIodd to survive minor version drift.
            XNamespace ns = root.Name.Namespace;

            var result = new ParsedIodd
            {
                ContentSha = sha,
                SourceFilename = sourceFilename,
            };

            XElement docInfo = root.Element(ns + "DocumentInfo");
            if (docInfo != null)
            {
                result.IoddVersion = (string)docInfo.Attribute("version") ?? (string)docInfo.Attribute("releaseDate");
            }

            XElement profileBody = root.Element(ns + "ProfileBody");
            if (profileBody == null) return result;

            // Texts — IODD uses ExternalTextCollection with multiple <PrimaryLanguage> inside
            result.Texts = ReadTexts(profileBody, ns);

            XElement deviceIdentity = profileBody.Element(ns + "DeviceIdentity");
            if (deviceIdentity != null)
            {
                result.VendorId = (string)deviceIdentity.Attribute("vendorId");
                result.DeviceId = (string)deviceIdentity.Attribute("deviceId");
                result.VendorName = (string)deviceIdentity.Attribute("vendorName");

                // Product name often lives under DeviceVariantCollection → DeviceVariant @productName
                XElement variantColl = deviceIdentity.Element(ns + "DeviceVariantCollection");
                XElement firstVariant = variantColl?.Elements(ns + "DeviceVariant").FirstOrDefault();
                if (firstVariant != null)
                {
                    result.ProductId = (string)firstVariant.Attribute("productId");
                    string nameRef = (string)firstVariant.Attribute("productName")
                                     ?? (string)firstVariant.Attribute("productText");
                    result.ProductName = ResolveText(nameRef, result.Texts);
                }
            }

            XElement deviceFunction = profileBody.Element(ns + "DeviceFunction");
            if (deviceFunction != null)
            {
                // Features — process data in/out byte lengths
                XElement features = deviceFunction.Element(ns + "Features");
                if (features != null)
                {
                    result.ProcessDataInLengthBits = ParseIntNullable((string)features.Attribute("processDataInLength"));
                    result.ProcessDataOutLengthBits = ParseIntNullable((string)features.Attribute("processDataOutLength"));
                    result.MinCycleTimeMs = ParseIntNullable((string)features.Attribute("minCycleTime"));
                    result.SupportsBlockParameter = string.Equals((string)features.Attribute("blockParameter"), "true",
                                                                  StringComparison.OrdinalIgnoreCase);
                }

                // Variables — flat list. We capture a shallow view.
                XElement varCollection = deviceFunction.Element(ns + "VariableCollection");
                if (varCollection != null)
                {
                    foreach (XElement v in varCollection.Elements(ns + "Variable"))
                    {
                        result.Variables.Add(new IoddVariable
                        {
                            Id = (string)v.Attribute("id"),
                            Index = ParseIntNullable((string)v.Attribute("index")),
                            AccessRights = (string)v.Attribute("accessRights"),
                            Name = ResolveText((string)v.Element(ns + "Name")?.Attribute("textId"), result.Texts),
                        });
                    }
                }
            }

            return result;
        }

        private static Dictionary<string, string> ReadTexts(XElement profileBody, XNamespace ns)
        {
            var map = new Dictionary<string, string>(StringComparer.Ordinal);
            XElement extColl = profileBody.Element(ns + "ExternalTextCollection");
            if (extColl == null) return map;

            // IODD supports multiple <PrimaryLanguage xml:lang="en">. Prefer "en" when present,
            // otherwise fall back to the first language encountered.
            XElement primary = extColl.Elements(ns + "PrimaryLanguage")
                .FirstOrDefault(el => string.Equals((string)el.Attribute(XNamespace.Xml + "lang"), "en",
                                                    StringComparison.OrdinalIgnoreCase));
            if (primary == null) primary = extColl.Elements(ns + "PrimaryLanguage").FirstOrDefault();
            if (primary == null) return map;

            foreach (XElement t in primary.Elements(ns + "Text"))
            {
                string id = (string)t.Attribute("id");
                string val = (string)t.Attribute("value");
                if (!string.IsNullOrEmpty(id)) map[id] = val ?? string.Empty;
            }
            return map;
        }

        private static string ResolveText(string textId, Dictionary<string, string> texts)
        {
            if (string.IsNullOrEmpty(textId)) return null;
            if (texts != null && texts.TryGetValue(textId, out var v)) return v;
            return textId;
        }

        private static int? ParseIntNullable(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return null;
            return int.TryParse(raw.Trim(), System.Globalization.NumberStyles.Integer,
                                System.Globalization.CultureInfo.InvariantCulture, out int v) ? (int?)v : null;
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

    public class ParsedIodd
    {
        public string ContentSha { get; set; }
        public string SourceFilename { get; set; }
        public string IoddVersion { get; set; }

        public string VendorId { get; set; }
        public string DeviceId { get; set; }
        public string VendorName { get; set; }
        public string ProductName { get; set; }
        public string ProductId { get; set; }

        public int? ProcessDataInLengthBits { get; set; }
        public int? ProcessDataOutLengthBits { get; set; }
        public int? MinCycleTimeMs { get; set; }
        public bool SupportsBlockParameter { get; set; }

        public List<IoddVariable> Variables { get; set; } = new List<IoddVariable>();
        public Dictionary<string, string> Texts { get; set; } = new Dictionary<string, string>(StringComparer.Ordinal);
    }

    public class IoddVariable
    {
        public string Id { get; set; }
        public int? Index { get; set; }
        public string AccessRights { get; set; }   // "ro" / "rw" / "wo"
        public string Name { get; set; }            // resolved text
    }
}
