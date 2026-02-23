using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
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
        public CompileResultDto LastCompileResult { get; private set; }
        public Dictionary<string, string> LastImportedSources { get; private set; } = new Dictionary<string, string>();

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
        /// Connect to TIA Portal — attach to running instance or start new one.
        /// </summary>
        public void Connect(bool preferAttach = true, bool withUi = true)
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

            // Start new instance
            var mode = withUi ? TiaPortalMode.WithUserInterface : TiaPortalMode.WithoutUserInterface;
            Console.WriteLine($"[TIA] Starting TIA Portal ({(withUi ? "with UI" : "headless")})...");
            _tiaPortal = new TiaPortal(mode);
            Console.WriteLine("[TIA] TIA Portal started.");
        }

        /// <summary>
        /// Disconnect from TIA Portal — close project and dispose instance.
        /// Unlike Dispose(), this allows reconnecting afterwards.
        /// </summary>
        public void Disconnect()
        {
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
                _project = null;
            }

            try
            {
                if (_tiaPortal != null)
                {
                    _tiaPortal.Dispose();
                    _tiaPortal = null;
                    Console.WriteLine("[TIA] Disconnected from TIA Portal.");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[TIA] Error disconnecting: {ex.Message}");
                _tiaPortal = null;
            }
        }

        /// <summary>
        /// Create a new TIA Portal project.
        /// </summary>
        public void CreateProject(string directory, string name)
        {
            if (_tiaPortal == null)
                throw new InvalidOperationException("TIA Portal not connected. Call Connect() first.");

            Console.WriteLine($"[TIA] Creating project: {name} in {directory}");
            Directory.CreateDirectory(directory);
            _project = _tiaPortal.Projects.Create(new DirectoryInfo(directory), name);
            Console.WriteLine($"[TIA] Project created: {_project.Name}");
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

            // Store source content for compile-fix chat
            try
            {
                string sourceContent = File.ReadAllText(sclFilePath);
                LastImportedSources[artifactName] = sourceContent;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[TIA] Warning: Could not read source for {artifactName}: {ex.Message}");
            }

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

            LastCompileResult = compileResult;
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

        /// <summary>
        /// Create a new TIA project and import provided SCL sources.
        /// Generic method — the frontend supplies the sources and import order.
        /// </summary>
        public DemoResult CreateProjectWithSources(string projectDir, string projectName, Dictionary<string, string> sources, List<string> importOrder)
        {
            var result = new DemoResult();

            // Step 1: Connect if not already
            Connect(preferAttach: true);

            // Step 2: Create project
            CreateProject(projectDir, projectName);

            // Step 3: Add S7-1500 CPU
            Console.WriteLine("[TIA] Adding S7-1500 CPU device...");
            Device device = _project.Devices.CreateWithItem(
                "OrderNumber:6ES7 516-3AN02-0AB0/V2.9",  // S7-1516 CPU
                "PLC_1",
                "PLC_1");
            Console.WriteLine($"[TIA] Device added: {device.Name}");

            PlcSoftware plcSoftware = GetPlcSoftware();
            result.DeviceName = device.Name;

            // Step 3b: Delete auto-created OB1
            try
            {
                PlcBlock existingMain = plcSoftware.BlockGroup.Blocks.Find("Main");
                if (existingMain != null)
                {
                    Console.WriteLine("[TIA] Deleting auto-created OB1 (Main) before import...");
                    existingMain.Delete();
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[TIA] Warning: Could not delete existing OB1: {ex.Message}");
            }

            // Step 4: Write SCL files to temp and import in order
            string tempDir = Path.Combine(Path.GetTempPath(), "PacForge", "proj_" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(tempDir);

            try
            {
                LastImportedSources.Clear();
                foreach (var kvp in sources)
                {
                    LastImportedSources[kvp.Key] = kvp.Value;
                }

                foreach (string name in importOrder)
                {
                    if (!sources.ContainsKey(name))
                    {
                        result.Warnings.Add($"{name}: not found in sources, skipping");
                        continue;
                    }

                    string filePath = Path.Combine(tempDir, name + ".scl");
                    File.WriteAllText(filePath, sources[name], new UTF8Encoding(true));

                    try
                    {
                        var generated = ImportArtifact(plcSoftware, name, filePath, "Program blocks");
                        result.ImportedBlocks.AddRange(generated);
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"[TIA] Warning importing {name}: {ex.Message}");
                        result.Warnings.Add($"{name}: {ex.Message}");
                    }
                }

                // Step 5: Compile
                Console.WriteLine("[TIA] Compiling project...");
                result.CompileResult = CompileAll(plcSoftware);

                // Step 6: Save
                SaveProject();

                result.Success = true;
                result.ProjectPath = _project.Path?.FullName;
            }
            finally
            {
                try { Directory.Delete(tempDir, true); } catch { }
            }

            return result;
        }

        /// <summary>
        /// Create a demo motor control project with UDT, FB, and OB.
        /// </summary>
        public DemoResult CreateDemoMotorProject(string projectDir, string projectName)
        {
            var result = new DemoResult();

            // Step 1: Connect if not already
            Connect(preferAttach: true);

            // Step 2: Create project
            CreateProject(projectDir, projectName);

            // Step 3: Get PLC software
            // The project is empty — we need to add a device first.
            // Use Siemens Openness to add an S7-1500 CPU.
            Console.WriteLine("[TIA] Adding S7-1500 CPU device...");
            Device device = _project.Devices.CreateWithItem(
                "OrderNumber:6ES7 516-3AN02-0AB0/V2.9",  // S7-1516 CPU
                "PLC_1",
                "PLC_1");
            Console.WriteLine($"[TIA] Device added: {device.Name}");

            PlcSoftware plcSoftware = GetPlcSoftware();
            result.DeviceName = device.Name;

            // Step 3b: Delete auto-created OB1 (TIA Portal creates it by default)
            try
            {
                PlcBlock existingMain = plcSoftware.BlockGroup.Blocks.Find("Main");
                if (existingMain != null)
                {
                    Console.WriteLine("[TIA] Deleting auto-created OB1 (Main) before import...");
                    existingMain.Delete();
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[TIA] Warning: Could not delete existing OB1: {ex.Message}");
            }

            // Step 4: Write demo SCL files to temp and import
            string tempDir = Path.Combine(Path.GetTempPath(), "PacForge", "demo_" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(tempDir);

            try
            {
                // Import in dependency order: UDT → FB → OB
                var demoFiles = new[]
                {
                    ("UDT_Motor", DEMO_UDT_MOTOR),
                    ("FB_MotorControl", DEMO_FB_MOTOR_CONTROL),
                    ("Main", DEMO_OB_MAIN),
                };

                // Store demo sources for compile-fix chat
                LastImportedSources.Clear();
                foreach (var (name, content) in demoFiles)
                {
                    LastImportedSources[name] = content;
                }

                foreach (var (name, content) in demoFiles)
                {
                    string filePath = Path.Combine(tempDir, name + ".scl");
                    File.WriteAllText(filePath, content, new UTF8Encoding(true));

                    try
                    {
                        var generated = ImportArtifact(plcSoftware, name, filePath, "Program blocks");
                        result.ImportedBlocks.AddRange(generated);
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"[TIA] Warning importing {name}: {ex.Message}");
                        result.Warnings.Add($"{name}: {ex.Message}");
                    }
                }

                // Step 5: Compile
                Console.WriteLine("[TIA] Compiling demo project...");
                result.CompileResult = CompileAll(plcSoftware);

                // Step 6: Save
                SaveProject();

                result.Success = true;
                result.ProjectPath = _project.Path?.FullName;
            }
            finally
            {
                try { Directory.Delete(tempDir, true); } catch { }
            }

            return result;
        }

        public class DemoResult
        {
            public bool Success { get; set; }
            public string ProjectPath { get; set; }
            public string DeviceName { get; set; }
            public List<string> ImportedBlocks { get; set; } = new List<string>();
            public List<string> Warnings { get; set; } = new List<string>();
            public CompileResultDto CompileResult { get; set; }
        }

        // --- Demo SCL Constants ---

        private const string DEMO_UDT_MOTOR = @"TYPE ""UDT_Motor""
VERSION : 0.1
   STRUCT
      Start : Bool;           // Start command
      Stop : Bool;            // Stop command
      Running : Bool;         // Motor is running
      Faulted : Bool;         // Motor fault active
      SpeedSetpoint : Real;   // Speed setpoint (0-100%)
      SpeedActual : Real;     // Actual speed feedback
      RunTimeHours : Real;    // Accumulated run time
   END_STRUCT;
END_TYPE
";

        private const string DEMO_FB_MOTOR_CONTROL = @"FUNCTION_BLOCK ""FB_MotorControl""
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
VAR_INPUT
   i_Start : Bool;
   i_Stop : Bool;
   i_SpeedSetpoint : Real;
   i_Reset : Bool;
END_VAR
VAR_OUTPUT
   o_Running : Bool;
   o_Faulted : Bool;
   o_SpeedActual : Real;
END_VAR
VAR
   state : Int;               // 0=Stopped, 1=Starting, 2=Running, 3=Stopping, 4=Faulted
   rampValue : Real;
   runTimer : Real;           // Accumulated seconds
END_VAR
VAR_TEMP
   dt : Real;
END_VAR
BEGIN
    #dt := 0.1;  // Assume 100ms cycle

    CASE #state OF
        0:  // Stopped
            #o_Running := FALSE;
            #o_Faulted := FALSE;
            #o_SpeedActual := 0.0;
            #rampValue := 0.0;
            IF #i_Start AND NOT #i_Stop THEN
                #state := 1;
            END_IF;

        1:  // Starting - ramp up
            #rampValue := #rampValue + (#dt * 20.0);  // 5s ramp
            IF #rampValue >= #i_SpeedSetpoint THEN
                #rampValue := #i_SpeedSetpoint;
                #state := 2;
            END_IF;
            #o_SpeedActual := #rampValue;
            #o_Running := TRUE;
            #o_Faulted := FALSE;

        2:  // Running
            #o_Running := TRUE;
            #o_Faulted := FALSE;
            #o_SpeedActual := #i_SpeedSetpoint;
            #runTimer := #runTimer + #dt;
            IF #i_Stop THEN
                #state := 3;
            END_IF;

        3:  // Stopping - ramp down
            #rampValue := #rampValue - (#dt * 25.0);  // 4s ramp
            IF #rampValue <= 0.0 THEN
                #rampValue := 0.0;
                #state := 0;
            END_IF;
            #o_SpeedActual := #rampValue;
            #o_Running := FALSE;
            #o_Faulted := FALSE;

        4:  // Faulted
            #o_Running := FALSE;
            #o_Faulted := TRUE;
            #o_SpeedActual := 0.0;
            IF #i_Reset THEN
                #o_Faulted := FALSE;
                #state := 0;
            END_IF;

        ELSE  // Invalid state - go to stopped
            #state := 0;
            #o_Running := FALSE;
            #o_Faulted := FALSE;
            #o_SpeedActual := 0.0;
    END_CASE;
END_FUNCTION_BLOCK
";

        private const string DEMO_OB_MAIN = @"ORGANIZATION_BLOCK ""Main""
TITLE = 'Main Program Sweep'
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
VAR
   Pump_1 : ""FB_MotorControl"";
   Fan_1 : ""FB_MotorControl"";
   Conveyor_1 : ""FB_MotorControl"";
   Pump_1_Running : Bool;
   Pump_1_Speed : Real;
   Fan_1_Running : Bool;
   Fan_1_Speed : Real;
   Conv_1_Running : Bool;
   Conv_1_Speed : Real;
END_VAR
VAR_TEMP
   tempInt : Int;
END_VAR
BEGIN
    // Pump 1 - 75% speed
    #Pump_1(i_Start := TRUE,
            i_Stop := FALSE,
            i_SpeedSetpoint := 75.0,
            i_Reset := FALSE,
            o_Running => #Pump_1_Running,
            o_SpeedActual => #Pump_1_Speed);

    // Fan 1 - 100% speed
    #Fan_1(i_Start := TRUE,
           i_Stop := FALSE,
           i_SpeedSetpoint := 100.0,
           i_Reset := FALSE,
           o_Running => #Fan_1_Running,
           o_SpeedActual => #Fan_1_Speed);

    // Conveyor 1 - 50% speed
    #Conveyor_1(i_Start := TRUE,
                i_Stop := FALSE,
                i_SpeedSetpoint := 50.0,
                i_Reset := FALSE,
                o_Running => #Conv_1_Running,
                o_SpeedActual => #Conv_1_Speed);
END_ORGANIZATION_BLOCK
";

        /// <summary>
        /// Reimport corrected SCL sources and recompile.
        /// Used by the compile-fix chat to apply AI-corrected code.
        /// </summary>
        public CompileResultDto ReimportAndCompile(Dictionary<string, string> sources)
        {
            if (!IsConnected || !IsProjectOpen)
                throw new InvalidOperationException("TIA Portal not connected or no project open.");

            PlcSoftware plcSoftware = GetPlcSoftware();

            string tempDir = Path.Combine(Path.GetTempPath(), "PacForge", "reimport_" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(tempDir);

            try
            {
                foreach (var kvp in sources)
                {
                    string artifactName = kvp.Key;
                    string sclContent = kvp.Value;
                    string filePath = Path.Combine(tempDir, artifactName + ".scl");
                    File.WriteAllText(filePath, sclContent, new UTF8Encoding(true));

                    try
                    {
                        // Delete existing block so reimport can replace it
                        PlcBlock existing = plcSoftware.BlockGroup.Blocks.Find(artifactName);
                        if (existing != null)
                        {
                            Console.WriteLine($"[TIA] Deleting existing block: {artifactName}");
                            existing.Delete();
                        }

                        // Also check types (UDTs)
                        PlcType existingType = plcSoftware.TypeGroup.Types.Find(artifactName);
                        if (existingType != null)
                        {
                            Console.WriteLine($"[TIA] Deleting existing type: {artifactName}");
                            existingType.Delete();
                        }

                        ImportArtifact(plcSoftware, artifactName, filePath, "Program blocks");
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"[TIA] Reimport error for {artifactName}: {ex.Message}");
                    }
                }

                // Update stored sources
                foreach (var kvp in sources)
                {
                    LastImportedSources[kvp.Key] = kvp.Value;
                }

                // Compile and save
                var compileResult = CompileAll(plcSoftware);
                SaveProject();
                return compileResult;
            }
            finally
            {
                try { Directory.Delete(tempDir, true); } catch { }
            }
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
