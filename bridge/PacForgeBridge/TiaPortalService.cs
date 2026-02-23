using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Siemens.Engineering;
using Siemens.Engineering.Compiler;
using Siemens.Engineering.HW;
using Siemens.Engineering.HW.Features;
using Siemens.Engineering.SW;
using Siemens.Engineering.SW.Blocks;
using Siemens.Engineering.SW.ExternalSources;
using Siemens.Engineering.SW.Tags;
using Siemens.Engineering.SW.Types;

namespace PacForgeBridge
{
    public class TiaPortalService : IDisposable
    {
        private TiaPortal _tiaPortal;
        private Project _project;
        private bool _disposed;

        public bool IsConnected => _tiaPortal != null;
        public bool IsProjectOpen => _project != null;

        /// <summary>
        /// Get current bridge/TIA status for the /tia/status endpoint.
        /// </summary>
        public BridgeStatusResponse GetStatus()
        {
            string tiaVersion = null;

            // Detect installed TIA Portal version
            try
            {
                tiaVersion = DetectInstalledVersion();
            }
            catch { }

            return new BridgeStatusResponse
            {
                Connected = IsConnected,
                TiaVersion = tiaVersion,
                TiaProjectOpen = IsProjectOpen,
                BridgeVersion = "1.0.0"
            };
        }

        /// <summary>
        /// Connect to TIA Portal — attach to running instance or start new headless instance.
        /// </summary>
        public void Connect(bool preferAttach = true)
        {
            if (IsConnected) return;

            if (preferAttach)
            {
                // Try to attach to a running TIA Portal instance
                IList<TiaPortalProcess> processes = TiaPortal.GetProcesses();
                if (processes.Count > 0)
                {
                    Console.WriteLine($"[TIA] Attaching to running TIA Portal (PID: {processes[0].Id})...");
                    _tiaPortal = processes[0].Attach();
                    Console.WriteLine("[TIA] Attached successfully.");

                    // If a project is already open, grab it
                    if (_tiaPortal.Projects.Count > 0)
                    {
                        _project = _tiaPortal.Projects[0];
                        Console.WriteLine($"[TIA] Project already open: {_project.Name}");
                    }
                    return;
                }
            }

            // Start new headless instance
            Console.WriteLine("[TIA] Starting TIA Portal (headless)...");
            _tiaPortal = new TiaPortal(TiaPortalMode.WithoutUserInterface);
            Console.WriteLine("[TIA] TIA Portal started.");
        }

        /// <summary>
        /// Open a TIA Portal project from disk.
        /// </summary>
        public void OpenProject(string projectPath)
        {
            if (_tiaPortal == null)
                throw new InvalidOperationException("TIA Portal not connected. Call Connect() first.");

            // If same project is already open, skip
            if (_project != null && _project.Path != null)
            {
                string currentPath = _project.Path.FullName;
                if (string.Equals(currentPath, projectPath, StringComparison.OrdinalIgnoreCase))
                {
                    Console.WriteLine($"[TIA] Project already open: {_project.Name}");
                    return;
                }

                // Close current project first
                Console.WriteLine($"[TIA] Closing current project: {_project.Name}");
                _project.Close();
                _project = null;
            }

            Console.WriteLine($"[TIA] Opening project: {projectPath}");
            _project = _tiaPortal.Projects.Open(new FileInfo(projectPath));
            Console.WriteLine($"[TIA] Project opened: {_project.Name}");
        }

        /// <summary>
        /// Find the PlcSoftware target by searching all devices recursively.
        /// </summary>
        public PlcSoftware GetPlcSoftware()
        {
            if (_project == null)
                throw new InvalidOperationException("No project open.");

            foreach (Device device in _project.Devices)
            {
                PlcSoftware plc = SearchDeviceItems(device.DeviceItems);
                if (plc != null)
                {
                    Console.WriteLine($"[TIA] Found PLC: {device.Name}");
                    return plc;
                }
            }

            throw new InvalidOperationException("No PLC device found in project.");
        }

        private PlcSoftware SearchDeviceItems(DeviceItemComposition items)
        {
            foreach (DeviceItem item in items)
            {
                SoftwareContainer container =
                    ((IEngineeringServiceProvider)item).GetService<SoftwareContainer>();
                if (container?.Software is PlcSoftware plc)
                    return plc;

                // Recurse into nested items (rack → CPU → modules)
                PlcSoftware nested = SearchDeviceItems(item.DeviceItems);
                if (nested != null)
                    return nested;
            }
            return null;
        }

        /// <summary>
        /// Import a single SCL artifact via the external source method.
        /// Returns the list of generated block/type names.
        /// </summary>
        public List<string> ImportArtifact(PlcSoftware plcSoftware, string artifactName, string sclFilePath, string destinationFolder)
        {
            var generatedNames = new List<string>();

            // Determine target group for block generation
            PlcBlockUserGroup targetGroup = null;
            if (!string.IsNullOrEmpty(destinationFolder) && destinationFolder != "Program blocks")
            {
                targetGroup = GetOrCreateBlockGroup(plcSoftware.BlockGroup, destinationFolder);
            }

            // Remove existing external source with same name (if leftover from previous run)
            string sourceName = Path.GetFileNameWithoutExtension(sclFilePath);
            PlcExternalSource existing = plcSoftware.ExternalSourceGroup.ExternalSources.Find(sourceName);
            existing?.Delete();

            Console.WriteLine($"[TIA] Importing external source: {artifactName} from {sclFilePath}");

            // Step 1: Add external source file
            PlcExternalSource source = plcSoftware.ExternalSourceGroup.ExternalSources
                .CreateFromFile(sourceName, sclFilePath);

            // Step 2: Generate blocks from source
            IList<IEngineeringObject> generated;
            if (targetGroup != null)
            {
                generated = source.GenerateBlocksFromSource(targetGroup, GenerateBlockOption.KeepOnError);
            }
            else
            {
                generated = source.GenerateBlocksFromSource(GenerateBlockOption.KeepOnError);
            }

            // Collect generated names
            foreach (IEngineeringObject obj in generated)
            {
                if (obj is PlcBlock block)
                    generatedNames.Add(block.Name);
                else if (obj is PlcType type)
                    generatedNames.Add(type.Name);
            }

            Console.WriteLine($"[TIA] Generated {generated.Count} object(s) from {artifactName}: {string.Join(", ", generatedNames)}");

            // Step 3: Clean up external source
            source.Delete();

            return generatedNames;
        }

        /// <summary>
        /// Compile all PLC software and return structured results.
        /// </summary>
        public CompileResultDto CompileAll(PlcSoftware plcSoftware)
        {
            Console.WriteLine("[TIA] Starting compilation...");

            ICompilable compileService = plcSoftware.GetService<ICompilable>();
            CompilerResult result = compileService.Compile();

            var compileResult = new CompileResultDto
            {
                Success = result.State == CompilerResultState.Success || result.State == CompilerResultState.Warning,
                CompiledAt = DateTime.UtcNow.ToString("o")
            };

            // Parse compiler messages recursively
            CollectCompilerMessages(result.Messages, compileResult);

            Console.WriteLine($"[TIA] Compilation {result.State}: {compileResult.Errors.Count} errors, {compileResult.Warnings.Count} warnings");

            return compileResult;
        }

        /// <summary>
        /// Compile a single block and return results.
        /// </summary>
        public CompileResultDto CompileBlock(PlcBlock block)
        {
            Console.WriteLine($"[TIA] Compiling block: {block.Name}");

            ICompilable compileService = block.GetService<ICompilable>();
            CompilerResult result = compileService.Compile();

            var compileResult = new CompileResultDto
            {
                Success = result.State == CompilerResultState.Success || result.State == CompilerResultState.Warning,
                CompiledAt = DateTime.UtcNow.ToString("o")
            };

            CollectCompilerMessages(result.Messages, compileResult);
            return compileResult;
        }

        /// <summary>
        /// Save the current project.
        /// </summary>
        public void SaveProject()
        {
            if (_project == null) return;
            Console.WriteLine("[TIA] Saving project...");
            _project.Save();
            Console.WriteLine("[TIA] Project saved.");
        }

        /// <summary>
        /// Execute an action within ExclusiveAccess + Transaction for atomic batch operations.
        /// </summary>
        public void WithTransaction(string description, Action action)
        {
            if (_tiaPortal == null || _project == null)
                throw new InvalidOperationException("TIA Portal not connected or no project open.");

            using (ExclusiveAccess access = _tiaPortal.ExclusiveAccess("PacForge Bridge"))
            {
                access.Text = description;
                using (Transaction tx = access.Transaction(_project, description))
                {
                    action();
                    tx.CommitOnDispose();
                }
            }
        }

        /// <summary>
        /// Navigate to or create a block user group by path (e.g., "Program blocks/Pac-ST").
        /// </summary>
        private PlcBlockUserGroup GetOrCreateBlockGroup(PlcBlockSystemGroup root, string folderPath)
        {
            // Strip leading "Program blocks/" if present
            string path = folderPath;
            if (path.StartsWith("Program blocks/", StringComparison.OrdinalIgnoreCase))
                path = path.Substring("Program blocks/".Length);
            if (path.StartsWith("Program blocks\\", StringComparison.OrdinalIgnoreCase))
                path = path.Substring("Program blocks\\".Length);

            if (string.IsNullOrEmpty(path))
                return null;

            string[] parts = path.Split(new[] { '/', '\\' }, StringSplitOptions.RemoveEmptyEntries);
            PlcBlockUserGroupComposition currentGroups = root.Groups;
            PlcBlockUserGroup currentGroup = null;

            foreach (string part in parts)
            {
                PlcBlockUserGroup found = currentGroups.Find(part);
                if (found == null)
                {
                    Console.WriteLine($"[TIA] Creating block group: {part}");
                    found = currentGroups.Create(part);
                }
                currentGroup = found;
                currentGroups = found.Groups;
            }

            return currentGroup;
        }

        /// <summary>
        /// Recursively collect compiler messages into errors and warnings lists.
        /// </summary>
        private void CollectCompilerMessages(CompilerResultMessageComposition messages, CompileResultDto result, string parentPath = "")
        {
            foreach (CompilerResultMessage msg in messages)
            {
                string artifactName = ExtractArtifactName(msg.Path ?? parentPath);

                var error = new CompileErrorDto
                {
                    ArtifactName = artifactName,
                    ErrorText = msg.Description,
                    Severity = msg.State == CompilerResultState.Error ? "ERROR" : "WARNING"
                };

                // Try to extract line/column from description if available
                // TIA Portal compile messages sometimes include position info
                ParseLineColumn(msg.Description, error);

                if (msg.State == CompilerResultState.Error)
                {
                    result.Errors.Add(error);
                }
                else if (msg.State == CompilerResultState.Warning)
                {
                    result.Warnings.Add(error);
                    error.Severity = "WARNING";
                }

                // Recurse into nested messages
                if (msg.Messages != null && msg.Messages.Count > 0)
                {
                    CollectCompilerMessages(msg.Messages, result, msg.Path ?? parentPath);
                }
            }
        }

        /// <summary>
        /// Extract a meaningful artifact name from compiler message path.
        /// Paths look like: "PLC_1/Program blocks/MyFB"
        /// </summary>
        private string ExtractArtifactName(string path)
        {
            if (string.IsNullOrEmpty(path)) return "Unknown";

            string[] parts = path.Split('/');
            return parts.Length > 0 ? parts[parts.Length - 1] : path;
        }

        /// <summary>
        /// Try to parse line/column numbers from compiler error description text.
        /// Common patterns: "Line X, Column Y:" or "(X,Y)"
        /// </summary>
        private void ParseLineColumn(string description, CompileErrorDto error)
        {
            if (string.IsNullOrEmpty(description)) return;

            // Pattern: "Line X, Column Y"
            var match = System.Text.RegularExpressions.Regex.Match(
                description, @"Line\s+(\d+),?\s*Column\s+(\d+)", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            if (match.Success)
            {
                error.Line = int.Parse(match.Groups[1].Value);
                error.Column = int.Parse(match.Groups[2].Value);
                return;
            }

            // Pattern: "(X,Y)"
            match = System.Text.RegularExpressions.Regex.Match(description, @"\((\d+),\s*(\d+)\)");
            if (match.Success)
            {
                error.Line = int.Parse(match.Groups[1].Value);
                error.Column = int.Parse(match.Groups[2].Value);
            }
        }

        /// <summary>
        /// Detect the installed TIA Portal version by checking common paths.
        /// </summary>
        private string DetectInstalledVersion()
        {
            string basePath = @"C:\Program Files\Siemens\Automation";
            string[] versions = { "Portal V20", "Portal V19", "Portal V18", "Portal V17" };

            foreach (string version in versions)
            {
                string vNum = version.Replace("Portal V", "V");
                string dllPath = Path.Combine(basePath, version, "PublicAPI", vNum, "Siemens.Engineering.dll");
                if (File.Exists(dllPath))
                    return version.Replace("Portal ", "");
            }

            return null;
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;

            try
            {
                if (_project != null)
                {
                    Console.WriteLine("[TIA] Closing project...");
                    _project.Close();
                    _project = null;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[TIA] Error closing project: {ex.Message}");
            }

            try
            {
                _tiaPortal?.Dispose();
                _tiaPortal = null;
                Console.WriteLine("[TIA] TIA Portal disposed.");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[TIA] Error disposing TIA Portal: {ex.Message}");
            }
        }
    }
}
