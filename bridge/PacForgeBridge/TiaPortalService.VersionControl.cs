using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;
using Siemens.Engineering;
using Siemens.Engineering.HW;
using Siemens.Engineering.HW.Features;
using Siemens.Engineering.SW;
#if !TIA_V18
using Siemens.Engineering.VersionControl;
#endif

namespace PacForgeBridge
{
    /// <summary>
    /// PHUB-232: the working copy a Pac Hub PLC conversation runs on (pac-hub spec
    /// 2026-10-01-pac-hub-plc-version-control-design.md §5). The job repo lives under PAC_JOBS_ROOT
    /// (C:\PacTechGit), outside Dropbox. The master TIA project lives in the job's Dropbox
    /// `50 PLC\&lt;nn&gt; &lt;name&gt;\`. Every git operation belongs to `pac-hub-vc`; this file drives TIA
    /// and the file system only, and never closes a project the engineer has open.
    /// </summary>
    public partial class TiaPortalService
    {
#if TIA_V18
        private const int EditionVersion = 18;
#elif TIA_V21
        private const int EditionVersion = 21;
#else
        private const int EditionVersion = 20;
#endif
        private const string PacHubWorkspace = "Pac Hub";
        private static readonly TimeSpan HydrateTimeout = TimeSpan.FromMinutes(10);
        private static readonly Regex PlcFolderPattern = new Regex(@"^(\d{2}) (.+)$");
        private static readonly Regex DocCodePattern = new Regex(@"^([A-Z]{2,6}-\d{4}-\d{7})(?!\d)");
        private static readonly Regex NameDatePattern = new Regex(@"(\d{4}-\d{2}-\d{2})");
        private static readonly Regex ArchiveExtension = new Regex(@"\.zap(\d+)$", RegexOptions.IgnoreCase);
        private static readonly Regex ProjectExtension = new Regex(@"\.ap(\d+)$", RegexOptions.IgnoreCase);
        private readonly object _vcLock = new object();

        private sealed class PlcMaster
        {
            public string Location;
            public bool IsArchive;
            public int Version;
            public string NameDate;
            public DateTime WrittenUtc;
        }

        /// <summary>POST /tia/vc/prepare (spec §5 steps 1–5).</summary>
        public VcPrepareResponse PrepareWorkingCopy(VcPrepareRequest request)
        {
            lock (_vcLock)
            {
                // 1. The job's PLC folders in Dropbox, and which one. Nothing has been touched yet. A jobs root
                //    inside Dropbox is refused first: git and Dropbox both sync, and running both over one
                //    folder corrupts the repo.
                string dropboxRoot = DropboxLocal.Root();
                string jobsRoot = JobsRoot();
                if (DropboxLocal.IsInside(jobsRoot, dropboxRoot))
                    throw new BridgeRefusalException("JOBS_ROOT_IN_DROPBOX",
                        $"The jobs root {jobsRoot} is inside Dropbox ({dropboxRoot}). The job repo must live outside Dropbox, e.g. C:\\PacTechGit: git and Dropbox both sync, and running both over one folder corrupts the repo. Point PAC_JOBS_ROOT outside Dropbox, restart the bridge and press Start again.");
                string jobDir = DropboxLocal.Resolve(dropboxRoot, request.DropboxJobPath);
                string plcRoot = Path.Combine(jobDir, "50 PLC");
                if (!Directory.Exists(plcRoot))
                    throw new BridgeRefusalException("DROPBOX_NOT_LOCAL", $"{plcRoot} is not on this workstation. Make sure Dropbox syncs the job folder (Selective Sync does not exclude it) and press Start again.");
                List<VcPlcDto> plcs = ListPlcFolders(plcRoot);
                if (plcs.Count == 0)
                    throw new InvalidOperationException($"{plcRoot} has no PLC folder; Pac Hub expects one named like '01 Rollformer'.");
                VcPlcDto plc = ChoosePlc(plcs, request.PlcFolder);

                // 2. The job repo: pac-hub-vc ensure (found, cloned or initialised; pull --ff-only), with the
                //    chosen PLC recorded in job.json, along with the doc code its newest master's name carries.
                JObject ensured = PacHubVc.Ensure(request.Job, request.Customer, request.JobName, jobsRoot,
                    new PacHubVc.PlcEntry { Number = plc.Number, Name = plc.Name, DocCode = plc.DocCode });
                MergeDocCodes(plcs, ensured);
                string repoPath = (string)ensured["repoPath"];
                string plcDir = Path.Combine(repoPath, plc.Folder);
                string projectDir = Path.Combine(plcDir, "Project");
                string workingCopy = FindProjectFileOrNull(projectDir);

                // 3. The TIA edition: the working copy's, or else the newest master's. Another edition is
                //    WRONG_TIA_VERSION, answered before TIA is asked anything and before any retrieve, copy
                //    or open. A master is never upgraded by opening it in a newer TIA; Pac Hub asks the next bridge.
                PlcMaster master = null;
                if (workingCopy != null)
                {
                    RequireEdition(VersionOf(workingCopy), workingCopy);
                }
                else
                {
                    master = NewestMaster(Path.Combine(plcRoot, plc.Folder));
                    if (master == null)
                        throw new InvalidOperationException($"50 PLC\\{plc.Folder} holds no TIA project (a .zap archive or an .ap project folder) to make the working copy from.");
                    RequireEdition(master.Version, master.Location);
                }

                // 4. What TIA has open. "other" returns here, before anything is opened, closed, saved or
                //    copied: the engineer's open project, unsaved edits and all, is never touched.
                string openName;
                string openPath;
                string tiaOpen = WhatTiaHasOpen(workingCopy, out openName, out openPath);
                if (tiaOpen == "other")
                    throw new BridgeRefusalException("NOT_WORKING_COPY",
                        $"TIA has {openName} ({openPath}) open, which isn't the working copy ({workingCopy ?? projectDir}); close it and press Start.");

                // 5. The working copy: used as is, or made once from the newest master (step 3).
                //    It is made in <plc>\.pachub\staging\ (git-ignored, and never searched for a working
                //    copy) and moved into Project\ only once complete. A copy or retrieve cut short, by a
                //    timeout or by the bridge or machine going down, leaves nothing in Project\ to be taken
                //    for a working copy at the next Start; what it left in staging is cleared then.
                //    A working copy retrieved from a .zap has the archive's file name recorded in
                //    <plc>\.pachub\retrieved-from once it is in Project\. Phase 3 reads the base from that name,
                //    so every prepare reports it from there (`retrieved_from`): a step below that fails after the
                //    move, or a later Start, never loses it. A new working copy forgets the old record first,
                //    and the old copy's base with it (`<plc>\.pachub\base`): that base belonged to the copy that
                //    is gone, and kept, `base --from-archive` would keep it and the next Start could commit "as
                //    found" a master older than git. A working copy used as is keeps both.
                bool opened = false;
                if (workingCopy == null)
                {
                    if (plc.DocCode == null) plc.DocCode = DocCodeOf(Path.GetFileName(master.Location));
                    string staging = Path.Combine(plcDir, ".pachub", "staging");
                    DropboxLocal.ClearStaging(staging);
                    ForgetRetrievedFrom(plcDir);
                    ForgetBase(plcDir);
                    Directory.CreateDirectory(staging);
                    if (master.IsArchive)
                    {
                        DropboxLocal.Hydrate(master.Location, HydrateTimeout);
                        ConnectWithNothingOpen();
                        string stagedFile;
                        try
                        {
                            // Retrieve unpacks the archive and opens it. That project is this call's own (TIA
                            // had nothing open, just checked), so it is closed again to be moved into place.
                            Project retrieved = _tiaPortal.Projects.Retrieve(new FileInfo(master.Location), new DirectoryInfo(staging));
                            stagedFile = retrieved.Path.FullName;
                            Console.WriteLine($"[VC] Retrieved {Path.GetFileName(master.Location)} into {stagedFile}");
                            retrieved.Close();
                            _project = null;
                        }
                        catch
                        {
                            DropboxLocal.TryClearStaging(staging);
                            throw;
                        }
                        string landed = Path.Combine(projectDir, Path.GetFileNameWithoutExtension(stagedFile));
                        DropboxLocal.MoveIntoPlace(Path.GetDirectoryName(stagedFile), landed);
                        workingCopy = Path.Combine(landed, Path.GetFileName(stagedFile));
                        RecordRetrievedFrom(plcDir, Path.GetFileName(master.Location));
                    }
                    else
                    {
                        string staged = Path.Combine(staging, Path.GetFileName(master.Location));
                        try
                        {
                            DropboxLocal.CopyDirectory(master.Location, staged, HydrateTimeout);
                        }
                        catch
                        {
                            DropboxLocal.TryClearStaging(staging);
                            throw;
                        }
                        string landed = Path.Combine(projectDir, Path.GetFileName(master.Location));
                        DropboxLocal.MoveIntoPlace(staged, landed);
                        workingCopy = FindProjectFileOrNull(landed)
                            ?? throw new InvalidOperationException($"{landed} holds no .ap project file after the copy.");
                    }
                    Console.WriteLine($"[VC] Working copy {workingCopy} made from {master.Location}");
                }

                // 6. Open it when TIA has nothing open. Never OpenProject: that closes what is open.
                if (tiaOpen == "none")
                {
                    ConnectWithNothingOpen();
                    _project = _tiaPortal.Projects.Open(new FileInfo(workingCopy));
                    opened = true;
                }

                // 7. One PLC per TIA project in this version (spec §5).
                int plcCount = CountPlcs();
                if (plcCount > 1)
                    throw new BridgeRefusalException("MULTI_PLC_PROJECT", $"{_project.Name} holds {plcCount} PLCs; Pac Hub's version control takes a project with one PLC in this version.");
                if (plcCount == 0)
                    throw new InvalidOperationException($"{_project.Name} holds no PLC.");

                // 8. The CPU's order number as the PLC's model in job.json (spec §5 step 2). ensure fills a model
                //    (or doc code) the PLC lacks and never changes one it has; the cost is one more fetch.
                string model = OpenCpuOrderNumber();
                if (plc.DocCode == null) plc.DocCode = DocCodeOf(Path.GetFileNameWithoutExtension(workingCopy));
                if (model != null || plc.DocCode != null)
                {
                    ensured = PacHubVc.Ensure(request.Job, request.Customer, request.JobName, jobsRoot,
                        new PacHubVc.PlcEntry { Number = plc.Number, Name = plc.Name, Model = model, DocCode = plc.DocCode });
                    MergeDocCodes(plcs, ensured);
                }

                // 9. The Pac Hub VCI workspace, rooted at the PLC's Export\ (spec §5 step 5). Objects are
                //    mapped by the first full export (Phase 3's check), not here. Nothing is saved.
                string exportDir = Path.Combine(plcDir, "Export");
                Directory.CreateDirectory(exportDir);
                string message = null;
#if !TIA_V18
                EnsurePacHubWorkspace(exportDir);
#else
                message = "TIA Portal V18: this bridge does not create the Pac Hub VCI workspace.";
#endif
                return new VcPrepareResponse
                {
                    Success = true,
                    Message = message,
                    RepoPath = repoPath,
                    PlcFolder = plc.Folder,
                    WorkingCopyPath = workingCopy,
                    TiaOpen = tiaOpen,
                    Opened = opened,
                    RetrievedFrom = RetrievedFromRecord(plcDir),
                    Plcs = plcs,
                };
            }
        }

        /// <summary>
        /// POST /tia/project/archive (spec §5 step 6): the open working copy archived, compressed, into its PLC's
        /// Dropbox folder (`…\50 PLC\&lt;nn&gt; &lt;name&gt;`, which must exist and is never created) as a new .zap.
        /// TIA writes it outside Dropbox, in `&lt;plc&gt;\.pachub\archive-staging\`, and only the finished file is put
        /// in the Dropbox folder, in one rename that fails when the name is taken: a partial archive never
        /// shows there as anybody's newest master. A file already there is somebody's master: it is refused
        /// before TIA is asked anything and again at the rename, and nothing is ever overwritten. TIA is never
        /// started for an archive. Success is only ever the archive at its target.
        /// </summary>
        public ArchiveProjectResponse ArchiveProject(ArchiveProjectRequest request)
        {
            lock (_vcLock)
            {
                // Everything the request names is checked before TIA is asked anything.
                string dropboxRoot = DropboxLocal.Root();
                string targetDir = ArchiveTargetDir(DropboxLocal.Resolve(dropboxRoot, request.TargetDir), request.TargetDir);
                string baseName = ArchiveBaseName(request.FileName);
                string plcDir = PlcDirOfWorkingCopy(request.WorkingCopyPath);
                if (!string.Equals(Path.GetFileName(plcDir), Path.GetFileName(targetDir), StringComparison.OrdinalIgnoreCase))
                    throw new BridgeBadRequestException($"The working copy belongs to PLC folder '{Path.GetFileName(plcDir)}', not '{Path.GetFileName(targetDir)}'; nothing was archived.");
                if (DropboxLocal.IsInside(plcDir, dropboxRoot))
                    throw new BridgeRefusalException("JOBS_ROOT_IN_DROPBOX", $"The working copy {request.WorkingCopyPath} is inside Dropbox ({dropboxRoot}); an archive is written outside Dropbox first, so nothing was archived.");
                if (!Directory.Exists(targetDir))
                    throw new BridgeRefusalException("DROPBOX_NOT_LOCAL", $"{targetDir} is not on this workstation. Make sure Dropbox syncs the job folder (Selective Sync does not exclude it) and archive again; nothing was archived.");
                string target = Path.Combine(targetDir, baseName + ".zap" + EditionVersion);
                if (File.Exists(target))
                    throw new BridgeRefusalException("ARCHIVE_EXISTS", $"{target} already exists; nothing was overwritten.");

                if (TiaPortal.GetProcesses().Count == 0)
                    throw new InvalidOperationException("TIA Portal is not running; open the working copy and archive again.");
                Connect(preferAttach: true);
                if (_project == null)
                    throw new InvalidOperationException("TIA has no project open; open the working copy and archive again.");
                string open = _project.Path?.FullName ?? "";
                if (!SamePath(open, request.WorkingCopyPath))
                    throw new BridgeRefusalException("NOT_WORKING_COPY", $"TIA has {_project.Name} ({open}) open, which isn't the working copy ({request.WorkingCopyPath}); nothing was archived.");

                string staging = Path.Combine(plcDir, ".pachub", "archive-staging");
                DropboxLocal.TryClearStaging(staging);
                Directory.CreateDirectory(staging);
                try
                {
                    try
                    {
                        _project.Archive(new DirectoryInfo(staging), baseName, ProjectArchivationMode.Compressed);
                    }
                    catch (Exception ex)
                    {
                        throw new InvalidOperationException($"TIA would not archive {_project.Name}: {ex.Message} (if the project has unsaved changes, save it in TIA, then archive again); nothing was put in Dropbox.", ex);
                    }
                    string staged = Path.Combine(staging, baseName + ".zap" + EditionVersion);
                    if (!File.Exists(staged))
                    {
                        string[] wrote = Directory.GetFileSystemEntries(staging).Select(Path.GetFileName).ToArray();
                        throw new InvalidOperationException($"TIA archived {_project.Name} without writing {Path.GetFileName(staged)} to {staging} (it wrote {(wrote.Length == 0 ? "nothing" : string.Join(", ", wrote))}); nothing was put in Dropbox.");
                    }
                    if (!DropboxLocal.PlaceNewFile(staged, target))
                        throw new BridgeRefusalException("ARCHIVE_EXISTS", $"{target} already exists (it appeared while the project was being archived); nothing was overwritten.");
                    if (!File.Exists(target))
                        throw new InvalidOperationException($"{staged} was moved to {target}, but nothing is there now; archive again.");
                }
                finally
                {
                    DropboxLocal.TryClearStaging(staging);
                }
                Console.WriteLine($"[VC] Archived {_project.Name} to {target}");
                return new ArchiveProjectResponse { Success = true, Path = target };
            }
        }

        /// <summary>A Dropbox folder an archive may go to: a PLC's folder, `…\50 PLC\&lt;nn&gt; &lt;name&gt;`. Anything else
        /// is the caller's bad input (400).</summary>
        private static string ArchiveTargetDir(string resolved, string requested)
        {
            string dir = resolved.TrimEnd(Path.DirectorySeparatorChar);
            string parent = Path.GetFileName(Path.GetDirectoryName(dir) ?? "");
            if (!PlcFolderPattern.IsMatch(Path.GetFileName(dir)) || !string.Equals(parent, "50 PLC", StringComparison.OrdinalIgnoreCase))
                throw new BridgeBadRequestException($"'{requested}' is not a PLC folder in a job's 50 PLC (expected Pac/Jobs/<Customer>/<JOB> - <name>/50 PLC/<nn> <name>); nothing was archived.");
            return dir;
        }

        /// <summary>
        /// The PLC folder a working copy belongs to: the parent of the nearest `Project` folder above it whose own
        /// name is a PLC folder's (`&lt;nn&gt; &lt;name&gt;`), as prepare lays it out. A path that is missing,
        /// malformed, relative or under no such folder is the caller's bad input (400).
        /// </summary>
        private static string PlcDirOfWorkingCopy(string workingCopyPath)
        {
            string full;
            try
            {
                if (string.IsNullOrWhiteSpace(workingCopyPath) || !Path.IsPathRooted(workingCopyPath))
                    throw new BridgeBadRequestException($"'{workingCopyPath}' is not a working copy path (expected <jobs root>\\<Customer>\\<JOB>\\<nn> <name>\\Project\\…\\<name>.apNN).");
                full = Path.GetFullPath(workingCopyPath);
            }
            catch (Exception ex) when (ex is ArgumentException || ex is NotSupportedException || ex is PathTooLongException)
            {
                throw new BridgeBadRequestException($"'{workingCopyPath}' is not a working copy path: {ex.Message}");
            }
            for (DirectoryInfo dir = new FileInfo(full).Directory; dir?.Parent != null; dir = dir.Parent)
            {
                if (string.Equals(dir.Name, "Project", StringComparison.OrdinalIgnoreCase) && PlcFolderPattern.IsMatch(dir.Parent.Name))
                    return dir.Parent.FullName;
            }
            throw new BridgeBadRequestException($"'{workingCopyPath}' is not in a PLC folder's Project\\ (<jobs root>\\<Customer>\\<JOB>\\<nn> <name>\\Project\\…).");
        }

        /// <summary>The archive's name without any .zapNN; the caller adds this edition's. A name that is blank or
        /// holds a character no file name may is the caller's bad input (400).</summary>
        private static string ArchiveBaseName(string fileName)
        {
            string baseName = ArchiveExtension.Replace((fileName ?? "").Trim(), "");
            if (baseName.Length == 0 || baseName.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
                throw new BridgeBadRequestException($"'{fileName}' is not a file name.");
            return baseName;
        }

        /// <summary>&lt;plc&gt;\.pachub\retrieved-from: the file name of the .zap the working copy in Project\ was
        /// retrieved from (Ruling 31). It sits beside the base marker, git-ignored with the rest of .pachub.</summary>
        private static string RetrievedFromFile(string plcDir) => Path.Combine(plcDir, ".pachub", "retrieved-from");

        private static void RecordRetrievedFrom(string plcDir, string archiveName)
        {
            string file = RetrievedFromFile(plcDir);
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            File.WriteAllText(file, archiveName + Environment.NewLine);
        }

        private static void ForgetRetrievedFrom(string plcDir)
        {
            string file = RetrievedFromFile(plcDir);
            if (File.Exists(file)) File.Delete(file);
        }

        /// <summary>&lt;plc&gt;\.pachub\base: the commit the working copy in Project\ was last in step with, written by
        /// `pac-hub-vc base` (git-ignored with the rest of .pachub). The bridge only ever deletes it.</summary>
        private static string BaseFile(string plcDir) => Path.Combine(plcDir, ".pachub", "base");

        /// <summary>A new working copy starts with no base (Important 1): the old copy's is deleted, so the check's
        /// `base --from-archive` records the new copy's own, or status applies its no-base rule.</summary>
        private static void ForgetBase(string plcDir)
        {
            string file = BaseFile(plcDir);
            if (!File.Exists(file)) return;
            File.Delete(file);
            Console.WriteLine($"[VC] Deleted {file}: it was the base of a working copy that is no longer there.");
        }

        /// <summary>The archive name recorded for the working copy, or null: none was recorded, so it was copied
        /// from an .ap project folder.</summary>
        private static string RetrievedFromRecord(string plcDir)
        {
            string file = RetrievedFromFile(plcDir);
            if (!File.Exists(file)) return null;
            string name = File.ReadAllText(file).Trim();
            return name.Length == 0 ? null : name;
        }

        private static string JobsRoot()
        {
            string root = Environment.GetEnvironmentVariable("PAC_JOBS_ROOT");
            return string.IsNullOrWhiteSpace(root) ? @"C:\PacTechGit" : root.Trim();
        }

        /// <summary>The "&lt;nn&gt; &lt;name&gt;" folders under 50 PLC, each with the doc code its newest master's name carries.</summary>
        private static List<VcPlcDto> ListPlcFolders(string plcRoot)
        {
            var list = new List<VcPlcDto>();
            foreach (string dir in Directory.GetDirectories(plcRoot).OrderBy(d => d, StringComparer.OrdinalIgnoreCase))
            {
                string folder = Path.GetFileName(dir);
                Match m = PlcFolderPattern.Match(folder);
                if (!m.Success) continue;
                PlcMaster newest = NewestMaster(dir);
                list.Add(new VcPlcDto
                {
                    Folder = folder,
                    Number = m.Groups[1].Value,
                    Name = m.Groups[2].Value.Trim(),
                    DocCode = newest == null ? null : DocCodeOf(Path.GetFileName(newest.Location)),
                });
            }
            return list;
        }

        private static VcPlcDto ChoosePlc(List<VcPlcDto> plcs, string requested)
        {
            if (!string.IsNullOrWhiteSpace(requested))
            {
                VcPlcDto named = plcs.FirstOrDefault(p => string.Equals(p.Folder, requested.Trim(), StringComparison.OrdinalIgnoreCase));
                if (named == null)
                    throw new BridgeBadRequestException($"50 PLC has no folder '{requested}' (it has {string.Join(", ", plcs.Select(p => p.Folder))}).");
                return named;
            }
            if (plcs.Count == 1) return plcs[0];
            throw new BridgeRefusalException("PLC_CHOICE_NEEDED",
                $"This job has {plcs.Count} PLCs in 50 PLC ({string.Join(", ", plcs.Select(p => p.Folder))}); choose one.", plcs);
        }

        /// <summary>
        /// The newest master in a PLC folder (spec §5 step 3): a .zap archive or an .ap project folder, the
        /// latest date in its name first, then its file time. Names and times only, so listing an
        /// online-only master never downloads it.
        /// </summary>
        private static PlcMaster NewestMaster(string dir)
        {
            var masters = new List<PlcMaster>();
            foreach (string file in Directory.GetFiles(dir))
            {
                Match m = ArchiveExtension.Match(file);
                if (!m.Success) continue;
                masters.Add(new PlcMaster { Location = file, IsArchive = true, Version = VersionIn(m), NameDate = DateOf(Path.GetFileName(file)), WrittenUtc = File.GetLastWriteTimeUtc(file) });
            }
            foreach (string sub in Directory.GetDirectories(dir))
            {
                string ap = Directory.GetFiles(sub).FirstOrDefault(f => ProjectExtension.IsMatch(f));
                if (ap == null) continue;
                masters.Add(new PlcMaster { Location = sub, IsArchive = false, Version = VersionOf(ap), NameDate = DateOf(Path.GetFileName(sub)), WrittenUtc = File.GetLastWriteTimeUtc(ap) });
            }
            return masters
                .OrderByDescending(x => x.NameDate ?? "", StringComparer.Ordinal)
                .ThenByDescending(x => x.WrittenUtc)
                .FirstOrDefault();
        }

        private static string DateOf(string name)
        {
            Match m = NameDatePattern.Match(name);
            return m.Success ? m.Groups[1].Value : null;
        }

        private static string DocCodeOf(string name)
        {
            Match m = DocCodePattern.Match(name ?? "");
            return m.Success ? m.Groups[1].Value : null;
        }

        private static int VersionOf(string projectFile) => VersionIn(ProjectExtension.Match(projectFile));

        /// <summary>The NN of an .apNN or .zapNN match, or -1 when it cannot be read: never taken for this edition.</summary>
        private static int VersionIn(Match m)
        {
            int version;
            return m.Success && int.TryParse(m.Groups[1].Value, out version) ? version : -1;
        }

        /// <summary>A project of another TIA version is WRONG_TIA_VERSION, never upgraded: opening a master in
        /// a newer TIA would turn the job's master into that version. Pac Hub passes over to the next bridge.
        /// A version that cannot be read is refused the same way (fails closed).</summary>
        private static void RequireEdition(int version, string what)
        {
            if (version == EditionVersion) return;
            if (version < 0)
                throw new BridgeRefusalException("WRONG_TIA_VERSION", $"The TIA Portal version of {what} cannot be read from its name (.apNN or .zapNN) and this is the V{EditionVersion} bridge; nothing was retrieved, copied, opened or upgraded.");
            throw new BridgeRefusalException("WRONG_TIA_VERSION", $"{what} is a TIA Portal V{version} project and this is the V{EditionVersion} bridge; nothing was retrieved, copied, opened or upgraded. Start the V{version} bridge and press Start again.");
        }

        private static string FindProjectFileOrNull(string dir)
        {
            if (!Directory.Exists(dir)) return null;
            return Directory.GetFiles(dir, "*.ap*", SearchOption.AllDirectories)
                .Where(f => ProjectExtension.IsMatch(f))
                .OrderBy(f => f.Length)
                .FirstOrDefault();
        }

        /// <summary>"none", "working_copy" or "other". Attaches to a running TIA and reads Projects[0]; opens,
        /// closes and saves nothing. With no TIA attached and none running it answers "none" and starts none.
        /// Otherwise it goes through Connect, which attaches, or starts TIA when the one attached earlier has
        /// gone and none is running.</summary>
        private string WhatTiaHasOpen(string workingCopy, out string openName, out string openPath)
        {
            openName = null;
            openPath = null;
            if (_tiaPortal == null && TiaPortal.GetProcesses().Count == 0) return "none";
            Connect(preferAttach: true);
            if (_project == null) return "none";
            openName = _project.Name;
            openPath = _project.Path?.FullName ?? "";
            return workingCopy != null && SamePath(openPath, workingCopy) ? "working_copy" : "other";
        }

        /// <summary>Connects (attaching to the running TIA, or starting it) and refuses NOT_WORKING_COPY when a
        /// project has been opened since step 4: a retrieve or open would otherwise land beside it. A hydrate
        /// before a retrieve can take minutes.</summary>
        private void ConnectWithNothingOpen()
        {
            Connect(preferAttach: true);
            if (_project != null)
                throw new BridgeRefusalException("NOT_WORKING_COPY", $"TIA opened {_project.Name} ({_project.Path?.FullName}) while the working copy was being prepared; close it and press Start.");
        }

        private static bool SamePath(string a, string b)
        {
            if (string.IsNullOrWhiteSpace(a) || string.IsNullOrWhiteSpace(b)) return false;
            return string.Equals(Path.GetFullPath(a).TrimEnd('\\'), Path.GetFullPath(b).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
        }

        private int CountPlcs()
        {
            int count = 0;
            foreach (Device device in _project.Devices) count += CountPlcs(device.DeviceItems);
            return count;
        }

        private static int CountPlcs(DeviceItemComposition items)
        {
            int count = 0;
            foreach (DeviceItem item in items)
            {
                SoftwareContainer container = ((IEngineeringServiceProvider)item).GetService<SoftwareContainer>();
                if (container?.Software is PlcSoftware) count++;
                count += CountPlcs(item.DeviceItems);
            }
            return count;
        }

        /// <summary>"6ES7 511-1AK02-0AB0" from the CPU's "OrderNumber:6ES7 511-1AK02-0AB0/V2.9"; null when unknown.</summary>
        private string OpenCpuOrderNumber()
        {
            string family;
            string typeId;
            try { GetSourcePlcInfo(out family, out typeId); }
            catch { return null; }
            if (string.IsNullOrWhiteSpace(typeId)) return null;
            string order = typeId.StartsWith("OrderNumber:", StringComparison.OrdinalIgnoreCase) ? typeId.Substring("OrderNumber:".Length) : typeId;
            int slash = order.IndexOf('/');
            return (slash > 0 ? order.Substring(0, slash) : order).Trim();
        }

        /// <summary>job.json's doc code wins over one read from a master's name.</summary>
        private static void MergeDocCodes(List<VcPlcDto> plcs, JObject ensured)
        {
            if (!(ensured["plcs"] is JArray list)) return;
            foreach (JToken p in list)
            {
                VcPlcDto dto = plcs.FirstOrDefault(x => string.Equals(x.Folder, (string)p["folder"], StringComparison.OrdinalIgnoreCase));
                string code = (string)p["docCode"];
                if (dto != null && !string.IsNullOrWhiteSpace(code)) dto.DocCode = code;
            }
        }

#if !TIA_V18
        /// <summary>The project's "Pac Hub" workspace at the PLC's Export\, created once (spec §5 step 5).</summary>
        private void EnsurePacHubWorkspace(string exportDir)
        {
            VersionControlInterface vci = ((IEngineeringServiceProvider)_project).GetService<VersionControlInterface>();
            if (vci == null)
                throw new InvalidOperationException($"{_project.Name} offers no version control interface (VCI) to this bridge.");
            Workspace existing = vci.WorkspaceGroup.Workspaces.Find(PacHubWorkspace);
            if (existing == null)
            {
                vci.WorkspaceGroup.Workspaces.Create(PacHubWorkspace, new DirectoryInfo(exportDir));
                Console.WriteLine($"[VC] Created the '{PacHubWorkspace}' VCI workspace at {exportDir}");
                return;
            }
            if (!SamePath(existing.RootPath.FullName, exportDir))
                throw new InvalidOperationException($"{_project.Name}'s '{PacHubWorkspace}' workspace points at {existing.RootPath.FullName}, not {exportDir}. Delete that workspace in TIA and press Start again.");
        }
#endif
    }
}
