using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace PacForgeBridge
{
    public class VcCheckRequest
    {
        public string RepoPath { get; set; }
        public string PlcFolder { get; set; }
        /// <summary>The Dropbox archive /tia/vc/prepare retrieved the working copy from, when it did (ruling 9).</summary>
        public string RetrievedFrom { get; set; }
    }

    public class VcCommitRequest
    {
        public string RepoPath { get; set; }
        public string PlcFolder { get; set; }
        public List<VcObjectRef> Objects { get; set; }
        public List<string> Changes { get; set; }
        public string Subject { get; set; }
        public string AuthorName { get; set; }
        public string AuthorEmail { get; set; }
        public string Agent { get; set; }
        /// <summary>The conversation's base (40 hex), when it has one: pac-hub-vc commits only while HEAD is still that
        /// commit (`--expect-base`), else refuses HEAD_MOVED. Absent or null: no guard.</summary>
        public string ExpectBase { get; set; }
    }

    public class VcNewerChange
    {
        public string Object { get; set; }
        public string Author { get; set; }
        public string Sha { get; set; }
    }

    public class VcCheckResponse
    {
        public bool Success { get; set; }
        public string Refused { get; set; }
        public string Message { get; set; }
        public string State { get; set; }
        public string Export { get; set; }
        public string Base { get; set; }
        public string Latest { get; set; }
        public string LatestAuthor { get; set; }
        public string LatestDate { get; set; }
        public List<string> LocalChanges { get; set; }
        public List<VcNewerChange> NewerChanges { get; set; }
        public List<string> Skipped { get; set; }
        public List<string> NotCompiling { get; set; }
        /// <summary>Ruling 34: the bridge saved the working copy, because only this route's VCI work had modified it.</summary>
        public bool Saved { get; set; }
    }

    public class VcCommitResponse
    {
        public bool Success { get; set; }
        public string Refused { get; set; }
        public string Message { get; set; }
        public string Outcome { get; set; }
        public string Sha { get; set; }
        public bool Pushed { get; set; }
        public string Reason { get; set; }
        /// <summary>Objects of the change that were not exported (know-how protected, not in TIA, or no format VCI can
        /// export them as); absent when none.</summary>
        public List<string> Skipped { get; set; }
        /// <summary>Ruling 34: the bridge saved the working copy, because only this route's VCI work had modified it.</summary>
        public bool Saved { get; set; }
    }

    public class VcUpdateResponse
    {
        public bool Success { get; set; }
        public string Refused { get; set; }
        public string Message { get; set; }
        public List<string> Imported { get; set; } = new List<string>();
        public List<string> Deleted { get; set; } = new List<string>();
        public List<string> NotImported { get; set; } = new List<string>();
        public CompileResultDto Compile { get; set; }
        public bool BaseWritten { get; set; }
        /// <summary>Ruling 34: the bridge saved the working copy (it had no unsaved changes before the update).</summary>
        public bool Saved { get; set; }
    }

    /// <summary>
    /// PLC conversation version control (PHUB-232 §6–7). The bridge drives TIA; every git operation runs
    /// inside pac-hub-vc (D4), read back from its --json output through PacHubVc. Nothing here runs git.
    /// Each route validates its paths, then does its TIA and pac-hub-vc work under the service's VC lock, as
    /// prepare and archive do, and only on the PLC's working copy. A refusal answers 409 { success:false,
    /// refused?, message } (refused only for a name Pac Hub knows), bad input 400, a failure 500.
    /// </summary>
    public partial class BridgeServer
    {
        /// <summary>Refusal names Pac Hub carries by name (its BRIDGE_REFUSALS); any other pac-hub-vc refusal is its message alone.</summary>
        private static readonly HashSet<string> VcHubRefusals = new HashSet<string> { "VC_TOOL_MISSING", "REPO_NOT_FAST_FORWARD", "VC_DIVERGED", "VC_BEHIND" };

        /// <summary>The states pac-hub-vc status answers (vc-storage-git's SyncState).</summary>
        private static readonly HashSet<string> VcStates = new HashSet<string> { "latest", "local_edits", "behind", "diverged" };

        /// <summary>A full commit sha as git prints it (`expect_base`): 40 lowercase hex digits and nothing else.</summary>
        private static readonly Regex VcSha = new Regex(@"\A[0-9a-f]{40}\z");

        private sealed class VcAnswer
        {
            public JObject Json;
            public string Refused;
            public string Message;
        }

        /// <summary>
        /// Runs pac-hub-vc through PacHubVc and reads its JSON. A missing pac-hub-vc (or Node) is VC_TOOL_MISSING by
        /// name; a timeout, a process that would not start, or no JSON at all is a message; <c>{ refused, message }</c>
        /// from pac-hub-vc is a refusal, and <c>{ error }</c> a failure in its own words.
        /// </summary>
        private static VcAnswer RunVcJson(List<string> args, int timeoutMs)
        {
            JObject json;
            int exitCode;
            string error;
            try
            {
                json = PacHubVc.Json(args, timeoutMs, out exitCode, out error);
            }
            catch (BridgeRefusalException refusal)
            {
                return new VcAnswer { Refused = refusal.Name, Message = refusal.Message };
            }
            catch (Exception ex)
            {
                return new VcAnswer { Message = "pac-hub-vc " + args[0] + " could not run: " + ex.Message };
            }
            if (json == null) return new VcAnswer { Message = "pac-hub-vc " + args[0] + " gave no result: " + (error ?? ("exit code " + exitCode)) };
            string name = JsonString(json["refused"]);
            if (name != null)
                return new VcAnswer { Json = json, Refused = VcHubRefusals.Contains(name) ? name : null, Message = JsonMessage(json["message"]) ?? name };
            string failed = JsonMessage(json["error"]);
            if (failed != null)
                return new VcAnswer { Json = json, Message = "pac-hub-vc " + args[0] + " failed: " + failed };
            return new VcAnswer { Json = json };
        }

        /// <summary>A string pac-hub-vc printed, or null: an absent key, a JSON null and any other type read as null,
        /// never a cast exception.</summary>
        private static string JsonString(JToken token)
        {
            return token != null && token.Type == JTokenType.String ? (string)token : null;
        }

        /// <summary>A message pac-hub-vc printed: its string, or any other value as compact JSON; null when absent or null.</summary>
        private static string JsonMessage(JToken token)
        {
            if (token == null || token.Type == JTokenType.Null) return null;
            return token.Type == JTokenType.String ? (string)token : token.ToString(Formatting.None);
        }

        /// <summary>The strings of a JSON array (anything else in it left out); an absent or non-array value is none.</summary>
        private static List<string> JsonStrings(JToken token)
        {
            return token is JArray list ? list.Where(t => t.Type == JTokenType.String).Select(t => (string)t).ToList() : new List<string>();
        }

        /// <summary>
        /// Free text bound for pac-hub-vc, flattened to one line (CR/LF and runs of whitespace to one space). Nothing
        /// else changes: PacHubVc passes `"`, `%` and the rest verbatim (CommandLineToArgvW quoting, no cmd.exe).
        /// </summary>
        private static string VcText(string s)
        {
            return string.Join(" ", (s ?? "").Split(new[] { ' ', '\t', '\r', '\n', '\v', '\f' }, StringSplitOptions.RemoveEmptyEntries));
        }

        private static string VcAuthorPart(string s)
        {
            return VcText(s).Replace("<", "").Replace(">", "");
        }

        /// <summary>
        /// One version-control route: V18 answers 409 (VCI export needs V20 or later) before anything; the paths are
        /// checked (400) before the lock is taken; the work runs under the VC lock. A named refusal is 409 with its
        /// name, anything that throws 500, and either says <c>saved</c> when the bridge had saved the working copy.
        /// </summary>
        private async Task AnswerVc<T>(HttpListenerResponse res, string what, string repoPath, string plcFolder,
            Func<string, T> work, Func<string, string, T> failure, Func<T, bool> succeeded, Action<T> markSaved)
        {
            try
            {
                if (!TiaPortalService.VcSupported)
                {
                    await WriteJson(res, 409, failure(null, TiaPortalService.VcUnsupported));
                    return;
                }
                string plcDir = TiaPortalService.VcPlcDir(repoPath, plcFolder);
                T answer = _tiaService.VcLocked(() => work(plcDir));
                await WriteJson(res, succeeded(answer) ? 200 : 409, answer);
            }
            catch (Exception ex)
            {
                int status;
                T answer = VcFailureAnswer(what, ex, failure, markSaved, out status);
                await WriteJson(res, status, answer);
            }
        }

        /// <summary>
        /// A route's work threw after the bridge had saved the working copy (Ruling 34: Update from Git's own save, or
        /// the save after VCI work that failed). The failure is the inner exception; its answer says <c>saved: true</c>.
        /// </summary>
        private sealed class VcFailedAfterSaveException : Exception
        {
            public VcFailedAfterSaveException(Exception cause) : base(cause.Message, cause) { }
        }

        /// <summary>The answer to a route that threw: 400 for bad input, 409 with its name for a refusal, anything else
        /// 500; one that threw after the bridge saved the working copy says so (<c>saved: true</c>).</summary>
        private static T VcFailureAnswer<T>(string what, Exception ex, Func<string, string, T> failure, Action<T> markSaved, out int status)
        {
            var afterSave = ex as VcFailedAfterSaveException;
            Exception cause = afterSave != null && afterSave.InnerException != null ? afterSave.InnerException : ex;
            var refusal = cause as BridgeRefusalException;
            string saved = afterSave != null ? " (the working copy was saved first)" : "";
            if (cause is BridgeBadRequestException)
            {
                status = 400;
                Console.WriteLine($"[VC] {what} bad request: {cause.Message}");
            }
            else if (refusal != null)
            {
                status = 409;
                Console.WriteLine($"[VC] {what} refused {refusal.Name}: {refusal.Message}{saved}");
            }
            else
            {
                status = 500;
                Console.WriteLine($"[VC] {what} failed: {cause.Message}{saved}");
            }
            T answer = failure(refusal?.Name, cause.Message);
            if (afterSave != null) markSaved(answer);
            return answer;
        }

        /// <summary>
        /// Ruling 34 around a route's VCI work (export, connect, synchronise, import): whether the working copy had
        /// unsaved changes is read before the work; afterwards, on every path (early returns and failures included),
        /// one that had none and has some now is saved, since only this work made them, and one that had some is never
        /// saved, because they are the engineer's. The answer says whether the bridge saved it during the route, the
        /// work's own save (Update from Git's) included; a failure after a save is thrown on as
        /// VcFailedAfterSaveException, so its 409 or 500 answer says so too.
        /// </summary>
        private T VcKeepingSaved<T>(string plcDir, string what, Func<bool, T> work, Action<T> markSaved) where T : class
        {
            bool modifiedBefore = _tiaService.VcProjectModified();
            int savesBefore = _tiaService.VcSaves;
            T answer;
            try
            {
                answer = work(modifiedBefore);
            }
            catch (Exception ex)
            {
                _tiaService.VcSaveWhatVcChanged(plcDir, modifiedBefore, what);
                if (_tiaService.VcSaves != savesBefore) throw new VcFailedAfterSaveException(ex);
                throw;
            }
            _tiaService.VcSaveWhatVcChanged(plcDir, modifiedBefore, what);
            if (answer != null && _tiaService.VcSaves != savesBefore) markSaved(answer);
            return answer;
        }

        /// <summary>The request body, or null when it is missing or not JSON (the caller answers 400).</summary>
        private static async Task<T> ReadVcBody<T>(HttpListenerRequest req) where T : class
        {
            try { return Json.Deserialize<T>(await ReadBody(req)); }
            catch (JsonException) { return null; }
        }

        private async Task HandleVcCheck(HttpListenerRequest req, HttpListenerResponse res)
        {
            var request = await ReadVcBody<VcCheckRequest>(req);
            if (request == null || string.IsNullOrWhiteSpace(request.RepoPath) || string.IsNullOrWhiteSpace(request.PlcFolder))
            {
                await WriteJson(res, 400, new VcCheckResponse { Success = false, Message = "repo_path and plc_folder are required." });
                return;
            }
            Console.WriteLine($"[VC] Check {request.RepoPath} {request.PlcFolder} (PHUB-232)");
            await AnswerVc(res, "check", request.RepoPath, request.PlcFolder, plcDir => VcCheck(request, plcDir),
                (name, message) => new VcCheckResponse { Success = false, Refused = name, Message = message }, a => a.Success, a => a.Saved = true);
        }

        /// <summary>§6: the whole PLC exported through the workspace, then read against git by pac-hub-vc status.</summary>
        private VcCheckResponse VcCheck(VcCheckRequest request, string plcDir)
        {
            string unready = _tiaService.VcWorkingCopyUnready(plcDir);
            if (unready != null) return new VcCheckResponse { Success = false, Message = unready };
            return VcKeepingSaved(plcDir, "check", modifiedBefore => VcCheckWorkingCopy(request, plcDir), a => a.Saved = true);
        }

        private VcCheckResponse VcCheckWorkingCopy(VcCheckRequest request, string plcDir)
        {
            string repo = Path.GetDirectoryName(plcDir);

            // Ruling 9: a working copy retrieved from an archive takes its base from the archive's name. pac-hub-vc
            // keeps a base already recorded, and a name with none leaves the no-base rule to status.
            if (!string.IsNullOrWhiteSpace(request.RetrievedFrom))
            {
                VcAnswer fromArchive = RunVcJson(new List<string> { "base", "--repo", repo, "--plc", request.PlcFolder, "--from-archive", VcText(request.RetrievedFrom), "--json" }, 60000);
                if (fromArchive.Message != null) Console.WriteLine("[VC] base from " + request.RetrievedFrom + " not recorded: " + fromArchive.Message);
            }

            string exportDir = VcExportDir(plcDir);
            Console.WriteLine("[VC] check: full export into " + exportDir);
            VcExportResult export = _tiaService.VcExportAll(exportDir);
            if (export.Error != null) return new VcCheckResponse { Success = false, Message = export.Error };

            var args = new List<string> { "status", "--repo", repo, "--plc", request.PlcFolder, "--json" };
            if (export.RefusedNotCompiling) args.Add("--base-only");
            VcAnswer status = RunVcJson(args, 180000);
            if (status.Message != null) return new VcCheckResponse { Success = false, Refused = status.Refused, Message = status.Message };
            return VcCheckAnswer(status.Json, export);
        }

        /// <summary>
        /// The check's answer from pac-hub-vc status and the export. An export refused because the project does not
        /// compile reads base against latest only (§6 rows 5–6): unverified, or unverified_behind; a clone diverged
        /// from its remote stays diverged. A status with no state Pac Hub knows is a failure, never a guess.
        /// </summary>
        private static VcCheckResponse VcCheckAnswer(JObject s, VcExportResult export)
        {
            string state = JsonString(s["state"]);
            if (state == null || !VcStates.Contains(state))
                return new VcCheckResponse { Success = false, Message = "pac-hub-vc status answered no state Pac Hub knows (" + (JsonMessage(s["state"]) ?? "none") + ")." };
            if (export.RefusedNotCompiling && state != "diverged") state = state == "behind" ? "unverified_behind" : "unverified";
            return new VcCheckResponse
            {
                Success = true,
                State = state,
                Export = export.RefusedNotCompiling ? "refused_not_compiling" : "ok",
                Base = JsonString(s["base"]),
                Latest = JsonString(s["latest"]),
                LatestAuthor = JsonString(s["latestAuthor"]),
                LatestDate = JsonString(s["latestDate"]),
                LocalChanges = JsonStrings(s["localChanges"]),
                NewerChanges = s["newerChanges"] is JArray newer
                    ? newer.OfType<JObject>().Select(n => new VcNewerChange { Object = JsonString(n["object"]), Author = JsonString(n["author"]), Sha = JsonString(n["sha"]) }).ToList()
                    : new List<VcNewerChange>(),
                Skipped = export.Skipped,
                NotCompiling = export.Inconsistent,
            };
        }

        private async Task HandleVcCommit(HttpListenerRequest req, HttpListenerResponse res)
        {
            var request = await ReadVcBody<VcCommitRequest>(req);
            if (request == null || string.IsNullOrWhiteSpace(request.RepoPath) || string.IsNullOrWhiteSpace(request.PlcFolder) || string.IsNullOrWhiteSpace(request.Subject))
            {
                await WriteJson(res, 400, new VcCommitResponse { Success = false, Message = "repo_path, plc_folder and subject are required." });
                return;
            }
            if ((request.Objects ?? new List<VcObjectRef>()).Any(o => o == null || (o.Kind != "block" && o.Kind != "tag_table") || string.IsNullOrWhiteSpace(o.Name)))
            {
                await WriteJson(res, 400, new VcCommitResponse { Success = false, Message = "Each of objects needs kind 'block' or 'tag_table' and a name." });
                return;
            }
            if (request.ExpectBase != null && !VcSha.IsMatch(request.ExpectBase))
            {
                await WriteJson(res, 400, new VcCommitResponse { Success = false, Message = "expect_base must be a commit sha of 40 lowercase hex digits; nothing was exported or committed." });
                return;
            }
            Console.WriteLine($"[VC] Commit {request.RepoPath} {request.PlcFolder}: {string.Join(", ", request.Changes ?? new List<string>())} (PHUB-232)");
            await AnswerVc(res, "commit", request.RepoPath, request.PlcFolder, plcDir => VcCommit(request, plcDir),
                (name, message) => new VcCommitResponse { Success = false, Refused = name, Message = message }, a => a.Success, a => a.Saved = true);
        }

        /// <summary>§7: the change's objects exported, then committed and pushed by pac-hub-vc. A rejected push is final (ruling 1).</summary>
        private VcCommitResponse VcCommit(VcCommitRequest request, string plcDir)
        {
            string unready = _tiaService.VcWorkingCopyUnready(plcDir);
            if (unready != null) return new VcCommitResponse { Success = false, Message = unready };
            return VcKeepingSaved(plcDir, "commit", modifiedBefore => VcCommitWorkingCopy(request, plcDir), a => a.Saved = true);
        }

        private VcCommitResponse VcCommitWorkingCopy(VcCommitRequest request, string plcDir)
        {
            string exportDir = VcExportDir(plcDir);
            VcExportResult export = _tiaService.VcExportObjects(exportDir, request.Objects ?? new List<VcObjectRef>());
            List<string> skipped = export.Skipped.Count > 0 ? export.Skipped : null;
            if (export.RefusedNotCompiling)
                return new VcCommitResponse { Success = true, Outcome = "deferred", Reason = string.Join(", ", export.Inconsistent) + " does not compile", Skipped = skipped };
            if (export.Error != null) return new VcCommitResponse { Success = true, Outcome = "failed", Reason = export.Error, Skipped = skipped };

            // 240 s: the hub gives the whole request 300 s, the export included, and must hear the outcome.
            VcAnswer commit = RunVcJson(VcCommitArgs(request, Path.GetDirectoryName(plcDir)), 240000);
            VcCommitResponse answer = VcCommitAnswer(commit);
            answer.Skipped = skipped;
            return answer;
        }

        /// <summary>`pac-hub-vc commit … --push --json` for the repo the request's paths resolved to: one --change per
        /// ref, free text flattened to one line, and `--expect-base` with the conversation's base when the hub sent one
        /// (validated as a sha before the route ran).</summary>
        private static List<string> VcCommitArgs(VcCommitRequest request, string repo)
        {
            var args = new List<string> { "commit", "--repo", repo, "--plc", request.PlcFolder, "--source", "offline", "--trigger", "plc-conversation", "--subject", VcText(request.Subject), "--push", "--json" };
            foreach (string change in request.Changes ?? new List<string>())
            {
                if (string.IsNullOrWhiteSpace(change)) continue;
                args.Add("--change");
                args.Add(VcText(change));
            }
            if (!string.IsNullOrWhiteSpace(request.Agent)) { args.Add("--agent"); args.Add(VcText(request.Agent)); }
            // The author goes as "Name <email>" only when both are given; otherwise pac-hub-vc uses the repo's identity.
            if (!string.IsNullOrWhiteSpace(VcAuthorPart(request.AuthorName)) && !string.IsNullOrWhiteSpace(VcAuthorPart(request.AuthorEmail)))
            {
                args.Add("--author");
                args.Add(VcAuthorPart(request.AuthorName) + " <" + VcAuthorPart(request.AuthorEmail) + ">");
            }
            // The commit guard: pac-hub-vc refuses HEAD_MOVED, before anything is staged, when HEAD is not this base.
            if (request.ExpectBase != null) { args.Add("--expect-base"); args.Add(request.ExpectBase); }
            return args;
        }

        /// <summary>
        /// What pac-hub-vc commit came to. <c>committed</c>: this change's commit, its sha and push. A push the remote
        /// rejected stays committed with pushed:false and pac-hub-vc's reason, untouched (ruling 1). <c>idle</c>: nothing
        /// new to commit, so committed with no sha (HEAD is not this change's commit), and pac-hub-vc's reason when it
        /// gave one, else "no changes": an earlier offline commit whose push the remote rejected still reaches the hub
        /// as "remote moved; not fast-forward". Anything else, or no result, is failed with its reason, never pushed:
        /// the commit guard's <c>{ outcome: refused, reason: "HEAD_MOVED: …" }</c> answers failed with that reason verbatim.
        /// </summary>
        private static VcCommitResponse VcCommitAnswer(VcAnswer commit)
        {
            string outcome = commit.Json == null ? null : JsonString(commit.Json["outcome"]);
            if (outcome == null)
                return new VcCommitResponse { Success = true, Outcome = "failed", Reason = commit.Refused != null ? commit.Refused + ": " + commit.Message : (commit.Message ?? "pac-hub-vc commit answered no outcome") };
            JObject j = commit.Json;
            bool pushed = j["pushed"] != null && j["pushed"].Type == JTokenType.Boolean && (bool)j["pushed"];
            if (outcome == "committed")
                return new VcCommitResponse { Success = true, Outcome = "committed", Sha = JsonString(j["sha"]), Pushed = pushed, Reason = JsonMessage(j["reason"]) };
            if (outcome == "idle")
                return new VcCommitResponse { Success = true, Outcome = "committed", Sha = null, Pushed = pushed, Reason = JsonMessage(j["reason"]) ?? "no changes" };
            return new VcCommitResponse { Success = true, Outcome = "failed", Sha = null, Pushed = false, Reason = JsonMessage(j["reason"]) ?? "pac-hub-vc commit answered " + outcome };
        }

        private async Task HandleVcUpdate(HttpListenerRequest req, HttpListenerResponse res)
        {
            var request = await ReadVcBody<VcCheckRequest>(req);
            if (request == null || string.IsNullOrWhiteSpace(request.RepoPath) || string.IsNullOrWhiteSpace(request.PlcFolder))
            {
                await WriteJson(res, 400, new VcUpdateResponse { Success = false, Message = "repo_path and plc_folder are required." });
                return;
            }
            Console.WriteLine($"[VC] Update from Git {request.RepoPath} {request.PlcFolder} (PHUB-232)");
            await AnswerVc(res, "update", request.RepoPath, request.PlcFolder, plcDir => VcUpdate(request, plcDir),
                (name, message) => new VcUpdateResponse { Success = false, Refused = name, Message = message }, a => a.Success, a => a.Saved = true);
        }

        /// <summary>§6 Update from Git: export, let pac-hub-vc fast-forward and list the files, import them, compile, save, record the base.</summary>
        private VcUpdateResponse VcUpdate(VcCheckRequest request, string plcDir)
        {
            string unready = _tiaService.VcWorkingCopyUnready(plcDir);
            if (unready != null) return new VcUpdateResponse { Success = false, Message = unready };
            // Ruling 42: a working copy with unsaved changes (the engineer's) is refused before any VCI work.
            return VcKeepingSaved(plcDir, "update", modifiedBefore => VcUnsavedRefusal(modifiedBefore) ?? VcUpdateWorkingCopy(request, plcDir), a => a.Saved = true);
        }

        /// <summary>
        /// Update from Git refuses a working copy with unsaved changes, read before any VCI work (Ruling 42): it ends
        /// in a save, and the engineer's unsaved edits are never saved for them. Nothing is exported, imported or
        /// compiled and the base is not recorded. Null when the copy has none.
        /// </summary>
        private static VcUpdateResponse VcUnsavedRefusal(bool modifiedBefore)
        {
            if (!modifiedBefore) return null;
            return new VcUpdateResponse
            {
                Success = false,
                Refused = "UNSAVED_CHANGES",
                Message = "The working copy has unsaved changes in TIA; save the project in TIA, then press Update from Git again. Nothing was exported, imported or compiled.",
            };
        }

        /// <summary>The update itself, on a working copy that had no unsaved changes before it.</summary>
        private VcUpdateResponse VcUpdateWorkingCopy(VcCheckRequest request, string plcDir)
        {
            string repo = Path.GetDirectoryName(plcDir);

            // Exported first, so pac-hub-vc update checks the working copy as it is now, not as it was at Start.
            string exportDir = VcExportDir(plcDir);
            VcExportResult export = _tiaService.VcExportAll(exportDir);
            if (export.Error != null) return new VcUpdateResponse { Success = false, Message = export.Error };
            if (export.RefusedNotCompiling)
                return new VcUpdateResponse { Success = false, Message = "The project does not compile (" + string.Join(", ", export.Inconsistent) + "), so Pac Hub cannot tell whether the working copy has edits; make it compile, then press Update from Git again." };

            VcAnswer prepared = RunVcJson(new List<string> { "update", "--repo", repo, "--plc", request.PlcFolder, "--json" }, 180000);
            if (prepared.Message != null) return new VcUpdateResponse { Success = false, Refused = prepared.Refused, Message = prepared.Message };
            string outcome = JsonString(prepared.Json["outcome"]);
            if (outcome == "up-to-date") return new VcUpdateResponse { Success = true, Message = "already up to date" };
            string latest = JsonString(prepared.Json["latest"]);
            if (outcome != "ready" || string.IsNullOrWhiteSpace(latest))
                return new VcUpdateResponse { Success = false, Message = "pac-hub-vc update answered " + (JsonMessage(prepared.Json["outcome"]) ?? "no outcome") + (string.IsNullOrWhiteSpace(latest) ? " with no latest commit" : "") + "; nothing was imported." };

            List<VcUpdateFile> files = VcUpdateFilesOf(prepared.Json);
            Console.WriteLine("[VC] update: " + files.Count + " file(s) from git, to " + latest);
            VcImportResult imported = _tiaService.VcImportFiles(exportDir, files);
            CompileResultDto compile = null;
            var notes = new List<string>();
            _tiaService.RequireVcWorkingCopy(plcDir);
            try
            {
                compile = _tiaService.CompileProject();
            }
            catch (Exception ex)
            {
                // What was imported is saved all the same; the compile is reported as not run.
                notes.Add("The project was not compiled after the update: " + ex.Message);
                Console.WriteLine("[VC] " + notes[notes.Count - 1]);
            }
            _tiaService.RequireVcWorkingCopy(plcDir);
            bool saved = _tiaService.VcSaveWhatVcChanged(plcDir, false, "update");

            // The base moves only when every file landed and is saved: a partial or unsaved import leaves the copy on
            // its old base, and the re-check reads behind (objects already equal to latest count as landed), so pressing
            // Update from Git again resumes it.
            bool baseWritten = false;
            if (imported.NotImported.Count == 0 && (saved || !_tiaService.VcProjectModified()))
            {
                VcAnswer written = RunVcJson(new List<string> { "base", "--repo", repo, "--plc", request.PlcFolder, "--set", latest, "--json" }, 60000);
                string recorded = written.Message == null ? JsonString(written.Json["base"]) : null;
                baseWritten = recorded != null && string.Equals(recorded, latest, StringComparison.OrdinalIgnoreCase);
                if (!baseWritten) Console.WriteLine("[VC] update: the base was not recorded: " + (written.Message ?? "pac-hub-vc base answered no base"));
            }
            return new VcUpdateResponse
            {
                Success = true, Message = notes.Count == 0 ? null : string.Join(" ", notes), Imported = imported.Imported, Deleted = imported.Deleted,
                NotImported = imported.NotImported, Compile = compile, BaseWritten = baseWritten, Saved = saved,
            };
        }

        /// <summary>The files pac-hub-vc update lists, read field by field. An entry that is not an object, or lacks a
        /// path or object, is kept, to be named in not_imported.</summary>
        private static List<VcUpdateFile> VcUpdateFilesOf(JObject json)
        {
            if (!(json["files"] is JArray list)) return new List<VcUpdateFile>();
            return list.Select(t => t as JObject).Select(o => o == null ? new VcUpdateFile() : new VcUpdateFile
            {
                Path = JsonString(o["path"]),
                Object = JsonString(o["object"]),
                Kind = JsonString(o["kind"]),
                Removed = o["removed"] != null && o["removed"].Type == JTokenType.Boolean && (bool)o["removed"],
            }).ToList();
        }

        /// <summary>&lt;plc&gt;\Export, the Pac Hub workspace's root (prepare made it; made again when it has gone).</summary>
        private static string VcExportDir(string plcDir)
        {
            return Directory.CreateDirectory(Path.Combine(plcDir, "Export")).FullName;
        }
    }
}
