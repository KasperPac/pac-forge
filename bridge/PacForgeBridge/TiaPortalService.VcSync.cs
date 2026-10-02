using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Siemens.Engineering;
using Siemens.Engineering.SW;
using Siemens.Engineering.SW.Blocks;
using Siemens.Engineering.SW.Tags;
using Siemens.Engineering.SW.Types;
#if !TIA_V18
using Siemens.Engineering.VersionControl;
#endif

namespace PacForgeBridge
{
    /// <summary>An object a PLC conversation change touched (PHUB-232): kind <c>block</c> or <c>tag_table</c>.</summary>
    public class VcObjectRef
    {
        public string Kind { get; set; }
        public string Name { get; set; }
    }

    /// <summary>One export file <c>pac-hub-vc update</c> lists for TIA (path relative to Export, forward slashes).</summary>
    public class VcUpdateFile
    {
        public string Path { get; set; }
        public string Object { get; set; }
        public string Kind { get; set; }
        public bool Removed { get; set; }
    }

    /// <summary>What a workspace export did. <c>RefusedNotCompiling</c>: nothing was exported because these do not compile.</summary>
    public class VcExportResult
    {
        public bool RefusedNotCompiling { get; set; }
        public List<string> Inconsistent { get; set; } = new List<string>();
        public List<string> Written { get; set; } = new List<string>();
        public List<string> Skipped { get; set; } = new List<string>();
        public List<string> Removed { get; set; } = new List<string>();
        public string Error { get; set; }
    }

    public class VcImportResult
    {
        public List<string> Imported { get; set; } = new List<string>();
        public List<string> Deleted { get; set; } = new List<string>();
        public List<string> NotImported { get; set; } = new List<string>();
    }

    /// <summary>
    /// PHUB-232 Phase 3 (spec §6–7): the TIA half of the version-control check, the conversation commit and Update
    /// from Git. The whole PLC, or the objects a change touched, are exported through the <c>Pac Hub</c> VCI
    /// workspace prepare created at <c>&lt;repo&gt;\&lt;plc&gt;\Export\</c>; files git changed are imported with the
    /// bridge's ordinary import paths. Every git operation belongs to pac-hub-vc. Nothing here runs unless the
    /// open project is that PLC's working copy, and nothing here starts TIA.
    /// </summary>
    public partial class TiaPortalService
    {
        public const string VcUnsupported = "Version control export needs TIA Portal V20 or later; this bridge is built for V18.";

        /// <summary>A version-control route's work, under the lock prepare and archive take.</summary>
        public T VcLocked<T>(Func<T> work)
        {
            lock (_vcLock) { return work(); }
        }

        /// <summary>
        /// The PLC folder a version-control request names, <c>&lt;repo_path&gt;\&lt;plc_folder&gt;</c>: a job repo under the
        /// jobs root (PAC_JOBS_ROOT, where prepare puts it) and one of its "&lt;nn&gt; &lt;name&gt;" folders, both existing.
        /// Anything else is the caller's bad input (400), so an export never writes, and a stale export file is never
        /// removed, anywhere else.
        /// </summary>
        public static string VcPlcDir(string repoPath, string plcFolder)
        {
            string jobsRoot = JobsRoot();
            string repo;
            try
            {
                if (string.IsNullOrWhiteSpace(repoPath) || !Path.IsPathRooted(repoPath))
                    throw new BridgeBadRequestException($"'{repoPath}' is not a job repo path (expected {jobsRoot}\\<Customer>\\<JOB>).");
                repo = Path.GetFullPath(repoPath).TrimEnd(Path.DirectorySeparatorChar);
            }
            catch (Exception ex) when (ex is ArgumentException || ex is NotSupportedException || ex is PathTooLongException)
            {
                throw new BridgeBadRequestException($"'{repoPath}' is not a job repo path: {ex.Message}");
            }
            if (!DropboxLocal.IsInside(repo, jobsRoot) || SamePath(repo, jobsRoot))
                throw new BridgeBadRequestException($"'{repoPath}' is not under the jobs root {jobsRoot}; nothing was exported, committed or imported.");
            if (!Directory.Exists(repo))
                throw new BridgeBadRequestException($"The job repo {repo} does not exist on this workstation; prepare the working copy first.");
            string folder = plcFolder ?? "";
            if (!PlcFolderPattern.IsMatch(folder) || folder != folder.Trim() || folder.EndsWith(".") || folder.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
                throw new BridgeBadRequestException($"'{plcFolder}' is not a PLC folder name (expected '<nn> <name>', e.g. '01 Rollformer').");
            string plcDir = Path.Combine(repo, folder);
            if (!Directory.Exists(plcDir))
                throw new BridgeBadRequestException($"{repo} has no PLC folder '{folder}'; prepare the working copy first.");
            return plcDir;
        }

        /// <summary>
        /// Why version control cannot run on what TIA has open, or null when it can: the open project must be this
        /// PLC's working copy (under <c>&lt;plc&gt;\Project\</c>). TIA is never started for it. Another project open is
        /// NOT_WORKING_COPY, so nothing is exported from, imported into or saved over a project that is not the working copy.
        /// </summary>
        public string VcWorkingCopyUnready(string plcDir)
        {
            if (!VcSupported) return VcUnsupported;
            if (TiaPortal.GetProcesses().Count == 0)
                return "TIA Portal is not running; open the working copy in TIA and try again.";
            Connect(preferAttach: true);
            if (_project == null)
                return "TIA has no project open; open the working copy in TIA and try again.";
            string projectDir = Path.Combine(plcDir, "Project");
            string open = _project.Path?.FullName ?? "";
            if (open.Length == 0 || !DropboxLocal.IsInside(open, projectDir))
                throw new BridgeRefusalException("NOT_WORKING_COPY",
                    $"TIA has {_project.Name} ({open}) open, which isn't the working copy in {projectDir}; nothing was exported, committed or imported.");
            return null;
        }

        /// <summary>
        /// Before each write of Update from Git: TIA still has this PLC's working copy open. The bridge re-reads the
        /// open project whenever its handle has gone stale, so one the engineer opened while an update ran would
        /// otherwise be the one imported into, compiled and saved. NOT_WORKING_COPY stops the update there.
        /// </summary>
        public void RequireVcWorkingCopy(string plcDir)
        {
            string projectDir = Path.Combine(plcDir, "Project");
            string open = IsProjectOpen ? (_project.Path?.FullName ?? "") : "";
            if (open.Length == 0 || !DropboxLocal.IsInside(open, projectDir))
                throw new BridgeRefusalException("NOT_WORKING_COPY",
                    $"TIA no longer has the working copy in {projectDir} open ({(open.Length == 0 ? "no project" : open)}); nothing more was imported, compiled or saved.");
        }

#if TIA_V18
        public static bool VcSupported { get { return false; } }

        public VcExportResult VcExportAll(string exportDir) { return new VcExportResult { Error = VcUnsupported }; }
        public VcExportResult VcExportObjects(string exportDir, IList<VcObjectRef> objects) { return new VcExportResult { Error = VcUnsupported }; }
        public VcImportResult VcImportFiles(string exportDir, IList<VcUpdateFile> files)
        {
            var result = new VcImportResult();
            result.NotImported.Add(VcUnsupported);
            return result;
        }
#else
        public static bool VcSupported { get { return true; } }
#endif

        /// <summary>The three areas a full export covers (spec §5.5): blocks, PLC data types, tag tables.</summary>
        private static readonly string[] VcAreas = { "Program blocks", "PLC data types", "PLC tags" };

        private static string VcJoin(string path, string name) { return path == "" ? name : path + "\\" + name; }

        private static string VcRel(string plcName, string area, string groups)
        {
            return groups == "" ? Path.Combine(plcName, area) : Path.Combine(plcName, area, groups);
        }

        private static bool IsVcPayload(string file)
        {
            return file.EndsWith(".xml", StringComparison.OrdinalIgnoreCase) || file.EndsWith(".scl", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>The export path relative to Export, with forward slashes, as pac-hub-vc names it (a file outside
        /// Export, which no export writes, keeps its full path).</summary>
        private static string VcRelative(string exportDir, string file)
        {
            string root = exportDir.TrimEnd('\\', '/') + "\\";
            return file.StartsWith(root, StringComparison.OrdinalIgnoreCase) ? file.Substring(root.Length).Replace('\\', '/') : file;
        }

        /// <summary>The import order of a kind pac-hub-vc names: types → tag tables → FC → FB → OB → DB, anything else last.
        /// Deletions run in the opposite order.</summary>
        private static int VcImportRank(string kind)
        {
            switch (kind)
            {
                case "datatype": return 0;
                case "tagtable": return 1;
                case "fc": return 2;
                case "fb": return 3;
                case "block": return 3;
                case "ob": return 4;
                case "db": return 5;
                default: return 6;
            }
        }

        /// <summary>SimaticML, never SIMATIC SD. An SCL block keeps an SCL format where TIA offers one, as V18's VCI wrote it.</summary>
        private static string PickVcFormat(IEnumerable<string> offered, bool scl)
        {
            var all = (offered ?? Enumerable.Empty<string>()).ToList();
            var usable = all.Where(f => f.IndexOf("SD", StringComparison.OrdinalIgnoreCase) < 0).ToList();
            if (scl)
            {
                string sclFormat = usable.FirstOrDefault(f => f.IndexOf("SCL", StringComparison.OrdinalIgnoreCase) >= 0);
                if (sclFormat != null) return sclFormat;
            }
            string ml = usable.FirstOrDefault(f => f.IndexOf("SimaticML", StringComparison.OrdinalIgnoreCase) >= 0);
            if (ml != null) return ml;
            throw new InvalidOperationException("TIA offers no SimaticML export for this object (offered: " + string.Join(", ", all) + ")");
        }

        /// <summary>A payload file (<c>&lt;name&gt;.xml</c> or <c>.scl</c>) already in a folder, the newest when both are; or null.</summary>
        private static string VcPayloadIn(string dir, string name)
        {
            if (string.IsNullOrEmpty(dir) || string.IsNullOrEmpty(name)) return null;
            return new[] { Path.Combine(dir, name + ".xml"), Path.Combine(dir, name + ".scl") }
                .Where(File.Exists).OrderByDescending(File.GetLastWriteTimeUtc).FirstOrDefault();
        }

        /// <summary>
        /// The file an export wrote: in the folder VCI reports for the mapping, else where it was asked to go, else
        /// (an object mapped earlier, elsewhere) anywhere in its area of the PLC — never another area's file of the same name.
        /// </summary>
        private static string FindVcWritten(string exportDir, string relDir, string area, string name, string mappedDir, string mappedName)
        {
            string found = null;
            if (!string.IsNullOrEmpty(mappedDir)) found = VcPayloadIn(Path.Combine(exportDir, mappedDir), string.IsNullOrEmpty(mappedName) ? name : mappedName);
            if (found == null) found = VcPayloadIn(Path.Combine(exportDir, relDir), name);
            if (found != null) return found;
            string plcName = relDir.Split(new[] { '\\', '/' }, StringSplitOptions.RemoveEmptyEntries)[0];
            string areaRoot = Path.Combine(exportDir, plcName, area);
            if (!Directory.Exists(areaRoot)) return null;
            return Directory.EnumerateFiles(areaRoot, name + ".*", SearchOption.AllDirectories)
                .Where(f => IsVcPayload(f) && string.Equals(Path.GetFileNameWithoutExtension(f), name, StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(File.GetLastWriteTimeUtc)
                .FirstOrDefault();
        }

        /// <summary>
        /// After a full export: a payload file in one of the three areas that no object wrote any more is a deleted
        /// object, and is removed so the deletion reads as one. A know-how-protected block's file (VCI exports none)
        /// is kept: it was skipped, not deleted.
        /// </summary>
        private static void RemoveStaleExports(string plcRoot, HashSet<string> expected, HashSet<string> keepBlocks, string exportDir, VcExportResult result)
        {
            foreach (string area in VcAreas)
            {
                string root = Path.Combine(plcRoot, area);
                if (!Directory.Exists(root)) continue;
                foreach (string file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories).ToList())
                {
                    if (!IsVcPayload(file) || expected.Contains(Path.GetFullPath(file))) continue;
                    if (area == "Program blocks" && keepBlocks.Contains(Path.GetFileNameWithoutExtension(file))) continue;
                    File.Delete(file);
                    result.Removed.Add(VcRelative(exportDir, file));
                }
            }
        }

#if !TIA_V18
        private const string NoVcWorkspace = "The '" + PacHubWorkspace + "' version control workspace is missing from this project; prepare the working copy again.";

        /// <summary>The project's Pac Hub workspace, which must be rooted at this PLC's Export\ (prepare made it so).</summary>
        private Workspace FindVcWorkspace(string exportDir, out string problem)
        {
            problem = null;
            var vci = ((IEngineeringServiceProvider)_project).GetService<VersionControlInterface>();
            Workspace ws = vci == null ? null : vci.WorkspaceGroup.Workspaces.Find(PacHubWorkspace);
            if (ws == null) { problem = NoVcWorkspace; return null; }
            string root = ws.RootPath?.FullName ?? "";
            if (!SamePath(root, exportDir))
            {
                problem = $"{_project.Name}'s '{PacHubWorkspace}' workspace points at {root}, not {exportDir}; prepare the working copy again.";
                return null;
            }
            return ws;
        }

        /// <summary>
        /// Export the whole PLC through the workspace into <paramref name="exportDir"/> (PHUB-232 §6), in the layout
        /// the Siemens adapter's VCI fixtures show: &lt;PLC&gt;\Program blocks\…, \PLC data types\…, \PLC tags\….
        /// A block or type that does not compile refuses the whole export before anything is written, so the
        /// Export folder never holds half a project. A payload file no object wrote any more (a deleted block)
        /// is removed, so a deletion in TIA reads as one.
        /// </summary>
        public VcExportResult VcExportAll(string exportDir)
        {
            var result = new VcExportResult();
            string problem;
            Workspace ws = FindVcWorkspace(exportDir, out problem);
            if (ws == null) { result.Error = problem; return result; }
            PlcSoftware plc = GetPlcSoftware();

            var blocks = new List<KeyValuePair<PlcBlock, string>>();
            CollectBlocks(plc.BlockGroup, "", blocks);
            var types = new List<KeyValuePair<PlcType, string>>();
            CollectTypes(plc.TypeGroup, "", types);
            var tables = new List<KeyValuePair<PlcTagTable, string>>();
            CollectTagTables(plc.TagTableGroup, "", tables);

            foreach (var b in blocks) if (!b.Key.IsKnowHowProtected && !b.Key.IsConsistent) result.Inconsistent.Add(b.Key.Name);
            foreach (var t in types) if (!t.Key.IsKnowHowProtected && !t.Key.IsConsistent) result.Inconsistent.Add(t.Key.Name);
            if (result.Inconsistent.Count > 0) { result.RefusedNotCompiling = true; return result; }

            string plcName = GetCpuDeviceItem().Name;
            var expected = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var keep = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var b in blocks)
            {
                // VCI drops know-how-protected blocks silently; they are named here, as a coverage gap (§11).
                if (b.Key.IsKnowHowProtected) { result.Skipped.Add(b.Key.Name); keep.Add(b.Key.Name); continue; }
                ExportOne(ws, b.Key, plcName, "Program blocks", b.Value, b.Key.Name, b.Key.ProgrammingLanguage == ProgrammingLanguage.SCL, exportDir, result, expected);
                if (result.Error != null) return result;
            }
            foreach (var t in types)
            {
                if (t.Key.IsKnowHowProtected) { result.Skipped.Add(t.Key.Name); continue; }
                ExportOne(ws, t.Key, plcName, "PLC data types", t.Value, t.Key.Name, false, exportDir, result, expected);
                if (result.Error != null) return result;
            }
            foreach (var t in tables)
            {
                ExportOne(ws, t.Key, plcName, "PLC tags", t.Value, t.Key.Name, false, exportDir, result, expected);
                if (result.Error != null) return result;
            }
            RemoveStaleExports(Path.Combine(exportDir, plcName), expected, keep, exportDir, result);
            Console.WriteLine($"[VC] Exported {result.Written.Count} object(s) to {exportDir}; removed {result.Removed.Count} stale file(s); skipped {result.Skipped.Count}.");
            return result;
        }

        /// <summary>Export only the objects a change touched (§7.1). Any block that does not compile defers the commit.</summary>
        public VcExportResult VcExportObjects(string exportDir, IList<VcObjectRef> objects)
        {
            var result = new VcExportResult();
            if (objects.Count == 0) return result;
            string problem;
            Workspace ws = FindVcWorkspace(exportDir, out problem);
            if (ws == null) { result.Error = problem; return result; }
            PlcSoftware plc = GetPlcSoftware();
            string plcName = GetCpuDeviceItem().Name;

            var blocks = new List<KeyValuePair<PlcBlock, string>>();
            var tables = new List<KeyValuePair<PlcTagTable, string>>();
            foreach (VcObjectRef o in objects)
            {
                if (o.Kind == "tag_table")
                {
                    var t = FindTagTableWithPath(plc.TagTableGroup, "", o.Name);
                    if (t.Key == null) result.Skipped.Add(o.Name); else tables.Add(t);
                }
                else
                {
                    var b = FindBlockWithPath(plc.BlockGroup, "", o.Name);
                    if (b.Key == null || b.Key.IsKnowHowProtected) result.Skipped.Add(o.Name);
                    else if (!b.Key.IsConsistent) result.Inconsistent.Add(o.Name);
                    else blocks.Add(b);
                }
            }
            if (result.Inconsistent.Count > 0) { result.RefusedNotCompiling = true; return result; }

            var expected = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var b in blocks)
            {
                ExportOne(ws, b.Key, plcName, "Program blocks", b.Value, b.Key.Name, b.Key.ProgrammingLanguage == ProgrammingLanguage.SCL, exportDir, result, expected);
                if (result.Error != null) return result;
            }
            foreach (var t in tables)
            {
                ExportOne(ws, t.Key, plcName, "PLC tags", t.Value, t.Key.Name, false, exportDir, result, expected);
                if (result.Error != null) return result;
            }
            if (result.Skipped.Count > 0)
                Console.WriteLine($"[VC] Not exported (not in TIA, or know-how protected): {string.Join(", ", result.Skipped)}");
            return result;
        }

        /// <summary>
        /// Bring the files git changed into TIA with the bridge's existing import paths (spec §6: Openness exposes
        /// no VCI import): SCL through import-scl, SimaticML blocks through reimport-blocks (a new block into the
        /// folder git has it in), PLC data types and tag tables through their own Import. Deletions first, highest
        /// dependants first; imports types → tag tables → FC → FB → OB → DB.
        /// </summary>
        public VcImportResult VcImportFiles(string exportDir, IList<VcUpdateFile> files)
        {
            var result = new VcImportResult();
            string plcDir = Path.GetDirectoryName(exportDir);
            PlcSoftware plc = GetPlcSoftware();
            foreach (VcUpdateFile f in files.Where(x => x.Removed).OrderByDescending(x => VcImportRank(x.Kind)).ToList())
            {
                RequireVcWorkingCopy(plcDir);
                DeleteVcObject(plc, f, result);
            }
            foreach (VcUpdateFile f in files.Where(x => !x.Removed).OrderBy(x => VcImportRank(x.Kind)).ToList())
            {
                RequireVcWorkingCopy(plcDir);
                ImportVcFile(plc, exportDir, f, result);
            }
            return result;
        }

        private static void CollectBlocks(PlcBlockGroup group, string path, List<KeyValuePair<PlcBlock, string>> into)
        {
            foreach (PlcBlock block in group.Blocks) into.Add(new KeyValuePair<PlcBlock, string>(block, path));
            foreach (PlcBlockUserGroup child in group.Groups) CollectBlocks(child, VcJoin(path, child.Name), into);
        }

        private static void CollectTypes(PlcTypeGroup group, string path, List<KeyValuePair<PlcType, string>> into)
        {
            foreach (PlcType type in group.Types) into.Add(new KeyValuePair<PlcType, string>(type, path));
            foreach (PlcTypeUserGroup child in group.Groups) CollectTypes(child, VcJoin(path, child.Name), into);
        }

        private static void CollectTagTables(PlcTagTableGroup group, string path, List<KeyValuePair<PlcTagTable, string>> into)
        {
            foreach (PlcTagTable table in group.TagTables) into.Add(new KeyValuePair<PlcTagTable, string>(table, path));
            foreach (PlcTagTableUserGroup child in group.Groups) CollectTagTables(child, VcJoin(path, child.Name), into);
        }

        private static KeyValuePair<PlcBlock, string> FindBlockWithPath(PlcBlockGroup group, string path, string name)
        {
            PlcBlock found = group.Blocks.Find(name);
            if (found != null) return new KeyValuePair<PlcBlock, string>(found, path);
            foreach (PlcBlockUserGroup child in group.Groups)
            {
                var hit = FindBlockWithPath(child, VcJoin(path, child.Name), name);
                if (hit.Key != null) return hit;
            }
            return default(KeyValuePair<PlcBlock, string>);
        }

        private static KeyValuePair<PlcTagTable, string> FindTagTableWithPath(PlcTagTableGroup group, string path, string name)
        {
            PlcTagTable found = group.TagTables.Find(name);
            if (found != null) return new KeyValuePair<PlcTagTable, string>(found, path);
            foreach (PlcTagTableUserGroup child in group.Groups)
            {
                var hit = FindTagTableWithPath(child, VcJoin(path, child.Name), name);
                if (hit.Key != null) return hit;
            }
            return default(KeyValuePair<PlcTagTable, string>);
        }

        private static PlcType FindTypeRecursive(PlcTypeGroup group, string name)
        {
            PlcType found = group.Types.Find(name);
            if (found != null) return found;
            foreach (PlcTypeUserGroup child in group.Groups)
            {
                PlcType hit = FindTypeRecursive(child, name);
                if (hit != null) return hit;
            }
            return null;
        }

        /// <summary>
        /// One object through the workspace. Mapped already: synchronised project → workspace. Not mapped, with a file
        /// already at its path (git has it from another workstation's export): connected to that file in the file's
        /// own format and synchronised over it, so the format git holds does not change. Otherwise exported new.
        /// </summary>
        private void ExportOne(Workspace ws, IEngineeringObject obj, string plcName, string area, string groups, string name, bool scl, string exportDir, VcExportResult result, HashSet<string> expected)
        {
            string relDir = VcRel(plcName, area, groups);
            try
            {
                MappedObject mapped = ws.MappedObjects.Find(obj);
                if (mapped != null)
                {
                    mapped.Synchronize(SynchronizationMode.ProjectToWorkspace);
                }
                else
                {
                    List<string> formats = (ws.GetSupportedFileFormats(obj) ?? Enumerable.Empty<string>()).ToList();
                    string existing = VcPayloadIn(Path.Combine(exportDir, relDir), name);
                    bool asScl = existing != null ? existing.EndsWith(".scl", StringComparison.OrdinalIgnoreCase) : scl;
                    string format = PickVcFormat(formats, asScl);
                    Console.WriteLine($"[VC] {name}: formats offered {string.Join(", ", formats)}; {(existing != null ? "connecting to " + VcRelative(exportDir, existing) : "exporting")} as {format}");
                    if (existing != null)
                    {
                        mapped = ws.ConnectObject(obj, new DirectoryInfo(relDir), name, format);
                        mapped.Synchronize(SynchronizationMode.ProjectToWorkspace);
                    }
                    else
                    {
                        mapped = ws.ExportObject(obj, new DirectoryInfo(relDir), name, format);
                    }
                }
                string mappedDir = null;
                string mappedName = null;
                try
                {
                    mappedDir = mapped?.DirectoryPath?.ToString();
                    mappedName = mapped?.FileNameWithoutExtension;
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[VC] {name}: the mapping's folder could not be read ({ex.Message}); looking where it was asked to go.");
                }
                string written = FindVcWritten(exportDir, relDir, area, name, mappedDir, mappedName);
                // One normal form on both sides of RemoveStaleExports' comparison, whatever form VCI reported the folder in.
                if (written != null) written = Path.GetFullPath(written);
                if (written == null) { result.Error = name + ": TIA reported the export but no .xml or .scl file appeared under " + relDir; return; }
                expected.Add(written);
                result.Written.Add(VcRelative(exportDir, written));
            }
            catch (Exception ex)
            {
                result.Error = name + ": " + ex.Message;
            }
        }

        private void ImportVcFile(PlcSoftware plc, string exportDir, VcUpdateFile f, VcImportResult result)
        {
            string rel = f.Path ?? "";
            string[] parts = rel.Split('/');
            // <PLC>/<area>/<groups…>/<file>, never leaving Export.
            string full = null;
            try
            {
                if (parts.Length >= 3 && !parts.Any(p => p == ".." || p == "." || p == ""))
                    full = Path.GetFullPath(Path.Combine(exportDir, rel.Replace('/', Path.DirectorySeparatorChar)));
            }
            catch (Exception ex) when (ex is ArgumentException || ex is NotSupportedException || ex is PathTooLongException)
            {
                full = null;
            }
            if (full == null || !DropboxLocal.IsInside(full, exportDir) || !File.Exists(full))
            {
                result.NotImported.Add(f.Object + ": " + rel + " is not in the export");
                return;
            }
            string area = parts[1];
            string groups = string.Join("/", parts.Skip(2).Take(parts.Length - 3));
            try
            {
                if (area == "Program blocks") ImportVcBlock(plc, full, f.Object, groups, result);
                else if (area == "PLC data types") { ImportVcType(plc, full, f.Object, groups); result.Imported.Add(f.Object); }
                else if (area == "PLC tags") { ImportVcTagTable(plc, full, f.Object, groups); result.Imported.Add(f.Object); }
                else result.NotImported.Add(f.Object + ": " + area + " is not imported from git");
            }
            catch (Exception ex)
            {
                result.NotImported.Add(f.Object + ": " + ex.Message);
            }
        }

        private void ImportVcBlock(PlcSoftware plc, string full, string name, string groups, VcImportResult result)
        {
            string folder = groups == "" ? "Program blocks" : "Program blocks/" + groups;
            if (full.EndsWith(".scl", StringComparison.OrdinalIgnoreCase))
            {
                ImportSclResponse scl = ImportSclSources(
                    new Dictionary<string, string> { { name, File.ReadAllText(full) } },
                    new List<string> { name }, false, new Dictionary<string, string> { { name, folder } });
                if (scl.Errors.Count > 0) result.NotImported.Add(string.Join("; ", scl.Errors)); else result.Imported.Add(name);
                return;
            }
            if (FindBlockRecursive(plc.BlockGroup, name) != null)
            {
                // An existing block is replaced in the folder that holds it (reimport-blocks, 1.12.1).
                var request = new ReimportMigrationBlocksRequest();
                request.Blocks[name] = File.ReadAllText(full);
                ReimportMigrationBlocksResponse r = ReimportMigrationBlocks(request);
                if (r.Errors.Count > 0) result.NotImported.Add(string.Join("; ", r.Errors)); else result.Imported.Add(name);
                return;
            }
            // A new block goes into the folder git has it in, so the next export writes it to the same path.
            PlcBlockUserGroup group = GetOrCreateBlockGroup(plc.BlockGroup, folder);
            PlcBlockComposition target = group != null ? group.Blocks : plc.BlockGroup.Blocks;
            target.Import(new FileInfo(full), ImportOptions.Override);
            result.Imported.Add(name);
        }

        private void ImportVcType(PlcSoftware plc, string full, string name, string groups)
        {
            PlcType existing = FindTypeRecursive(plc.TypeGroup, name);
            PlcTypeGroup target = existing != null ? existing.Parent as PlcTypeGroup : null;
            if (target == null)
            {
                target = plc.TypeGroup;
                foreach (string part in groups.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries))
                    target = target.Groups.Find(part) ?? target.Groups.Create(part);
            }
            target.Types.Import(new FileInfo(full), ImportOptions.Override);
        }

        private void ImportVcTagTable(PlcSoftware plc, string full, string name, string groups)
        {
            var existing = FindTagTableWithPath(plc.TagTableGroup, "", name);
            PlcTagTableGroup target = existing.Key != null ? existing.Key.Parent as PlcTagTableGroup : null;
            if (target == null)
            {
                target = plc.TagTableGroup;
                foreach (string part in groups.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries))
                    target = target.Groups.Find(part) ?? target.Groups.Create(part);
            }
            target.TagTables.Import(new FileInfo(full), ImportOptions.Override);
        }

        private void DeleteVcObject(PlcSoftware plc, VcUpdateFile f, VcImportResult result)
        {
            try
            {
                string[] parts = (f.Path ?? "").Split('/');
                string area = parts.Length > 1 ? parts[1] : "";
                if (area == "Program blocks") { PlcBlock b = FindBlockRecursive(plc.BlockGroup, f.Object); if (b != null) b.Delete(); }
                else if (area == "PLC data types") { PlcType t = FindTypeRecursive(plc.TypeGroup, f.Object); if (t != null) t.Delete(); }
                else if (area == "PLC tags") { var t = FindTagTableWithPath(plc.TagTableGroup, "", f.Object); if (t.Key != null) t.Key.Delete(); }
                else { result.NotImported.Add(f.Object + ": " + area + " is not deleted from git"); return; }
                result.Deleted.Add(f.Object);
            }
            catch (Exception ex)
            {
                result.NotImported.Add(f.Object + ": could not delete — " + ex.Message);
            }
        }
#endif
    }
}
