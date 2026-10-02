using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

namespace PacForgeBridge
{
    /// <summary>A refusal the bridge names (PHUB-232), answered 409 { success:false, refused, message }.</summary>
    public class BridgeRefusalException : Exception
    {
        public string Name { get; }
        public List<VcPlcDto> Plcs { get; }

        public BridgeRefusalException(string name, string message, List<VcPlcDto> plcs = null) : base(message)
        {
            Name = name;
            Plcs = plcs;
        }
    }

    /// <summary>The caller's request names something that cannot be (PHUB-232), answered 400 { success:false, message }.</summary>
    public class BridgeBadRequestException : Exception
    {
        public BridgeBadRequestException(string message) : base(message) { }
    }

    /// <summary>What running pac-hub-vc came to. Missing: pac-hub-vc (or Node, for its script) could not be
    /// found, and Stderr says which. TimedOut: it was stopped at the timeout, or it exited but its output was
    /// still held open (by a process it started) at the timeout, so its result was never read.</summary>
    public class PacHubVcResult
    {
        public bool Missing;
        public bool TimedOut;
        public int ExitCode;
        public string Stdout;
        public string Stderr;
    }

    /// <summary>
    /// Runs Pac Hub's `pac-hub-vc` on this workstation (PHUB-232, spec D4: every git operation happens
    /// inside it, and the bridge has no git logic). It is started directly, never through cmd.exe, with
    /// each argument quoted by the CommandLineToArgvW rules (see Quote).
    ///
    /// Where it is looked for, in order:
    /// 1. PAC_HUB_VC: the CLI's bin\pac-hub-vc.mjs, or an .exe.
    /// 2. A pac-hub-vc.exe on PATH.
    /// 3. The script a pac-hub-vc.cmd on PATH names. npm, pnpm and hand-written shims all name it as a
    ///    quoted path ending .mjs or .js, with %~dp0 or %dp0% for the shim's own folder.
    /// A script is run by the node.exe found on PATH.
    /// </summary>
    public static class PacHubVc
    {
        public class PlcEntry
        {
            public string Number;
            public string Name;
            public string Model;
            public string DocCode;
        }

        public static PacHubVcResult Run(IList<string> args, int timeoutMs)
        {
            string fileName;
            string script;
            string missing;
            if (!Locate(out fileName, out script, out missing))
                return new PacHubVcResult { Missing = true, ExitCode = -1, Stdout = "", Stderr = missing };

            var all = new List<string>();
            if (script != null) all.Add(script);
            all.AddRange(args);
            var psi = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = string.Join(" ", all.Select(Quote)),
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            string what = args.Count > 0 ? args[0] : "";
            Stopwatch clock = Stopwatch.StartNew();
            using (Process p = Process.Start(psi))
            {
                var stdout = p.StandardOutput.ReadToEndAsync();
                var stderr = p.StandardError.ReadToEndAsync();
                if (!p.WaitForExit(timeoutMs))
                {
                    KillTree(p.Id);
                    return new PacHubVcResult { TimedOut = true, ExitCode = -1, Stdout = "", Stderr = $"pac-hub-vc {what} did not finish within {timeoutMs / 1000} s and was stopped." };
                }
                // The output ends when the last holder of the pipes closes them, and a process pac-hub-vc
                // started that outlives it can hold them open. So the drain gets only what is left of the
                // timeout (at least DrainFloorMs, for a run that ended just before it).
                long left = Math.Max(DrainFloorMs, timeoutMs - clock.ElapsedMilliseconds);
                if (!Task.WaitAll(new Task[] { stdout, stderr }, (int)Math.Min(left, int.MaxValue)))
                    return new PacHubVcResult { TimedOut = true, ExitCode = -1, Stdout = "", Stderr = $"pac-hub-vc {what} exited (code {p.ExitCode}), but a process it started still held its output open at the {timeoutMs / 1000} s timeout, so its result was not read." };
                return new PacHubVcResult { ExitCode = p.ExitCode, Stdout = stdout.Result, Stderr = stderr.Result };
            }
        }

        /// <summary>The least time the output gets to drain after pac-hub-vc exits.</summary>
        private const int DrainFloorMs = 2000;

        /// <summary>One argument as CommandLineToArgvW reads it back (the rule above the class).</summary>
        public static string Quote(string arg)
        {
            if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0) return arg;
            var sb = new StringBuilder("\"");
            for (int i = 0; ; i++)
            {
                int backslashes = 0;
                while (i < arg.Length && arg[i] == '\\')
                {
                    backslashes++;
                    i++;
                }
                if (i == arg.Length)
                {
                    sb.Append('\\', backslashes * 2);
                    break;
                }
                if (arg[i] == '"')
                {
                    sb.Append('\\', backslashes * 2 + 1);
                    sb.Append('"');
                }
                else
                {
                    sb.Append('\\', backslashes);
                    sb.Append(arg[i]);
                }
            }
            return sb.Append('"').ToString();
        }

        /// <summary>The last stdout line that is a JSON object, or null. Strings stay the strings pac-hub-vc printed: an
        /// ISO date (status's latestDate) is not turned into a DateTime and back into this machine's local format.</summary>
        public static JObject LastJson(string stdout)
        {
            string last = (stdout ?? "").Split('\n').Select(l => l.Trim()).LastOrDefault(l => l.StartsWith("{"));
            if (last == null) return null;
            try
            {
                using (var reader = new Newtonsoft.Json.JsonTextReader(new StringReader(last)) { DateParseHandling = Newtonsoft.Json.DateParseHandling.None })
                {
                    JObject json = JObject.Load(reader);
                    return reader.Read() ? null : json;
                }
            }
            catch (Newtonsoft.Json.JsonException) { return null; }
        }

        /// <summary>
        /// `pac-hub-vc ensure … --json` (spec §5 step 1): the job repo found, cloned or initialised and pulled
        /// fast-forward only. With `plc`, that PLC is recorded in job.json: added when missing, a missing doc
        /// code or model filled in. A named refusal is rethrown under its name.
        /// </summary>
        public static JObject Ensure(string job, string customer, string jobName, string root, PlcEntry plc)
        {
            var args = new List<string> { "ensure", "--job", job, "--customer", customer, "--name", jobName, "--root", root, "--json" };
            if (plc != null)
            {
                args.AddRange(new[] { "--plc", plc.Number + ":" + plc.Name, "--vendor", "siemens" });
                if (!string.IsNullOrWhiteSpace(plc.Model)) args.AddRange(new[] { "--model", plc.Model });
                if (!string.IsNullOrWhiteSpace(plc.DocCode)) args.AddRange(new[] { "--doc-code", plc.DocCode });
            }
            PacHubVcResult r = Run(args, 600000);
            if (r.Missing) throw new BridgeRefusalException("VC_TOOL_MISSING", r.Stderr);
            if (r.TimedOut) throw new InvalidOperationException(r.Stderr);
            JObject json = LastJson(r.Stdout);
            if (json != null && json["refused"] != null)
                throw new BridgeRefusalException((string)json["refused"], (string)json["message"] ?? "pac-hub-vc ensure refused.");
            if (r.ExitCode != 0 || json == null || json["repoPath"] == null)
                throw new InvalidOperationException("pac-hub-vc ensure failed: " + FailureReason(r, json));
            return json;
        }

        /// <summary>
        /// Why a run gave no result. An `{ error }` line says it in pac-hub-vc's own words. Without one, stderr
        /// says it: a usage error (commander) exits 1 with nothing on stdout even under --json, and a crash
        /// leaves only Node's stack. Nothing on stdout is never read as success.
        /// </summary>
        private static string FailureReason(PacHubVcResult r, JObject json)
        {
            string error = json?["error"]?.ToString();
            if (!string.IsNullOrWhiteSpace(error)) return error;
            string what = json == null ? "no JSON result on stdout" : "a JSON result with no repoPath";
            string stderr = (r.Stderr ?? "").Trim();
            if (stderr.Length == 0) return $"exit code {r.ExitCode}, {what}, nothing on stderr";
            if (stderr.Length > 2000) stderr = stderr.Substring(0, 2000) + " …";
            return $"{stderr} (exit code {r.ExitCode}, {what})";
        }

        private static string _version;
        private static DateTime _versionAskedAt = DateTime.MinValue;
        private static int _asking;

        /// <summary>
        /// `pac-hub-vc --version`, for /tia/status; null when it is not installed or not known yet. It is
        /// asked in the background, so a status read never waits on a child process (the hub reads
        /// /tia/status with a 10 s timeout). A version once found is kept. A missing one is asked again after
        /// a minute, in case it has been installed meanwhile.
        /// </summary>
        public static string InstalledVersion()
        {
            if (_version == null && DateTime.UtcNow - _versionAskedAt >= TimeSpan.FromMinutes(1)
                && System.Threading.Interlocked.CompareExchange(ref _asking, 1, 0) == 0)
            {
                _versionAskedAt = DateTime.UtcNow;
                System.Threading.Tasks.Task.Run(() =>
                {
                    try
                    {
                        PacHubVcResult r = Run(new List<string> { "--version" }, 20000);
                        string line = FirstLine(r.Stdout);
                        if (!r.Missing && !r.TimedOut && r.ExitCode == 0 && !string.IsNullOrWhiteSpace(line)) _version = line;
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"[VC] pac-hub-vc --version: {ex.Message}");
                    }
                    finally
                    {
                        System.Threading.Interlocked.Exchange(ref _asking, 0);
                    }
                });
            }
            return _version;
        }

        /// <summary>
        /// PHUB-232 Phase 3: any `pac-hub-vc … --json` command, on Run and LastJson — the last JSON object it printed
        /// (null when none or when it timed out), its exit code, and why it gave none (the timeout, or the first
        /// stderr line). A missing pac-hub-vc (or Node) is VC_TOOL_MISSING by name, as Ensure throws it.
        /// </summary>
        public static JObject Json(IList<string> args, int timeoutMs, out int exitCode, out string error)
        {
            PacHubVcResult r = Run(args, timeoutMs);
            if (r.Missing) throw new BridgeRefusalException("VC_TOOL_MISSING", r.Stderr);
            exitCode = r.ExitCode;
            error = r.TimedOut ? r.Stderr : FirstLine(r.Stderr);
            return r.TimedOut ? null : LastJson(r.Stdout);
        }

        private static bool Locate(out string fileName, out string script, out string missing)
        {
            fileName = null;
            script = null;
            missing = null;
            string target;
            string overridden = (Environment.GetEnvironmentVariable("PAC_HUB_VC") ?? "").Trim();
            if (overridden.Length > 0)
            {
                if (!File.Exists(overridden))
                {
                    missing = $"PAC_HUB_VC names {overridden}, which does not exist on this workstation. Correct it, restart the bridge and press Start again.";
                    return false;
                }
                target = overridden;
            }
            else
            {
                target = OnPath("pac-hub-vc.exe") ?? ScriptOfShim(OnPath("pac-hub-vc.cmd"));
                if (target == null)
                {
                    missing = "pac-hub-vc is not on PATH on this workstation (no pac-hub-vc.exe, and no pac-hub-vc.cmd naming its script). Install it, or set PAC_HUB_VC to the CLI's bin\\pac-hub-vc.mjs, then restart the bridge and press Start again.";
                    return false;
                }
            }
            if (target.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            {
                fileName = target;
                return true;
            }
            string node = OnPath("node.exe");
            if (node == null)
            {
                missing = "Node.js (node.exe) is not on PATH on this workstation, so pac-hub-vc cannot run. Install Node, restart the bridge and press Start again.";
                return false;
            }
            fileName = node;
            script = target;
            return true;
        }

        private static string OnPath(string file)
        {
            foreach (string dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
            {
                if (string.IsNullOrWhiteSpace(dir)) continue;
                try
                {
                    string candidate = Path.Combine(dir.Trim().Trim('"'), file);
                    if (File.Exists(candidate)) return candidate;
                }
                catch (ArgumentException)
                {
                    // A PATH entry that is not a path is skipped.
                }
            }
            return null;
        }

        private static readonly Regex ShimScript = new Regex("\"([^\"]+\\.m?js)\"", RegexOptions.IgnoreCase);

        /// <summary>The script a .cmd shim runs, read out of the shim (never run through cmd), or null.</summary>
        private static string ScriptOfShim(string shim)
        {
            if (shim == null) return null;
            string dir = Path.GetDirectoryName(shim) + "\\";
            foreach (Match m in ShimScript.Matches(File.ReadAllText(shim)))
            {
                string path = m.Groups[1].Value.Replace("%~dp0", dir).Replace("%dp0%", dir);
                try
                {
                    string full = Path.GetFullPath(path);
                    if (File.Exists(full)) return full;
                }
                catch (Exception)
                {
                    // A quoted text in the shim that is not a usable path is passed over.
                }
            }
            return null;
        }

        private static void KillTree(int pid)
        {
            try
            {
                using (Process k = Process.Start(new ProcessStartInfo("taskkill", $"/T /F /PID {pid}") { UseShellExecute = false, CreateNoWindow = true }))
                    k?.WaitForExit(10000);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[VC] Could not stop pac-hub-vc (pid {pid}): {ex.Message}");
            }
        }

        private static string FirstLine(string s) =>
            string.IsNullOrWhiteSpace(s) ? null : s.Split('\n').Select(l => l.Trim()).FirstOrDefault(l => l.Length > 0);
    }
}
