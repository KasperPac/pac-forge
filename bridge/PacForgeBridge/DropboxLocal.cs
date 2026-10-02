using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

namespace PacForgeBridge
{
    /// <summary>
    /// The Dropbox desktop client's copy of the team folder on this workstation (PHUB-232 spec §5 step 3).
    /// The root comes from %LOCALAPPDATA%\Dropbox\info.json (business.root_path); PAC_DROPBOX_ROOT
    /// overrides it, for a scratch run. An online-only file is downloaded by reading it. One that will not
    /// download in time, or that Dropbox cannot serve, is DROPBOX_NOT_LOCAL.
    /// </summary>
    internal static class DropboxLocal
    {
        public static string Root()
        {
            string overridden = Environment.GetEnvironmentVariable("PAC_DROPBOX_ROOT");
            if (!string.IsNullOrWhiteSpace(overridden)) return overridden.Trim();
            string info = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Dropbox", "info.json");
            if (!File.Exists(info))
                throw new BridgeRefusalException("DROPBOX_NOT_LOCAL", $"The Dropbox desktop client is not set up on this workstation ({info} is missing).");
            string root = (string)JObject.Parse(File.ReadAllText(info)).SelectToken("business.root_path");
            if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
                throw new BridgeRefusalException("DROPBOX_NOT_LOCAL", $"This workstation's Dropbox has no Pac Technologies team folder ({info} names no business.root_path that exists).");
            return root;
        }

        /// <summary>A Dropbox-relative path (forward slashes) on this workstation; never outside the root.</summary>
        public static string Resolve(string root, string relative)
        {
            if (string.IsNullOrWhiteSpace(relative) || Path.IsPathRooted(relative))
                throw new InvalidOperationException($"'{relative}' is not a path inside Dropbox (expected e.g. Pac/Jobs/<Customer>/<JOB> - <name>).");
            string full = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
            string inside = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!full.StartsWith(inside, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException($"'{relative}' leaves the Dropbox folder.");
            return full;
        }

        /// <summary>Reads the whole file, which is what makes Dropbox download an online-only one.</summary>
        public static void Hydrate(string file, TimeSpan timeout) => CopyFile(file, null, timeout);

        /// <summary>Copies a folder (a TIA .ap project folder) file by file, downloading each as it goes.
        /// Listing reads names only and downloads nothing.</summary>
        public static void CopyDirectory(string source, string target, TimeSpan timeout)
        {
            DateTime deadline = DateTime.UtcNow + timeout;
            string src = Path.GetFullPath(source).TrimEnd(Path.DirectorySeparatorChar);
            Directory.CreateDirectory(target);
            foreach (string dir in Directory.GetDirectories(src, "*", SearchOption.AllDirectories))
                Directory.CreateDirectory(Path.Combine(target, dir.Substring(src.Length + 1)));
            foreach (string file in Directory.GetFiles(src, "*", SearchOption.AllDirectories))
            {
                TimeSpan left = deadline - DateTime.UtcNow;
                if (left <= TimeSpan.Zero) throw NotLocal(file, "the copy ran out of time");
                CopyFile(file, Path.Combine(target, file.Substring(src.Length + 1)), left);
            }
        }

        private static void CopyFile(string source, string target, TimeSpan timeout)
        {
            var cts = new CancellationTokenSource();
            Task copy = Task.Run(() =>
            {
                using (var input = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1 << 20))
                using (Stream output = target == null ? Stream.Null : new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1 << 20))
                {
                    var buffer = new byte[1 << 20];
                    int n;
                    while ((n = input.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        cts.Token.ThrowIfCancellationRequested();
                        output.Write(buffer, 0, n);
                    }
                }
            });
            bool done;
            try
            {
                done = copy.Wait(timeout);
            }
            catch (AggregateException ex)
            {
                var io = ex.InnerException as IOException;
                if (io != null && IsCloudFileError(io)) throw NotLocal(source, io.Message.Trim());
                throw ex.InnerException ?? ex;
            }
            if (!done)
            {
                cts.Cancel();
                throw NotLocal(source, $"it did not download within {timeout.TotalMinutes:0} minutes");
            }
        }

        /// <summary>ERROR_CLOUD_FILE_* (Win32 362–400): the provider (Dropbox) could not serve the file.</summary>
        private static bool IsCloudFileError(IOException io)
        {
            int code = io.HResult & 0xFFFF;
            return code >= 362 && code <= 400;
        }

        private static BridgeRefusalException NotLocal(string file, string why) =>
            new BridgeRefusalException("DROPBOX_NOT_LOCAL", $"{file} is not on this workstation and {why}. Make the job's 50 PLC folder available offline in Dropbox and press Start again.");
    }
}
