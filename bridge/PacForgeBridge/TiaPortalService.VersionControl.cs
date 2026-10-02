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
                // 1. The job's PLC folders in Dropbox, and which one. Nothing has been touched yet.
                string jobDir = DropboxLocal.Resolve(DropboxLocal.Root(), request.DropboxJobPath);
                string plcRoot = Path.Combine(jobDir, "50 PLC");
                if (!Directory.Exists(plcRoot))
                    throw new BridgeRefusalException("DROPBOX_NOT_LOCAL", $"{plcRoot} is not on this workstation. Make sure Dropbox syncs the job folder (Selective Sync does not exclude it) and press Start again.");
                List<VcPlcDto> plcs = ListPlcFolders(plcRoot);
                if (plcs.Count == 0)
                    throw new InvalidOperationException($"{plcRoot} has no PLC folder; Pac Hub expects one named like '01 Rollformer'.");
                VcPlcDto plc = ChoosePlc(plcs, request.PlcFolder);

                // 2. The job repo: pac-hub-vc ensure (found, cloned or initialised; pull --ff-only), with the
                //    chosen PLC recorded in job.json, along with the doc code its newest master's name carries.
                string jobsRoot = JobsRoot();
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
                //    `retrievedFrom` names the archive it came from; Phase 3 reads the base from that name.
                bool opened = false;
                string retrievedFrom = null;
                if (workingCopy == null)
                {
                    if (plc.DocCode == null) plc.DocCode = DocCodeOf(Path.GetFileName(master.Location));
                    Directory.CreateDirectory(projectDir);
                    if (master.IsArchive)
                    {
                        DropboxLocal.Hydrate(master.Location, HydrateTimeout);
                        Connect(preferAttach: true);
                        try
                        {
                            // Retrieve unpacks the archive and opens it; TIA had nothing open (step 3).
                            _project = _tiaPortal.Projects.Retrieve(new FileInfo(master.Location), new DirectoryInfo(projectDir));
                        }
                        catch
                        {
                            DeleteContents(projectDir);
                            throw;
                        }
                        workingCopy = _project.Path.FullName;
                        opened = true;
                        retrievedFrom = Path.GetFileName(master.Location);
                    }
                    else
                    {
                        string target = Path.Combine(projectDir, Path.GetFileName(master.Location));
                        try
                        {
                            DropboxLocal.CopyDirectory(master.Location, target, HydrateTimeout);
                        }
                        catch
                        {
                            // A half copy must never be taken for a working copy at the next Start.
                            DeleteContents(projectDir);
                            throw;
                        }
                        workingCopy = FindProjectFileOrNull(projectDir)
                            ?? throw new InvalidOperationException($"{target} holds no .ap project file after the copy.");
                    }
                    Console.WriteLine($"[VC] Working copy {workingCopy} made from {master.Location}");
                }

                // 6. Open it when TIA has nothing open. Never OpenProject: that closes what is open.
                if (!opened && tiaOpen == "none")
                {
                    Connect(preferAttach: true);
                    if (_project != null)
                        throw new BridgeRefusalException("NOT_WORKING_COPY", $"TIA opened {_project.Name} while the working copy was being prepared; close it and press Start.");
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
                    RetrievedFrom = retrievedFrom,
                    Plcs = plcs,
                };
            }
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
                    throw new InvalidOperationException($"50 PLC has no folder '{requested}' (it has {string.Join(", ", plcs.Select(p => p.Folder))}).");
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
                masters.Add(new PlcMaster { Location = file, IsArchive = true, Version = int.Parse(m.Groups[1].Value), NameDate = DateOf(Path.GetFileName(file)), WrittenUtc = File.GetLastWriteTimeUtc(file) });
            }
            foreach (string sub in Directory.GetDirectories(dir))
            {
                string ap = Directory.GetFiles(sub).FirstOrDefault(f => ProjectExtension.IsMatch(f));
                if (ap == null) continue;
                masters.Add(new PlcMaster { Location = sub, IsArchive = false, Version = int.Parse(ProjectExtension.Match(ap).Groups[1].Value), NameDate = DateOf(Path.GetFileName(sub)), WrittenUtc = File.GetLastWriteTimeUtc(ap) });
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

        private static int VersionOf(string projectFile)
        {
            Match m = ProjectExtension.Match(projectFile);
            return m.Success ? int.Parse(m.Groups[1].Value) : EditionVersion;
        }

        /// <summary>A project of another TIA version is WRONG_TIA_VERSION, never upgraded: opening a master in
        /// a newer TIA would turn the job's master into that version. Pac Hub passes over to the next bridge.</summary>
        private static void RequireEdition(int version, string what)
        {
            if (version != EditionVersion)
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

        /// <summary>"none", "working_copy" or "other". Attaches to a running TIA and reads Projects[0];
        /// opens, closes and saves nothing, and starts no TIA.</summary>
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

        private static void DeleteContents(string dir)
        {
            try
            {
                foreach (string sub in Directory.GetDirectories(dir)) Directory.Delete(sub, true);
                foreach (string file in Directory.GetFiles(dir)) File.Delete(file);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[VC] Could not clear {dir}: {ex.Message}");
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
