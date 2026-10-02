using System;
using System.Collections.Generic;
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
    /// download in time, or that Dropbox cannot serve, is DROPBOX_NOT_LOCAL. A working copy made from it is
    /// built in a staging folder and moved into place only once complete (ClearStaging, MoveIntoPlace).
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

        /// <summary>A Dropbox-relative path (forward slashes) on this workstation; never outside the root. A path
        /// that is absolute, malformed or leaves the root is the caller's bad input (400).</summary>
        public static string Resolve(string root, string relative)
        {
            string full;
            try
            {
                if (string.IsNullOrWhiteSpace(relative) || Path.IsPathRooted(relative))
                    throw new BridgeBadRequestException($"'{relative}' is not a path inside Dropbox (expected e.g. Pac/Jobs/<Customer>/<JOB> - <name>).");
                full = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
            }
            catch (Exception ex) when (ex is ArgumentException || ex is NotSupportedException || ex is PathTooLongException)
            {
                throw new BridgeBadRequestException($"'{relative}' is not a path inside Dropbox: {ex.Message}");
            }
            string inside = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!full.StartsWith(inside, StringComparison.OrdinalIgnoreCase))
                throw new BridgeBadRequestException($"'{relative}' leaves the Dropbox folder.");
            return full;
        }

        /// <summary>Whether `path` is `root` or anywhere under it.</summary>
        public static bool IsInside(string path, string root)
        {
            string full = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar);
            string top = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
            return string.Equals(full, top, StringComparison.OrdinalIgnoreCase)
                || full.StartsWith(top + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Clears what an earlier copy or retrieve left in a working copy's staging folder. Nothing in staging
        /// is ever a working copy, so all of it goes. One that cannot be cleared is still held, by a copy that
        /// timed out and is still reading from Dropbox or by TIA, and is refused DROPBOX_NOT_LOCAL.
        /// </summary>
        public static void ClearStaging(string staging)
        {
            if (!Directory.Exists(staging)) return;
            try
            {
                DeleteTree(staging);
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                throw new BridgeRefusalException("DROPBOX_NOT_LOCAL", $"A previous copy of the working copy is still finishing ({staging} could not be cleared: {ex.Message.Trim()}); try again in a minute.");
            }
        }

        /// <summary>ClearStaging after a failed copy or retrieve, best effort: what stays is cleared at the next Start.</summary>
        public static void TryClearStaging(string staging)
        {
            try
            {
                if (Directory.Exists(staging)) DeleteTree(staging);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[VC] Could not clear {staging} yet ({ex.Message.Trim()}); the next Start clears it.");
            }
        }

        /// <summary>
        /// Moves a finished project folder from staging to `target`, in one rename on the same volume. The caller
        /// has found no project file under the working copy folder, so a folder already at `target` is debris
        /// and is replaced. A handle TIA or a scanner keeps for a moment after a close is waited out (5 s).
        /// </summary>
        public static void MoveIntoPlace(string staged, string target)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(target));
            if (Directory.Exists(target)) DeleteTree(target);
            for (int attempt = 1; ; attempt++)
            {
                try
                {
                    Directory.Move(staged, target);
                    return;
                }
                catch (Exception ex) when ((ex is IOException || ex is UnauthorizedAccessException) && attempt < 20)
                {
                    Thread.Sleep(250);
                }
            }
        }

        private static void DeleteTree(string dir)
        {
            foreach (string file in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
                File.SetAttributes(file, FileAttributes.Normal);
            Directory.Delete(dir, true);
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

        /// <summary>
        /// The Win32 ERROR_CLOUD_FILE_* codes: the cloud files provider (Dropbox) could not serve the file. Listed
        /// one by one (checked against the messages Windows gives each code): 362–400 also holds codes that are
        /// not cloud-file errors, and 404, 426 and 475 lie outside it. ERROR_NOT_A_CLOUD_FILE (376),
        /// ERROR_CLOUD_FILE_NOT_UNDER_SYNC_ROOT (390) and ERROR_NOT_A_CLOUD_SYNC_ROOT (405) say the file is no
        /// cloud file at all, so they are left out.
        /// </summary>
        private static readonly HashSet<int> CloudFileErrors = new HashSet<int>
        {
            362, // PROVIDER_NOT_RUNNING
            363, // METADATA_CORRUPT
            364, // METADATA_TOO_LARGE
            365, // PROPERTY_BLOB_TOO_LARGE
            366, // PROPERTY_BLOB_CHECKSUM_MISMATCH
            374, // TOO_MANY_PROPERTY_BLOBS
            375, // PROPERTY_VERSION_NOT_SUPPORTED
            377, // NOT_IN_SYNC
            378, // ALREADY_CONNECTED
            379, // NOT_SUPPORTED
            380, // INVALID_REQUEST
            381, // READ_ONLY_VOLUME
            382, // CONNECTED_PROVIDER_ONLY
            383, // VALIDATION_FAILED
            386, // AUTHENTICATION_FAILED
            387, // INSUFFICIENT_RESOURCES
            388, // NETWORK_UNAVAILABLE
            389, // UNSUCCESSFUL
            391, // IN_USE
            392, // PINNED
            393, // REQUEST_ABORTED
            394, // PROPERTY_CORRUPT
            395, // ACCESS_DENIED
            396, // INCOMPATIBLE_HARDLINKS
            397, // PROPERTY_LOCK_CONFLICT
            398, // REQUEST_CANCELED
            404, // PROVIDER_TERMINATED
            426, // REQUEST_TIMEOUT
            475, // US_MESSAGE_TIMEOUT
        };

        private static bool IsCloudFileError(IOException io) => CloudFileErrors.Contains(io.HResult & 0xFFFF);

        private static BridgeRefusalException NotLocal(string file, string why) =>
            new BridgeRefusalException("DROPBOX_NOT_LOCAL", $"{file} is not on this workstation and {why}. Make the job's 50 PLC folder available offline in Dropbox and press Start again.");
    }
}
