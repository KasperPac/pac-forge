using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace PacForgeBridge.HardwareExtractors
{
    // ============================================================
    // RollerCardClassifier
    //
    // Classifies a PROFINET device into a Pac-Audit-relevant category
    // based on signals available at Extract time — primarily the
    // ParsedGsdml (vendor name + product family) with TypeIdentifier /
    // device-name fallbacks when no GSDML matched.
    //
    // Output categories (dot-notation — the frontend splits on '.'):
    //
    //   drive.sinamics.g120c         drive.sinamics.g120        drive.sinamics.s120
    //   drive.sinamics.s210          drive.sinamics.v90         drive.sinamics
    //   roller_card.interroll        roller_card.pulse_roller   roller_card.itoh_denki
    //   load_cell.siwarex            load_cell.mettler_toledo   load_cell.hbm
    //   hmi                          io_module.generic          other.pn_device
    //
    // The Sinamics scope is tight — Pac customers use Sinamics exclusively
    // (see CLAUDE.md: Sinamics-only scope). Non-Sinamics drives would fall
    // to other.pn_device and surface through the engineer review panel.
    //
    // This file only covers roller cards + load cells + drive badges per §16
    // step 4; IO-Link classification is step 5 via IoLinkMasterWalker.
    // ============================================================
    public static class RollerCardClassifier
    {
        public struct Classification
        {
            public string Category;
            public string VendorName;
            /// <summary>Short human explanation of why this classification fired. Surfaces in engineer review.</summary>
            public string Reason;
        }

        /// <summary>
        /// Classifies a device. Non-null inputs aren't required — missing signals are handled
        /// gracefully and shift the classifier toward safer (less specific) categories.
        /// </summary>
        public static Classification Classify(string deviceName, string typeIdentifier, ParsedGsdml gsdml)
        {
            // GSDML-driven path — strongest signal when present.
            if (gsdml != null)
            {
                var fromGsdml = ClassifyFromGsdml(gsdml);
                if (fromGsdml.Category != null) return fromGsdml;
            }

            // Fallback — device name / TypeIdentifier heuristics when no GSDML matched.
            return ClassifyFromNames(deviceName, typeIdentifier);
        }

        private static Classification ClassifyFromGsdml(ParsedGsdml g)
        {
            string vendor = g.VendorName ?? "";
            string mainFamily = g.MainFamily ?? "";
            string productFamily = g.ProductFamily ?? "";
            string blob = vendor + " " + mainFamily + " " + productFamily;
            string dapName = FirstDapName(g);
            string orderNo = FirstDapOrderNumber(g);
            if (!string.IsNullOrEmpty(dapName)) blob += " " + dapName;

            // Rule 1 — SIEMENS SINAMICS (tightest scope).
            if (Regex.IsMatch(vendor, @"SIEMENS", RegexOptions.IgnoreCase) &&
                (Regex.IsMatch(blob, @"SINAMICS", RegexOptions.IgnoreCase) ||
                 Regex.IsMatch(orderNo ?? "", @"^6SL", RegexOptions.IgnoreCase)))
            {
                string subfamily = ExtractSinamicsSubfamily(blob, orderNo);
                return new Classification
                {
                    Category = subfamily != null ? $"drive.sinamics.{subfamily}" : "drive.sinamics",
                    VendorName = vendor,
                    Reason = $"GSDML vendor={vendor}, SINAMICS match (subfamily={subfamily ?? "?"})",
                };
            }

            // Rule 2 — SIWAREX load cells (still Siemens vendor; distinct from drives).
            if (Regex.IsMatch(blob, @"SIWAREX|\bWP\s*2\d\d\b", RegexOptions.IgnoreCase))
            {
                return new Classification
                {
                    Category = "load_cell.siwarex",
                    VendorName = vendor,
                    Reason = $"GSDML vendor={vendor}, SIWAREX family detected",
                };
            }

            // Rule 3 — Roller cards (Interroll).
            if (Regex.IsMatch(vendor, @"Interroll", RegexOptions.IgnoreCase))
            {
                return new Classification
                {
                    Category = "roller_card.interroll",
                    VendorName = vendor,
                    Reason = $"GSDML vendor={vendor}",
                };
            }

            // Rule 4 — Pulseroller / Conveylinx / Insight Automation (Pulse Roller brand).
            if (Regex.IsMatch(blob, @"Pulse\s*roller|Conveylinx|Insight\s*Automation", RegexOptions.IgnoreCase))
            {
                return new Classification
                {
                    Category = "roller_card.pulse_roller",
                    VendorName = vendor,
                    Reason = $"GSDML vendor={vendor} / product match 'Pulseroller'",
                };
            }

            // Rule 5 — Itoh Denki.
            if (Regex.IsMatch(vendor, @"Itoh|Itoh\s*Denki", RegexOptions.IgnoreCase))
            {
                return new Classification
                {
                    Category = "roller_card.itoh_denki",
                    VendorName = vendor,
                    Reason = $"GSDML vendor={vendor}",
                };
            }

            // Rule 6 — Mettler-Toledo load cells.
            if (Regex.IsMatch(blob, @"Mettler|Toledo", RegexOptions.IgnoreCase))
            {
                return new Classification
                {
                    Category = "load_cell.mettler_toledo",
                    VendorName = vendor,
                    Reason = $"GSDML vendor={vendor} — Mettler/Toledo match",
                };
            }

            // Rule 7 — HBM / Hottinger load cells.
            if (Regex.IsMatch(blob, @"HBM\b|Hottinger|HBK", RegexOptions.IgnoreCase))
            {
                return new Classification
                {
                    Category = "load_cell.hbm",
                    VendorName = vendor,
                    Reason = $"GSDML vendor={vendor} — HBM/Hottinger match",
                };
            }

            // Rule 8 — HMI (GSDML devices rarely are, but safety net).
            if (Regex.IsMatch(mainFamily, @"^HMI$", RegexOptions.IgnoreCase))
            {
                return new Classification
                {
                    Category = "hmi",
                    VendorName = vendor,
                    Reason = $"GSDML MainFamily=HMI",
                };
            }

            // Rule 9 — anything declared as I/O in GSDML (ET200, Beckhoff, Murrelektronik, …).
            if (Regex.IsMatch(mainFamily, @"^I/?O$", RegexOptions.IgnoreCase))
            {
                return new Classification
                {
                    Category = "io_module.generic",
                    VendorName = vendor,
                    Reason = $"GSDML MainFamily=I/O (vendor={vendor})",
                };
            }

            // GSDML present but no specific rule matched — leave a breadcrumb, still useful.
            return new Classification
            {
                Category = "other.pn_device",
                VendorName = vendor,
                Reason = $"GSDML present, no specific rule — vendor={vendor}, family={mainFamily}/{productFamily}",
            };
        }

        private static Classification ClassifyFromNames(string deviceName, string typeIdentifier)
        {
            string blob = ((deviceName ?? "") + " " + (typeIdentifier ?? "")).Trim();
            if (string.IsNullOrEmpty(blob)) return new Classification();  // empty → no classification

            // TIA's own System:Device.G120C-2 / similar handles for catalog-placed SINAMICS drives.
            var m = Regex.Match(blob, @"System:Device\.(?<fam>G120C|G120|S120|S210|V90)",
                                RegexOptions.IgnoreCase);
            if (m.Success)
            {
                return new Classification
                {
                    Category = $"drive.sinamics.{m.Groups["fam"].Value.ToLowerInvariant()}",
                    Reason = $"TypeIdentifier carries SINAMICS System:Device handle ({m.Groups["fam"].Value})",
                };
            }

            // OrderNumber-only drives (6SL = SINAMICS MLFB prefix).
            var mOrder = Regex.Match(blob, @"OrderNumber:\s*6SL", RegexOptions.IgnoreCase);
            if (mOrder.Success)
            {
                return new Classification
                {
                    Category = "drive.sinamics",
                    Reason = "OrderNumber starts with 6SL (SINAMICS catalog prefix)",
                };
            }

            // SIWAREX sometimes surfaces in the device name.
            if (Regex.IsMatch(blob, @"SIWAREX", RegexOptions.IgnoreCase))
            {
                return new Classification { Category = "load_cell.siwarex", Reason = "Device name contains SIWAREX" };
            }

            return new Classification();  // no match
        }

        /// <summary>
        /// Picks a SINAMICS subfamily from the strongest available signal. OrderNumber prefixes
        /// are the most reliable (6SL3210 → G120C, 6SL3224 → G120, 6SL312x → S120, 6SL35 → S210,
        /// 6SL3210-5 → V90). Falls back to name-blob matching otherwise.
        /// </summary>
        private static string ExtractSinamicsSubfamily(string blob, string orderNumber)
        {
            if (!string.IsNullOrEmpty(orderNumber))
            {
                // Normalise — strip spaces + uppercase.
                string o = orderNumber.Replace(" ", "").ToUpperInvariant();
                if (o.StartsWith("6SL3210-5") || o.StartsWith("6SL35")) return "v90";
                if (o.StartsWith("6SL3210")) return "g120c";
                if (o.StartsWith("6SL3224")) return "g120";
                if (o.StartsWith("6SL312") || o.StartsWith("6SL313")) return "s120";
                if (o.StartsWith("6SL350") || o.StartsWith("6SL351")) return "s210";
            }

            // Name-blob fallback — most specific tokens first (G120C before G120).
            if (Regex.IsMatch(blob, @"G120C", RegexOptions.IgnoreCase)) return "g120c";
            if (Regex.IsMatch(blob, @"\bG120\b", RegexOptions.IgnoreCase)) return "g120";
            if (Regex.IsMatch(blob, @"\bS120\b", RegexOptions.IgnoreCase)) return "s120";
            if (Regex.IsMatch(blob, @"\bS210\b", RegexOptions.IgnoreCase)) return "s210";
            if (Regex.IsMatch(blob, @"\bV90\b", RegexOptions.IgnoreCase)) return "v90";
            return null;
        }

        private static string FirstDapName(ParsedGsdml g)
        {
            foreach (var dap in g.DeviceAccessPoints)
            {
                if (!string.IsNullOrEmpty(dap.Name)) return dap.Name;
                if (!string.IsNullOrEmpty(dap.InfoText)) return dap.InfoText;
            }
            return null;
        }

        private static string FirstDapOrderNumber(ParsedGsdml g)
        {
            foreach (var dap in g.DeviceAccessPoints)
            {
                if (!string.IsNullOrEmpty(dap.OrderNumber)) return dap.OrderNumber;
            }
            return null;
        }
    }
}
