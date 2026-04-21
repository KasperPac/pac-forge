using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Siemens.Engineering;
using Siemens.Engineering.Compiler;
using Siemens.Engineering.HW;
using Siemens.Engineering.HW.Features;
using Siemens.Engineering.Hmi;
using Siemens.Engineering.Hmi.Screen;
using Siemens.Engineering.Hmi.Tag;
using Siemens.Engineering.SW;
using Siemens.Engineering.SW.Blocks;
using Siemens.Engineering.SW.ExternalSources;
using Siemens.Engineering.SW.Tags;
using Siemens.Engineering.SW.Types;
using Siemens.Engineering.Download;
using Siemens.Engineering.Connection;
using Siemens.Engineering.Library;
using Siemens.Engineering.Library.Types;
using Siemens.Engineering.Library.MasterCopies;
#if !TIA_V18
using Siemens.Engineering.HmiUnified;
using Siemens.Engineering.HmiUnified.UI.Screens;
using Siemens.Engineering.HmiUnified.UI.ScreenGroup;
using Siemens.Engineering.HmiUnified.UI.Base;
using Siemens.Engineering.HmiUnified.HmiTags;
#endif
using System.Reflection;
using System.Drawing;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;

namespace PacForgeBridge
{
    public class TiaPortalService : IDisposable
    {
        private TiaPortal _tiaPortal;
        private Project _project;
        private bool _disposed;

        public bool IsConnected => _tiaPortal != null;
        public bool HasProjectOpen => _project != null;
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

            // Probe whether the TIA Portal instance is still alive
            bool connected = false;
            bool projectOpen = false;
            if (_tiaPortal == null)
            {
                Console.WriteLine("[TIA] GetStatus: _tiaPortal is null (not yet connected)");
            }
            else
            {
                try
                {
                    var projects = _tiaPortal.Projects;
                    connected = true;
                    // Refresh _project in case user opened a project after the bridge attached
                    if (_project == null && projects.Count > 0)
                    {
                        _project = projects[0];
                        Console.WriteLine($"[TIA] GetStatus: picked up newly opened project: {_project.Name}");
                    }
                    else if (_project != null && projects.Count == 0)
                    {
                        _project = null;
                        Console.WriteLine("[TIA] GetStatus: project was closed, cleared reference");
                    }
                    projectOpen = _project != null;
                    Console.WriteLine($"[TIA] GetStatus: connected=true, projects={projects.Count}, projectOpen={projectOpen}");
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[TIA] GetStatus: _tiaPortal.Projects threw {ex.GetType().Name}: {ex.Message}");
                    // Instance is stale — clear it so Connect() will create a fresh one
                    _tiaPortal = null;
                    _project = null;
                }
            }

            string sourcePlcFamily = null;
            string sourceCpuTypeId = null;
            if (projectOpen)
            {
                try { GetSourcePlcInfo(out sourcePlcFamily, out sourceCpuTypeId); } catch { }
            }

            return new BridgeStatusResponse
            {
                Connected = connected,
                TiaVersion = tiaVersion,
                TiaProjectOpen = projectOpen,
                BridgeVersion = "1.0.0",
                SourcePlcFamily = sourcePlcFamily,
                SourceCpuTypeId = sourceCpuTypeId,
            };
        }

        /// <summary>
        /// Read the source PLC family name and CPU TypeIdentifier from the open project.
        /// </summary>
        private void GetSourcePlcInfo(out string familyName, out string typeId)
        {
            familyName = null;
            typeId = null;
            if (_project == null) return;

            foreach (Device device in _project.Devices)
            {
                familyName = device.Name;
                typeId = FindCpuTypeId(device.DeviceItems);
                if (typeId != null) return;
            }
        }

        private string FindCpuTypeId(DeviceItemComposition items)
        {
            foreach (DeviceItem item in items)
            {
                SoftwareContainer container = item.GetService<SoftwareContainer>();
                if (container?.Software is PlcSoftware)
                {
                    try
                    {
                        var id = item.GetAttribute("TypeIdentifier") as string;
                        if (!string.IsNullOrWhiteSpace(id)) return id;
                    }
                    catch { }
                }
                string nested = FindCpuTypeId(item.DeviceItems);
                if (nested != null) return nested;
            }
            return null;
        }

        /// <summary>
        /// Connect to TIA Portal — attach to running instance or start new one.
        /// Detects disposed/stale instances and reconnects automatically.
        /// </summary>
        public void Connect(bool preferAttach = true, bool withUi = true)
        {
            // Check if the existing instance is still alive
            if (_tiaPortal != null)
            {
                try
                {
                    // Probe the instance — accessing Projects will throw if disposed
                    // Also refresh _project in case the user switched projects in TIA Portal
                    var projects = _tiaPortal.Projects;
                    _project = projects.Count > 0 ? projects[0] : null;
                    if (_project != null)
                        Console.WriteLine($"[TIA] Refreshed project reference: {_project.Name}");
                    return; // Still alive
                }
                catch (ObjectDisposedException)
                {
                    Console.WriteLine("[TIA] TIA Portal instance was disposed externally. Reconnecting...");
                    _tiaPortal = null;
                    _project = null;
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[TIA] TIA Portal instance is stale ({ex.GetType().Name}: {ex.Message}). Reconnecting...");
                    _tiaPortal = null;
                    _project = null;
                }
            }

            if (preferAttach)
            {
                // Try to attach to a running TIA Portal instance
                IList<TiaPortalProcess> processes = TiaPortal.GetProcesses();
                Console.WriteLine($"[TIA] GetProcesses() found {processes.Count} TIA Portal process(es).");
                if (processes.Count > 0)
                {
                    Console.WriteLine($"[TIA] Attaching to running TIA Portal (PID: {processes[0].Id})...");
                    _tiaPortal = processes[0].Attach();
                    Console.WriteLine("[TIA] Attached successfully.");

                    // If a project is already open, grab it
                    int projCount = _tiaPortal.Projects.Count;
                    Console.WriteLine($"[TIA] Projects open after attach: {projCount}");
                    if (projCount > 0)
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
        /// Accepts either a full .ap* file path OR a folder path (will search for .ap* inside).
        /// </summary>
        public void OpenProject(string projectPath)
        {
            if (_tiaPortal == null)
                throw new InvalidOperationException("TIA Portal not connected. Call Connect() first.");

            // If a folder is given (not a .ap* file), find the project file inside it
            string resolvedPath = ResolveProjectFilePath(projectPath);

            // If same project is already open, skip
            if (_project != null && _project.Path != null)
            {
                string currentPath = _project.Path.FullName;
                if (string.Equals(currentPath, resolvedPath, StringComparison.OrdinalIgnoreCase))
                {
                    Console.WriteLine($"[TIA] Project already open: {_project.Name}");
                    return;
                }

                // Close current project first
                Console.WriteLine($"[TIA] Closing current project: {_project.Name}");
                _project.Close();
                _project = null;
            }

            Console.WriteLine($"[TIA] Opening project: {resolvedPath}");
            _project = _tiaPortal.Projects.Open(new FileInfo(resolvedPath));
            Console.WriteLine($"[TIA] Project opened: {_project.Name}");
        }

        /// <summary>
        /// Resolve a project path: if it's a folder, find the .ap* file inside.
        /// Returns the full path to the project file.
        /// </summary>
        private static string ResolveProjectFilePath(string path)
        {
            // Already a file path
            if (File.Exists(path))
                return path;

            // It's a directory — find the .ap* project file (search subdirectories too,
            // since TIA Portal creates projectDir\projectName\projectName.ap*)
            if (Directory.Exists(path))
            {
                string[] apFiles = Directory.GetFiles(path, "*.ap*", SearchOption.AllDirectories);
                // Filter to actual TIA project files (ap17, ap18, ap19, ap20...)
                foreach (string f in apFiles)
                {
                    string ext = Path.GetExtension(f).ToLowerInvariant();
                    if (System.Text.RegularExpressions.Regex.IsMatch(ext, @"\.ap\d+$"))
                        return f;
                }
                throw new FileNotFoundException($"No TIA Portal project file (*.ap17/18/19/20) found in: {path}");
            }

            // Not a file or folder — pass through and let TIA give the error
            return path;
        }

        /// <summary>
        /// Provision a TIA project: open if it exists, create if it doesn't.
        /// Adds CPU device, IO modules, and IO tag table when creating.
        /// The optional onProgress callback is invoked at each step for WS broadcasting.
        /// </summary>
        public ProvisionProjectResponse ProvisionProject(ProvisionProjectRequest request, Action<BridgeEvent> onProgress = null)
        {
            var response = new ProvisionProjectResponse();
            string provisionId = request.ProvisionId ?? Guid.NewGuid().ToString("N").Substring(0, 12);

            void Emit(string step, int pct, bool complete = false, bool failed = false, string err = null)
            {
                Console.WriteLine($"[TIA] Provision [{pct}%] {step}");
                onProgress?.Invoke(BridgeEvent.ProvisionProgress(provisionId, step, pct, complete, failed, err));
            }

            Emit("Connecting to TIA Portal", 5);
            Connect(preferAttach: true);

            string cleanFolder = request.TiaProjectPath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            // Use explicit ProjectName if provided, otherwise derive from folder basename
            string projectName = !string.IsNullOrWhiteSpace(request.ProjectName)
                ? request.ProjectName
                : Path.GetFileName(cleanFolder);

            // TIA Projects.Create(containerDir, name) creates containerDir\name\name.ap*
            // cleanFolder is the container directory (e.g. C:\TIA_Projects)
            // Result will be cleanFolder\projectName\projectName.ap*
            string projectDir = Path.Combine(cleanFolder, projectName);

            // Check whether a project file already exists inside the project subfolder
            string existingFile = null;
            if (Directory.Exists(projectDir))
            {
                string[] apFiles = Directory.GetFiles(projectDir, "*.ap*", SearchOption.TopDirectoryOnly);
                foreach (string f in apFiles)
                {
                    string ext = Path.GetExtension(f).ToLowerInvariant();
                    if (System.Text.RegularExpressions.Regex.IsMatch(ext, @"\.ap\d+$"))
                    {
                        existingFile = f;
                        break;
                    }
                }
            }

            if (existingFile != null)
            {
                // Project already exists — just open it
                Emit("Opening existing project", 50);
                OpenProject(existingFile);
                Emit("Project opened", 100, complete: true);
                response.Created = false;
                response.ProjectFilePath = existingFile;
                response.Success = true;
                response.Message = $"Opened existing project: {_project.Name}";
                return response;
            }

            // Create new project — TIA creates cleanFolder\projectName\projectName.ap*
            Emit("Creating TIA project", 15);
            Console.WriteLine($"[TIA] Provision: creating new project '{projectName}' in {cleanFolder}");
            CreateProject(cleanFolder, projectName);

            // Add CPU device
            Emit("Adding PLC device", 35);
            string cpuOrderNumber = !string.IsNullOrWhiteSpace(request.CpuOrderNumber)
                ? request.CpuOrderNumber
                : "OrderNumber:6ES7 516-3AN02-0AB0/V2.9"; // S7-1516 default

            // Ensure OrderNumber: prefix
            if (!cpuOrderNumber.StartsWith("OrderNumber:"))
                cpuOrderNumber = "OrderNumber:" + cpuOrderNumber;

            Console.WriteLine($"[TIA] Provision: adding CPU {cpuOrderNumber}");
            Device device = null;

            // Build list of order numbers to try: requested first, then fallbacks
            var orderNumbersToTry = new List<string> { cpuOrderNumber };

            // Also try stripping/changing version suffix variants
            string baseOrderNum = cpuOrderNumber.Replace("OrderNumber:", "");
            int slashIdx = baseOrderNum.LastIndexOf('/');
            if (slashIdx > 0)
            {
                string withoutVersion = "OrderNumber:" + baseOrderNum.Substring(0, slashIdx);
                if (!orderNumbersToTry.Contains(withoutVersion))
                    orderNumbersToTry.Add(withoutVersion);
            }

            // Known-good fallbacks for common S7-1500 CPUs installed in TIA V18
            var fallbacks = new[]
            {
                "OrderNumber:6ES7 516-3AN02-0AB0/V2.9",
                "OrderNumber:6ES7 516-3AN02-0AB0/V2.8",
                "OrderNumber:6ES7 516-3AN02-0AB0",
                "OrderNumber:6ES7 515-2AM02-0AB0/V2.9",
                "OrderNumber:6ES7 513-1AL02-0AB0/V2.1",
                "OrderNumber:6ES7 513-1AL02-0AB0",
            };
            foreach (var f in fallbacks)
                if (!orderNumbersToTry.Contains(f)) orderNumbersToTry.Add(f);

            Exception lastEx = null;
            foreach (string on in orderNumbersToTry)
            {
                try
                {
                    Console.WriteLine($"[TIA] Provision: trying CPU {on}");
                    device = _project.Devices.CreateWithItem(on, "PLC_1", "PLC_1");
                    Console.WriteLine($"[TIA] Provision: device added with {on}: {device.Name}");
                    break;
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[TIA] Provision: {on} failed: {ex.Message}");
                    lastEx = ex;
                }
            }

            if (device == null)
                throw new InvalidOperationException($"Could not add any S7-1500 CPU to project. Last error: {lastEx?.Message}");

            // V20: CreateWithItem invalidates the Project COM proxy. Re-grab it from the portal
            // before any further access or _project.Devices enumeration throws "No project open."
            if (_tiaPortal.Projects.Count > 0)
                _project = _tiaPortal.Projects[0];

            PlcSoftware plcSoftware = GetPlcSoftware();
            var demoResult = new DemoResult { DeviceName = device.Name };

            // Plug IO modules
            if (request.IoModules != null && request.IoModules.Count > 0)
            {
                Emit("Adding IO modules", 55);
                PlugIoModules(device, request.IoModules, demoResult);
                response.Warnings.AddRange(demoResult.Warnings);
            }

            // Create IO tag table
            if (request.IoTags != null && request.IoTags.Count > 0)
            {
                Emit("Creating IO tag table", 75);
                CreateIoTags(plcSoftware, request.IoTags, demoResult);
                response.Warnings.AddRange(demoResult.Warnings);
            }

            Emit("Saving project", 90);
            SaveProject();

            // Compile hardware configuration to validate CPU + modules
            Emit("Compiling hardware", 95);
            try
            {
                var compileResult = CompileAll(plcSoftware);
                if (!compileResult.Success)
                {
                    response.Warnings.Add($"Hardware compile warnings: {compileResult.Errors.Count} error(s), {compileResult.Warnings.Count} warning(s)");
                }
            }
            catch (Exception ex)
            {
                response.Warnings.Add($"Compile step skipped: {ex.Message}");
            }

            response.Created = true;
            response.ProjectFilePath = _project.Path?.FullName;
            response.Success = true;
            response.Message = $"Created project '{_project.Name}' with {device.Name}";
            Emit("Complete", 100, complete: true);
            Console.WriteLine($"[TIA] Provision complete: {response.ProjectFilePath}");
            return response;
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
        /// Find the CPU DeviceItem (the item that has SoftwareContainer with PlcSoftware).
        /// Needed for Download API, which operates on DeviceItem not PlcSoftware.
        /// </summary>
        public DeviceItem GetCpuDeviceItem()
        {
            if (_project == null)
                throw new InvalidOperationException("No project open.");

            foreach (Device device in _project.Devices)
            {
                DeviceItem cpu = FindCpuDeviceItem(device.DeviceItems);
                if (cpu != null) return cpu;
            }

            throw new InvalidOperationException("No PLC CPU found in project.");
        }

        private DeviceItem FindCpuDeviceItem(DeviceItemComposition items)
        {
            foreach (DeviceItem item in items)
            {
                SoftwareContainer container =
                    ((IEngineeringServiceProvider)item).GetService<SoftwareContainer>();
                if (container?.Software is PlcSoftware)
                    return item;

                DeviceItem nested = FindCpuDeviceItem(item.DeviceItems);
                if (nested != null) return nested;
            }
            return null;
        }

        /// <summary>
        /// Download the current project to a PLCSIM Advanced instance.
        /// Full pipeline: enable simulation support → compile → configure PLCSIM
        /// softbus connection → download → report results.
        /// The PLCSIM instance must already be running (started via /tia/plcsim/start).
        /// </summary>
        public DownloadResultDto DownloadToPlcsim()
        {
            if (_project == null)
                return new DownloadResultDto { Success = false, Message = "No project open." };

            try
            {
                // 1. Get CPU DeviceItem + PlcSoftware
                DeviceItem cpuDevice = GetCpuDeviceItem();
                PlcSoftware plcSoftware = GetPlcSoftware();
                Console.WriteLine($"[TIA] Found CPU: {cpuDevice.Name}");

                // 2. Dump protection/simulation attributes on CPU + PlcSoftware for diagnostics
                foreach (var target in new (string label, IEngineeringObject obj)[] {
                    ("CPU DeviceItem", cpuDevice),
                    ("PlcSoftware", plcSoftware),
                })
                {
                    try
                    {
                        Console.WriteLine($"[TIA] {target.label} — protection/simulation attributes:");
                        foreach (var ai in target.obj.GetAttributeInfos())
                        {
                            string lower = ai.Name.ToLower();
                            if (lower.Contains("simul") || lower.Contains("protect") ||
                                lower.Contains("access") || lower.Contains("password") ||
                                lower.Contains("security") || lower.Contains("connect"))
                            {
                                try
                                {
                                    var val = target.obj.GetAttribute(ai.Name);
                                    Console.WriteLine($"  {ai.Name} = {val ?? "(null)"}");
                                }
                                catch { Console.WriteLine($"  {ai.Name} = (read error)"); }
                            }
                        }
                    }
                    catch { }
                }
                // This must be set BEFORE compiling — blocks compiled without it can't be simulated
                try
                {
                    // Try on PlcSoftware first (V18 typical location)
                    plcSoftware.SetAttribute("SupportSimulationDuringBlockCompilation", true);
                    Console.WriteLine("[TIA] Simulation support enabled on PlcSoftware.");
                }
                catch
                {
                    try
                    {
                        // Try on the CPU DeviceItem
                        cpuDevice.SetAttribute("SupportSimulationDuringBlockCompilation", true);
                        Console.WriteLine("[TIA] Simulation support enabled on CPU DeviceItem.");
                    }
                    catch
                    {
                        try
                        {
                            // Try on the parent Device
                            var parentDevice = cpuDevice.Parent as Device;
                            if (parentDevice == null)
                                parentDevice = cpuDevice.Parent?.Parent as Device;
                            if (parentDevice != null)
                            {
                                parentDevice.SetAttribute("SupportSimulationDuringBlockCompilation", true);
                                Console.WriteLine("[TIA] Simulation support enabled on Device.");
                            }
                        }
                        catch (Exception ex3)
                        {
                            Console.WriteLine($"[TIA] WARNING: Could not set simulation flag automatically: {ex3.Message}");
                            Console.WriteLine("[TIA] Please enable it manually: Project tree → PLC → Properties → Protection & Security → Support simulation during block compilation");
                        }
                    }
                }

                // 3. Compile hardware + software (recompile with simulation flag)
                var compilable = plcSoftware.GetService<ICompilable>();
                if (compilable != null)
                {
                    Console.WriteLine("[TIA] Compiling before download...");
                    CompilerResult compileResult = compilable.Compile();
                    Console.WriteLine($"[TIA] Compile result: {compileResult.State} ({compileResult.WarningCount} warnings, {compileResult.ErrorCount} errors)");
                    if (compileResult.State == CompilerResultState.Error)
                    {
                        return new DownloadResultDto
                        {
                            Success = false,
                            Message = $"Compilation failed with {compileResult.ErrorCount} errors — fix before downloading.",
                        };
                    }
                }

                // 4. Get DownloadProvider
                DownloadProvider downloadProvider = cpuDevice.GetService<DownloadProvider>();
                if (downloadProvider == null)
                {
                    return new DownloadResultDto
                    {
                        Success = false,
                        Message = "CPU does not support Download API (DownloadProvider service unavailable).",
                    };
                }

                // 5. Configure for PLCSIM Softbus connection
                ConnectionConfiguration connConfig = downloadProvider.Configuration;

                // Dump all available attributes for diagnostics
                Console.WriteLine("[TIA] ConnectionConfiguration attributes:");
                try
                {
                    var attrInfos = connConfig.GetAttributeInfos();
                    foreach (var ai in attrInfos)
                    {
                        try
                        {
                            var val = connConfig.GetAttribute(ai.Name);
                            Console.WriteLine($"  {ai.Name} = {val ?? "(null)"}");
                        }
                        catch
                        {
                            Console.WriteLine($"  {ai.Name} = (read error)");
                        }
                    }
                }
                catch (Exception attrEx)
                {
                    Console.WriteLine($"  (could not enumerate attributes: {attrEx.Message})");
                }

                // Navigate: Modes → PN/IE → PLCSIM PC Interface
                ConfigurationMode pnMode = null;
                foreach (ConfigurationMode mode in connConfig.Modes)
                {
                    Console.WriteLine($"[TIA] Mode: {mode.Name}");
                    if (mode.Name.Contains("PN/IE"))
                        pnMode = mode;
                }

                if (pnMode == null)
                    return new DownloadResultDto { Success = false, Message = "PN/IE mode not found." };

                ConfigurationPcInterface plcsimInterface = null;
                foreach (ConfigurationPcInterface iface in pnMode.PcInterfaces)
                {
                    Console.WriteLine($"[TIA] PC Interface: '{iface.Name}' (Number={iface.Number})");
                    if (iface.Name.Contains("PLCSIM"))
                        plcsimInterface = iface;
                }

                if (plcsimInterface == null)
                    return new DownloadResultDto { Success = false, Message = "PLCSIM PC interface not found." };

                // Dump PLCSIM interface details
                Console.WriteLine($"[TIA] PLCSIM interface: '{plcsimInterface.Name}' Number={plcsimInterface.Number}");
                Console.WriteLine($"[TIA]   TargetInterfaces: {plcsimInterface.TargetInterfaces.Count}");
                foreach (ConfigurationTargetInterface ti in plcsimInterface.TargetInterfaces)
                {
                    Console.WriteLine($"[TIA]     Target: '{ti.Name}'");
                    Console.WriteLine($"[TIA]       Addresses: {ti.Addresses.Count}");
                    foreach (ConfigurationAddress a in ti.Addresses)
                        Console.WriteLine($"[TIA]         Addr: '{a.Name}' = {a.Address}");
                }
                Console.WriteLine($"[TIA]   Subnets: {plcsimInterface.Subnets.Count}");
                foreach (ConfigurationSubnet sn in plcsimInterface.Subnets)
                {
                    Console.WriteLine($"[TIA]     Subnet: '{sn.Name}'");
                    foreach (ConfigurationAddress a in sn.Addresses)
                        Console.WriteLine($"[TIA]       Addr: '{a.Name}' = {a.Address}");
                }
                Console.WriteLine($"[TIA]   Direct Addresses: {plcsimInterface.Addresses.Count}");
                foreach (ConfigurationAddress a in plcsimInterface.Addresses)
                    Console.WriteLine($"[TIA]     Addr: '{a.Name}' = {a.Address}");

                // ── Try approach A: ApplyConfiguration with the PLCSIM interface,
                //    then download using the first TargetInterface
                ConfigurationTargetInterface targetIface = null;
                foreach (ConfigurationTargetInterface ti in plcsimInterface.TargetInterfaces)
                {
                    if (targetIface == null) targetIface = ti;
                }

                if (targetIface == null)
                    return new DownloadResultDto { Success = false, Message = "No PLC target on PLCSIM interface." };

                // Try to find a ConfigurationAddress on the target (implements IConfiguration)
                IConfiguration downloadConfig = targetIface; // default: use TargetInterface

                // If the target has addresses, prefer an address (more specific routing)
                foreach (ConfigurationAddress addr in targetIface.Addresses)
                {
                    Console.WriteLine($"[TIA] Using target address: '{addr.Name}' = {addr.Address}");
                    downloadConfig = addr;
                    break;
                }

                Console.WriteLine($"[TIA] Download config type: {downloadConfig.GetType().Name}");

                // 6. Execute download
                Console.WriteLine("[TIA] Starting download to PLCSIM...");
                Siemens.Engineering.Download.DownloadResult downloadResult = downloadProvider.Download(
                    downloadConfig,
                    delegate(Siemens.Engineering.Download.Configurations.DownloadConfiguration preConfig)
                    {
                        Console.WriteLine($"[TIA] Pre-download prompt: {preConfig.Message}");
                        // Handle known pre-download prompts by accepting them
                        // Common prompts: "Stop modules", "Overwrite existing data", etc.
                    },
                    delegate(Siemens.Engineering.Download.Configurations.DownloadConfiguration postConfig)
                    {
                        Console.WriteLine($"[TIA] Post-download prompt: {postConfig.Message}");
                    },
                    Siemens.Engineering.Download.DownloadOptions.Software
                );

                // 7. Report results
                int warnCount = downloadResult.WarningCount;
                int errCount = downloadResult.ErrorCount;
                var dlState = downloadResult.State;

                Console.WriteLine($"[TIA] Download result: {dlState} ({warnCount} warnings, {errCount} errors)");

                // Log individual messages for debugging
                foreach (Siemens.Engineering.Download.DownloadResultMessage msg in downloadResult.Messages)
                {
                    Console.WriteLine($"[TIA]   [{msg.State}] {msg.Message}");
                }

                bool success = dlState != Siemens.Engineering.Download.DownloadResultState.Error;
                return new DownloadResultDto
                {
                    Success = success,
                    Message = success
                        ? $"Download complete ({warnCount} warnings)"
                        : $"Download failed with {errCount} errors",
                    Warnings = warnCount,
                    Errors = errCount,
                };
            }
            catch (Siemens.Engineering.EngineeringException ex)
            {
                // Log full exception chain for Openness errors
                Console.WriteLine($"[TIA] Download EngineeringException:");
                Exception inner = ex;
                while (inner != null)
                {
                    Console.WriteLine($"[TIA]   {inner.GetType().Name}: {inner.Message}");
                    inner = inner.InnerException;
                }
                return new DownloadResultDto
                {
                    Success = false,
                    Message = $"Download failed: {ex.Message}" +
                        (ex.InnerException != null ? $" → {ex.InnerException.Message}" : ""),
                };
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[TIA] Download error: {ex.GetType().Name}: {ex.Message}");
                if (ex.InnerException != null)
                    Console.WriteLine($"[TIA]   Inner: {ex.InnerException.Message}");
                return new DownloadResultDto
                {
                    Success = false,
                    Message = $"Download failed: {ex.Message}",
                };
            }
        }

        /// <summary>
        /// Import a single SCL artifact via the external source method.
        /// Returns the list of generated block/type names.
        /// </summary>
        public List<string> ImportArtifact(PlcSoftware plcSoftware, string artifactName, string sclFilePath, string destinationFolder)
        {
            var generatedNames = new List<string>();

            // UDTs/Types are auto-placed by TIA into the type group — skip block group routing
            bool isTypeDestination = !string.IsNullOrEmpty(destinationFolder)
                && (destinationFolder.Equals("Types", StringComparison.OrdinalIgnoreCase)
                    || destinationFolder.StartsWith("PLC data types", StringComparison.OrdinalIgnoreCase));

            // Determine target group for block generation (not used for UDTs)
            PlcBlockUserGroup targetGroup = null;
            if (!string.IsNullOrEmpty(destinationFolder) && destinationFolder != "Program blocks" && !isTypeDestination)
            {
                targetGroup = GetOrCreateBlockGroup(plcSoftware.BlockGroup, destinationFolder);
            }

            // Remove existing external source with same name (if leftover from previous run)
            string sourceName = Path.GetFileNameWithoutExtension(sclFilePath);
            PlcExternalSource existing = plcSoftware.ExternalSourceGroup.ExternalSources.Find(sourceName);
            existing?.Delete();

            // Store source content for compile-fix chat + debug log interface
            try
            {
                string sourceContent = File.ReadAllText(sclFilePath);
                LastImportedSources[artifactName] = sourceContent;

                // Debug: log VAR_INPUT section so we can verify what TIA actually receives
                var varInputMatch = System.Text.RegularExpressions.Regex.Match(
                    sourceContent, @"VAR_INPUT\s*([\s\S]*?)END_VAR", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                if (varInputMatch.Success)
                {
                    string[] inputLines = varInputMatch.Groups[1].Value.Trim().Split('\n');
                    string preview = string.Join(", ", inputLines.Length > 5
                        ? inputLines.Take(5).Select(l => l.Trim()).Where(l => l.Length > 0)
                        : inputLines.Select(l => l.Trim()).Where(l => l.Length > 0));
                    Console.WriteLine($"[TIA] {artifactName} VAR_INPUT: {preview}");
                }
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
        /// Export a block as SimaticML XML using block.Export() — use this to get the reference
        /// format that TIA Portal expects for import.
        /// </summary>
        public ExportBlockXmlResponse ExportBlockAsXml(string blockName, string folder = null)
        {
            if (_project == null)
                throw new InvalidOperationException("No TIA project open.");

            var result = new ExportBlockXmlResponse { BlockName = blockName };
            string tempFile = Path.Combine(Path.GetTempPath(), $"PacLadExport_{blockName}_{DateTime.UtcNow:yyyyMMddHHmmssfff}.xml");

            try
            {
                PlcSoftware plcSoftware = GetPlcSoftware();
                PlcBlock block = null;

                if (!string.IsNullOrEmpty(folder))
                {
                    PlcBlockUserGroup group = GetOrCreateBlockGroup(plcSoftware.BlockGroup, folder);
                    block = group?.Blocks.Find(blockName);
                }

                if (block == null)
                    block = plcSoftware.BlockGroup.Blocks.Find(blockName);

                if (block == null)
                {
                    result.Success = false;
                    result.Message = $"Block '{blockName}' not found in project.";
                    return result;
                }

                Console.WriteLine($"[LAD] Exporting block '{blockName}' ({block.ProgrammingLanguage}) to XML...");
                block.Export(new FileInfo(tempFile), ExportOptions.WithDefaults);

                result.XmlContent = File.ReadAllText(tempFile);
                result.Success = true;
                result.Message = $"Exported '{blockName}' ({block.ProgrammingLanguage})";
                Console.WriteLine($"[LAD] Exported {result.XmlContent.Length} chars");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[LAD] Export failed: {ex.Message}");
                result.Success = false;
                result.Message = ex.Message;
            }
            finally
            {
                if (File.Exists(tempFile)) try { File.Delete(tempFile); } catch { }
            }

            return result;
        }

        /// <summary>
        /// Create symbolic tags in TIA Portal's tag table for migration placeholder names.
        /// Uses the "Migration Tags" table (created if missing) so they're easy to find and rename.
        /// </summary>
        public CreateMigrationTagsResponse CreateMigrationTags(CreateMigrationTagsRequest request)
        {
            if (_project == null)
                throw new InvalidOperationException("No TIA project open.");

            PlcSoftware plcSoftware = GetPlcSoftware();
            string tableName = string.IsNullOrEmpty(request.TableName) ? "Migration Tags" : request.TableName;

            // Find or create the tag table
            PlcTagTable tagTable = plcSoftware.TagTableGroup.TagTables.Find(tableName);
            if (tagTable == null)
                tagTable = plcSoftware.TagTableGroup.TagTables.Create(tableName);

            var response = new CreateMigrationTagsResponse { Success = true };

            foreach (var tag in request.Tags)
            {
                try
                {
                    // Skip if already exists
                    if (tagTable.Tags.Find(tag.Name) != null)
                    {
                        response.Skipped.Add(tag.Name);
                        continue;
                    }

                    // Create(name, dataTypeName, logicalAddress)
                    tagTable.Tags.Create(tag.Name, tag.DataType, tag.Address);
                    response.Created.Add(tag.Name);
                    Console.WriteLine($"[Tags] Created: {tag.Name} : {tag.DataType} @ {tag.Address}");
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[Tags] Failed to create {tag.Name}: {ex.Message}");
                    response.Errors.Add($"{tag.Name}: {ex.Message}");
                }
            }

            response.Message = $"Created {response.Created.Count}, skipped {response.Skipped.Count}, errors {response.Errors.Count}";
            if (response.Errors.Count > 0) response.Success = false;
            return response;
        }

        /// <summary>
        /// Reimport fixed SimaticML XML blocks (LAD/FBD/GRAPH) into the open project.
        /// Overwrites existing blocks with the fixed versions (absolute addresses resolved etc.)
        /// </summary>
        public ReimportMigrationBlocksResponse ReimportMigrationBlocks(ReimportMigrationBlocksRequest request)
        {
            if (_project == null)
                throw new InvalidOperationException("No TIA project open.");

            PlcSoftware plcSoftware = GetPlcSoftware();
            var response = new ReimportMigrationBlocksResponse { Success = true };
            string tempDir = Path.Combine(Path.GetTempPath(), "PacForge", "reimport_" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(tempDir);

            try
            {
                foreach (var kvp in request.Blocks)
                {
                    string blockName = kvp.Key;
                    string xmlContent = kvp.Value;

                    if (string.IsNullOrEmpty(xmlContent))
                    {
                        response.Errors.Add($"{blockName}: empty XML content");
                        continue;
                    }

                    string tempFile = Path.Combine(tempDir, blockName + ".xml");
                    try
                    {
                        File.WriteAllText(tempFile, xmlContent, System.Text.Encoding.UTF8);
                        var imported = plcSoftware.BlockGroup.Blocks.Import(
                            new FileInfo(tempFile),
                            ImportOptions.Override);

                        Console.WriteLine($"[Reimport] {blockName}: imported {imported?.Count ?? 0} block(s)");
                        response.Imported.Add(blockName);
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"[Reimport] {blockName} failed: {ex.Message}");
                        response.Errors.Add($"{blockName}: {ex.Message}");
                    }
                }

                response.Message = $"Reimported {response.Imported.Count} block(s), {response.Errors.Count} error(s)";
                if (response.Errors.Count > 0 && response.Imported.Count == 0) response.Success = false;
            }
            finally
            {
                try { Directory.Delete(tempDir, true); } catch { }
            }

            return response;
        }

        /// <summary>
        /// Import a LAD block from SimaticML XML into the open project and optionally compile it.
        /// Uses PlcBlockGroup.Blocks.Import() — different from the SCL external source path.
        /// </summary>
        public ImportLadResponse ImportLadBlock(string xmlContent, string blockName, string blockType, bool compile, string destinationFolder = null)
        {
            if (_project == null)
                throw new InvalidOperationException("No TIA project open. Open a project first.");

            var result = new ImportLadResponse();
            string tempFile = null;

            try
            {
                // Write XML to a temp file — TIA Openness needs a FileInfo on disk
                tempFile = Path.Combine(Path.GetTempPath(), $"PacLad_{blockName}_{DateTime.UtcNow:yyyyMMddHHmmssfff}.xml");
                File.WriteAllText(tempFile, xmlContent, System.Text.Encoding.UTF8);
                Console.WriteLine($"[LAD] Importing {blockType} '{blockName}' from {tempFile}");

                PlcSoftware plcSoftware = GetPlcSoftware();

                // Determine target block group
                PlcBlockSystemGroup rootGroup = plcSoftware.BlockGroup;

                // Delete existing block if it exists anywhere — ImportOptions.Override only
                // works within the same group. If the block was previously imported to a
                // different folder, TIA will reject the new import with "already exists".
                PlcBlock existingBlock = FindBlockRecursive(rootGroup, blockName);
                if (existingBlock != null)
                {
                    Console.WriteLine($"[LAD] Deleting existing block '{blockName}' before re-import");
                    existingBlock.Delete();
                }

                IList<PlcBlock> imported;
                if (!string.IsNullOrEmpty(destinationFolder))
                {
                    PlcBlockUserGroup targetGroup = GetOrCreateBlockGroup(rootGroup, destinationFolder);
                    imported = targetGroup.Blocks.Import(new FileInfo(tempFile), ImportOptions.Override);
                }
                else
                {
                    imported = rootGroup.Blocks.Import(new FileInfo(tempFile), ImportOptions.Override);
                }

                foreach (PlcBlock block in imported)
                {
                    result.ImportedBlocks.Add(block.Name);
                }

                Console.WriteLine($"[LAD] Imported {result.ImportedBlocks.Count} block(s): {string.Join(", ", result.ImportedBlocks)}");

                if (compile && result.ImportedBlocks.Count > 0)
                {
                    Console.WriteLine($"[LAD] Compiling block(s)...");
                    // Compile the whole PLC software to pick up the new LAD block
                    result.CompileResult = CompileAll(plcSoftware);
                    Console.WriteLine($"[LAD] Compile {(result.CompileResult.Success ? "succeeded" : "failed")}");
                }

                // If compile was requested, success depends on compile result
                if (compile && result.CompileResult != null && !result.CompileResult.Success)
                {
                    result.Success = false;
                    result.Message = $"Imported '{blockName}' but compile failed ({result.CompileResult.Errors?.Count ?? 0} errors)";
                }
                else
                {
                    result.Success = true;
                    result.Message = compile
                        ? $"Imported and compiled '{blockName}' ({result.ImportedBlocks.Count} block(s))"
                        : $"Imported '{blockName}' ({result.ImportedBlocks.Count} block(s))";
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[LAD] Import failed: {ex.Message}");
                result.Success = false;
                result.Message = ex.Message;
            }
            finally
            {
                if (tempFile != null && File.Exists(tempFile))
                {
                    try { File.Delete(tempFile); } catch { }
                }
            }

            return result;
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
        /// Recursively search for a block by name across all user groups.
        /// Returns null if not found.
        /// </summary>
        private PlcBlock FindBlockRecursive(PlcBlockSystemGroup root, string blockName)
        {
            // Check root group
            PlcBlock found = root.Blocks.Find(blockName);
            if (found != null) return found;

            // Recurse into user groups
            return FindBlockInGroups(root.Groups, blockName);
        }

        private PlcBlock FindBlockInGroups(PlcBlockUserGroupComposition groups, string blockName)
        {
            foreach (PlcBlockUserGroup group in groups)
            {
                PlcBlock found = group.Blocks.Find(blockName);
                if (found != null) return found;
                PlcBlock recursive = FindBlockInGroups(group.Groups, blockName);
                if (recursive != null) return recursive;
            }
            return null;
        }

        /// <summary>
        /// Recursively collect compiler messages into errors and warnings lists.
        /// Only LEAF messages (no children) are added — parent nodes are just
        /// hierarchy path (PLC_1, Program blocks, FB_Name) not real errors.
        /// Summary messages like "Compiling finished ..." are also filtered out.
        /// </summary>
        private void CollectCompilerMessages(CompilerResultMessageComposition messages, CompileResultDto result, string parentPath = "")
        {
            foreach (CompilerResultMessage msg in messages)
            {
                // Accumulate path: TIA Portal msg.Path is sometimes a full path, sometimes just
                // a segment name. Treat it as a segment if it contains no "/" and parentPath is set.
                string segment = msg.Path ?? "";
                string effectivePath;
                if (string.IsNullOrEmpty(segment))
                    effectivePath = parentPath;
                else if (segment.Contains("/") || string.IsNullOrEmpty(parentPath))
                    effectivePath = segment;          // already a full path
                else
                    effectivePath = parentPath + "/" + segment;  // append segment

                bool hasChildren = msg.Messages != null && msg.Messages.Count > 0;

                if (hasChildren)
                {
                    // Parent node — just recurse, don't add as error
                    CollectCompilerMessages(msg.Messages, result, effectivePath);
                    continue;
                }

                // Leaf node — this is an actual error/warning
                string description = msg.Description ?? "";

                // Skip summary messages like "Compiling finished (errors: 1; warnings: 0)"
                if (description.StartsWith("Compiling finished", StringComparison.OrdinalIgnoreCase))
                    continue;

                string artifactName = ExtractArtifactName(effectivePath);

                var error = new CompileErrorDto
                {
                    ArtifactName = artifactName,
                    ErrorText = description,
                    Severity = msg.State == CompilerResultState.Error ? "ERROR" : "WARNING"
                };

                // Try to extract line/column from description
                ParseLineColumn(description, error);

                if (msg.State == CompilerResultState.Error)
                {
                    result.Errors.Add(error);
                }
                else if (msg.State == CompilerResultState.Warning)
                {
                    result.Warnings.Add(error);
                    error.Severity = "WARNING";
                }
            }
        }

        /// <summary>
        /// Extract a meaningful artifact name from compiler message path.
        /// Paths look like: "PLC_1/Program blocks/FB_TrafficLight (FB1)/Interface"
        /// Returns the block name without the TIA type suffix, e.g. "FB_TrafficLight".
        /// Skips structural section names (Interface, Code, Temp, Static, Constant)
        /// that TIA Portal appends after the block name.
        /// </summary>
        private string ExtractArtifactName(string path)
        {
            if (string.IsNullOrEmpty(path)) return "Unknown";

            string[] parts = path.Split('/');

            // Walk backwards, skipping known TIA structural section names
            var structuralSections = new System.Collections.Generic.HashSet<string>(System.StringComparer.OrdinalIgnoreCase)
            {
                "Interface", "Code", "Temp", "Static", "Constant", "InOut", "Input", "Output",
                "Return", "Network", "Program blocks", "PLC data types", "External source files"
            };

            string last = null;
            for (int i = parts.Length - 1; i >= 0; i--)
            {
                string part = parts[i].Trim();
                if (string.IsNullOrEmpty(part)) continue;

                // Skip exact matches (e.g. "Interface", "Code")
                if (structuralSections.Contains(part)) continue;

                // Skip numbered structural sections like "Network 1", "Network 2"
                int spaceIdx = part.LastIndexOf(' ');
                if (spaceIdx > 0)
                {
                    string prefix = part.Substring(0, spaceIdx);
                    string suffix = part.Substring(spaceIdx + 1);
                    if (structuralSections.Contains(prefix) && int.TryParse(suffix, out _))
                        continue;
                }

                last = part;
                break;
            }
            if (last == null) last = parts[parts.Length - 1].Trim();

            // Strip TIA type suffix like " (FB1)", " (DB3)", " (FC2)"
            var suffixMatch = System.Text.RegularExpressions.Regex.Match(last, @"\s*\([A-Z]+\d+\)\s*$");
            if (suffixMatch.Success)
            {
                last = last.Substring(0, suffixMatch.Index).Trim();
            }

            return string.IsNullOrEmpty(last) ? "Unknown" : last;
        }

        /// <summary>
        /// Try to parse line/column numbers from compiler error description text.
        /// TIA Portal patterns:
        ///   "279 — Parameter 'OUT' has to be used."  (line number at start, em-dash)
        ///   "279 - Parameter 'OUT' has to be used."   (line number at start, hyphen)
        ///   "Line X, Column Y: ..."
        ///   "(X,Y) ..."
        /// When a leading line number is found, the description is cleaned to remove it.
        /// </summary>
        private void ParseLineColumn(string description, CompileErrorDto error)
        {
            if (string.IsNullOrEmpty(description)) return;

            // Pattern: leading line number "279 — text" or "279 - text"
            var match = System.Text.RegularExpressions.Regex.Match(
                description, @"^(\d+)\s*[\u2014\-]\s*(.+)$");
            if (match.Success)
            {
                error.Line = int.Parse(match.Groups[1].Value);
                error.ErrorText = match.Groups[2].Value.Trim();
                return;
            }

            // Pattern: "Line X, Column Y"
            match = System.Text.RegularExpressions.Regex.Match(
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
        /// Return the TIA Portal version this bridge was compiled against.
        /// Uses the compile-time constant so V18 and V20 builds always report correctly,
        /// regardless of which other TIA Portal versions are installed on the machine.
        /// </summary>
        private string DetectInstalledVersion()
        {
#if TIA_V18
            return "V18";
#else
            return "V20";
#endif
        }

        /// <summary>
        /// Create a new TIA project and import provided SCL sources.
        /// Generic method — the frontend supplies the sources and import order.
        /// </summary>
        public DemoResult CreateProjectWithSources(string projectDir, string projectName, Dictionary<string, string> sources, List<string> importOrder, List<IoModuleDto> ioModules = null, List<IoTagDto> ioTags = null)
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

            // Step 3a: Add IO modules to rack
            if (ioModules != null && ioModules.Count > 0)
            {
                PlugIoModules(device, ioModules, result);
            }

            // Step 3b: Create PLC tags from IO list
            if (ioTags != null && ioTags.Count > 0)
            {
                CreateIoTags(plcSoftware, ioTags, result);
            }

            // Step 3d: Delete auto-created OB1
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
        /// Plug IO modules into the device rack at specified slots.
        /// The rack is the first DeviceItem under the Device.
        /// </summary>
        // Common firmware versions to try when plugging IO modules (most likely first)
        // Descending order — newer firmware versions are more likely to be installed in TIA V18+
        private static readonly string[] VERSION_SUFFIXES = new[]
        {
            "/V5.0", "/V4.2", "/V4.1", "/V4.0",
            "/V3.1", "/V3.0",
            "/V2.9", "/V2.8", "/V2.7", "/V2.6", "/V2.5", "/V2.4", "/V2.3", "/V2.2", "/V2.1", "/V2.0",
            "/V1.2", "/V1.1", "/V1.0",
            "/V0.4", "/V0.3", "/V0.2", "/V0.1", "/V0.0",
            "/V6.0", "/V5.1", "/V5.2",
        };

        private void PlugIoModules(Device device, List<IoModuleDto> ioModules, DemoResult result)
        {
            // S7-1500 device hierarchy: Device → DeviceItem[0] (rack/rail) → slots
            DeviceItem rack = null;
            foreach (DeviceItem item in device.DeviceItems)
            {
                rack = item;
                break;
            }

            if (rack == null)
            {
                result.Warnings.Add("Could not find rack in device — IO modules not added");
                return;
            }

            Console.WriteLine($"[TIA] Found rack: {rack.Name} — plugging {ioModules.Count} IO module(s)");

            // Track next available slot — slots 0 (PSU) and 1 (CPU) are reserved
            int nextAvailableSlot = 2;

            foreach (var mod in ioModules)
            {
                // Guard: never plug into slot 0 (PSU) or slot 1 (CPU), and never reuse an occupied slot
                int targetSlot = mod.Slot < nextAvailableSlot ? nextAvailableSlot : mod.Slot;
                if (targetSlot < 2) targetSlot = 2;

                string mlfb = mod.Mlfb.Trim();
                string moduleName = mod.Description ?? $"IO_Slot{targetSlot}";
                bool plugged = false;
                string lastError = "";

                if (targetSlot != mod.Slot)
                    Console.WriteLine($"[TIA]   Slot {mod.Slot} is reserved (CPU/PSU), using slot {targetSlot} instead");

                // Build MLFB format variants:
                // - raw input, no-spaces, with-space-at-pos-4
                var mlfbVariants = new List<string> { mlfb };
                string noSpaces = mlfb.Replace(" ", "");
                string withSpaces = noSpaces.Length >= 4
                    ? noSpaces.Substring(0, 4) + " " + noSpaces.Substring(4)
                    : noSpaces;
                if (noSpaces != mlfb) mlfbVariants.Add(noSpaces);
                if (withSpaces != mlfb && withSpaces != noSpaces) mlfbVariants.Add(withSpaces);

                foreach (string variant in mlfbVariants)
                {
                    if (plugged) break;

                    // Try without version
                    string orderNumber = $"OrderNumber:{variant}";
                    try
                    {
                        Console.WriteLine($"[TIA]   Trying {orderNumber} in slot {targetSlot}...");
                        DeviceItem pluggedItem = rack.PlugNew(orderNumber, moduleName, targetSlot);
                        Console.WriteLine($"[TIA]   OK: {pluggedItem.Name} in slot {targetSlot}");
                        plugged = true;
                        break;
                    }
                    catch (Exception ex)
                    {
                        lastError = ex.Message;
                        Console.WriteLine($"[TIA]   Failed: {ex.Message}");
                    }

                    // Try with version suffixes
                    foreach (string version in VERSION_SUFFIXES)
                    {
                        string orderWithVer = $"OrderNumber:{variant}{version}";
                        try
                        {
                            Console.WriteLine($"[TIA]   Trying {orderWithVer} in slot {targetSlot}...");
                            DeviceItem pluggedItem = rack.PlugNew(orderWithVer, moduleName, targetSlot);
                            Console.WriteLine($"[TIA]   OK: {pluggedItem.Name} in slot {targetSlot}");
                            plugged = true;
                            break;
                        }
                        catch (Exception ex)
                        {
                            lastError = ex.Message;
                        }
                    }
                }

                // If first pass failed, re-acquire rack reference and retry
                // TIA's internal object model can become stale after a successful PlugNew
                if (!plugged)
                {
                    Console.WriteLine($"[TIA]   First pass failed for slot {targetSlot}, re-acquiring rack and retrying...");
                    System.Threading.Thread.Sleep(200);

                    // Re-acquire the rack DeviceItem — the previous PlugNew may have invalidated it
                    DeviceItem freshRack = null;
                    foreach (DeviceItem item in device.DeviceItems)
                    {
                        freshRack = item;
                        break;
                    }
                    if (freshRack != null)
                    {
                        rack = freshRack;
                        foreach (string variant in mlfbVariants)
                        {
                            if (plugged) break;
                            foreach (string version in VERSION_SUFFIXES)
                            {
                                string orderWithVer = $"OrderNumber:{variant}{version}";
                                try
                                {
                                    DeviceItem pluggedItem = rack.PlugNew(orderWithVer, moduleName, targetSlot);
                                    Console.WriteLine($"[TIA]   RETRY OK: {pluggedItem.Name} in slot {targetSlot} with {version}");
                                    plugged = true;
                                    break;
                                }
                                catch (Exception ex)
                                {
                                    lastError = ex.Message;
                                }
                            }
                        }
                    }
                }

                if (plugged)
                {
                    nextAvailableSlot = targetSlot + 1;
                    // Re-acquire rack reference after every successful plug —
                    // PlugNew modifies the device tree, invalidating the old rack object
                    foreach (DeviceItem item in device.DeviceItems)
                    {
                        rack = item;
                        break;
                    }
                }
                else
                {
                    string warning = $"IO module {mod.Mlfb} slot {targetSlot}: Could not find matching hardware in TIA catalog. Last error: {lastError}";
                    Console.WriteLine($"[TIA]   WARNING: {warning}");
                    result.Warnings.Add(warning);
                    nextAvailableSlot = targetSlot + 1;
                }
            }
        }

        /// <summary>
        /// Create PLC tags in a "PacForge IO Tags" tag table from the project IO list.
        /// Each IoTagDto maps a symbolic name to a physical address (e.g. Motor_Start → %I0.0).
        /// Invalid tags are skipped with a warning rather than failing the whole import.
        /// </summary>
        private void CreateIoTags(PlcSoftware plcSoftware, List<IoTagDto> ioTags, DemoResult result)
        {
            if (ioTags == null || ioTags.Count == 0) return;

            Console.WriteLine($"[TIA] Creating {ioTags.Count} PLC tag(s) in tag table...");

            // Find or create the "PacForge IO Tags" table
            PlcTagTable tagTable = plcSoftware.TagTableGroup.TagTables.Find("PacForge IO Tags");
            if (tagTable == null)
            {
                Console.WriteLine("[TIA] Creating 'PacForge IO Tags' tag table...");
                tagTable = plcSoftware.TagTableGroup.TagTables.Create("PacForge IO Tags");
            }

            int created = 0;
            foreach (var tag in ioTags)
            {
                if (string.IsNullOrWhiteSpace(tag.Name) || string.IsNullOrWhiteSpace(tag.LogicalAddress))
                {
                    Console.WriteLine($"[TIA]   Skipping tag with empty name or address");
                    continue;
                }

                // Normalize data type: TIA Portal uses PascalCase (Bool, Int, Word, DWord, Real)
                string dataType = NormalizeDataType(tag.DataType);
                string address = tag.LogicalAddress.Trim();

                try
                {
                    PlcTag created_tag = tagTable.Tags.Create(tag.Name.Trim(), dataType, address);
                    if (!string.IsNullOrWhiteSpace(tag.Comment))
                    {
                        created_tag.Comment.Items[0].Text = tag.Comment;
                    }
                    Console.WriteLine($"[TIA]   Tag: {tag.Name} {dataType} {address}");
                    created++;
                }
                catch (Exception ex)
                {
                    string warning = $"Could not create tag '{tag.Name}' ({dataType} {address}): {ex.Message}";
                    Console.WriteLine($"[TIA]   WARNING: {warning}");
                    result.Warnings.Add(warning);
                }
            }

            Console.WriteLine($"[TIA] Created {created}/{ioTags.Count} PLC tag(s).");
        }

        /// <summary>
        /// Normalize data type string to TIA Portal PascalCase format.
        /// Accepts "bool", "BOOL", "Bool" → "Bool"; "int" → "Int"; etc.
        /// </summary>
        private static string NormalizeDataType(string rawType)
        {
            if (string.IsNullOrWhiteSpace(rawType)) return "Bool";

            switch (rawType.Trim().ToUpperInvariant())
            {
                case "BOOL":    return "Bool";
                case "BYTE":    return "Byte";
                case "WORD":    return "Word";
                case "DWORD":   return "DWord";
                case "LWORD":   return "LWord";
                case "SINT":    return "SInt";
                case "INT":     return "Int";
                case "DINT":    return "DInt";
                case "LINT":    return "LInt";
                case "USINT":   return "USInt";
                case "UINT":    return "UInt";
                case "UDINT":   return "UDInt";
                case "ULINT":   return "ULInt";
                case "REAL":    return "Real";
                case "LREAL":   return "LReal";
                case "CHAR":    return "Char";
                case "STRING":  return "String";
                case "TIME":    return "Time";
                case "DATE":    return "Date";
                default:
                    // Return as-is with first letter uppercased as best effort
                    string t = rawType.Trim();
                    return char.ToUpperInvariant(t[0]) + t.Substring(1).ToLowerInvariant();
            }
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
        /// Export current PLC block sources from TIA Portal.
        /// Uses GenerateSource to produce .scl files from compiled blocks.
        /// </summary>
        public ExportSourcesResponse ExportSources()
        {
            if (!IsConnected || !IsProjectOpen)
                throw new InvalidOperationException("TIA Portal not connected or no project open.");

            PlcSoftware plcSoftware = GetPlcSoftware();
            var result = new ExportSourcesResponse { Success = true };

            string tempDir = Path.Combine(Path.GetTempPath(), "PacForge",
                "export_" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(tempDir);

            try
            {
                // Collect all blocks recursively
                var allBlocks = new List<PlcBlock>();
                CollectBlocks(plcSoftware.BlockGroup, allBlocks);

                Console.WriteLine($"[TIA] Exporting {allBlocks.Count} block(s) from project...");

                // Export each block individually (try/catch per block so one failure doesn't stop others)
                foreach (PlcBlock block in allBlocks)
                {
                    string blockLang = "SCL";
                    try { blockLang = block.ProgrammingLanguage.ToString(); } catch { }

                    try
                    {
                        // File extension must match block type for GenerateSource.
                        // LAD/FBD blocks decompile to AWL — use .awl extension.
                        string ext = ".scl";
                        if (blockLang == "STL") ext = ".awl";
                        else if (blockLang == "DB") ext = ".db";
                        else if (blockLang == "LAD" || blockLang == "FBD") ext = ".awl";

                        string outputFile = Path.Combine(tempDir, block.Name + ext);

                        plcSoftware.ExternalSourceGroup.GenerateSource(
                            new PlcBlock[] { block },
                            new FileInfo(outputFile),
                            GenerateOptions.None);

                        if (File.Exists(outputFile))
                        {
                            result.Sources[block.Name] = File.ReadAllText(outputFile);
                            // LAD/FBD decompiled to AWL — label as STL so migration treats it as STL
                            if (blockLang == "LAD" || blockLang == "FBD")
                                result.SourceLanguages[block.Name] = blockLang; // keep original lang for UI
                            else
                                result.SourceLanguages[block.Name] = blockLang == "DB" ? "DB" : blockLang == "STL" ? "STL" : "SCL";
                            Console.WriteLine($"[TIA] Exported ({blockLang}→AWL): {block.Name}");
                        }
                        else
                        {
                            result.Warnings.Add($"{block.Name}: No output file generated");
                        }
                    }
                    catch (Exception genEx)
                    {
                        // GenerateSource failed — for LAD/FBD fall back to SimaticML XML export.
                        Console.WriteLine($"[TIA] GenerateSource failed for {block.Name} ({blockLang}): {genEx.Message}");
                        if (blockLang == "LAD" || blockLang == "FBD" || blockLang == "GRAPH")
                        {
                            try
                            {
                                string xmlFile = Path.Combine(tempDir, block.Name + ".xml");
                                try { block.Export(new FileInfo(xmlFile), ExportOptions.None); }
                                catch { block.Export(new FileInfo(xmlFile), ExportOptions.WithDefaults); }

                                if (File.Exists(xmlFile))
                                {
                                    result.Sources[block.Name] = File.ReadAllText(xmlFile);
                                    result.SourceLanguages[block.Name] = blockLang;
                                    Console.WriteLine($"[TIA] Exported XML ({blockLang}): {block.Name}");
                                }
                                else
                                {
                                    result.Warnings.Add($"{block.Name}: LAD/FBD XML export produced no file");
                                }
                            }
                            catch (Exception xmlEx)
                            {
                                Console.WriteLine($"[TIA] XML export also failed for {block.Name}: {xmlEx.Message}");
                                result.Warnings.Add($"{block.Name}: {xmlEx.Message}");
                            }
                        }
                        else
                        {
                            Console.WriteLine($"[TIA] Export skipped for {block.Name} ({blockLang})");
                            result.Warnings.Add($"{block.Name}: not exportable");
                        }
                    }
                }

                // Also export UDTs (PLC data types) from the type group
                var allTypes = new List<PlcType>();
                CollectTypes(plcSoftware.TypeGroup, allTypes);
                Console.WriteLine($"[TIA] Exporting {allTypes.Count} UDT(s)...");

                foreach (PlcType type in allTypes)
                {
                    try
                    {
                        // UDTs require .udt extension (TIA Openness requirement)
                        string outputFile = Path.Combine(tempDir, type.Name + ".udt");
                        plcSoftware.ExternalSourceGroup.GenerateSource(
                            new PlcType[] { type },
                            new FileInfo(outputFile),
                            GenerateOptions.None);

                        if (File.Exists(outputFile))
                        {
                            result.Sources[type.Name] = File.ReadAllText(outputFile);
                            Console.WriteLine($"[TIA] Exported UDT: {type.Name}");
                        }
                        else
                        {
                            result.Warnings.Add($"UDT {type.Name}: No output file generated");
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"[TIA] UDT export skipped for {type.Name}: {ex.Message}");
                        result.Warnings.Add($"UDT {type.Name}: {ex.Message}");
                    }
                }

                result.Message = $"Exported {result.Sources.Count} source(s)";
                Console.WriteLine($"[TIA] Export complete: {result.Sources.Count} source(s), {result.Warnings.Count} warning(s)");
            }
            finally
            {
                try { Directory.Delete(tempDir, true); } catch { }
            }

            return result;
        }

        private void CollectTypes(PlcTypeSystemGroup group, List<PlcType> types)
        {
            foreach (PlcType type in group.Types)
                types.Add(type);
            foreach (PlcTypeUserGroup subGroup in group.Groups)
                CollectTypesFromUserGroup(subGroup, types);
        }

        private void CollectTypesFromUserGroup(PlcTypeUserGroup group, List<PlcType> types)
        {
            foreach (PlcType type in group.Types)
                types.Add(type);
            foreach (PlcTypeUserGroup subGroup in group.Groups)
                CollectTypesFromUserGroup(subGroup, types);
        }

        /// <summary>
        /// Collect all blocks from the system block group (root level + user groups).
        /// </summary>
        private void CollectBlocks(PlcBlockSystemGroup group, List<PlcBlock> blocks)
        {
            foreach (PlcBlock block in group.Blocks)
                blocks.Add(block);
            foreach (PlcBlockUserGroup subGroup in group.Groups)
                CollectBlocksFromUserGroup(subGroup, blocks);
        }

        /// <summary>
        /// Recursively collect blocks from user-created block groups.
        /// </summary>
        private void CollectBlocksFromUserGroup(PlcBlockUserGroup group, List<PlcBlock> blocks)
        {
            foreach (PlcBlock block in group.Blocks)
                blocks.Add(block);
            foreach (PlcBlockUserGroup subGroup in group.Groups)
                CollectBlocksFromUserGroup(subGroup, blocks);
        }

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

        // ────────────────────────────────────────────────────────
        //  HMI Export
        // ────────────────────────────────────────────────────────

        /// <summary>
        /// Find the HmiTarget (WinCC RT Advanced / Comfort) by searching all devices.
        /// </summary>
        public HmiTarget GetHmiTarget()
        {
            if (_project == null)
                throw new InvalidOperationException("No project open.");

            foreach (Device device in _project.Devices)
            {
                HmiTarget hmi = SearchHmiDeviceItems(device.DeviceItems);
                if (hmi != null)
                {
                    Console.WriteLine($"[TIA] Found HMI: {device.Name}");
                    return hmi;
                }
            }

            throw new InvalidOperationException("No HMI device found in project.");
        }

        private HmiTarget SearchHmiDeviceItems(DeviceItemComposition items)
        {
            foreach (DeviceItem item in items)
            {
                SoftwareContainer container =
                    ((IEngineeringServiceProvider)item).GetService<SoftwareContainer>();
                if (container?.Software is HmiTarget hmi)
                    return hmi;

                HmiTarget nested = SearchHmiDeviceItems(item.DeviceItems);
                if (nested != null)
                    return nested;
            }
            return null;
        }

        /// <summary>
        /// Import HMI screens, tag tables, text lists, and graphic lists from XML into TIA project.
        /// Uses Openness Import() API which accepts SimaticML XML files.
        /// </summary>
        public ImportHmiResponse ImportHmiArtifacts(ImportHmiRequest request)
        {
            if (!IsConnected || !IsProjectOpen)
                throw new InvalidOperationException("TIA Portal not connected or no project open.");

            HmiTarget hmiTarget = GetHmiTarget();
            var result = new ImportHmiResponse { Success = true };

            string tempDir = Path.Combine(Path.GetTempPath(), "PacForge",
                "hmi_import_" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(tempDir);

            try
            {
                // Import screens
                if (request.Screens != null)
                {
                    foreach (var kvp in request.Screens)
                    {
                        try
                        {
                            string filePath = Path.Combine(tempDir, kvp.Key + ".xml");
                            File.WriteAllText(filePath, kvp.Value);
                            hmiTarget.ScreenFolder.Screens.Import(new FileInfo(filePath), ImportOptions.Override);
                            result.ImportedScreens.Add(kvp.Key);
                            Console.WriteLine($"[TIA] Imported HMI screen: {kvp.Key}");
                        }
                        catch (Exception ex)
                        {
                            Console.WriteLine($"[TIA] Screen import failed for {kvp.Key}: {ex.Message}");
                            result.Warnings.Add($"Screen {kvp.Key}: {ex.Message}");
                        }
                    }
                }

                // Import tag tables
                if (request.TagTables != null)
                {
                    foreach (var kvp in request.TagTables)
                    {
                        try
                        {
                            string filePath = Path.Combine(tempDir, "tags_" + kvp.Key + ".xml");
                            File.WriteAllText(filePath, kvp.Value);
                            hmiTarget.TagFolder.TagTables.Import(new FileInfo(filePath), ImportOptions.Override);
                            result.ImportedTagTables.Add(kvp.Key);
                            Console.WriteLine($"[TIA] Imported HMI tag table: {kvp.Key}");
                        }
                        catch (Exception ex)
                        {
                            Console.WriteLine($"[TIA] Tag table import failed for {kvp.Key}: {ex.Message}");
                            result.Warnings.Add($"TagTable {kvp.Key}: {ex.Message}");
                        }
                    }
                }

                // Import text lists (via ScreenFolder — Openness routes by XML element type)
                if (request.TextLists != null)
                {
                    foreach (var kvp in request.TextLists)
                    {
                        try
                        {
                            string filePath = Path.Combine(tempDir, "tl_" + kvp.Key + ".xml");
                            File.WriteAllText(filePath, kvp.Value);
                            hmiTarget.ScreenFolder.Screens.Import(new FileInfo(filePath), ImportOptions.Override);
                            result.ImportedTextLists.Add(kvp.Key);
                            Console.WriteLine($"[TIA] Imported text list: {kvp.Key}");
                        }
                        catch (Exception ex)
                        {
                            Console.WriteLine($"[TIA] Text list import failed for {kvp.Key}: {ex.Message}");
                            result.Warnings.Add($"TextList {kvp.Key}: {ex.Message}");
                        }
                    }
                }

                // Import graphic lists (via ScreenFolder — Openness routes by XML element type)
                if (request.GraphicLists != null)
                {
                    foreach (var kvp in request.GraphicLists)
                    {
                        try
                        {
                            string filePath = Path.Combine(tempDir, "gl_" + kvp.Key + ".xml");
                            File.WriteAllText(filePath, kvp.Value);
                            hmiTarget.ScreenFolder.Screens.Import(new FileInfo(filePath), ImportOptions.Override);
                            result.ImportedGraphicLists.Add(kvp.Key);
                            Console.WriteLine($"[TIA] Imported graphic list: {kvp.Key}");
                        }
                        catch (Exception ex)
                        {
                            Console.WriteLine($"[TIA] Graphic list import failed for {kvp.Key}: {ex.Message}");
                            result.Warnings.Add($"GraphicList {kvp.Key}: {ex.Message}");
                        }
                    }
                }

                int total = result.ImportedScreens.Count + result.ImportedTagTables.Count +
                            result.ImportedTextLists.Count + result.ImportedGraphicLists.Count;
                result.Message = $"Imported {total} artifact(s): {result.ImportedScreens.Count} screen(s), " +
                                 $"{result.ImportedTagTables.Count} tag table(s), {result.ImportedTextLists.Count} text list(s), " +
                                 $"{result.ImportedGraphicLists.Count} graphic list(s)";
                Console.WriteLine($"[TIA] HMI import complete: {result.Message}");
            }
            finally
            {
                try { Directory.Delete(tempDir, true); } catch { }
            }

            return result;
        }

        /// <summary>
        /// Export all HMI screens as XML files.
        /// Returns screen name → XML content mapping.
        /// </summary>
        public ExportHmiResponse ExportHmiScreens()
        {
            if (!IsConnected || !IsProjectOpen)
                throw new InvalidOperationException("TIA Portal not connected or no project open.");

            HmiTarget hmiTarget = GetHmiTarget();
            var result = new ExportHmiResponse { Success = true };

            string tempDir = Path.Combine(Path.GetTempPath(), "PacForge",
                "hmi_export_" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(tempDir);

            try
            {
                // Export screens
                var allScreens = new List<Siemens.Engineering.Hmi.Screen.Screen>();
                CollectScreens(hmiTarget.ScreenFolder, allScreens);
                Console.WriteLine($"[TIA] Exporting {allScreens.Count} HMI screen(s)...");

                foreach (var screen in allScreens)
                {
                    try
                    {
                        string outputFile = Path.Combine(tempDir, screen.Name + ".xml");
                        screen.Export(new FileInfo(outputFile), ExportOptions.WithDefaults);

                        if (File.Exists(outputFile))
                        {
                            result.Screens[screen.Name] = File.ReadAllText(outputFile);
                            Console.WriteLine($"[TIA] Exported screen: {screen.Name}");
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"[TIA] Export skipped for screen {screen.Name}: {ex.Message}");
                        result.Warnings.Add($"{screen.Name}: {ex.Message}");
                    }
                }

                // Export HMI tag tables
                try
                {
                    foreach (var tagTable in hmiTarget.TagFolder.TagTables)
                    {
                        try
                        {
                            string tagFile = Path.Combine(tempDir, "tags_" + tagTable.Name + ".xml");
                            tagTable.Export(new FileInfo(tagFile), ExportOptions.WithDefaults);

                            if (File.Exists(tagFile))
                            {
                                result.TagTables[tagTable.Name] = File.ReadAllText(tagFile);
                                Console.WriteLine($"[TIA] Exported HMI tag table: {tagTable.Name}");
                            }
                        }
                        catch (Exception ex)
                        {
                            Console.WriteLine($"[TIA] Export skipped for tag table {tagTable.Name}: {ex.Message}");
                            result.Warnings.Add($"TagTable {tagTable.Name}: {ex.Message}");
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[TIA] Could not export HMI tag tables: {ex.Message}");
                    result.Warnings.Add($"HMI tag tables: {ex.Message}");
                }

                result.Message = $"Exported {result.Screens.Count} screen(s), {result.TagTables.Count} tag table(s)";
                Console.WriteLine($"[TIA] HMI export complete: {result.Screens.Count} screen(s), {result.TagTables.Count} tag table(s), {result.Warnings.Count} warning(s)");
            }
            finally
            {
                try { Directory.Delete(tempDir, true); } catch { }
            }

            return result;
        }

        /// <summary>
        /// Export all HMI graphics from the project.
        /// Enumerates all properties on HmiTarget via reflection to discover the graphics API path,
        /// then exports any found graphics as base64 data URIs.
        /// Logs full discovery details to the console for debugging.
        /// </summary>
        public ExportHmiGraphicsResponse ExportHmiGraphics(List<string> requestedNames = null)
        {
            if (!IsConnected || !IsProjectOpen)
                throw new InvalidOperationException("TIA Portal not connected or no project open.");

            var result = new ExportHmiGraphicsResponse { Success = true };

            var wantedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (requestedNames != null)
                foreach (var n in requestedNames)
                    if (!string.IsNullOrWhiteSpace(n)) wantedNames.Add(n.Trim());

            bool hasFilter = wantedNames.Count > 0;
            Console.WriteLine($"[TIA] Graphic export requested: {(hasFilter ? string.Join(", ", wantedNames) : "all")}");

            HmiTarget hmiTarget = GetHmiTarget();
            string tempDir = Path.Combine(Path.GetTempPath(), "PacForge",
                "hmi_graphics_" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(tempDir);

            try
            {
                int exported = 0;

                // === Step 1: Probe GraphicLists and their entries ===
                Console.WriteLine("[TIA] === Probing GraphicLists ===");
                var graphicLists = hmiTarget.GraphicLists;
                foreach (var gl in graphicLists)
                {
                    Console.WriteLine($"[TIA]   GraphicList: \"{gl.Name}\" (Type: {gl.GetType().FullName})");

                    // Dump all properties on this GraphicList
                    foreach (var prop in gl.GetType().GetProperties())
                    {
                        try
                        {
                            var val = prop.GetValue(gl);
                            bool isEnum = val is System.Collections.IEnumerable && !(val is string);
                            int count = -1;
                            if (isEnum) { count = 0; foreach (var _ in (System.Collections.IEnumerable)val) count++; }
                            string valStr = val == null ? "null" : val.GetType().Name;
                            Console.WriteLine($"[TIA]     {prop.Name} : {prop.PropertyType.Name} = {valStr}{(count >= 0 ? " [" + count + "]" : "")}");

                            // Walk into enumerable sub-items
                            if (isEnum && count > 0)
                            {
                                int idx = 0;
                                foreach (var entry in (System.Collections.IEnumerable)val)
                                {
                                    if (entry == null) continue;
                                    var entryType = entry.GetType();
                                    if (idx < 2) // Log first 2 entries in detail
                                    {
                                        Console.WriteLine($"[TIA]       Entry[{idx}]: {entryType.FullName}");
                                        foreach (var ep in entryType.GetProperties())
                                        {
                                            try
                                            {
                                                var ev = ep.GetValue(entry);
                                                string evStr;
                                                if (ev == null) evStr = "null";
                                                else if (ev is byte[] ba) evStr = $"byte[{ba.Length}]";
                                                else if (ev is string s) evStr = $"\"{(s.Length > 60 ? s.Substring(0, 60) + "..." : s)}\"";
                                                else evStr = ev.GetType().Name + ": " + ev.ToString();
                                                Console.WriteLine($"[TIA]         {ep.Name} : {ep.PropertyType.Name} = {evStr}");
                                            }
                                            catch { }
                                        }

                                        // Try GetAttribute on entry for graphic data
                                        var entryGetAttr = entryType.GetMethod("GetAttribute", new[] { typeof(string) });
                                        if (entryGetAttr != null)
                                        {
                                            foreach (var attrName in new[] { "Graphic", "Picture", "Image", "Bitmap", "GraphicName" })
                                            {
                                                try
                                                {
                                                    var av = entryGetAttr.Invoke(entry, new object[] { attrName });
                                                    if (av is byte[] bav)
                                                        Console.WriteLine($"[TIA]         GetAttribute(\"{attrName}\"): byte[{bav.Length}]");
                                                    else
                                                        Console.WriteLine($"[TIA]         GetAttribute(\"{attrName}\"): {(av == null ? "null" : av.GetType().Name + "=" + av)}");
                                                }
                                                catch (Exception ex)
                                                {
                                                    Console.WriteLine($"[TIA]         GetAttribute(\"{attrName}\"): {ex.InnerException?.Message ?? ex.Message}");
                                                }
                                            }
                                        }
                                    }
                                    idx++;

                                    // Try to export each entry
                                    var entryName = entryType.GetProperty("Name")?.GetValue(entry)?.ToString();
                                    if (!string.IsNullOrEmpty(entryName))
                                        exported += TryExportItem(entry, entryName, tempDir, result, wantedNames, hasFilter);
                                }
                            }
                        }
                        catch { }
                    }

                    // Try exporting the GraphicList itself
                    exported += TryExportItem(gl, gl.Name, tempDir, result, wantedNames, hasFilter);
                }

                // === Step 2: Probe ScreenGlobalElements (not enumerable, check its properties) ===
                Console.WriteLine("[TIA] === Probing ScreenGlobalElements ===");
                var sge = hmiTarget.ScreenGlobalElements;
                if (sge != null)
                {
                    foreach (var prop in sge.GetType().GetProperties())
                    {
                        try
                        {
                            var val = prop.GetValue(sge);
                            bool isEnum = val is System.Collections.IEnumerable && !(val is string);
                            int count = -1;
                            if (isEnum) { count = 0; foreach (var _ in (System.Collections.IEnumerable)val) count++; }
                            Console.WriteLine($"[TIA]   {prop.Name} : {prop.PropertyType.Name} = {(val == null ? "null" : val.GetType().Name)}{(count >= 0 ? " [" + count + "]" : "")}");

                            if (isEnum && count > 0)
                            {
                                int idx = 0;
                                foreach (var item in (System.Collections.IEnumerable)val)
                                {
                                    if (item == null) continue;
                                    var itemName = item.GetType().GetProperty("Name")?.GetValue(item)?.ToString() ?? $"item_{idx}";
                                    Console.WriteLine($"[TIA]     -> {item.GetType().Name}: \"{itemName}\"");
                                    exported += TryExportItem(item, itemName, tempDir, result, wantedNames, hasFilter);
                                    idx++;
                                    if (idx >= 5) { Console.WriteLine($"[TIA]     ... and more"); break; }
                                }
                            }
                        }
                        catch { }
                    }
                }

                // === Step 3: Probe Screens for embedded graphic objects ===
                Console.WriteLine("[TIA] === Probing Screen items for graphic elements ===");
                var screenFolder = hmiTarget.ScreenFolder;
                var screens = new List<Siemens.Engineering.Hmi.Screen.Screen>();
                CollectScreens(screenFolder, screens);
                foreach (var screen in screens)
                {
                    try
                    {
                        // Check if screen has ScreenItems with graphic references
                        var screenType = screen.GetType();
                        var screenItemsProp = screenType.GetProperty("ScreenItems");
                        if (screenItemsProp != null)
                        {
                            var screenItems = screenItemsProp.GetValue(screen) as System.Collections.IEnumerable;
                            if (screenItems != null)
                            {
                                foreach (var si in screenItems)
                                {
                                    if (si == null) continue;
                                    var siType = si.GetType();
                                    // Look for GraphicView items specifically
                                    if (siType.Name.Contains("Graphic") || siType.Name.Contains("Picture"))
                                    {
                                        var siName = siType.GetProperty("Name")?.GetValue(si)?.ToString() ?? "?";
                                        Console.WriteLine($"[TIA]   Screen \"{screen.Name}\" -> {siType.Name}: \"{siName}\"");

                                        // Dump all properties
                                        foreach (var p in siType.GetProperties())
                                        {
                                            try
                                            {
                                                var pv = p.GetValue(si);
                                                if (pv is byte[] ba)
                                                    Console.WriteLine($"[TIA]     {p.Name}: byte[{ba.Length}]");
                                                else if (pv != null)
                                                    Console.WriteLine($"[TIA]     {p.Name}: {pv.GetType().Name} = {pv}");
                                            }
                                            catch { }
                                        }

                                        // Try GetAttribute for the graphic name/data
                                        var getAttr = siType.GetMethod("GetAttribute", new[] { typeof(string) });
                                        if (getAttr != null)
                                        {
                                            foreach (var attr in new[] { "Graphic", "GraphicName", "Picture", "PictureName", "GraphicStrip", "GraphicReference" })
                                            {
                                                try
                                                {
                                                    var av = getAttr.Invoke(si, new object[] { attr });
                                                    if (av != null)
                                                        Console.WriteLine($"[TIA]     GetAttribute(\"{attr}\"): {(av is byte[] bx ? "byte[" + bx.Length + "]" : av.GetType().Name + "=" + av)}");
                                                }
                                                catch { }
                                            }
                                        }

                                        exported += TryExportItem(si, siName, tempDir, result, wantedNames, hasFilter);
                                    }
                                }
                            }
                        }
                    }
                    catch { }
                }

                // Log missing graphics
                if (hasFilter)
                {
                    foreach (var wanted in wantedNames)
                    {
                        if (!result.Graphics.ContainsKey(wanted))
                        {
                            Console.WriteLine($"[TIA]   NOT FOUND: {wanted}");
                            result.Warnings.Add($"Not found: {wanted}");
                        }
                    }
                }

                result.Message = exported > 0
                    ? $"Exported {result.Graphics.Count} graphic(s)"
                    : "No graphics found via Openness. Check bridge console for API discovery log.";
                Console.WriteLine($"[TIA] Graphics export complete: {result.Graphics.Count} exported, {result.Warnings.Count} warnings");
            }
            finally
            {
                try { Directory.Delete(tempDir, true); } catch { }
            }

            return result;
        }

        /// <summary>
        /// Try to export a single item as a graphic image file.
        /// Checks for Export method, GetAttribute("Graphic"), or byte[] properties.
        /// </summary>
        private int TryExportItem(object item, string name, string tempDir,
            ExportHmiGraphicsResponse result, HashSet<string> wantedNames, bool hasFilter)
        {
            if (item == null || string.IsNullOrEmpty(name)) return 0;
            if (result.Graphics.ContainsKey(name)) return 0; // Already exported

            // If filtering, skip items that don't match
            if (hasFilter && !wantedNames.Contains(name))
            {
                // Also try normalized match
                string normalized = name.Replace(" ", "_");
                bool match = false;
                foreach (var w in wantedNames)
                {
                    if (string.Equals(w.Replace(" ", "_"), normalized, StringComparison.OrdinalIgnoreCase))
                    { match = true; break; }
                }
                if (!match) return 0;
            }

            var itemType = item.GetType();

            // Method 1: Export(FileInfo, ExportOptions)
            try
            {
                var exportMethod = itemType.GetMethod("Export",
                    new[] { typeof(FileInfo), typeof(ExportOptions) });
                if (exportMethod != null)
                {
                    // Try multiple extensions — TIA may require matching format
                    foreach (var ext in new[] { ".png", ".bmp", ".jpg" })
                    {
                        string safeName = string.Join("_", name.Split(Path.GetInvalidFileNameChars()));
                        string outputFile = Path.Combine(tempDir, safeName + ext);
                        try
                        {
                            exportMethod.Invoke(item, new object[] { new FileInfo(outputFile), ExportOptions.WithDefaults });
                            if (File.Exists(outputFile) && new FileInfo(outputFile).Length > 0)
                            {
                                byte[] fileBytes = File.ReadAllBytes(outputFile);
                                string mime = DetectMimeType(fileBytes);
                                string base64 = Convert.ToBase64String(fileBytes);
                                result.Graphics[name] = $"data:{mime};base64,{base64}";
                                Console.WriteLine($"[TIA]   EXPORTED: {name} ({fileBytes.Length} bytes via Export{ext})");
                                return 1;
                            }
                        }
                        catch { }
                    }
                    Console.WriteLine($"[TIA]   Export method exists for {name} but produced no output");
                }
            }
            catch { }

            // Method 2: Look for byte[] or Stream properties that might contain image data
            try
            {
                foreach (var prop in itemType.GetProperties())
                {
                    if (prop.PropertyType == typeof(byte[]))
                    {
                        var data = prop.GetValue(item) as byte[];
                        if (data != null && data.Length > 100)
                        {
                            string mime = DetectMimeType(data);
                            string base64 = Convert.ToBase64String(data);
                            result.Graphics[name] = $"data:{mime};base64,{base64}";
                            Console.WriteLine($"[TIA]   EXPORTED: {name} ({data.Length} bytes via {prop.Name} byte[])");
                            return 1;
                        }
                    }
                }
            }
            catch { }

            // Method 3: GetAttribute("Graphic") or GetAttribute("Picture")
            try
            {
                var getAttr = itemType.GetMethod("GetAttribute", new[] { typeof(string) });
                if (getAttr != null)
                {
                    foreach (var attrName in new[] { "Graphic", "Picture", "Image", "Data", "BitmapData" })
                    {
                        try
                        {
                            var attrVal = getAttr.Invoke(item, new object[] { attrName });
                            if (attrVal is byte[] bytes && bytes.Length > 100)
                            {
                                string mime = DetectMimeType(bytes);
                                string base64 = Convert.ToBase64String(bytes);
                                result.Graphics[name] = $"data:{mime};base64,{base64}";
                                Console.WriteLine($"[TIA]   EXPORTED: {name} ({bytes.Length} bytes via GetAttribute(\"{attrName}\"))");
                                return 1;
                            }
                        }
                        catch { }
                    }
                }
            }
            catch { }

            return 0;
        }

        private static string DetectMimeType(byte[] bytes)
        {
            if (bytes.Length > 3 && bytes[0] == 0x89 && bytes[1] == 0x50)
                return "image/png";
            if (bytes.Length > 3 && bytes[0] == 0xFF && bytes[1] == 0xD8)
                return "image/jpeg";
            if (bytes.Length > 2 && bytes[0] == 0x42 && bytes[1] == 0x4D)
                return "image/bmp";
            if (bytes.Length > 4 && bytes[0] == 0x47 && bytes[1] == 0x49)
                return "image/gif";
            return "image/png";
        }

        private void CollectScreens(ScreenFolder folder, List<Siemens.Engineering.Hmi.Screen.Screen> screens)
        {
            foreach (var screen in folder.Screens)
            {
                screens.Add(screen);
            }
            foreach (var subFolder in folder.Folders)
            {
                CollectScreens(subFolder, screens);
            }
        }

        // ─── Unified HMI (V20) — reference export ──────────────────────────
#if !TIA_V18

        /// <summary>
        /// Find the first HmiSoftware (WinCC Unified) by searching all devices.
        /// Returns null when the open project has no Unified HMI device.
        /// </summary>
        public HmiSoftware GetHmiSoftware()
        {
            if (_project == null) return null;
            foreach (Device device in _project.Devices)
            {
                HmiSoftware hmi = SearchHmiSoftwareDeviceItems(device.DeviceItems);
                if (hmi != null) return hmi;
            }
            return null;
        }

        private HmiSoftware SearchHmiSoftwareDeviceItems(DeviceItemComposition items)
        {
            foreach (DeviceItem item in items)
            {
                SoftwareContainer container = item.GetService<SoftwareContainer>();
                if (container?.Software is HmiSoftware hmi)
                    return hmi;

                HmiSoftware nested = SearchHmiSoftwareDeviceItems(item.DeviceItems);
                if (nested != null) return nested;
            }
            return null;
        }

        /// <summary>
        /// Export wizard-run reference project data for Pac-Forge Phase 3 seeding.
        ///
        /// V20 Openness does NOT expose SimaticML export for Unified HmiScreen or HmiTagTable
        /// (only PlcType and HmiScriptModule have Export methods). So this endpoint:
        ///   - Exports all PLC types (UDTs) as SimaticML XML — real ground truth for the tag-mapping layer
        ///   - Enumerates Unified HMI screens + tag tables and dumps basic metadata (name, key attributes)
        ///     as JSON for reference — Pac-Forge uses this to understand Template Suite structure
        ///
        /// Pac-Forge's HMI generation path targets Openness API calls directly, not SimaticML round-trip.
        /// </summary>
        public ExportReferenceResponse ExportReferenceProject(string outputDir)
        {
            if (!IsConnected || !IsProjectOpen)
                throw new InvalidOperationException("TIA Portal not connected or no project open.");

            if (string.IsNullOrWhiteSpace(outputDir))
                throw new ArgumentException("outputDir is required", nameof(outputDir));

            var result = new ExportReferenceResponse { Success = true, OutputDir = outputDir };

            string screensDir = Path.Combine(outputDir, "screens");
            string udtsDir = Path.Combine(outputDir, "udts");
            string tagsDir = Path.Combine(outputDir, "tags");
            Directory.CreateDirectory(screensDir);
            Directory.CreateDirectory(udtsDir);
            Directory.CreateDirectory(tagsDir);

            // ─── Unified HMI — enumerate and dump metadata as JSON (recursive) ──
#if !TIA_V18
            HmiSoftware hmiSoftware = GetHmiSoftware();
            if (hmiSoftware == null)
            {
                result.Warnings.Add("No Unified HmiSoftware found in project — skipping HMI exports. Make sure the project has a WinCC Unified Comfort Panel.");
            }
            else
            {
                Console.WriteLine($"[TIA] Found Unified HmiSoftware: {hmiSoftware.Name}");

                // Recursively collect all screens across nested ScreenGroups
                var screensWithPaths = new List<(HmiScreen screen, string folderPath)>();
                CollectUnifiedScreens(hmiSoftware.Screens, hmiSoftware.ScreenGroups, "", screensWithPaths);
                Console.WriteLine($"[TIA] Enumerating {screensWithPaths.Count} Unified screen(s) across all groups...");

                foreach (var (screen, folderPath) in screensWithPaths)
                {
                    try
                    {
                        string safeName = SanitizeFileName(screen.Name);
                        string subDir = string.IsNullOrEmpty(folderPath)
                            ? screensDir
                            : Path.Combine(screensDir, folderPath);
                        Directory.CreateDirectory(subDir);
                        string outputFile = Path.Combine(subDir, safeName + ".json");
                        string json = SerializeHmiScreenToJson(screen);
                        File.WriteAllText(outputFile, json);

                        string displayPath = string.IsNullOrEmpty(folderPath) ? screen.Name : $"{folderPath}/{screen.Name}";
                        result.Screens.Add(displayPath);
                        Console.WriteLine($"[TIA]   screen: {displayPath}");
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"[TIA]   screen {screen.Name} skipped: {ex.Message}");
                        result.Warnings.Add($"screen {folderPath}/{screen.Name}: {ex.Message}");
                    }
                }

                // Recursively collect all tag tables across nested TagTableGroups
                var tagTablesWithPaths = new List<(HmiTagTable tagTable, string folderPath)>();
                CollectUnifiedTagTables(hmiSoftware.TagTables, hmiSoftware.TagTableGroups, "", tagTablesWithPaths);
                Console.WriteLine($"[TIA] Enumerating {tagTablesWithPaths.Count} Unified tag table(s) across all groups...");

                foreach (var (tagTable, folderPath) in tagTablesWithPaths)
                {
                    try
                    {
                        string safeName = SanitizeFileName(tagTable.Name);
                        string subDir = string.IsNullOrEmpty(folderPath)
                            ? tagsDir
                            : Path.Combine(tagsDir, folderPath);
                        Directory.CreateDirectory(subDir);
                        string outputFile = Path.Combine(subDir, safeName + ".json");
                        string json = SerializeHmiTagTableToJson(tagTable);
                        File.WriteAllText(outputFile, json);

                        string displayPath = string.IsNullOrEmpty(folderPath) ? tagTable.Name : $"{folderPath}/{tagTable.Name}";
                        result.TagTables.Add(displayPath);
                        Console.WriteLine($"[TIA]   tag table: {displayPath}");
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"[TIA]   tag table {tagTable.Name} skipped: {ex.Message}");
                        result.Warnings.Add($"tag table {folderPath}/{tagTable.Name}: {ex.Message}");
                    }
                }
            }
#else
            result.Warnings.Add("Unified HMI export not supported in V18 bridge — skipping HMI exports.");
#endif

            // ─── PLC UDTs — real SimaticML export, works via PlcType.Export ──
            PlcSoftware plcSoftware = GetPlcSoftware();
            if (plcSoftware == null)
            {
                result.Warnings.Add("No PlcSoftware found in project — skipping UDT exports.");
            }
            else
            {
                var allTypes = new List<PlcType>();
                CollectTypes(plcSoftware.TypeGroup, allTypes);
                Console.WriteLine($"[TIA] Exporting {allTypes.Count} UDT(s) as SimaticML...");

                foreach (PlcType type in allTypes)
                {
                    try
                    {
                        string safeName = SanitizeFileName(type.Name);
                        string outputFile = Path.Combine(udtsDir, safeName + ".xml");
                        type.Export(new FileInfo(outputFile), ExportOptions.WithDefaults);
                        if (File.Exists(outputFile))
                        {
                            result.Udts.Add(type.Name);
                            Console.WriteLine($"[TIA]   udt: {type.Name}");
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"[TIA]   udt {type.Name} skipped: {ex.Message}");
                        result.Warnings.Add($"udt {type.Name}: {ex.Message}");
                    }
                }
            }

            result.Message = $"Exported {result.Screens.Count} screen(s), {result.TagTables.Count} tag table(s), {result.Udts.Count} UDT(s)";
            Console.WriteLine($"[TIA] Reference export complete: {result.Message}");
            return result;
        }

        /// <summary>
        /// Recursively walk HmiSoftware's nested ScreenGroups, collecting every HmiScreen
        /// with its folder path (forward-slash separated, empty for root-level screens).
        /// </summary>
        private void CollectUnifiedScreens(
            HmiScreenComposition screens,
            HmiScreenGroupComposition groups,
            string currentPath,
            List<(HmiScreen, string)> result)
        {
            foreach (HmiScreen screen in screens)
            {
                result.Add((screen, currentPath));
            }
            foreach (HmiScreenGroup group in groups)
            {
                string subPath = string.IsNullOrEmpty(currentPath)
                    ? SanitizeFileName(group.Name)
                    : currentPath + "/" + SanitizeFileName(group.Name);
                CollectUnifiedScreens(group.Screens, group.Groups, subPath, result);
            }
        }

        /// <summary>
        /// Recursively walk HmiSoftware's nested TagTableGroups, collecting every HmiTagTable
        /// with its folder path.
        /// </summary>
        private void CollectUnifiedTagTables(
            HmiTagTableComposition tagTables,
            HmiTagTableGroupComposition groups,
            string currentPath,
            List<(HmiTagTable, string)> result)
        {
            foreach (HmiTagTable tagTable in tagTables)
            {
                result.Add((tagTable, currentPath));
            }
            foreach (HmiTagTableGroup group in groups)
            {
                string subPath = string.IsNullOrEmpty(currentPath)
                    ? SanitizeFileName(group.Name)
                    : currentPath + "/" + SanitizeFileName(group.Name);
                CollectUnifiedTagTables(group.TagTables, group.Groups, subPath, result);
            }
        }

        /// <summary>
        /// Serialize an HmiScreen to JSON using Openness attribute access.
        /// Dumps top-level screen properties + every ScreenItem (type, name, position, size, key attributes).
        /// Used for Pac-Forge Phase 3 reference capture — V20 Openness does not expose SimaticML export for Unified screens.
        /// </summary>
        private string SerializeHmiScreenToJson(HmiScreen screen)
        {
            var payload = new Dictionary<string, object>
            {
                ["name"] = screen.Name,
                ["displayName"] = screen.DisplayName?.ToString() ?? "",
                ["width"] = (long)screen.Width,
                ["height"] = (long)screen.Height,
                ["screenNumber"] = (int)screen.ScreenNumber,
                ["backColor"] = screen.BackColor.ToString(),
                ["alternateBackColor"] = screen.AlternateBackColor.ToString(),
                ["backgroundFillMode"] = screen.BackgroundFillMode.ToString(),
                ["horizontalAlignment"] = screen.HorizontalAlignment.ToString(),
                ["verticalAlignment"] = screen.VerticalAlignment.ToString(),
                ["enabled"] = screen.Enabled,
                ["items"] = SerializeScreenItems(screen.ScreenItems),
            };
            return Newtonsoft.Json.JsonConvert.SerializeObject(payload, Newtonsoft.Json.Formatting.Indented);
        }

        private List<Dictionary<string, object>> SerializeScreenItems(System.Collections.IEnumerable items)
        {
            var result = new List<Dictionary<string, object>>();
            foreach (var item in items)
            {
                try
                {
                    var obj = item as IEngineeringObject;
                    if (obj == null) continue;

                    var itemDict = new Dictionary<string, object>
                    {
                        ["type"] = item.GetType().FullName,
                        ["typeShort"] = item.GetType().Name,
                    };

                    // Dump all readable attributes via Openness introspection
                    try
                    {
                        var infos = obj.GetAttributeInfos();
                        var attrDict = new Dictionary<string, object>();
                        foreach (var info in infos)
                        {
                            if (!info.AccessMode.ToString().Contains("Read")) continue;
                            try
                            {
                                var value = obj.GetAttribute(info.Name);
                                attrDict[info.Name] = value?.ToString() ?? "";
                            }
                            catch { /* skip unreadable attrs */ }
                        }
                        itemDict["attributes"] = attrDict;
                    }
                    catch (Exception ex)
                    {
                        itemDict["attributeError"] = ex.Message;
                    }

                    result.Add(itemDict);
                }
                catch (Exception ex)
                {
                    result.Add(new Dictionary<string, object>
                    {
                        ["error"] = ex.Message,
                        ["type"] = item?.GetType().FullName ?? "null",
                    });
                }
            }
            return result;
        }

        /// <summary>
        /// Serialize an HmiTagTable to JSON — table name + list of tag names/types/addresses.
        /// </summary>
        private string SerializeHmiTagTableToJson(HmiTagTable tagTable)
        {
            var tags = new List<Dictionary<string, object>>();
            foreach (var tag in tagTable.Tags)
            {
                try
                {
                    var obj = tag as IEngineeringObject;
                    if (obj == null) continue;

                    var tagDict = new Dictionary<string, object>
                    {
                        ["type"] = tag.GetType().Name,
                    };

                    var infos = obj.GetAttributeInfos();
                    foreach (var info in infos)
                    {
                        if (!info.AccessMode.ToString().Contains("Read")) continue;
                        try
                        {
                            var value = obj.GetAttribute(info.Name);
                            tagDict[info.Name] = value?.ToString() ?? "";
                        }
                        catch { }
                    }
                    tags.Add(tagDict);
                }
                catch { /* skip bad tags */ }
            }

            var payload = new Dictionary<string, object>
            {
                ["name"] = tagTable.Name,
                ["tagCount"] = tags.Count,
                ["tags"] = tags,
            };
            return Newtonsoft.Json.JsonConvert.SerializeObject(payload, Newtonsoft.Json.Formatting.Indented);
        }

        private static string SanitizeFileName(string name)
        {
            var invalid = Path.GetInvalidFileNameChars();
            var sb = new StringBuilder(name.Length);
            foreach (char c in name)
                sb.Append(invalid.Contains(c) ? '_' : c);
            return sb.ToString();
        }

        // ─── Unified HMI screen creation (Phase 4) ─────────────────────────

        private static Dictionary<string, Type> _itemTypeCache;
        private static MethodInfo _createItemMethodDef;

        /// <summary>
        /// Build a case-insensitive map from HMI item type short name and full name
        /// to the corresponding .NET Type. Used for generic dispatch when creating items.
        /// </summary>
        private static Dictionary<string, Type> GetItemTypeCache()
        {
            if (_itemTypeCache != null) return _itemTypeCache;

            var dict = new Dictionary<string, Type>(StringComparer.OrdinalIgnoreCase);
            var baseType = typeof(HmiScreenItemBase);
            var asm = baseType.Assembly;
            foreach (var t in asm.GetExportedTypes())
            {
                if (t.IsAbstract) continue;
                if (!baseType.IsAssignableFrom(t)) continue;
                if (!dict.ContainsKey(t.Name)) dict[t.Name] = t;
                if (!dict.ContainsKey(t.FullName)) dict[t.FullName] = t;
            }
            _itemTypeCache = dict;
            Console.WriteLine($"[TIA] Built HmiScreenItem type cache: {dict.Count} entries covering {dict.Values.Distinct().Count()} concrete types");
            return dict;
        }

        /// <summary>
        /// Get the single-arg generic Create&lt;T&gt;(string) method definition on
        /// HmiScreenItemBaseComposition for later MakeGenericMethod() calls.
        /// </summary>
        private static MethodInfo GetCreateItemMethodDef()
        {
            if (_createItemMethodDef != null) return _createItemMethodDef;

            var compositionType = typeof(HmiScreenItemBaseComposition);
            foreach (var m in compositionType.GetMethods())
            {
                if (m.Name != "Create") continue;
                if (!m.IsGenericMethodDefinition) continue;
                var ps = m.GetParameters();
                if (ps.Length == 1 && ps[0].ParameterType == typeof(string))
                {
                    _createItemMethodDef = m;
                    return m;
                }
            }
            throw new InvalidOperationException("HmiScreenItemBaseComposition.Create<T>(string) not found on V20 Openness API.");
        }

        /// <summary>
        /// Create a Unified HMI screen from a Pac-Forge payload and apply all item attributes
        /// via generic Openness dispatch. No SimaticML involvement — pure API calls.
        /// </summary>
        public CreateUnifiedScreenResponse CreateUnifiedScreen(UnifiedScreenRequest req)
        {
            if (!IsConnected || !IsProjectOpen)
                throw new InvalidOperationException("TIA Portal not connected or no project open.");

            if (req == null || string.IsNullOrWhiteSpace(req.Name))
                throw new ArgumentException("Request must include a screen Name.", nameof(req));

            var result = new CreateUnifiedScreenResponse { Success = false, ScreenName = req.Name };

            HmiSoftware hmiSoftware = GetHmiSoftware();
            if (hmiSoftware == null)
            {
                result.Message = "No Unified HmiSoftware found in project. Project needs a WinCC Unified device.";
                return result;
            }

            try
            {
                // 1. Create the screen (in a specific folder if requested)
                HmiScreenComposition targetComposition = hmiSoftware.Screens;
                if (!string.IsNullOrWhiteSpace(req.FolderPath))
                {
                    targetComposition = ResolveScreenGroupFolder(hmiSoftware, req.FolderPath);
                }

                HmiScreen screen = targetComposition.Create(req.Name);
                Console.WriteLine($"[TIA] Created Unified screen: {req.Name}");

                // 2. Apply screen-level attributes
                var engineeringScreen = (IEngineeringObject)screen;
                TrySetAttribute(engineeringScreen, "Width", req.Width, result.Warnings, req.Name);
                TrySetAttribute(engineeringScreen, "Height", req.Height, result.Warnings, req.Name);
                if (!string.IsNullOrEmpty(req.BackColor))
                    TrySetAttribute(engineeringScreen, "BackColor", req.BackColor, result.Warnings, req.Name);
                if (req.ScreenNumber.HasValue)
                    TrySetAttribute(engineeringScreen, "ScreenNumber", req.ScreenNumber.Value, result.Warnings, req.Name);

                // 3. Create each screen item via generic dispatch
                var typeCache = GetItemTypeCache();
                var createMethodDef = GetCreateItemMethodDef();

                foreach (var itemReq in req.Items ?? new List<UnifiedScreenItemRequest>())
                {
                    try
                    {
                        if (string.IsNullOrWhiteSpace(itemReq.Type) || string.IsNullOrWhiteSpace(itemReq.Name))
                        {
                            result.Warnings.Add($"Item skipped: missing type or name ({itemReq.Type}/{itemReq.Name})");
                            continue;
                        }

                        if (!typeCache.TryGetValue(itemReq.Type, out Type itemType))
                        {
                            result.Warnings.Add($"Item {itemReq.Name}: unknown type '{itemReq.Type}' (not an HmiScreenItemBase subclass)");
                            continue;
                        }

                        var genericCreate = createMethodDef.MakeGenericMethod(itemType);
                        object createdItem = genericCreate.Invoke(screen.ScreenItems, new object[] { itemReq.Name });
                        var engineeringItem = (IEngineeringObject)createdItem;

                        // Apply each simple attribute on the created item
                        foreach (var kv in itemReq.Attributes ?? new Dictionary<string, object>())
                        {
                            TrySetAttribute(engineeringItem, kv.Key, kv.Value, result.Warnings, $"{itemReq.Name}");
                        }

                        // Apply composite properties (MultilingualText, Font/Padding/Corners parts)
                        if (itemReq.Text != null)
                            TrySetMultilingualText(engineeringItem, "Text", itemReq.Text, result.Warnings, itemReq.Name);
                        if (itemReq.ToolTip != null)
                            TrySetMultilingualText(engineeringItem, "ToolTipText", itemReq.ToolTip, result.Warnings, itemReq.Name);
                        if (itemReq.Font != null)
                            TrySetCompositePart(engineeringItem, "Font", itemReq.Font, FontPropertyMap, result.Warnings, itemReq.Name);
                        if (itemReq.Padding != null)
                            TrySetCompositePart(engineeringItem, "Padding", itemReq.Padding, PaddingPropertyMap, result.Warnings, itemReq.Name);
                        if (itemReq.Corners != null)
                            TrySetCompositePart(engineeringItem, "Corners", itemReq.Corners, CornersPropertyMap, result.Warnings, itemReq.Name);

                        result.ItemsCreated++;
                    }
                    catch (Exception ex)
                    {
                        string inner = ex.InnerException?.Message ?? ex.Message;
                        Console.WriteLine($"[TIA]   item {itemReq.Name} ({itemReq.Type}) failed: {inner}");
                        result.Warnings.Add($"{itemReq.Name} ({itemReq.Type}): {inner}");
                    }
                }

                result.Success = true;
                result.Message = $"Created screen '{req.Name}' with {result.ItemsCreated} item(s)";
                Console.WriteLine($"[TIA] {result.Message}");
            }
            catch (Exception ex)
            {
                result.Message = $"Failed to create screen: {ex.Message}";
                Console.WriteLine($"[TIA] {result.Message}");
            }

            return result;
        }

        /// <summary>
        /// Walk the forward-slash separated folder path, creating missing HmiScreenGroups as needed,
        /// and return the HmiScreenComposition that new screens should be created under.
        /// </summary>
        private HmiScreenComposition ResolveScreenGroupFolder(HmiSoftware hmiSoftware, string folderPath)
        {
            var segments = folderPath.Split(new[] { '/', '\\' }, StringSplitOptions.RemoveEmptyEntries);
            if (segments.Length == 0) return hmiSoftware.Screens;

            HmiScreenGroupComposition currentGroups = hmiSoftware.ScreenGroups;
            HmiScreenGroup currentGroup = null;

            foreach (var segment in segments)
            {
                currentGroup = currentGroups.Find(segment) ?? currentGroups.Create(segment);
                currentGroups = currentGroup.Groups;
            }

            return currentGroup.Screens;
        }

#endif // !TIA_V18

        /// <summary>
        /// Try to set an Openness attribute, coercing the value to the target property's
        /// actual .NET type via reflection. JSON deserialization gives us long/double/string
        /// for everything; Openness expects UInt32, UInt16, Color, enum values, etc.
        /// Errors are collected as warnings so one bad attribute doesn't abort the whole item.
        /// </summary>
        private void TrySetAttribute(
            IEngineeringObject obj,
            string name,
            object value,
            List<string> warnings,
            string context)
        {
            if (obj == null || string.IsNullOrEmpty(name)) return;

            try
            {
                PropertyInfo pi = obj.GetType().GetProperty(name);
                object coerced;
                if (pi != null)
                {
                    coerced = CoerceToType(value, pi.PropertyType);
                }
                else
                {
                    coerced = value;
                }

                obj.SetAttribute(name, coerced);
            }
            catch (Exception ex)
            {
                string inner = ex.InnerException?.Message ?? ex.Message;
                warnings.Add($"{context}.{name}: {inner}");
            }
        }

        /// <summary>
        /// Convert a JSON-origin value (long/double/string/bool) to the specific .NET type
        /// that Openness expects for a property. Handles nullable wrappers, numeric integer
        /// variants (Int16/Int32/Int64, UInt16/UInt32/UInt64, Byte/SByte), enums, and
        /// System.Drawing.Color (parsed from "Color [A=x, R=y, G=z, B=w]" or "#RRGGBB").
        /// </summary>
        private static object CoerceToType(object value, Type targetType)
        {
            if (value == null) return null;

            // Unwrap Nullable<T>
            Type underlying = Nullable.GetUnderlyingType(targetType) ?? targetType;

            // Already the right type
            if (underlying.IsInstanceOfType(value)) return value;

            // Numeric conversions (JSON always gives us long/double for numbers)
            if (underlying == typeof(Int32))  return Convert.ToInt32(value);
            if (underlying == typeof(UInt32)) return Convert.ToUInt32(value);
            if (underlying == typeof(Int16))  return Convert.ToInt16(value);
            if (underlying == typeof(UInt16)) return Convert.ToUInt16(value);
            if (underlying == typeof(Int64))  return Convert.ToInt64(value);
            if (underlying == typeof(UInt64)) return Convert.ToUInt64(value);
            if (underlying == typeof(Byte))   return Convert.ToByte(value);
            if (underlying == typeof(SByte))  return Convert.ToSByte(value);
            if (underlying == typeof(Double)) return Convert.ToDouble(value);
            if (underlying == typeof(Single)) return Convert.ToSingle(value);
            if (underlying == typeof(Decimal)) return Convert.ToDecimal(value);
            if (underlying == typeof(Boolean)) return Convert.ToBoolean(value);
            if (underlying == typeof(String))  return Convert.ToString(value);

            // Enum: "Solid" -> HmiFillPattern.Solid
            if (underlying.IsEnum)
            {
                string s = value.ToString();
                return Enum.Parse(underlying, s, ignoreCase: true);
            }

            // System.Drawing.Color: parse "Color [A=255, R=72, G=73, B=78]" or "#RRGGBB" or named
            if (underlying == typeof(Color))
            {
                if (value is string cs) return ParseColor(cs);
            }

            // Fallback: pass through and hope Openness figures it out
            return value;
        }

        private static readonly Regex _colorArgbFormat =
            new Regex(@"A=(\d+)[, ]+R=(\d+)[, ]+G=(\d+)[, ]+B=(\d+)", RegexOptions.IgnoreCase);

        /// <summary>
        /// Parse a colour string into System.Drawing.Color. Supports three forms:
        ///   1. "Color [A=255, R=72, G=73, B=78]"  (Siemens ToString() format)
        ///   2. "#RRGGBB" or "#AARRGGBB"
        ///   3. Named colours like "White", "Red", "Basic 40" (Basic/Accent palette tokens fall through to Black for now)
        /// </summary>
        private static Color ParseColor(string input)
        {
            if (string.IsNullOrWhiteSpace(input)) return Color.Transparent;

            var m = _colorArgbFormat.Match(input);
            if (m.Success)
            {
                int a = int.Parse(m.Groups[1].Value);
                int r = int.Parse(m.Groups[2].Value);
                int g = int.Parse(m.Groups[3].Value);
                int b = int.Parse(m.Groups[4].Value);
                return Color.FromArgb(a, r, g, b);
            }

            if (input.StartsWith("#"))
            {
                string hex = input.Substring(1);
                if (hex.Length == 6)
                {
                    int rgb = int.Parse(hex, System.Globalization.NumberStyles.HexNumber);
                    return Color.FromArgb(255, (rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF);
                }
                if (hex.Length == 8)
                {
                    uint argb = uint.Parse(hex, System.Globalization.NumberStyles.HexNumber);
                    return Color.FromArgb((int)((argb >> 24) & 0xFF), (int)((argb >> 16) & 0xFF), (int)((argb >> 8) & 0xFF), (int)(argb & 0xFF));
                }
            }

            // Named colours (System.Drawing known colours)
            Color named = Color.FromName(input);
            if (named.ToArgb() != 0 || input.Equals("Transparent", StringComparison.OrdinalIgnoreCase))
                return named;

            // Palette tokens like "Basic 40", "Accent 1": resolve to Black for now.
            // TODO: wire to a theme-aware palette resolver once we parse .cd20 Corporate Design files.
            return Color.Black;
        }

        // ─── Phase 4.3: composite property helpers ──────────────────────────

        /// <summary>
        /// Property name map for the Font payload field -> HmiFontPart property.
        /// Maps camelCase / shorthand names to the actual Openness attribute names.
        /// </summary>
        private static readonly Dictionary<string, string> FontPropertyMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "size", "Size" },
            { "name", "Name" },
            { "family", "Name" },    // alias
            { "weight", "Weight" },
            { "italic", "Italic" },
            { "underline", "Underline" },
            { "strikeOut", "StrikeOut" },
        };

        private static readonly Dictionary<string, string> PaddingPropertyMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "left", "Left" },
            { "top", "Top" },
            { "right", "Right" },
            { "bottom", "Bottom" },
        };

        private static readonly Dictionary<string, string> CornersPropertyMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "topLeft", "TopLeftRadius" },
            { "topRight", "TopRightRadius" },
            { "bottomLeft", "BottomLeftRadius" },
            { "bottomRight", "BottomRightRadius" },
            // "radius" is expanded to all four in TrySetCompositePart
        };

        /// <summary>
        /// Set a MultilingualText property on an item using the Siemens-canonical Language-object lookup path:
        ///   project.LanguageSettings.Languages.Find(cultureInfo)  -> Language
        ///   multiText.Items.Find(language)                         -> MultilingualTextItem
        ///   item.Text = "..."                                      -> direct property setter
        ///
        /// Accepts either a plain string (applied to the project's EditingLanguage) or a
        /// Dictionary&lt;string, string&gt; of culture -> text for multi-language content.
        /// </summary>
        private void TrySetMultilingualText(
            IEngineeringObject item,
            string propertyName,
            object value,
            List<string> warnings,
            string context)
        {
            if (item == null || value == null) return;

            try
            {
                PropertyInfo pi = item.GetType().GetProperty(propertyName);
                if (pi == null)
                {
                    warnings.Add($"{context}.{propertyName}: property not found on {item.GetType().Name}");
                    return;
                }
                object mtObj = pi.GetValue(item);
                if (mtObj == null)
                {
                    warnings.Add($"{context}.{propertyName}: MultilingualText getter returned null");
                    return;
                }

                // Get the Items composition once
                PropertyInfo itemsProp = mtObj.GetType().GetProperty("Items");
                if (itemsProp == null)
                {
                    warnings.Add($"{context}.{propertyName}: MultilingualText has no Items composition");
                    return;
                }
                object itemsComposition = itemsProp.GetValue(mtObj);
                if (itemsComposition == null)
                {
                    warnings.Add($"{context}.{propertyName}: Items composition is null");
                    return;
                }

                // Get Project.LanguageSettings for Language object resolution
                var languageSettings = _project?.LanguageSettings;
                if (languageSettings == null)
                {
                    warnings.Add($"{context}.{propertyName}: project LanguageSettings unavailable");
                    return;
                }
                var projectLanguages = languageSettings.Languages;
                var editingLanguage = languageSettings.EditingLanguage;

                var textMap = CoerceToTextMap(value);
                int itemsUpdated = 0;

                // Resolve and write each (culture, text) entry via Find(Language)
                foreach (var kv in textMap)
                {
                    object targetLanguage = null;

                    if (kv.Key == "*")
                    {
                        // Single-string payload → use project's EditingLanguage
                        targetLanguage = editingLanguage;
                    }
                    else
                    {
                        // Culture-specific payload → look up the Language by CultureInfo
                        try
                        {
                            var culture = new System.Globalization.CultureInfo(kv.Key);
                            targetLanguage = projectLanguages.Find(culture);
                        }
                        catch
                        {
                            warnings.Add($"{context}.{propertyName}: invalid culture '{kv.Key}'");
                            continue;
                        }
                    }

                    if (targetLanguage == null)
                    {
                        warnings.Add($"{context}.{propertyName}[{kv.Key}]: language not present in project");
                        continue;
                    }

                    // Find(Language) on the Items composition
                    MethodInfo findMethod = itemsComposition.GetType().GetMethod(
                        "Find",
                        new Type[] { targetLanguage.GetType() });
                    if (findMethod == null)
                    {
                        warnings.Add($"{context}.{propertyName}[{kv.Key}]: Find(Language) method not found");
                        continue;
                    }

                    object mtItem = findMethod.Invoke(itemsComposition, new object[] { targetLanguage });
                    if (mtItem == null)
                    {
                        warnings.Add($"{context}.{propertyName}[{kv.Key}]: no MultilingualTextItem for this language");
                        continue;
                    }

                    // Siemens Unified MultilingualText requires values wrapped in <body><p>...</p></body>
                    // Discovered via diagnostic dump of live items: default value is literally "<body><p>Text</p></body>".
                    // Plain strings are rejected as "invalid format". XML-escape user content before wrapping.
                    string wrapped = WrapMultilingualText(kv.Value);

                    try
                    {
                        PropertyInfo textProp = mtItem.GetType().GetProperty("Text");
                        if (textProp != null && textProp.CanWrite)
                        {
                            textProp.SetValue(mtItem, wrapped);
                            itemsUpdated++;
                        }
                        else
                        {
                            warnings.Add($"{context}.{propertyName}[{kv.Key}]: Text property not writable");
                        }
                    }
                    catch (Exception ex)
                    {
                        warnings.Add($"{context}.{propertyName}[{kv.Key}]: {ex.InnerException?.Message ?? ex.Message}");
                    }
                }

                if (itemsUpdated == 0)
                {
                    warnings.Add($"{context}.{propertyName}: no MultilingualText items updated");
                }
            }
            catch (Exception ex)
            {
                warnings.Add($"{context}.{propertyName}: {ex.InnerException?.Message ?? ex.Message}");
            }
        }

        /// <summary>
        /// Wrap a plain text string in the Siemens Unified MultilingualText body/paragraph XML format.
        /// Live diagnostic exports showed the canonical format is &lt;body&gt;&lt;p&gt;TEXT&lt;/p&gt;&lt;/body&gt;
        /// with XML-escaped content. Plain strings (or HTML with &lt;span&gt; wrappers) are rejected by the setter.
        /// If the caller already provides a &lt;body&gt; wrapper, pass through unchanged.
        /// </summary>
        private static string WrapMultilingualText(string plainText)
        {
            if (string.IsNullOrEmpty(plainText)) return "<body><p></p></body>";

            // Pass-through if caller already wrapped it
            if (plainText.StartsWith("<body>", StringComparison.OrdinalIgnoreCase))
                return plainText;

            // XML-escape and wrap
            string escaped = plainText
                .Replace("&", "&amp;")
                .Replace("<", "&lt;")
                .Replace(">", "&gt;");
            return $"<body><p>{escaped}</p></body>";
        }

        /// <summary>
        /// Convert a payload Text value (string or Dictionary) into a culture-keyed map.
        /// Plain strings become { "*" -> value } which TrySetMultilingualText applies to all items.
        /// </summary>
        private static Dictionary<string, string> CoerceToTextMap(object value)
        {
            var map = new Dictionary<string, string>();
            if (value is string plain)
            {
                map["*"] = plain;
                return map;
            }
            if (value is JValue jv)
            {
                map["*"] = jv.ToString();
                return map;
            }
            if (value is JObject jo)
            {
                foreach (var prop in jo.Properties())
                {
                    map[prop.Name] = prop.Value?.ToString() ?? "";
                }
                return map;
            }
            if (value is IDictionary<string, object> dict)
            {
                foreach (var kv in dict)
                {
                    map[kv.Key] = kv.Value?.ToString() ?? "";
                }
                return map;
            }
            map["*"] = value.ToString();
            return map;
        }

        /// <summary>
        /// Set sub-properties on a read-only "Part" composite object (Font, Padding, Corners, etc.).
        /// Retrieves the existing Part instance via reflection and calls SetAttribute on each
        /// mapped sub-property. Supports a "radius" shorthand for corners that expands to all four.
        /// </summary>
        private void TrySetCompositePart(
            IEngineeringObject item,
            string partPropertyName,
            Dictionary<string, object> payload,
            Dictionary<string, string> propertyMap,
            List<string> warnings,
            string context)
        {
            if (item == null || payload == null || payload.Count == 0) return;

            try
            {
                PropertyInfo pi = item.GetType().GetProperty(partPropertyName);
                if (pi == null)
                {
                    warnings.Add($"{context}.{partPropertyName}: property not found on {item.GetType().Name}");
                    return;
                }
                object partObj = pi.GetValue(item);
                if (partObj == null)
                {
                    warnings.Add($"{context}.{partPropertyName}: Part getter returned null");
                    return;
                }
                var partEng = partObj as IEngineeringObject;
                if (partEng == null)
                {
                    warnings.Add($"{context}.{partPropertyName}: Part does not implement IEngineeringObject");
                    return;
                }

                // Expand "radius" shorthand for corners (applies to all four radii)
                var expanded = new Dictionary<string, object>(payload, StringComparer.OrdinalIgnoreCase);
                if (partPropertyName == "Corners" && expanded.TryGetValue("radius", out object radiusVal))
                {
                    expanded.Remove("radius");
                    if (!expanded.ContainsKey("topLeft")) expanded["topLeft"] = radiusVal;
                    if (!expanded.ContainsKey("topRight")) expanded["topRight"] = radiusVal;
                    if (!expanded.ContainsKey("bottomLeft")) expanded["bottomLeft"] = radiusVal;
                    if (!expanded.ContainsKey("bottomRight")) expanded["bottomRight"] = radiusVal;
                }

                // Font.bold shorthand → Weight=Bold/Normal
                if (partPropertyName == "Font" && expanded.TryGetValue("bold", out object boldVal))
                {
                    expanded.Remove("bold");
                    bool isBold = Convert.ToBoolean(boldVal);
                    if (!expanded.ContainsKey("weight"))
                        expanded["weight"] = isBold ? "Bold" : "Normal";
                }

                foreach (var kv in expanded)
                {
                    if (!propertyMap.TryGetValue(kv.Key, out string realName))
                    {
                        warnings.Add($"{context}.{partPropertyName}.{kv.Key}: unknown sub-property");
                        continue;
                    }
                    TrySetAttribute(partEng, realName, kv.Value, warnings, $"{context}.{partPropertyName}");
                }
            }
            catch (Exception ex)
            {
                warnings.Add($"{context}.{partPropertyName}: {ex.InnerException?.Message ?? ex.Message}");
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

        // =============================================
        // LIBRARY SUPPORT
        // =============================================

        /// <summary>
        /// Open a global library file (.al18 etc.) and enumerate its contents.
        /// Returns library metadata including type folders, master copies, and type info.
        /// </summary>
        public LibraryContentsResponse OpenAndReadLibrary(string libraryPath)
        {
            if (!IsConnected)
                throw new InvalidOperationException("TIA Portal not connected.");

            if (!File.Exists(libraryPath))
                throw new FileNotFoundException($"Library file not found: {libraryPath}");

            Console.WriteLine($"[TIA] Opening global library: {libraryPath}");
            var result = new LibraryContentsResponse { Success = true };

            bool weOpened = false;
            GlobalLibrary library = null;
            try
            {
                // Check if this library is already open in TIA Portal
                var fileInfo = new FileInfo(libraryPath);
                Console.WriteLine($"[TIA] Looking for library: {fileInfo.FullName}");
                Console.WriteLine($"[TIA] Open libraries: {_tiaPortal.GlobalLibraries.Count}");

                // Extract the expected library name from the filename (strip extension + "Open Library V18 " prefix variations)
                string expectedName = Path.GetFileNameWithoutExtension(libraryPath);

                foreach (var openLib in _tiaPortal.GlobalLibraries)
                {
                    try
                    {
                        var openPath = openLib.Path?.FullName ?? "(no path)";
                        Console.WriteLine($"[TIA]   Open lib: '{openLib.Name}' at '{openPath}'");

                        // Match by: exact path, filename, or library name
                        bool pathMatch = openLib.Path != null && (
                            string.Equals(openLib.Path.FullName, fileInfo.FullName, StringComparison.OrdinalIgnoreCase) ||
                            string.Equals(openLib.Path.Name, fileInfo.Name, StringComparison.OrdinalIgnoreCase));
                        bool nameMatch = string.Equals(openLib.Name, expectedName, StringComparison.OrdinalIgnoreCase);

                        if (pathMatch || nameMatch)
                        {
                            library = openLib;
                            Console.WriteLine($"[TIA] Library already open: {openLib.Name} (matched by {(pathMatch ? "path" : "name")})");
                            break;
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"[TIA]   Error checking open lib: {ex.Message}");
                    }
                }

                // If not already open, try to open it
                if (library == null)
                {
                    try
                    {
                        library = _tiaPortal.GlobalLibraries.Open(fileInfo, OpenMode.ReadOnly);
                        weOpened = true;
                        Console.WriteLine($"[TIA] Library opened: {library.Name}");
                    }
                    catch
                    {
                        // If ReadOnly fails, try ReadWrite
                        library = _tiaPortal.GlobalLibraries.Open(fileInfo, OpenMode.ReadWrite);
                        weOpened = true;
                        Console.WriteLine($"[TIA] Library opened (read-write): {library.Name}");
                    }
                }

                result.LibraryName = library.Name;
                result.LibraryPath = libraryPath;

                // Enumerate type folder (library types = reusable screen templates, faceplates, FBs)
                EnumerateTypeFolder(library.TypeFolder, "", result.Types);

                // Enumerate master copies folder
                EnumerateMasterCopyFolder(library.MasterCopyFolder, "", result.MasterCopies);

                result.Message = $"Library '{library.Name}': {result.Types.Count} type(s), {result.MasterCopies.Count} master copy/copies";
                Console.WriteLine($"[TIA] {result.Message}");
            }
            finally
            {
                // Only close if we opened it (don't close user's already-open library)
                if (weOpened && library != null)
                {
                    try { ((UserGlobalLibrary)library).Close(); } catch { }
                    Console.WriteLine("[TIA] Library closed.");
                }
            }

            return result;
        }

        private void EnumerateTypeFolder(LibraryTypeFolder folder, string path, List<LibraryItemInfo> items)
        {
            foreach (var typeItem in folder.Types)
            {
                string fullPath = string.IsNullOrEmpty(path) ? typeItem.Name : path + "/" + typeItem.Name;
                string typeKind = "Unknown";
                try
                {
                    typeKind = typeItem.GetType().Name;
                }
                catch { }

                items.Add(new LibraryItemInfo
                {
                    Name = typeItem.Name,
                    Path = fullPath,
                    Kind = typeKind,
                    Guid = typeItem.Guid.ToString()
                });
                Console.WriteLine($"[TIA]   Type: {fullPath} ({typeKind})");
            }

            foreach (var subFolder in folder.Folders)
            {
                string subPath = string.IsNullOrEmpty(path) ? subFolder.Name : path + "/" + subFolder.Name;
                Console.WriteLine($"[TIA]   Folder: {subPath}");
                EnumerateTypeFolder(subFolder, subPath, items);
            }
        }

        private void EnumerateMasterCopyFolder(MasterCopyFolder folder, string path, List<LibraryItemInfo> items)
        {
            foreach (var masterCopy in folder.MasterCopies)
            {
                string fullPath = string.IsNullOrEmpty(path) ? masterCopy.Name : path + "/" + masterCopy.Name;

                // Describe contents of the master copy
                string contentInfo = "";
                try
                {
                    var descriptions = masterCopy.ContentDescriptions;
                    if (descriptions.Count > 0)
                    {
                        var parts = new List<string>();
                        foreach (var desc in descriptions)
                        {
                            parts.Add(desc.ContentName + " (" + desc.ContentType.Name + ")");
                        }
                        contentInfo = string.Join(", ", parts);
                    }
                }
                catch { }

                items.Add(new LibraryItemInfo
                {
                    Name = masterCopy.Name,
                    Path = fullPath,
                    Kind = "MasterCopy",
                    Description = contentInfo
                });
                Console.WriteLine($"[TIA]   MasterCopy: {fullPath}");
            }

            foreach (var subFolder in folder.Folders)
            {
                string subPath = string.IsNullOrEmpty(path) ? subFolder.Name : path + "/" + subFolder.Name;
                Console.WriteLine($"[TIA]   MasterCopy Folder: {subPath}");
                EnumerateMasterCopyFolder(subFolder, subPath, items);
            }
        }

        /// <summary>
        /// Export library types/master copies as XML to a temp directory.
        /// Tries to export each item and returns the XML content.
        /// </summary>
        public LibraryExportResponse ExportLibraryItems(string libraryPath, List<string> itemPaths)
        {
            if (!IsConnected)
                throw new InvalidOperationException("TIA Portal not connected.");

            if (!File.Exists(libraryPath))
                throw new FileNotFoundException($"Library file not found: {libraryPath}");

            var result = new LibraryExportResponse { Success = true };
            string tempDir = Path.Combine(Path.GetTempPath(), "PacForge",
                "lib_export_" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(tempDir);

            bool weOpened = false;
            GlobalLibrary library = null;
            try
            {
                // Check if already open (match by path, filename, or library name)
                var fileInfo = new FileInfo(libraryPath);
                string expectedName = Path.GetFileNameWithoutExtension(libraryPath);
                foreach (var openLib in _tiaPortal.GlobalLibraries)
                {
                    try
                    {
                        bool pathMatch = openLib.Path != null && (
                            string.Equals(openLib.Path.FullName, fileInfo.FullName, StringComparison.OrdinalIgnoreCase) ||
                            string.Equals(openLib.Path.Name, fileInfo.Name, StringComparison.OrdinalIgnoreCase));
                        bool nameMatch = string.Equals(openLib.Name, expectedName, StringComparison.OrdinalIgnoreCase);
                        if (pathMatch || nameMatch)
                        {
                            library = openLib;
                            Console.WriteLine($"[TIA] Export: using already-open library '{openLib.Name}'");
                            break;
                        }
                    }
                    catch { }
                }

                if (library == null)
                {
                    library = _tiaPortal.GlobalLibraries.Open(fileInfo, OpenMode.ReadOnly);
                    weOpened = true;
                }

                var wantedPaths = new HashSet<string>(itemPaths ?? new List<string>(), StringComparer.OrdinalIgnoreCase);
                bool exportAll = wantedPaths.Count == 0;

                // Try to export library types
                ExportTypesFromFolder(library.TypeFolder, "", tempDir, wantedPaths, exportAll, result);

                // Try to export master copies
                ExportMasterCopiesFromFolder(library.MasterCopyFolder, "", tempDir, wantedPaths, exportAll, result);

                result.Message = $"Exported {result.Items.Count} item(s) from library '{library.Name}'";
                Console.WriteLine($"[TIA] {result.Message}");
            }
            finally
            {
                if (weOpened && library != null)
                {
                    try { ((UserGlobalLibrary)library).Close(); } catch { }
                }
                try { Directory.Delete(tempDir, true); } catch { }
            }

            return result;
        }

        /// <summary>
        /// Copy master copies and/or library types from a global library into the open project.
        /// Master copies are pasted into the PLC block group; types into the PLC type group.
        /// Blocks that already exist in the project are skipped (logged as SkippedBlocks).
        /// </summary>
        public LibraryCopyToProjectResponse CopyLibraryItemsToProject(
            string libraryPath, List<string> masterCopyPaths, List<string> typePaths)
        {
            // libraryPath may be a folder — find the .al* file inside it (search subdirectories too)
            string resolvedLibPath = libraryPath;
            if (Directory.Exists(libraryPath))
            {
                var alFiles = Directory.GetFiles(libraryPath, "*.al*", SearchOption.AllDirectories);
                // Filter to actual TIA library files (.al17, .al18, .al19, .al20, etc.)
                var tiaLibFiles = alFiles.Where(f => System.Text.RegularExpressions.Regex.IsMatch(
                    Path.GetExtension(f), @"\.al\d+$", System.Text.RegularExpressions.RegexOptions.IgnoreCase)).ToArray();
                if (tiaLibFiles.Length > 0)
                {
                    resolvedLibPath = tiaLibFiles[0];
                    Console.WriteLine($"[TIA] Resolved library folder to file: {resolvedLibPath}");
                }
                else
                {
                    throw new FileNotFoundException($"No .al* library file found in folder: {libraryPath}");
                }
            }
            else if (!File.Exists(libraryPath))
            {
                // Path doesn't exist as file or folder — try searching parent directory for a matching subfolder
                string parentDir = Path.GetDirectoryName(libraryPath);
                string searchName = Path.GetFileName(libraryPath);
                if (parentDir != null && Directory.Exists(parentDir))
                {
                    // Search all subdirectories for .al* files matching the library name
                    var alFiles = Directory.GetFiles(parentDir, "*.al*", SearchOption.AllDirectories);
                    var match = alFiles.FirstOrDefault(f =>
                        Path.GetFileNameWithoutExtension(f).Equals(searchName, StringComparison.OrdinalIgnoreCase)
                        && System.Text.RegularExpressions.Regex.IsMatch(
                            Path.GetExtension(f), @"\.al\d+$", System.Text.RegularExpressions.RegexOptions.IgnoreCase));
                    if (match != null)
                    {
                        resolvedLibPath = match;
                        Console.WriteLine($"[TIA] Found library file by name search: {resolvedLibPath}");
                    }
                    else
                    {
                        throw new FileNotFoundException($"Library path not found: {libraryPath}");
                    }
                }
                else
                {
                    throw new FileNotFoundException($"Library path not found: {libraryPath}");
                }
            }

            var result = new LibraryCopyToProjectResponse { Success = true };
            bool weOpened = false;
            GlobalLibrary library = null;

            try
            {
                // --- Get PLC software (caller must ensure project is open) ---
                var plcSoftware = GetPlcSoftware();

                // --- Open library (reuse if already open) ---
                var fileInfo = new FileInfo(resolvedLibPath);
                string expectedName = Path.GetFileNameWithoutExtension(resolvedLibPath);
                foreach (var openLib in _tiaPortal.GlobalLibraries)
                {
                    try
                    {
                        bool pathMatch = openLib.Path != null && (
                            string.Equals(openLib.Path.FullName, fileInfo.FullName, StringComparison.OrdinalIgnoreCase) ||
                            string.Equals(openLib.Path.Name, fileInfo.Name, StringComparison.OrdinalIgnoreCase));
                        bool nameMatch = string.Equals(openLib.Name, expectedName, StringComparison.OrdinalIgnoreCase);
                        if (pathMatch || nameMatch)
                        {
                            library = openLib;
                            Console.WriteLine($"[TIA] Copy: using already-open library '{openLib.Name}'");
                            break;
                        }
                    }
                    catch { }
                }
                if (library == null)
                {
                    library = _tiaPortal.GlobalLibraries.Open(fileInfo, OpenMode.ReadOnly);
                    weOpened = true;
                    Console.WriteLine($"[TIA] Copy: opened library '{library.Name}'");
                }
                if (plcSoftware == null)
                    throw new InvalidOperationException("No PLC device found in the project.");

                var blockGroup = plcSoftware.BlockGroup;
                var typeGroup = plcSoftware.TypeGroup;

                // Log what's available in the type folder
                Console.WriteLine($"[TIA] Library type folder: {library.TypeFolder.Types.Count} types, {library.TypeFolder.Folders.Count} subfolders");
                foreach (var tf in library.TypeFolder.Folders)
                {
                    Console.WriteLine($"[TIA]   Type subfolder: '{tf.Name}' ({tf.Types.Count} types, {tf.Folders.Count} subfolders)");
                }

                // --- Auto-import "Open Library" master copy (tag table) if it exists ---
                // Required by all Open Library blocks — must be imported before any FBs
                foreach (var mc in library.MasterCopyFolder.MasterCopies)
                {
                    if (string.Equals(mc.Name, "Open Library", StringComparison.OrdinalIgnoreCase))
                    {
                        // Log what this master copy contains
                        try
                        {
                            var parts = new List<string>();
                            foreach (var desc in mc.ContentDescriptions)
                                parts.Add($"{desc.ContentName} ({desc.ContentType.Name})");
                            Console.WriteLine($"[TIA]   'Open Library' master copy contains: {string.Join(", ", parts)}");
                        }
                        catch { }

                        // Try tag table composition first (most likely for "Open Library")
                        bool imported = false;
                        try
                        {
                            Console.WriteLine($"[TIA]   Auto-importing 'Open Library' as tag table...");
                            var tagGroup = plcSoftware.TagTableGroup;
                            PlcTagTable tagTable = tagGroup.TagTables.CreateFrom(mc);
                            Console.WriteLine($"[TIA]     Created tag table: {tagTable?.Name ?? "(unknown)"}");
                            result.CopiedBlocks.Add(tagTable?.Name ?? "Open Library (tag table)");
                            imported = true;
                        }
                        catch (Exception ex)
                        {
                            string msg = ex.Message;
                            if (msg.Contains("already exists") || msg.Contains("bereits vorhanden"))
                            {
                                Console.WriteLine($"[TIA]     Skipped 'Open Library' tag table (already exists)");
                                result.SkippedBlocks.Add("Open Library (tag table)");
                                imported = true;
                            }
                            else
                            {
                                Console.WriteLine($"[TIA]     Tag table import failed: {msg}");
                            }
                        }

                        // Fallback: try as a block
                        if (!imported)
                        {
                            try
                            {
                                Console.WriteLine($"[TIA]   Trying 'Open Library' as block...");
                                PlcBlock tagBlock = blockGroup.Blocks.CreateFrom(mc);
                                Console.WriteLine($"[TIA]     Created block: {tagBlock?.Name ?? "(unknown)"}");
                                result.CopiedBlocks.Add(tagBlock?.Name ?? "Open Library");
                            }
                            catch (Exception ex2)
                            {
                                string msg2 = ex2.Message;
                                if (msg2.Contains("already exists") || msg2.Contains("bereits vorhanden"))
                                {
                                    Console.WriteLine($"[TIA]     Skipped 'Open Library' block (already exists)");
                                    result.SkippedBlocks.Add("Open Library");
                                }
                                else
                                {
                                    Console.WriteLine($"[TIA]     Block import also failed: {msg2}");
                                    result.Warnings.Add($"Open Library master copy: could not import as tag table or block");
                                }
                            }
                        }
                        break;
                    }
                }

                // --- Copy library types (individual FBs live here as versioned types) ---
                var wantedNames = new HashSet<string>(masterCopyPaths, StringComparer.OrdinalIgnoreCase);
                foreach (var tp in typePaths) wantedNames.Add(tp);
                // Track found names so we can short-circuit once all are found
                var foundNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

                if (wantedNames.Count > 0)
                {
                    CopyLibraryTypesToProject(library.TypeFolder, "", typeGroup, wantedNames, foundNames, result);
                }

                result.Message = $"Copied {result.CopiedBlocks.Count} block(s), " +
                    $"skipped {result.SkippedBlocks.Count}, " +
                    $"{result.Warnings.Count} warning(s)";
                Console.WriteLine($"[TIA] {result.Message}");
            }
            catch (Exception ex)
            {
                result.Success = false;
                result.Message = ex.Message;
                result.Errors.Add(ex.Message);
                Console.WriteLine($"[TIA] Copy failed: {ex.Message}");
            }
            finally
            {
                if (weOpened && library != null)
                {
                    try { ((UserGlobalLibrary)library).Close(); } catch { }
                }
            }

            return result;
        }

        private void CopyMasterCopiesToProject(MasterCopyFolder folder, string path,
            PlcBlockSystemGroup targetGroup, HashSet<string> wantedPaths, LibraryCopyToProjectResponse result)
        {
            Console.WriteLine($"[TIA]   Scanning folder: '{(string.IsNullOrEmpty(path) ? "(root)" : path)}' — {folder.MasterCopies.Count} master copies, {folder.Folders.Count} subfolders");

            foreach (var masterCopy in folder.MasterCopies)
            {
                string fullPath = string.IsNullOrEmpty(path) ? masterCopy.Name : path + "/" + masterCopy.Name;
                Console.WriteLine($"[TIA]     Found: '{masterCopy.Name}' (fullPath='{fullPath}')");

                // Match by full path OR by just the name (case-insensitive)
                bool match = wantedPaths.Any(w =>
                    string.Equals(w, fullPath, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(w, masterCopy.Name, StringComparison.OrdinalIgnoreCase));
                if (!match) continue;

                try
                {
                    Console.WriteLine($"[TIA]   Creating block from master copy: {fullPath}");
                    // CreateFrom brings the block + all dependencies automatically
                    PlcBlock created = targetGroup.Blocks.CreateFrom(masterCopy);
                    string blockName = created?.Name ?? masterCopy.Name;
                    result.CopiedBlocks.Add(blockName);
                    Console.WriteLine($"[TIA]     Created: {blockName}");
                }
                catch (Exception ex)
                {
                    result.Warnings.Add($"{fullPath}: {ex.Message}");
                    Console.WriteLine($"[TIA]     Warning: {fullPath}: {ex.Message}");
                }
            }

            foreach (var subFolder in folder.Folders)
            {
                string subPath = string.IsNullOrEmpty(path) ? subFolder.Name : path + "/" + subFolder.Name;
                CopyMasterCopiesToProject(subFolder, subPath, targetGroup, wantedPaths, result);
            }
        }

        private void CopyLibraryTypesToProject(LibraryTypeFolder folder, string path,
            PlcTypeGroup targetGroup, HashSet<string> wantedPaths, HashSet<string> foundNames,
            LibraryCopyToProjectResponse result)
        {
            // Short-circuit if all wanted names have been found
            if (foundNames.Count >= wantedPaths.Count) return;

            Console.WriteLine($"[TIA]   Scanning type folder: '{(string.IsNullOrEmpty(path) ? "(root)" : path)}' — {folder.Types.Count} types, {folder.Folders.Count} subfolders");

            foreach (var typeItem in folder.Types)
            {
                if (foundNames.Count >= wantedPaths.Count) break;

                string fullPath = string.IsNullOrEmpty(path) ? typeItem.Name : path + "/" + typeItem.Name;

                // Match by full path OR by just the name (case-insensitive)
                if (!wantedPaths.Contains(fullPath) && !wantedPaths.Contains(typeItem.Name))
                    continue;

                // Skip if already found (prevents duplicate matches like "p")
                if (foundNames.Contains(typeItem.Name))
                    continue;

                try
                {
                    Console.WriteLine($"[TIA]   Copying library type: {fullPath}");
                    var versions = typeItem.Versions;
                    if (versions.Count > 0)
                    {
                        var latestVersion = versions[versions.Count - 1];
                        Console.WriteLine($"[TIA]     Version: {latestVersion.VersionNumber}, Type: {latestVersion.GetType().Name}");

                        var plcSoftware = GetPlcSoftware();

                        // Use CreateFrom directly — no export+import needed.
                        // Dependencies are auto-synced to the project library.
                        if (latestVersion is CodeBlockLibraryTypeVersion blockVersion)
                        {
                            // FB/FC library type → create in PlcBlockComposition
                            PlcBlock newBlock = plcSoftware.BlockGroup.Blocks.CreateFrom(blockVersion);
                            result.CopiedBlocks.Add(newBlock.Name);
                            foundNames.Add(typeItem.Name);
                            Console.WriteLine($"[TIA]     Created block: {newBlock.Name}");
                        }
                        else if (latestVersion is PlcTypeLibraryTypeVersion plcTypeVersion)
                        {
                            // UDT library type → create in PlcTypeComposition
                            PlcType newType = plcSoftware.TypeGroup.Types.CreateFrom(plcTypeVersion);
                            result.CopiedBlocks.Add(newType.Name);
                            foundNames.Add(typeItem.Name);
                            Console.WriteLine($"[TIA]     Created type: {newType.Name}");
                        }
                        else
                        {
                            result.Warnings.Add($"{fullPath}: unsupported version type '{latestVersion.GetType().Name}'");
                        }
                    }
                    else
                    {
                        result.Warnings.Add($"Type '{fullPath}' has no versions.");
                    }
                }
                catch (Exception ex)
                {
                    string msg = ex.Message;
                    if (msg.Contains("already exists") || msg.Contains("bereits vorhanden"))
                    {
                        result.SkippedBlocks.Add(fullPath);
                        Console.WriteLine($"[TIA]     Skipped (already exists): {fullPath}");
                    }
                    else
                    {
                        result.Warnings.Add($"{fullPath}: {msg}");
                        Console.WriteLine($"[TIA]     Warning: {fullPath}: {msg}");
                    }
                }
            }

            foreach (var subFolder in folder.Folders)
            {
                if (foundNames.Count >= wantedPaths.Count) break;
                string subPath = string.IsNullOrEmpty(path) ? subFolder.Name : path + "/" + subFolder.Name;
                CopyLibraryTypesToProject(subFolder, subPath, targetGroup, wantedPaths, foundNames, result);
            }
        }

        private void ExportTypesFromFolder(LibraryTypeFolder folder, string path,
            string tempDir, HashSet<string> wantedPaths, bool exportAll, LibraryExportResponse result)
        {
            foreach (var typeItem in folder.Types)
            {
                string fullPath = string.IsNullOrEmpty(path) ? typeItem.Name : path + "/" + typeItem.Name;
                if (!exportAll && !wantedPaths.Contains(fullPath))
                    continue;

                try
                {
                    // Export the latest version of the type
                    var versions = typeItem.Versions;
                    if (versions.Count > 0)
                    {
                        var latestVersion = versions[versions.Count - 1];
                        string outputFile = Path.Combine(tempDir, typeItem.Name.Replace("/", "_") + ".xml");
                        latestVersion.Export(new FileInfo(outputFile), ExportOptions.WithDefaults);

                        if (File.Exists(outputFile))
                        {
                            result.Items[fullPath] = File.ReadAllText(outputFile);
                            Console.WriteLine($"[TIA]   Exported type: {fullPath}");
                        }
                    }
                    else
                    {
                        result.Warnings.Add($"Type '{fullPath}' has no versions to export.");
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[TIA]   Export failed for type '{fullPath}': {ex.Message}");
                    result.Warnings.Add($"{fullPath}: {ex.Message}");
                }
            }

            foreach (var subFolder in folder.Folders)
            {
                string subPath = string.IsNullOrEmpty(path) ? subFolder.Name : path + "/" + subFolder.Name;
                ExportTypesFromFolder(subFolder, subPath, tempDir, wantedPaths, exportAll, result);
            }
        }

        private void ExportMasterCopiesFromFolder(MasterCopyFolder folder, string path,
            string tempDir, HashSet<string> wantedPaths, bool exportAll, LibraryExportResponse result)
        {
            foreach (var masterCopy in folder.MasterCopies)
            {
                string fullPath = string.IsNullOrEmpty(path) ? masterCopy.Name : path + "/" + masterCopy.Name;
                if (!exportAll && !wantedPaths.Contains(fullPath))
                    continue;

                // MasterCopy objects cannot be exported as standalone XML.
                // Record their content descriptions so the frontend knows what they contain.
                try
                {
                    var parts = new List<string>();
                    foreach (var desc in masterCopy.ContentDescriptions)
                    {
                        parts.Add(desc.ContentName + " (" + desc.ContentType.Name + ")");
                    }
                    string info = parts.Count > 0 ? string.Join(", ", parts) : masterCopy.Name;
                    result.Items[fullPath] = "[MasterCopy] Contents: " + info;
                    Console.WriteLine($"[TIA]   Listed master copy: {fullPath} ({info})");
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[TIA]   Failed to read master copy '{fullPath}': {ex.Message}");
                    result.Warnings.Add($"{fullPath}: {ex.Message}");
                }
            }

            foreach (var subFolder in folder.Folders)
            {
                string subPath = string.IsNullOrEmpty(path) ? subFolder.Name : path + "/" + subFolder.Name;
                ExportMasterCopiesFromFolder(subFolder, subPath, tempDir, wantedPaths, exportAll, result);
            }
        }

        // ============================================================
        // Pac-Audit: Full project extraction
        // ============================================================

        /// <summary>
        /// Get project metadata for the /tia/project-info endpoint.
        /// </summary>
        public ProjectInfoResponse GetProjectInfo()
        {
            if (!IsConnected || !IsProjectOpen)
                throw new InvalidOperationException("TIA Portal not connected or no project open.");

            PlcSoftware plcSoftware = GetPlcSoftware();

            string cpuFamily = null;
            string cpuOrderNumber = null;
            try { GetSourcePlcInfo(out cpuFamily, out cpuOrderNumber); } catch { }

            // Count blocks
            var blocks = new List<PlcBlock>();
            CollectBlocks(plcSoftware.BlockGroup, blocks);

            // Count UDTs
            var udts = new List<PlcType>();
            CollectTypes(plcSoftware.TypeGroup, udts);

            // Count tag tables
            int tagTableCount = 0;
            try { tagTableCount = plcSoftware.TagTableGroup.TagTables.Count; } catch { }

            // Count HMI screens
            int hmiScreenCount = 0;
            try
            {
                var hmiTarget = GetHmiTarget();
                if (hmiTarget != null)
                {
                    var screens = new List<Siemens.Engineering.Hmi.Screen.Screen>();
                    CollectScreens(hmiTarget.ScreenFolder, screens);
                    hmiScreenCount = screens.Count;
                }
            }
            catch { }

            // Count devices
            int deviceCount = 0;
            try { deviceCount = _project.Devices.Count; } catch { }

            string tiaVersion = null;
            try { tiaVersion = DetectInstalledVersion(); } catch { }

            return new ProjectInfoResponse
            {
                Success = true,
                ProjectName = _project.Name,
                ProjectPath = _project.Path?.ToString(),
                TiaVersion = tiaVersion,
                CpuFamily = cpuFamily,
                CpuOrderNumber = cpuOrderNumber,
                BlockCount = blocks.Count,
                UdtCount = udts.Count,
                TagTableCount = tagTableCount,
                HmiScreenCount = hmiScreenCount,
                DeviceCount = deviceCount
            };
        }

        /// <summary>
        /// Extract the full project: blocks with folder hierarchy, UDTs, tag tables, and HW config.
        /// </summary>
        public ExtractProjectResponse ExtractProject()
        {
            if (!IsConnected || !IsProjectOpen)
                throw new InvalidOperationException("TIA Portal not connected or no project open.");

            PlcSoftware plcSoftware = GetPlcSoftware();
            var result = new ExtractProjectResponse { Success = true };

            string tempDir = Path.Combine(Path.GetTempPath(), "PacForge",
                "audit_" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(tempDir);

            try
            {
                // ── 1. Extract folder structure + blocks ──────────────────
                int folderSeq = 0;
                ExtractBlocksRecursive(plcSoftware.BlockGroup, null, "Program blocks", 0, ref folderSeq, tempDir, plcSoftware, result);

                // ── 2. Extract UDTs ───────────────────────────────────────
                var udts = new List<PlcType>();
                CollectTypes(plcSoftware.TypeGroup, udts);
                Console.WriteLine($"[Audit] Extracting {udts.Count} UDT(s)...");

                string udtFolderId = "folder-udt-root";
                result.Folders.Add(new ExtractedFolderDto
                {
                    Id = udtFolderId,
                    ParentId = null,
                    Name = "PLC data types",
                    FolderType = "udt",
                    Path = "PLC data types",
                    Depth = 0
                });

                foreach (PlcType udt in udts)
                {
                    try
                    {
                        string outputFile = Path.Combine(tempDir, udt.Name + ".udt");
                        plcSoftware.ExternalSourceGroup.GenerateSource(
                            new PlcType[] { udt },
                            new FileInfo(outputFile),
                            GenerateOptions.None);

                        string source = File.Exists(outputFile) ? File.ReadAllText(outputFile) : null;
                        result.Blocks.Add(new ExtractedBlockDto
                        {
                            Name = udt.Name,
                            BlockType = "UDT",
                            ProgrammingLanguage = "UDT",
                            SourceCode = source,
                            SourceFormat = "scl",
                            FolderPath = "PLC data types",
                            FolderId = udtFolderId,
                            LineCount = source?.Split('\n').Length
                        });
                    }
                    catch (Exception ex)
                    {
                        result.Warnings.Add($"UDT {udt.Name}: {ex.Message}");
                    }
                }

                // ── 3. Extract tag tables ─────────────────────────────────
                Console.WriteLine("[Audit] Extracting tag tables...");
                try
                {
                    foreach (PlcTagTable table in plcSoftware.TagTableGroup.TagTables)
                    {
                        var tagDto = new ExtractedTagTableDto { Name = table.Name };
                        foreach (PlcTag tag in table.Tags)
                        {
                            string address = null;
                            try { address = tag.LogicalAddress; } catch { }
                            string comment = null;
                            try
                            {
                                var commentItems = tag.Comment?.Items;
                                if (commentItems != null)
                                    foreach (var item in commentItems)
                                        { comment = item.Text; break; }
                            }
                            catch { }

                            tagDto.Tags.Add(new ExtractedTagDto
                            {
                                Name = tag.Name,
                                DataType = tag.DataTypeName,
                                Address = address,
                                Comment = comment
                            });
                        }
                        result.TagTables.Add(tagDto);
                    }
                }
                catch (Exception ex)
                {
                    result.Warnings.Add($"Tag tables: {ex.Message}");
                }

                // ── 4. Extract hardware config ────────────────────────────
                Console.WriteLine("[Audit] Extracting hardware configuration...");
                result.Hardware = ExtractHardwareConfig();

                int blockCount = result.Blocks.Count;
                int folderCount = result.Folders.Count;
                int tagTableCount = result.TagTables.Count;
                result.Message = $"Extracted {blockCount} blocks, {folderCount} folders, {tagTableCount} tag tables";
                Console.WriteLine($"[Audit] {result.Message}, {result.Warnings.Count} warnings");
            }
            finally
            {
                try { Directory.Delete(tempDir, true); } catch { }
            }

            return result;
        }

        private void ExtractBlocksRecursive(
            PlcBlockSystemGroup systemGroup,
            string parentFolderId,
            string currentPath,
            int depth,
            ref int folderSeq,
            string tempDir,
            PlcSoftware plcSoftware,
            ExtractProjectResponse result)
        {
            string folderId = $"folder-{folderSeq++}";
            result.Folders.Add(new ExtractedFolderDto
            {
                Id = folderId,
                ParentId = parentFolderId,
                Name = systemGroup.Name ?? "Program blocks",
                FolderType = "program_blocks",
                Path = currentPath,
                Depth = depth
            });

            int rootBlockCount = 0;
            try { rootBlockCount = systemGroup.Blocks.Count; } catch { }
            int rootGroupCount = 0;
            try { rootGroupCount = systemGroup.Groups.Count; } catch { }
            Console.WriteLine($"[Audit] Folder '{currentPath}': {rootBlockCount} direct blocks, {rootGroupCount} sub-groups");

            // Recurse into sub-groups FIRST to collect names of blocks that belong there.
            // PlcBlockSystemGroup.Blocks returns ALL blocks recursively in V18, so we use
            // the sub-group names to filter out duplicates when processing root-level blocks.
            var subGroupBlockNames = new System.Collections.Generic.HashSet<string>(
                System.StringComparer.OrdinalIgnoreCase);
            CollectSubGroupBlockNames(systemGroup.Groups, subGroupBlockNames);

            foreach (PlcBlockUserGroup subGroup in systemGroup.Groups)
            {
                ExtractUserGroupRecursive(subGroup, folderId, currentPath + "/" + subGroup.Name, depth + 1, ref folderSeq, tempDir, plcSoftware, result);
            }

            // Only add blocks that are NOT in any sub-group (truly root-level blocks)
            int rootOnly = 0;
            foreach (PlcBlock block in systemGroup.Blocks)
            {
                string blockName = null;
                try { blockName = block.Name; } catch { }
                if (blockName != null && !subGroupBlockNames.Contains(blockName))
                {
                    ExtractSingleBlock(block, folderId, currentPath, tempDir, plcSoftware, result);
                    rootOnly++;
                }
            }
            if (rootOnly > 0)
                Console.WriteLine($"[Audit] Root-only blocks in '{currentPath}': {rootOnly}");
        }

        private void CollectSubGroupBlockNames(
            PlcBlockUserGroupComposition groups,
            System.Collections.Generic.HashSet<string> names)
        {
            foreach (PlcBlockUserGroup g in groups)
            {
                foreach (PlcBlock b in g.Blocks)
                {
                    try { if (b.Name != null) names.Add(b.Name); } catch { }
                }
                CollectSubGroupBlockNames(g.Groups, names);
            }
        }

        private void ExtractUserGroupRecursive(
            PlcBlockUserGroup userGroup,
            string parentFolderId,
            string currentPath,
            int depth,
            ref int folderSeq,
            string tempDir,
            PlcSoftware plcSoftware,
            ExtractProjectResponse result)
        {
            string folderId = $"folder-{folderSeq++}";
            result.Folders.Add(new ExtractedFolderDto
            {
                Id = folderId,
                ParentId = parentFolderId,
                Name = userGroup.Name,
                FolderType = "program_blocks",
                Path = currentPath,
                Depth = depth
            });

            int groupBlockCount = 0;
            try { groupBlockCount = userGroup.Blocks.Count; } catch { }
            int groupSubCount = 0;
            try { groupSubCount = userGroup.Groups.Count; } catch { }
            Console.WriteLine($"[Audit] Folder '{currentPath}': {groupBlockCount} direct blocks, {groupSubCount} sub-groups");

            foreach (PlcBlock block in userGroup.Blocks)
            {
                ExtractSingleBlock(block, folderId, currentPath, tempDir, plcSoftware, result);
            }

            foreach (PlcBlockUserGroup subGroup in userGroup.Groups)
            {
                ExtractUserGroupRecursive(subGroup, folderId, currentPath + "/" + subGroup.Name, depth + 1, ref folderSeq, tempDir, plcSoftware, result);
            }
        }

        private void ExtractSingleBlock(
            PlcBlock block,
            string folderId,
            string folderPath,
            string tempDir,
            PlcSoftware plcSoftware,
            ExtractProjectResponse result)
        {
            string blockLang = "SCL";
            try { blockLang = block.ProgrammingLanguage.ToString(); } catch { }

            string blockType = "FB";
            try
            {
                if (block is OB) blockType = "OB";
                else if (block is FB) blockType = "FB";
                else if (block is FC) blockType = "FC";
                else if (block is InstanceDB || block is GlobalDB) blockType = "DB";
                else blockType = block.GetType().Name.Replace("Plc", "");
            }
            catch { }

            int? blockNumber = null;
            try { blockNumber = block.Number; } catch { }

            string source = null;
            string sourceFormat = "scl";

            try
            {
                string ext = ".scl";
                if (blockLang == "STL") ext = ".awl";
                else if (blockLang == "DB") ext = ".db";
                else if (blockLang == "LAD" || blockLang == "FBD") ext = ".awl";

                string outputFile = Path.Combine(tempDir, block.Name + ext);
                plcSoftware.ExternalSourceGroup.GenerateSource(
                    new PlcBlock[] { block },
                    new FileInfo(outputFile),
                    GenerateOptions.None);

                if (File.Exists(outputFile))
                {
                    source = File.ReadAllText(outputFile);
                    sourceFormat = (blockLang == "LAD" || blockLang == "FBD") ? "awl" : "scl";
                }
            }
            catch
            {
                // Fallback to XML export for LAD/FBD/GRAPH
                if (blockLang == "LAD" || blockLang == "FBD" || blockLang == "GRAPH")
                {
                    try
                    {
                        string xmlFile = Path.Combine(tempDir, block.Name + ".xml");
                        try { block.Export(new FileInfo(xmlFile), ExportOptions.None); }
                        catch { block.Export(new FileInfo(xmlFile), ExportOptions.WithDefaults); }

                        if (File.Exists(xmlFile))
                        {
                            source = File.ReadAllText(xmlFile);
                            sourceFormat = "xml";
                        }
                    }
                    catch (Exception xmlEx)
                    {
                        result.Warnings.Add($"{block.Name}: {xmlEx.Message}");
                    }
                }
                else
                {
                    result.Warnings.Add($"{block.Name}: not exportable");
                }
            }

            result.Blocks.Add(new ExtractedBlockDto
            {
                Name = block.Name,
                BlockType = blockType,
                BlockNumber = blockNumber,
                ProgrammingLanguage = blockLang,
                SourceCode = source,
                SourceFormat = sourceFormat,
                FolderPath = folderPath,
                FolderId = folderId,
                LineCount = source?.Split('\n').Length
            });

            Console.WriteLine($"[Audit] Exported {blockType} '{block.Name}' ({blockLang}) [{folderPath}]");
        }

        private ExtractedHardwareDto ExtractHardwareConfig()
        {
            var hw = new ExtractedHardwareDto();

            try
            {
                foreach (Device device in _project.Devices)
                {
                    hw.Devices.Add(new ExtractedDeviceDto
                    {
                        Name = device.Name,
                        TypeId = device.TypeIdentifier
                    });

                    // Extract IO modules from device items
                    ExtractDeviceItems(device.DeviceItems, hw, 0, 0);
                }

                // Extract subnets / networks
                try
                {
                    foreach (Subnet subnet in _project.Subnets)
                    {
                        var netDto = new ExtractedNetworkDto
                        {
                            Name = subnet.Name,
                            Type = subnet.TypeIdentifier
                        };
                        hw.Networks.Add(netDto);
                    }
                }
                catch { }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Audit] HW extraction error: {ex.Message}");
            }

            return hw;
        }

        private void ExtractDeviceItems(DeviceItemComposition items, ExtractedHardwareDto hw, int rack, int slot)
        {
            foreach (DeviceItem item in items)
            {
                string typeId = null;
                try { typeId = item.TypeIdentifier; } catch { }

                if (typeId != null && (typeId.Contains("OrderNumber:") || typeId.Contains("GSD:")))
                {
                    int itemSlot = slot;
                    try
                    {
                        var posNum = item.PositionNumber;
                        itemSlot = posNum;
                    }
                    catch { }

                    hw.IoModules.Add(new ExtractedIoModuleDto
                    {
                        Name = item.Name,
                        TypeId = typeId,
                        Rack = rack,
                        Slot = itemSlot
                    });
                }

                ExtractDeviceItems(item.DeviceItems, hw, rack, slot + 1);
            }
        }
    }
}
