using System;
using System.IO;
using System.Linq;

namespace PacForgeBridge.HardwareExtractors
{
    /// <summary>
    /// Dev-only CLI helper — invoked via `PacForgeBridge.V18.exe --validate-hardware-parsers &lt;dir&gt;`.
    /// Iterates every GSDML-*.xml and IODD*.xml file under the given directory, parses each, and
    /// prints a one-line summary per file. Used to sanity-check the parsers against real files
    /// without standing up a TIA Portal session. Not wired into any endpoint.
    /// </summary>
    public static class HardwareParserValidator
    {
        public static void Run(string directory)
        {
            if (string.IsNullOrEmpty(directory) || !Directory.Exists(directory))
            {
                Console.Error.WriteLine($"[validate] directory not found: {directory}");
                Environment.ExitCode = 2;
                return;
            }

            Console.WriteLine($"[validate] scanning {directory}");

            var gsdmlFiles = Directory.GetFiles(directory, "GSDML-*.xml", SearchOption.AllDirectories)
                .Concat(Directory.GetFiles(directory, "gsdml-*.xml", SearchOption.AllDirectories))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(p => p, StringComparer.OrdinalIgnoreCase)
                .ToList();

            var ioddFiles = Directory.GetFiles(directory, "IODD*.xml", SearchOption.AllDirectories)
                .Concat(Directory.GetFiles(directory, "iodd*.xml", SearchOption.AllDirectories))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(p => p, StringComparer.OrdinalIgnoreCase)
                .ToList();

            Console.WriteLine($"[validate] found {gsdmlFiles.Count} GSDML + {ioddFiles.Count} IODD file(s)");
            Console.WriteLine();

            int gsdmlOk = 0, gsdmlFail = 0;
            var gsdmlParser = new GsdmlParser();
            foreach (string f in gsdmlFiles)
            {
                try
                {
                    ParsedGsdml g = gsdmlParser.Parse(f);
                    string family = $"{g.MainFamily ?? "?"}/{g.ProductFamily ?? "?"}";
                    string vendor = $"{g.VendorName ?? "?"} (0x{g.VendorId:X4}/0x{g.DeviceId:X4})";
                    string firstOrder = g.DeviceAccessPoints.Select(d => d.OrderNumber).FirstOrDefault(o => !string.IsNullOrEmpty(o)) ?? "-";
                    Console.WriteLine($"  ✔  {Path.GetFileName(f)}");
                    Console.WriteLine($"         schema={g.SchemaVersion ?? "?"}  family={family}  vendor={vendor}");
                    Console.WriteLine($"         DAPs={g.DeviceAccessPoints.Count}  modules={g.Modules.Count}  submodules={g.Submodules.Count}  texts={g.Texts.Count}  order={firstOrder}");
                    gsdmlOk++;
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"  ✖  {Path.GetFileName(f)}: {ex.Message}");
                    gsdmlFail++;
                }
            }

            int ioddOk = 0, ioddFail = 0;
            var ioddParser = new IoddParser();
            foreach (string f in ioddFiles)
            {
                try
                {
                    ParsedIodd d = ioddParser.Parse(f);
                    Console.WriteLine($"  ✔  {Path.GetFileName(f)}  vendor={d.VendorName} product={d.ProductName} pdIn={d.ProcessDataInLengthBits}b pdOut={d.ProcessDataOutLengthBits}b vars={d.Variables.Count}");
                    ioddOk++;
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"  ✖  {Path.GetFileName(f)}: {ex.Message}");
                    ioddFail++;
                }
            }

            Console.WriteLine();
            Console.WriteLine($"[validate] GSDML: {gsdmlOk} ok / {gsdmlFail} failed");
            Console.WriteLine($"[validate] IODD:  {ioddOk} ok / {ioddFail} failed");
            Environment.ExitCode = (gsdmlFail + ioddFail) > 0 ? 1 : 0;
        }
    }
}
