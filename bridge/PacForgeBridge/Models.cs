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
    }

    public class ProvisionProjectResponse
    {
        public bool Success { get; set; }
        public bool Created { get; set; }             // true = new project created, false = existing opened
        public string ProjectFilePath { get; set; }  // Full path to .ap* file
        public string Message { get; set; }
        public List<string> Warnings { get; set; } = new List<string>();
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
}
