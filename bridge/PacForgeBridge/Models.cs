using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;

namespace PacForgeBridge
{
    // --- Global JSON settings ---

    public static class Json
    {
        public static readonly JsonSerializerSettings Settings = new JsonSerializerSettings
        {
            ContractResolver = new DefaultContractResolver
            {
                NamingStrategy = new SnakeCaseNamingStrategy()
            },
            NullValueHandling = NullValueHandling.Ignore,
            Formatting = Formatting.None
        };

        public static string Serialize(object obj)
        {
            return JsonConvert.SerializeObject(obj, Settings);
        }

        public static T Deserialize<T>(string json)
        {
            return JsonConvert.DeserializeObject<T>(json, Settings);
        }
    }

    // --- REST API Request/Response DTOs ---

    public class SubmitJobRequest
    {
        public string JobId { get; set; }
        public string JobType { get; set; }
        public ManifestDto Manifest { get; set; }
        public string ArtifactBundle { get; set; } // Base64-encoded ZIP
        public string TiaProjectPath { get; set; }
    }

    public class SubmitJobResponse
    {
        public string JobId { get; set; }
        public string Status { get; set; }
        public string CreatedAt { get; set; }
    }

    public class JobStatusResponse
    {
        public string JobId { get; set; }
        public string Status { get; set; }
        public int Progress { get; set; }
        public string CurrentStep { get; set; }
        public string CreatedAt { get; set; }
        public string StartedAt { get; set; }
        public string CompletedAt { get; set; }
        public string ErrorMessage { get; set; }
    }

    public class JobResultsResponse
    {
        public string JobId { get; set; }
        public CompileResultDto CompileResult { get; set; }
        public List<string> ImportedArtifacts { get; set; } = new List<string>();
        public List<string> SkippedArtifacts { get; set; } = new List<string>();
    }

    public class CancelJobResponse
    {
        public string JobId { get; set; }
        public string Status { get; set; }
        public string CancelledAt { get; set; }
    }

    public class BridgeStatusResponse
    {
        public bool Connected { get; set; }
        public string TiaVersion { get; set; }
        public bool TiaProjectOpen { get; set; }
        public string BridgeVersion { get; set; }
        /// <summary>e.g. "SIMATIC 300" — device family name from open project</summary>
        public string SourcePlcFamily { get; set; }
        /// <summary>e.g. "OrderNumber:6ES7 317-2EK14-0AB0/V3.3" — CPU slot TypeIdentifier</summary>
        public string SourceCpuTypeId { get; set; }
    }

    // --- TIA Action Requests/Responses ---

    public class ConnectRequest
    {
        public string Mode { get; set; } = "attach"; // "attach" or "start"
        public bool WithUi { get; set; } = true;     // Open TIA Portal with visible UI
    }

    public class OpenProjectRequest
    {
        public string ProjectPath { get; set; }
    }

    public class DemoRequest
    {
        public string ProjectPath { get; set; }
        public string ProjectName { get; set; }
    }

    public class CreateProjectWithSourcesRequest
    {
        public string ProjectPath { get; set; }
        public string ProjectName { get; set; }
        public Dictionary<string, string> Sources { get; set; }  // name → SCL content
        public List<string> ImportOrder { get; set; }             // ordered artifact names
        public List<IoModuleDto> IoModules { get; set; }          // IO modules to plug into rack
        public List<IoTagDto> IoTags { get; set; }                // PLC tags to create in tag table
    }

    public class IoModuleDto
    {
        public string Mlfb { get; set; }          // e.g. "6ES7 521-1BH50-0AA0"
        public int Rack { get; set; }
        public int Slot { get; set; }
        public string Description { get; set; }
    }

    public class IoTagDto
    {
        public string Name { get; set; }           // Symbolic tag name, e.g. "Motor_Start"
        public string DataType { get; set; }       // TIA data type, e.g. "Bool", "Int", "Word"
        public string LogicalAddress { get; set; } // Siemens address, e.g. "%I0.0", "%Q1.3"
        public string Comment { get; set; }        // Optional description
    }

    public class ProvisionProjectRequest
    {
        public string TiaProjectPath { get; set; }    // Folder path, e.g. C:\...\50 PLC\01 Project Name
        public string ProjectName { get; set; }       // Project name used when creating (folder basename if omitted)
        public string CpuOrderNumber { get; set; }    // e.g. "6ES7 516-3AN02-0AB0/V2.9"
        public string ProvisionId { get; set; }       // Correlation ID for WS events
        public List<IoModuleDto> IoModules { get; set; }
        public List<IoTagDto> IoTags { get; set; }
        public Dictionary<string, string> Sources { get; set; }  // name -> SCL; when present the program is imported too
        public List<string> ImportOrder { get; set; }            // dependency order: UDT -> FB -> FC -> DB -> OB
    }

    public class ProvisionProjectResponse
    {
        public bool Success { get; set; }
        public bool Created { get; set; }             // true = new project created, false = existing opened
        public string ProjectFilePath { get; set; }  // Full path to .ap* file
        public string Message { get; set; }
        public List<string> Warnings { get; set; } = new List<string>();
        public CompileResultDto CompileResult { get; set; }      // present when Sources were supplied
    }

    public class TiaActionResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public Dictionary<string, object> Details { get; set; } = new Dictionary<string, object>();
    }

    // --- Compile Results ---

    public class CompileResultDto
    {
        public bool Success { get; set; }
        public List<CompileErrorDto> Errors { get; set; } = new List<CompileErrorDto>();
        public List<CompileErrorDto> Warnings { get; set; } = new List<CompileErrorDto>();
        public string CompiledAt { get; set; }
    }

    public class CompileResultWithSourcesDto
    {
        public bool Success { get; set; }
        public List<CompileErrorDto> Errors { get; set; } = new List<CompileErrorDto>();
        public List<CompileErrorDto> Warnings { get; set; } = new List<CompileErrorDto>();
        public string CompiledAt { get; set; }
        public Dictionary<string, string> Sources { get; set; } = new Dictionary<string, string>();

        public CompileResultWithSourcesDto() { }

        public CompileResultWithSourcesDto(CompileResultDto result, Dictionary<string, string> sources)
        {
            Success = result.Success;
            Errors = result.Errors;
            Warnings = result.Warnings;
            CompiledAt = result.CompiledAt;
            Sources = sources ?? new Dictionary<string, string>();
        }
    }

    public class ReimportRequest
    {
        public Dictionary<string, string> Sources { get; set; } = new Dictionary<string, string>();

        /// <summary>Optional artifact name → block-group path (e.g. "Unit/DB").
        /// Missing names import to the Program blocks root (pre-1.4.0 behavior).</summary>
        public Dictionary<string, string> Folders { get; set; } = new Dictionary<string, string>();
    }

    public class ExportSourcesResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public Dictionary<string, string> Sources { get; set; } = new Dictionary<string, string>();
        /// <summary>Block name → programming language ("SCL", "STL", "LAD", "FBD", "DB", "UDT")</summary>
        public Dictionary<string, string> SourceLanguages { get; set; } = new Dictionary<string, string>();
        public List<string> Warnings { get; set; } = new List<string>();
    }

    public class ExportHmiResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public Dictionary<string, string> Screens { get; set; } = new Dictionary<string, string>();
        public Dictionary<string, string> TagTables { get; set; } = new Dictionary<string, string>();
        public List<string> Warnings { get; set; } = new List<string>();
    }

    public class ExportHmiGraphicsResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public Dictionary<string, string> Graphics { get; set; } = new Dictionary<string, string>(); // name → data:mime;base64,... URI
        public List<string> Warnings { get; set; } = new List<string>();
    }

    public class ExportReferenceRequest
    {
        /// <summary>Absolute directory where screens/, udts/, tags/ subfolders will be created.</summary>
        public string OutputDir { get; set; }
    }

    public class ExportReferenceResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public string OutputDir { get; set; }
        public List<string> Screens { get; set; } = new List<string>();
        public List<string> TagTables { get; set; } = new List<string>();
        public List<string> Udts { get; set; } = new List<string>();
        public List<string> Warnings { get; set; } = new List<string>();
    }

    // Unified screen creation request/response (Phase 4 bridge consumer)
    public class UnifiedScreenItemRequest
    {
        /// <summary>Short type name (HmiRectangle) or full .NET name.</summary>
        public string Type { get; set; }
        public string Name { get; set; }
        public Dictionary<string, object> Attributes { get; set; } = new Dictionary<string, object>();

        // Phase 4.3: composite-property fields that can't be set via SetAttribute.
        // All are optional — bridge dispatches specialised helpers when present.

        /// <summary>Text content. Either a plain string (sets default language) or a Dictionary&lt;string, string&gt; of culture -> text.</summary>
        public object Text { get; set; }
        /// <summary>Tooltip text. Same shape as Text.</summary>
        public object ToolTip { get; set; }
        /// <summary>Font sub-properties: size (number), name (string), weight ("Normal" | "Bold" | ...), italic (bool), underline (bool), strikeOut (bool).</summary>
        public Dictionary<string, object> Font { get; set; }
        /// <summary>Padding sub-properties: left, top, right, bottom (all int).</summary>
        public Dictionary<string, object> Padding { get; set; }
        /// <summary>Corner radii: topLeft, topRight, bottomLeft, bottomRight (all uint). "radius" sets all four at once.</summary>
        public Dictionary<string, object> Corners { get; set; }
    }

    public class UnifiedScreenRequest
    {
        public string Name { get; set; }
        public int Width { get; set; }
        public int Height { get; set; }
        public string BackColor { get; set; }
        public int? ScreenNumber { get; set; }
        /// <summary>Forward-slash separated folder path to nest the new screen under, e.g. "Application/Overviews".</summary>
        public string FolderPath { get; set; }
        public List<UnifiedScreenItemRequest> Items { get; set; } = new List<UnifiedScreenItemRequest>();
    }

    public class CreateUnifiedScreenResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public string ScreenName { get; set; }
        public int ItemsCreated { get; set; }
        public List<string> Warnings { get; set; } = new List<string>();
    }

    public class ImportHmiRequest
    {
        public string TiaProjectPath { get; set; }
        public Dictionary<string, string> Screens { get; set; }
        public Dictionary<string, string> TagTables { get; set; }
        public Dictionary<string, string> TextLists { get; set; }
        public Dictionary<string, string> GraphicLists { get; set; }
    }

    public class ImportHmiResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public List<string> ImportedScreens { get; set; } = new List<string>();
        public List<string> ImportedTagTables { get; set; } = new List<string>();
        public List<string> ImportedTextLists { get; set; } = new List<string>();
        public List<string> ImportedGraphicLists { get; set; } = new List<string>();
        public List<string> Warnings { get; set; } = new List<string>();
    }

    public class CompileErrorDto
    {
        public string ArtifactName { get; set; }
        public int? Line { get; set; }
        public int? Column { get; set; }
        public string ErrorText { get; set; }
        public string Severity { get; set; } // "ERROR", "WARNING", "INFO"
    }

    // --- Manifest ---

    public class ManifestDto
    {
        public string ManifestVersion { get; set; }
        public string ProjectId { get; set; }
        public string Platform { get; set; }
        public string TiaVersion { get; set; }
        public string CpuType { get; set; }
        public string CreatedAt { get; set; }
        public string CreatedByUserId { get; set; }
        public string GenerationSessionId { get; set; }
        public List<ManifestArtifactDto> Artifacts { get; set; } = new List<ManifestArtifactDto>();
    }

    public class ManifestArtifactDto
    {
        public string Name { get; set; }
        public string Type { get; set; }
        public string Filename { get; set; }
        public string DestinationFolder { get; set; }
        public List<string> Dependencies { get; set; } = new List<string>();
        public bool CompileAfterImport { get; set; }
        public string OverwriteStrategy { get; set; }
        public string Notes { get; set; }
    }

    // --- WebSocket Events ---

    public class BridgeEvent
    {
        public string Type { get; set; }
        public string JobId { get; set; }
        public string Timestamp { get; set; }
        public Dictionary<string, object> Data { get; set; } = new Dictionary<string, object>();

        public BridgeEvent() { }

        public BridgeEvent(string type, string jobId)
        {
            Type = type;
            JobId = jobId;
            Timestamp = DateTime.UtcNow.ToString("o");
        }

        public static BridgeEvent JobStarted(string jobId)
        {
            return new BridgeEvent("job_started", jobId);
        }

        public static BridgeEvent JobProgress(string jobId, int progress, string step, string artifact = null)
        {
            return new BridgeEvent("job_progress", jobId)
            {
                Data = new Dictionary<string, object>
                {
                    ["progress"] = progress,
                    ["current_step"] = step,
                    ["current_artifact"] = artifact
                }
            };
        }

        public static BridgeEvent ArtifactImported(string jobId, string name, bool success, string error = null)
        {
            return new BridgeEvent("artifact_imported", jobId)
            {
                Data = new Dictionary<string, object>
                {
                    ["artifact_name"] = name,
                    ["success"] = success,
                    ["error"] = error
                }
            };
        }

        public static BridgeEvent CompileStarted(string jobId)
        {
            return new BridgeEvent("compile_started", jobId);
        }

        public static BridgeEvent CompileError(string jobId, string artifactName, int? line, int? column, string text, string severity)
        {
            return new BridgeEvent("compile_error", jobId)
            {
                Data = new Dictionary<string, object>
                {
                    ["artifact_name"] = artifactName,
                    ["line"] = line,
                    ["column"] = column,
                    ["error_text"] = text,
                    ["severity"] = severity
                }
            };
        }

        public static BridgeEvent CompileCompleted(string jobId, bool success)
        {
            return new BridgeEvent("compile_completed", jobId)
            {
                Data = new Dictionary<string, object>
                {
                    ["success"] = success
                }
            };
        }

        public static BridgeEvent JobCompleted(string jobId)
        {
            return new BridgeEvent("job_completed", jobId);
        }

        public static BridgeEvent JobFailed(string jobId, string error)
        {
            return new BridgeEvent("job_failed", jobId)
            {
                Data = new Dictionary<string, object>
                {
                    ["error"] = error
                }
            };
        }

        public static BridgeEvent ProvisionProgress(string provisionId, string step, int progress, bool complete = false, bool failed = false, string error = null)
        {
            return new BridgeEvent("provision_progress", null)
            {
                Data = new Dictionary<string, object>
                {
                    ["provision_id"] = provisionId,
                    ["step"] = step,
                    ["progress"] = progress,
                    ["complete"] = complete,
                    ["failed"] = failed,
                    ["error"] = error
                }
            };
        }

        public static BridgeEvent Status(bool connected, string tiaVersion, bool projectOpen, string bridgeVersion)
        {
            return new BridgeEvent("bridge_status", null)
            {
                Data = new Dictionary<string, object>
                {
                    ["connected"] = connected,
                    ["tia_version"] = tiaVersion,
                    ["tia_project_open"] = projectOpen,
                    ["bridge_version"] = bridgeVersion
                }
            };
        }
    }

    // --- Library DTOs ---

    public class OpenLibraryRequest
    {
        public string LibraryPath { get; set; }
    }

    public class LibraryContentsResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public string LibraryName { get; set; }
        public string LibraryPath { get; set; }
        public List<LibraryItemInfo> Types { get; set; } = new List<LibraryItemInfo>();
        public List<LibraryItemInfo> MasterCopies { get; set; } = new List<LibraryItemInfo>();
    }

    public class LibraryItemInfo
    {
        public string Name { get; set; }
        public string Path { get; set; }
        public string Kind { get; set; }
        public string Guid { get; set; }
        public string Description { get; set; }
    }

    public class ExportLibraryRequest
    {
        public string LibraryPath { get; set; }
        public List<string> ItemPaths { get; set; }
    }

    public class LibraryExportResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public Dictionary<string, string> Items { get; set; } = new Dictionary<string, string>();
        public List<string> Warnings { get; set; } = new List<string>();
    }

    // --- Library Copy-to-Project ---

    public class LibraryCopyToProjectRequest
    {
        /// <summary>Path to the global library file (.al18 etc.)</summary>
        public string LibraryPath { get; set; }
        /// <summary>Optional project path — if provided and no project is open, the bridge opens it first.</summary>
        public string ProjectPath { get; set; }
        /// <summary>List of master copy paths to copy into the project (e.g. "04 Electrical Drives/fbMotor_Reversing")</summary>
        public List<string> MasterCopyPaths { get; set; } = new List<string>();
        /// <summary>List of library type paths to copy into the project (e.g. "04 Electrical Drives/udtHMI_MotorControl")</summary>
        public List<string> TypePaths { get; set; } = new List<string>();
    }

    public class LibraryCopyToProjectResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public List<string> CopiedBlocks { get; set; } = new List<string>();
        public List<string> SkippedBlocks { get; set; } = new List<string>();
        public List<string> Warnings { get; set; } = new List<string>();
        public List<string> Errors { get; set; } = new List<string>();
    }

    // --- LAD Import ---

    public class ImportLadRequest
    {
        /// <summary>Path to the TIA Portal project (.ap18 etc.) — must already be open or will be opened.</summary>
        public string TiaProjectPath { get; set; }
        /// <summary>SimaticML XML content of the LAD block to import.</summary>
        public string XmlContent { get; set; }
        /// <summary>Name of the block (used for logging and compile lookup).</summary>
        public string BlockName { get; set; }
        /// <summary>Block type: FB, FC, OB.</summary>
        public string BlockType { get; set; }
        /// <summary>If true, compile the block after import.</summary>
        public bool Compile { get; set; }
        /// <summary>Optional sub-folder inside Program blocks (e.g. "Pac-LAD").</summary>
        public string DestinationFolder { get; set; }
    }

    public class ImportLadResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public List<string> ImportedBlocks { get; set; } = new List<string>();
        public List<string> Warnings { get; set; } = new List<string>();
        public CompileResultDto CompileResult { get; set; }
    }

    // --- Block XML Export ---

    public class ExportBlockXmlRequest
    {
        /// <summary>Name of the block to export (must exist in the open project).</summary>
        public string BlockName { get; set; }
        /// <summary>Optional sub-folder to look in (e.g. "Pac-LAD"). Blank = root Program blocks.</summary>
        public string Folder { get; set; }
    }

    public class ExportBlockXmlResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public string BlockName { get; set; }
        /// <summary>SimaticML XML content of the exported block.</summary>
        public string XmlContent { get; set; }
    }

    // --- Migration Tag Creation ---

    public class MigrationTagDto
    {
        /// <summary>Symbolic tag name, e.g. ABS_M10_0</summary>
        public string Name { get; set; }
        /// <summary>S7-1500 data type, e.g. Bool, Word, DWord, Byte, Int</summary>
        public string DataType { get; set; }
        /// <summary>Absolute address in TIA notation, e.g. %M10.0, %MW10</summary>
        public string Address { get; set; }
    }

    public class CreateMigrationTagsRequest
    {
        /// <summary>Tags to create in TIA Portal's tag table.</summary>
        public List<MigrationTagDto> Tags { get; set; } = new List<MigrationTagDto>();
        /// <summary>Tag table name to create/use. Defaults to "Migration Tags".</summary>
        public string TableName { get; set; } = "Migration Tags";
    }

    public class CreateMigrationTagsResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public List<string> Created { get; set; } = new List<string>();
        public List<string> Skipped { get; set; } = new List<string>();
        public List<string> Errors { get; set; } = new List<string>();
    }

    // --- Migration Block Reimport ---

    public class ReimportMigrationBlocksRequest
    {
        /// <summary>Map of block name → fixed SimaticML XML to reimport.</summary>
        public Dictionary<string, string> Blocks { get; set; } = new Dictionary<string, string>();
        /// <summary>If true, compile all blocks after reimport.</summary>
        public bool Compile { get; set; } = false;
    }

    public class ReimportMigrationBlocksResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public List<string> Imported { get; set; } = new List<string>();
        public List<string> Errors { get; set; } = new List<string>();
    }

    public class DownloadResultDto
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public int Warnings { get; set; }
        public int Errors { get; set; }
    }

    // --- Internal Job State ---

    public class JobState
    {
        public string JobId { get; set; }
        public string JobType { get; set; }
        public string Status { get; set; } = "PENDING";
        public int Progress { get; set; }
        public string CurrentStep { get; set; } = "";
        public ManifestDto Manifest { get; set; }
        public string ArtifactBundle { get; set; }
        public string TiaProjectPath { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime? StartedAt { get; set; }
        public DateTime? CompletedAt { get; set; }
        public string ErrorMessage { get; set; }
        public CompileResultDto CompileResult { get; set; }
        public List<string> ImportedArtifacts { get; set; } = new List<string>();
        public List<string> SkippedArtifacts { get; set; } = new List<string>();
        public bool CancellationRequested { get; set; }

        public JobStatusResponse ToStatusResponse()
        {
            return new JobStatusResponse
            {
                JobId = JobId,
                Status = Status,
                Progress = Progress,
                CurrentStep = CurrentStep,
                CreatedAt = CreatedAt.ToString("o"),
                StartedAt = StartedAt?.ToString("o"),
                CompletedAt = CompletedAt?.ToString("o"),
                ErrorMessage = ErrorMessage
            };
        }

        public JobResultsResponse ToResultsResponse()
        {
            return new JobResultsResponse
            {
                JobId = JobId,
                CompileResult = CompileResult,
                ImportedArtifacts = ImportedArtifacts,
                SkippedArtifacts = SkippedArtifacts
            };
        }
    }

    // --- File Browse ---

    public class BrowseFileRequest
    {
        public string Title { get; set; }
        public string Filter { get; set; }
        public string InitialDirectory { get; set; }
    }

    public class BrowseFileResponse
    {
        public bool Success { get; set; }
        public string FilePath { get; set; }
        public string FileName { get; set; }
    }

    // ============================================================
    // Directory listing (local filesystem)
    // ============================================================

    public class ListDirectoryRequest
    {
        public string Path { get; set; }
    }

    public class ListDirectoryResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public List<DirectoryEntryDto> Entries { get; set; } = new List<DirectoryEntryDto>();
    }

    public class DirectoryEntryDto
    {
        public string Name { get; set; }
        public string Path { get; set; }
        public string Type { get; set; } // "directory" or "file"
    }

    // ============================================================
    // Pac-Audit: Full project extraction DTOs
    // ============================================================

    public class ProjectInfoResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public string ProjectName { get; set; }
        public string ProjectPath { get; set; }
        public string TiaVersion { get; set; }
        public string CpuFamily { get; set; }
        public string CpuOrderNumber { get; set; }
        public int BlockCount { get; set; }
        public int UdtCount { get; set; }
        public int TagTableCount { get; set; }
        public int HmiScreenCount { get; set; }
        public int DeviceCount { get; set; }
        /// <summary>ISO-8601 timestamp from _project.LastModified. Used for stale-snapshot detection.</summary>
        public string LastModifiedAt { get; set; }
    }

    public class ExtractProjectResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public List<ExtractedFolderDto> Folders { get; set; } = new List<ExtractedFolderDto>();
        public List<ExtractedBlockDto> Blocks { get; set; } = new List<ExtractedBlockDto>();
        public List<ExtractedTagTableDto> TagTables { get; set; } = new List<ExtractedTagTableDto>();
        public ExtractedHardwareDto Hardware { get; set; }
        public List<ExtractedCrossReferenceDto> CrossReferences { get; set; } = new List<ExtractedCrossReferenceDto>();
        /// <summary>Per-channel IO detail for Trace joins. One row per channel. See PAC_AUDIT_DERIVED_SPEC §12.6.</summary>
        public List<ExtractedModuleChannelDto> ModuleChannels { get; set; } = new List<ExtractedModuleChannelDto>();
        /// <summary>HMI panels linked to the project with nested screen + tag-table inventory.</summary>
        public List<ExtractedHmiTargetDto> HmiTargets { get; set; } = new List<ExtractedHmiTargetDto>();
        /// <summary>
        /// Per-drive Sinamics detail (nameplate, ramps, telegrams). One row per drive device
        /// classified as `drive.sinamics.*` in ExtractedDeviceDto.Category. See §12.6 / §16 step 4.
        /// </summary>
        public List<ExtractedDriveDetailDto> DriveDetails { get; set; } = new List<ExtractedDriveDetailDto>();
        /// <summary>ISO-8601 timestamp captured at extract time. Persisted to audit_projects.tia_project_modified_at for stale detection.</summary>
        public string LastModifiedAt { get; set; }
        public List<string> Warnings { get; set; } = new List<string>();
    }

    public class ExtractedFolderDto
    {
        public string Id { get; set; }
        public string ParentId { get; set; }
        public string Name { get; set; }
        public string FolderType { get; set; }
        public string Path { get; set; }
        public int Depth { get; set; }
    }

    public class ExtractedBlockDto
    {
        public string Name { get; set; }
        public string BlockType { get; set; }
        public int? BlockNumber { get; set; }
        public string ProgrammingLanguage { get; set; }
        public string SourceCode { get; set; }
        public string SourceFormat { get; set; }
        public string FolderPath { get; set; }
        public string FolderId { get; set; }
        public int? LineCount { get; set; }
    }

    public class ExtractedTagTableDto
    {
        public string Name { get; set; }
        public List<ExtractedTagDto> Tags { get; set; } = new List<ExtractedTagDto>();
    }

    public class ExtractedTagDto
    {
        public string Name { get; set; }
        public string DataType { get; set; }
        public string Address { get; set; }
        public string Comment { get; set; }
    }

    public class ExtractedHardwareDto
    {
        public List<ExtractedDeviceDto> Devices { get; set; } = new List<ExtractedDeviceDto>();
        public List<ExtractedIoModuleDto> IoModules { get; set; } = new List<ExtractedIoModuleDto>();
        public List<ExtractedNetworkDto> Networks { get; set; } = new List<ExtractedNetworkDto>();
    }

    public class ExtractedDeviceDto
    {
        public string Name { get; set; }
        public string TypeId { get; set; }
        public string OrderNumber { get; set; }
        public string FirmwareVersion { get; set; }
        /// <summary>
        /// Engineer's physical-device label from DeviceItem.GetAttribute("Comment") — e.g.
        /// "FREEZER Pallet Chain conveyor 1500L-01A Ground Level". Primary source for §12.6
        /// physical-device attribution on drives; populated opportunistically for every device
        /// that exposes the attribute. Null when absent.
        /// </summary>
        public string Comment { get; set; }
        /// <summary>
        /// Classification label from GSDML VendorName + family heuristics (§16 step 4). Uses
        /// dot-notation: "drive.sinamics.g120c", "roller_card.interroll", "load_cell.siwarex",
        /// "hmi", "io_module.generic", "other.pn_device". Null when classification found no
        /// matching rule (e.g. CPUs — handled outside the GSDML path).
        /// </summary>
        public string Category { get; set; }
        /// <summary>
        /// Vendor name from the matched GSDML (e.g. "SIEMENS AG", "Interroll Engineering GmbH",
        /// "Pulseroller", "Itoh Denki Co., Ltd."). Null when no GSDML matched.
        /// </summary>
        public string VendorName { get; set; }
        /// <summary>
        /// GSDML filename the device resolved to (e.g. "GSDML-V2.31-Siemens-SINAMICS_G120C-...xml").
        /// Parsed out of the TypeIdentifier `GSD:&lt;filename&gt;/...` prefix where present.
        /// Null when the device uses an `OrderNumber:` identifier (catalog-only, no GSDML).
        /// </summary>
        public string GsdmlFilename { get; set; }
        /// <summary>Primary IP address on the device's PROFINET interface. Null when not discoverable.</summary>
        public string IpAddress { get; set; }
        /// <summary>PROFINET station name. Null when not set.</summary>
        public string StationName { get; set; }
    }

    public class ExtractedIoModuleDto
    {
        public string Name { get; set; }
        public string TypeId { get; set; }
        /// <summary>Parsed catalog number from TypeId (e.g. "6ES7 521-1BH50-0AA0"). Primary handle for GSDML / HSP lookup.</summary>
        public string Mlfb { get; set; }
        /// <summary>Parsed firmware version from TypeId (e.g. "V1.2").</summary>
        public string FirmwareVersion { get; set; }
        public int Rack { get; set; }
        public int Slot { get; set; }
    }

    public class ExtractedNetworkDto
    {
        public string Name { get; set; }
        public string Type { get; set; }
        public List<string> Devices { get; set; } = new List<string>();
    }

    /// <summary>
    /// One row per (source-block → referenced-object → location) triple, flattened from Openness
    /// CrossReferenceService.GetCrossReferences(AllObjects). Persisted to audit_cross_references.
    /// See PAC_AUDIT_DERIVED_SPEC.md §12.0 + §12.2.
    /// </summary>
    public class ExtractedCrossReferenceDto
    {
        // Source side — mirrors SourceObject
        public string SourceName { get; set; }
        public string SourcePath { get; set; }
        public string SourceAddress { get; set; }
        public string SourceTypeName { get; set; }
        public string SourceDevice { get; set; }

        // Reference target side — mirrors ReferenceObject
        public string TargetName { get; set; }
        public string TargetPath { get; set; }
        public string TargetAddress { get; set; }
        public string TargetTypeName { get; set; }
        public string TargetDevice { get; set; }

        // Location — per-occurrence inside source
        public string Access { get; set; }            // Access enum — Read/Write/RW/Call/InstanceDB/Multiinstance/Interface/Definition/...
        public string ReferenceType { get; set; }     // ReferenceType enum — Uses/UsedBy/TypeInstance/InstanceType/Assigns/...
        public string ReferenceLocation { get; set; } // human-readable, e.g. "@CALL_SENSORS ▶ NW4 (Function Block SENSOR_FB)"
        public string ReferencedAsName { get; set; }
        public string LocationAddress { get; set; }
        public string LocationName { get; set; }      // the symbolic path at the site, e.g. "DB_SENSORS.SENSOR_FB[15]._ClearDly"
        public string LocationTypeName { get; set; }
    }

    /// <summary>
    /// One row per physical IO channel, derived from walking Device.DeviceItems and unrolling
    /// module-level `StartAddress` across the module's channel count. See PAC_AUDIT_DERIVED_SPEC
    /// §12.6. Populated by ExtractModuleChannels; persisted to audit_module_channels.
    /// </summary>
    public class ExtractedModuleChannelDto
    {
        /// <summary>Parent IO module name — joins to ExtractedIoModuleDto.Name.</summary>
        public string ModuleName { get; set; }
        /// <summary>Parent module catalog number (e.g. "6ES7 521-1BH50-0AA0"). Copied from ExtractedIoModuleDto.Mlfb; the authoritative handle for GSDML/HSP lookup.</summary>
        public string ModuleMlfb { get; set; }
        /// <summary>Zero-based channel index within the module.</summary>
        public int ChannelNumber { get; set; }
        /// <summary>Absolute TIA address, e.g. "%I0.0", "%Q1.3", "%IW256", "%QW256".</summary>
        public string IoAddress { get; set; }
        /// <summary>DI / DO / AI / AO / DIQ / RS485 / other — inferred from address prefix + module TypeIdentifier.</summary>
        public string SignalType { get; set; }
        /// <summary>Symbolic tag, joined from the project tag tables by address. Null when no tag binds this address.</summary>
        public string SymbolicTag { get; set; }
        /// <summary>True when the module's TypeIdentifier/name marks it as F-I/O (e.g. FDI, FDO, SM 336F).</summary>
        public bool IsSafety { get; set; }
        /// <summary>Channel-level comment when available (often null on V18 for non-safety modules).</summary>
        public string ChannelComment { get; set; }
        /// <summary>How this channel's count was derived — for provenance/debug. One of: "length_in_bits", "length_bytes", "name_pattern", "single_row".</summary>
        public string ChannelCountSource { get; set; }
        public int Rack { get; set; }
        public int Slot { get; set; }
    }

    /// <summary>
    /// One row per HMI panel linked to the project. _project.HmiTargets is not surfaced on V18;
    /// this is populated by walking Devices for HmiTarget software containers. See §12.6.
    /// </summary>
    public class ExtractedHmiTargetDto
    {
        /// <summary>HmiTarget.Name.</summary>
        public string Name { get; set; }
        /// <summary>Parent Device.Name.</summary>
        public string DeviceName { get; set; }
        /// <summary>Device.TypeIdentifier, e.g. "OrderNumber:6AV2124-0MC01-0AX0/15.1.0.0".</summary>
        public string TypeId { get; set; }
        /// <summary>Parsed MLFB from TypeId, e.g. "6AV2124-0MC01-0AX0".</summary>
        public string OrderNumber { get; set; }
        /// <summary>Parsed firmware version from TypeId.</summary>
        public string FirmwareVersion { get; set; }
        /// <summary>HmiTarget model class name, e.g. "ComfortPanel", "BasicPanel", "UnifiedComfortPanel".</summary>
        public string PanelClass { get; set; }
        /// <summary>Primary IP address if a PROFINET interface is discoverable.</summary>
        public string IpAddress { get; set; }
        /// <summary>PROFINET station name if present.</summary>
        public string StationName { get; set; }
        public int ScreenCount { get; set; }
        public int TagTableCount { get; set; }
        public List<ExtractedHmiScreenDto> Screens { get; set; } = new List<ExtractedHmiScreenDto>();
    }

    public class ExtractedHmiScreenDto
    {
        public string Name { get; set; }
        /// <summary>Forward-slash separated folder path under ScreenFolder root.</summary>
        public string FolderPath { get; set; }
        public int? Number { get; set; }
    }

    /// <summary>
    /// Per-drive Sinamics detail captured via Siemens.Engineering.MC.Drives.DriveObjectContainer.
    /// One row per drive device (matched to ExtractedDeviceDto.Name). Parameters below are
    /// nullable because Startdrive integration is optional — a project downloaded without
    /// Startdrive will return nulls for nameplate/ramp fields. See PAC_AUDIT_DERIVED_SPEC §12.6.
    /// </summary>
    public class ExtractedDriveDetailDto
    {
        /// <summary>Joins back to ExtractedDeviceDto.Name.</summary>
        public string DeviceName { get; set; }
        /// <summary>Engineer's physical-device label from DeviceItem.GetAttribute("Comment"). Primary attribution signal per §12.6.</summary>
        public string Comment { get; set; }
        /// <summary>Drive family derived from MLFB/TypeIdentifier — "G120C", "G120", "S120", "S210", "V90", or null when unrecognised.</summary>
        public string DriveFamily { get; set; }
        /// <summary>MLFB / order number (e.g. "6SL3210-1KE18-8AF1").</summary>
        public string Mlfb { get; set; }
        /// <summary>Firmware version suffix (e.g. "4.7.13").</summary>
        public string FirmwareVersion { get; set; }
        public string IpAddress { get; set; }
        public string StationName { get; set; }

        // Motor nameplate — P304/P305/P311. Values are doubles where present.
        public double? MotorRatedPowerKw { get; set; }      // P304
        public double? MotorRatedCurrentA { get; set; }     // P305
        public double? MotorRatedSpeedRpm { get; set; }     // P311
        public double? MotorRatedVoltageV { get; set; }     // P304 sibling (P304[V] on some drives); nullable

        // Ramps — P1120 / P1121 / P1135. Seconds.
        public double? RampUpSeconds { get; set; }          // P1120
        public double? RampDownSeconds { get; set; }        // P1121
        public double? RampOffStopSeconds { get; set; }     // P1135

        /// <summary>Telegram number of the PROFIdrive main telegram (e.g. 352 = G120 Standard, 1 = Std msg 1). From Telegrams collection Type="MainTelegram".</summary>
        public int? MainTelegramNumber { get; set; }
        /// <summary>Telegram number of the PROFIsafe telegram (30 = PROFIsafe standard). From Telegrams collection Type="SafetyTelegram".</summary>
        public int? SafetyTelegramNumber { get; set; }
        public List<ExtractedDriveTelegramDto> Telegrams { get; set; } = new List<ExtractedDriveTelegramDto>();

        /// <summary>Populated only for parameters the extractor explicitly probes (nameplate + ramps + P922). Keyed snapshot useful for debugging missing values.</summary>
        public List<ExtractedDriveParameterDto> SelectedParameters { get; set; } = new List<ExtractedDriveParameterDto>();

        /// <summary>"starter" when any parameter values returned non-null; "partial" when some returned null; "not_available" when the DriveObjectContainer was absent entirely; "gsdml" reserved for future GSDML-only fallback path.</summary>
        public string ParameterSource { get; set; }

        /// <summary>Per-drive warnings surfaced during extraction (API errors, missing collections, etc.).</summary>
        public List<string> Warnings { get; set; } = new List<string>();
    }

    public class ExtractedDriveParameterDto
    {
        /// <summary>Parameter number (e.g. 304 for P304, 20 for r20).</summary>
        public int Number { get; set; }
        /// <summary>Short name from Openness (e.g. "p304", "r18").</summary>
        public string Name { get; set; }
        /// <summary>Human-readable description (e.g. "Rated motor power").</summary>
        public string Text { get; set; }
        /// <summary>Value as string — nameplate params are doubles, others vary (ints, enums, FW-version codes).</summary>
        public string Value { get; set; }
        /// <summary>Engineering unit (e.g. "kW", "A", "rpm", "V", "s", "Hz"); empty when unitless.</summary>
        public string Unit { get; set; }
    }

    public class ExtractedDriveTelegramDto
    {
        /// <summary>PROFIdrive telegram number (30 = PROFIsafe, 352 = G120 standard, 1 = Std msg 1, …).</summary>
        public int TelegramNumber { get; set; }
        /// <summary>"MainTelegram" or "SafetyTelegram".</summary>
        public string Type { get; set; }
        /// <summary>Formatted input address range if present (e.g. "%IW256..%IW267").</summary>
        public string InputAddress { get; set; }
        /// <summary>Formatted output address range if present.</summary>
        public string OutputAddress { get; set; }
    }

    // --- Pac-Audit Openness API spike (Step 0) ---

    public class AuditSpikeResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public string OutputDirectory { get; set; }
        public string RunAt { get; set; }
        public string TiaVersion { get; set; }
        public string ProjectName { get; set; }
        public List<SpikeFinding> Findings { get; set; } = new List<SpikeFinding>();
    }

    public class SpikeFinding
    {
        public string Category { get; set; }
        public string Name { get; set; }
        public bool Success { get; set; }
        public int? ItemCount { get; set; }
        public double ElapsedMs { get; set; }
        public string SampleFile { get; set; }
        public string Notes { get; set; }
    }
}
