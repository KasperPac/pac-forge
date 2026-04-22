using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace PacForgeBridge.HardwareExtractors
{
    // ============================================================
    // GsdmlLoader
    //
    // Finds every GSDML file shipped inside the open TIA project
    // (<project_dir>/AdditionalFiles/GSD/*.xml, confirmed by Step 0
    // spike — see §12.6 of PAC_AUDIT_DERIVED_SPEC.md), parses each
    // via GsdmlParser, and exposes a lookup keyed by:
    //   * filename (case-insensitive) — used when a device carries
    //     a `GSD:<filename>/...` TypeIdentifier
    //   * ModuleAccessPoint's OrderNumber — used when a device
    //     carries an `OrderNumber:...` TypeIdentifier and we want to
    //     enrich it from the matching GSDML catalogue anyway
    //
    // One loader per Extract call — cache lifetime = extraction pass.
    // ============================================================
    public class GsdmlLoader
    {
        private readonly GsdmlParser _parser = new GsdmlParser();

        // All keys stored case-insensitive; Windows filesystems are
        // case-preserving-but-insensitive, and TIA normalises inconsistently.
        private readonly Dictionary<string, ParsedGsdml> _byFilename =
            new Dictionary<string, ParsedGsdml>(StringComparer.OrdinalIgnoreCase);

        private readonly Dictionary<string, ParsedGsdml> _byOrderNumber =
            new Dictionary<string, ParsedGsdml>(StringComparer.OrdinalIgnoreCase);

        /// <summary>Parsed GSDMLs indexed by content SHA — useful for the engineer dump.</summary>
        public IReadOnlyDictionary<string, ParsedGsdml> ByFilename => _byFilename;

        public int FileCount => _byFilename.Count;

        /// <summary>
        /// Scan a project directory for GSDML files and parse them all. Swallows
        /// per-file parse errors (reports via the warnings list) so a single malformed
        /// GSDML can't abort extraction.
        /// </summary>
        public void LoadFromProjectDirectory(string projectDir, List<string> warnings)
        {
            if (string.IsNullOrEmpty(projectDir)) return;
            string gsdDir = Path.Combine(projectDir, "AdditionalFiles", "GSD");
            if (!Directory.Exists(gsdDir)) return;

            // GSDML filename convention is "GSDML-V<ver>-<vendor>-<product>-<date>.xml"; case
            // varies between vendors (SIEMENS lowercases, others mix). Match loosely.
            string[] files;
            try
            {
                files = Directory.GetFiles(gsdDir, "*.xml", SearchOption.TopDirectoryOnly);
            }
            catch (Exception ex)
            {
                warnings.Add($"GSDML loader: cannot list '{gsdDir}' — {ex.Message}");
                return;
            }

            foreach (string file in files)
            {
                string name = Path.GetFileName(file);
                // Accept both "GSDML-*" and project-local "conf#*" variants (observed in spike output
                // for Beckhoff-0010). Skip anything that clearly isn't a GSDML.
                if (!name.StartsWith("GSDML-", StringComparison.OrdinalIgnoreCase) &&
                    !name.StartsWith("gsdml-", StringComparison.OrdinalIgnoreCase) &&
                    !name.Contains("GSDML-") && !name.Contains("gsdml-"))
                {
                    continue;
                }

                try
                {
                    ParsedGsdml parsed = _parser.Parse(file);
                    _byFilename[name] = parsed;

                    // Index every DAP's OrderNumber too — lets a device whose TypeIdentifier is
                    // `OrderNumber:...` still be matched against its GSDML by catalog handle.
                    foreach (var dap in parsed.DeviceAccessPoints)
                    {
                        if (!string.IsNullOrEmpty(dap.OrderNumber) && !_byOrderNumber.ContainsKey(dap.OrderNumber))
                            _byOrderNumber[dap.OrderNumber] = parsed;
                    }
                }
                catch (Exception ex)
                {
                    warnings.Add($"GSDML loader: '{name}' — {ex.Message}");
                }
            }
        }

        public ParsedGsdml Lookup(string gsdmlFilename)
        {
            if (string.IsNullOrEmpty(gsdmlFilename)) return null;
            _byFilename.TryGetValue(gsdmlFilename, out var g);
            return g;
        }

        public ParsedGsdml LookupByOrderNumber(string orderNumber)
        {
            if (string.IsNullOrEmpty(orderNumber)) return null;
            _byOrderNumber.TryGetValue(orderNumber, out var g);
            return g;
        }

        /// <summary>
        /// Resolves a `GSD:<filename>/<dap_id>` TypeIdentifier to the GSDML filename segment,
        /// or null when the TypeIdentifier isn't a GSD-style handle (e.g. plain `OrderNumber:`).
        /// </summary>
        public static string ExtractGsdmlFilename(string typeIdentifier)
        {
            if (string.IsNullOrEmpty(typeIdentifier)) return null;
            // Format observed in spike: "GSD:gsdml-v2.31-siemens-sinamics_g120c-20200511.xml/DAP_..."
            // The GSD: prefix is always present on GSD-imported devices; filename runs until the
            // first '/' after the prefix.
            var m = Regex.Match(typeIdentifier, @"^GSD:\s*(?<name>[^/]+)", RegexOptions.IgnoreCase);
            return m.Success ? m.Groups["name"].Value.Trim() : null;
        }

        /// <summary>
        /// Resolves a `OrderNumber:<mlfb>/<fw>` TypeIdentifier to the MLFB part (without firmware),
        /// matching the format used inside GSDML DAP.OrderNumber elements.
        /// </summary>
        public static string ExtractOrderNumber(string typeIdentifier)
        {
            if (string.IsNullOrEmpty(typeIdentifier)) return null;
            var m = Regex.Match(typeIdentifier, @"^OrderNumber:\s*(?<order>[^/]+)", RegexOptions.IgnoreCase);
            return m.Success ? m.Groups["order"].Value.Trim() : null;
        }

        /// <summary>
        /// All-in-one: given a device TypeIdentifier, return the matching ParsedGsdml by trying
        /// GSD:filename first, then by OrderNumber. Null when no GSDML matches.
        /// </summary>
        public ParsedGsdml LookupByTypeIdentifier(string typeIdentifier)
        {
            string file = ExtractGsdmlFilename(typeIdentifier);
            if (file != null)
            {
                var direct = Lookup(file);
                if (direct != null) return direct;
            }
            string order = ExtractOrderNumber(typeIdentifier);
            if (order != null)
            {
                var byOrder = LookupByOrderNumber(order);
                if (byOrder != null) return byOrder;
            }
            return null;
        }
    }
}
