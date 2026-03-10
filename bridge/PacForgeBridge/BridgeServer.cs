using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace PacForgeBridge
{
    public class BridgeServer
    {
        private readonly HttpListener _listener;
        private readonly JobExecutor _jobExecutor;
        private readonly WebSocketHandler _wsHandler;
        private readonly TiaPortalService _tiaService;
        private CancellationTokenSource _cts;

        public BridgeServer(int port, JobExecutor jobExecutor, WebSocketHandler wsHandler, TiaPortalService tiaService)
        {
            _listener = new HttpListener();
            _listener.Prefixes.Add($"http://localhost:{port}/");
            _jobExecutor = jobExecutor;
            _wsHandler = wsHandler;
            _tiaService = tiaService;
        }

        public void Start()
        {
            _cts = new CancellationTokenSource();
            _listener.Start();
            Task.Run(() => AcceptLoop(_cts.Token));
        }

        public void Stop()
        {
            _cts?.Cancel();
            _listener.Stop();
        }

        private async Task AcceptLoop(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    var context = await _listener.GetContextAsync();
                    // Fire and forget — each request handled independently
                    _ = Task.Run(() => HandleRequest(context));
                }
                catch (HttpListenerException) when (ct.IsCancellationRequested)
                {
                    break;
                }
                catch (ObjectDisposedException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[HTTP] Accept error: {ex.Message}");
                }
            }
        }

        private async Task HandleRequest(HttpListenerContext context)
        {
            var req = context.Request;
            var res = context.Response;

            // CORS headers for Vite dev server
            res.Headers.Add("Access-Control-Allow-Origin", "*");
            res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            res.Headers.Add("Access-Control-Allow-Headers", "Content-Type");

            // Handle preflight
            if (req.HttpMethod == "OPTIONS")
            {
                res.StatusCode = 204;
                res.Close();
                return;
            }

            try
            {
                string path = req.Url.AbsolutePath.TrimEnd('/');
                string method = req.HttpMethod;

                // Route: GET /tia/status
                if (method == "GET" && path == "/tia/status")
                {
                    await HandleGetStatus(res);
                    return;
                }

                // Route: GET /tia/compile-result
                if (method == "GET" && path == "/tia/compile-result")
                {
                    var compileResult = _tiaService.LastCompileResult;
                    if (compileResult == null)
                    {
                        await WriteJson(res, 200, new TiaActionResponse
                        {
                            Success = true,
                            Message = "No compile results available"
                        });
                    }
                    else
                    {
                        var withSources = new CompileResultWithSourcesDto(compileResult, _tiaService.LastImportedSources);
                        await WriteJson(res, 200, withSources);
                    }
                    return;
                }

                // Route: POST /tia/reimport-compile
                if (method == "POST" && path == "/tia/reimport-compile")
                {
                    await HandleReimportCompile(req, res);
                    return;
                }

                // Route: POST /tia/export-sources
                if (method == "POST" && path == "/tia/export-sources")
                {
                    await HandleExportSources(res);
                    return;
                }

                // Route: POST /tia/export-hmi
                if (method == "POST" && path == "/tia/export-hmi")
                {
                    await HandleExportHmi(res);
                    return;
                }

                // Route: POST /tia/import-hmi
                if (method == "POST" && path == "/tia/import-hmi")
                {
                    await HandleImportHmi(req, res);
                    return;
                }

                // Route: POST /tia/export-hmi-graphics
                if (method == "POST" && path == "/tia/export-hmi-graphics")
                {
                    await HandleExportHmiGraphics(req, res);
                    return;
                }

                // Route: GET /tia/wincc-graphics-index
                if (method == "GET" && path == "/tia/wincc-graphics-index")
                {
                    await HandleWinccGraphicsIndex(res);
                    return;
                }

                // Route: GET /tia/wincc-graphic?path=...
                if (method == "GET" && path == "/tia/wincc-graphic")
                {
                    await HandleWinccGraphic(req, res);
                    return;
                }

                // Route: POST /tia/connect
                if (method == "POST" && path == "/tia/connect")
                {
                    await HandleConnect(req, res);
                    return;
                }

                // Route: POST /tia/disconnect
                if (method == "POST" && path == "/tia/disconnect")
                {
                    await HandleDisconnect(res);
                    return;
                }

                // Route: POST /tia/open-project
                if (method == "POST" && path == "/tia/open-project")
                {
                    await HandleOpenProject(req, res);
                    return;
                }

                // Route: POST /tia/demo/motor-control
                if (method == "POST" && path == "/tia/demo/motor-control")
                {
                    await HandleDemoMotorControl(req, res);
                    return;
                }

                // Route: POST /tia/demo/create — generic project from frontend-supplied SCL
                if (method == "POST" && path == "/tia/demo/create")
                {
                    await HandleDemoCreate(req, res);
                    return;
                }

                // Route: POST /tia/jobs
                if (method == "POST" && path == "/tia/jobs")
                {
                    await HandleSubmitJob(req, res);
                    return;
                }

                // Route: GET /tia/jobs/{id}
                var jobStatusMatch = Regex.Match(path, @"^/tia/jobs/([^/]+)$");
                if (method == "GET" && jobStatusMatch.Success)
                {
                    string jobId = jobStatusMatch.Groups[1].Value;
                    await HandleGetJobStatus(jobId, res);
                    return;
                }

                // Route: GET /tia/jobs/{id}/results
                var jobResultsMatch = Regex.Match(path, @"^/tia/jobs/([^/]+)/results$");
                if (method == "GET" && jobResultsMatch.Success)
                {
                    string jobId = jobResultsMatch.Groups[1].Value;
                    await HandleGetJobResults(jobId, res);
                    return;
                }

                // Route: POST /tia/jobs/{id}/cancel
                var jobCancelMatch = Regex.Match(path, @"^/tia/jobs/([^/]+)/cancel$");
                if (method == "POST" && jobCancelMatch.Success)
                {
                    string jobId = jobCancelMatch.Groups[1].Value;
                    await HandleCancelJob(jobId, res);
                    return;
                }

                // Route: POST /tia/library/open — Open and enumerate a TIA global library
                if (method == "POST" && path == "/tia/library/open")
                {
                    await HandleLibraryOpen(req, res);
                    return;
                }

                // Route: POST /tia/library/export — Export items from a TIA global library
                if (method == "POST" && path == "/tia/library/export")
                {
                    await HandleLibraryExport(req, res);
                    return;
                }

                // Route: GET /tia/ws — WebSocket upgrade
                if (path == "/tia/ws" && req.IsWebSocketRequest)
                {
                    var wsContext = await context.AcceptWebSocketAsync(null);
                    await _wsHandler.AcceptClient(wsContext.WebSocket);
                    return;
                }

                // 404
                await WriteJson(res, 404, new { error = "Not found" });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[HTTP] Error handling {req.HttpMethod} {req.Url.AbsolutePath}: {ex.Message}");
                try
                {
                    await WriteJson(res, 500, new { error = ex.Message });
                }
                catch { }
            }
        }

        // --- Route Handlers ---

        private async Task HandleGetStatus(HttpListenerResponse res)
        {
            var status = _tiaService.GetStatus();
            await WriteJson(res, 200, status);
        }

        private async Task HandleSubmitJob(HttpListenerRequest req, HttpListenerResponse res)
        {
            string body = await ReadBody(req);
            var request = Json.Deserialize<SubmitJobRequest>(body);

            if (request == null || string.IsNullOrEmpty(request.TiaProjectPath))
            {
                await WriteJson(res, 400, new { error = "Missing required fields (tia_project_path)" });
                return;
            }

            // Generate job ID if not provided by frontend
            if (string.IsNullOrEmpty(request.JobId))
            {
                request.JobId = Guid.NewGuid().ToString();
            }

            var job = _jobExecutor.EnqueueJob(request);

            var response = new SubmitJobResponse
            {
                JobId = job.JobId,
                Status = job.Status,
                CreatedAt = job.CreatedAt.ToString("o")
            };

            Console.WriteLine($"[JOB] Enqueued: {job.JobId} ({request.JobType})");
            await WriteJson(res, 201, response);
        }

        private async Task HandleGetJobStatus(string jobId, HttpListenerResponse res)
        {
            var job = _jobExecutor.GetJob(jobId);
            if (job == null)
            {
                await WriteJson(res, 404, new { error = "Job not found" });
                return;
            }
            await WriteJson(res, 200, job.ToStatusResponse());
        }

        private async Task HandleGetJobResults(string jobId, HttpListenerResponse res)
        {
            var job = _jobExecutor.GetJob(jobId);
            if (job == null)
            {
                await WriteJson(res, 404, new { error = "Job not found" });
                return;
            }
            await WriteJson(res, 200, job.ToResultsResponse());
        }

        private async Task HandleCancelJob(string jobId, HttpListenerResponse res)
        {
            bool cancelled = _jobExecutor.CancelJob(jobId);
            if (!cancelled)
            {
                await WriteJson(res, 404, new { error = "Job not found or already completed" });
                return;
            }

            var response = new CancelJobResponse
            {
                JobId = jobId,
                Status = "CANCELLED",
                CancelledAt = DateTime.UtcNow.ToString("o")
            };

            Console.WriteLine($"[JOB] Cancelled: {jobId}");
            await WriteJson(res, 200, response);
        }

        private async Task HandleConnect(HttpListenerRequest req, HttpListenerResponse res)
        {
            try
            {
                string body = await ReadBody(req);
                var request = string.IsNullOrEmpty(body) ? new ConnectRequest() : Json.Deserialize<ConnectRequest>(body);

                bool preferAttach = request?.Mode != "start";
                bool withUi = request?.WithUi ?? true;
                _tiaService.Connect(preferAttach, withUi);

                var status = _tiaService.GetStatus();
                await WriteJson(res, 200, new TiaActionResponse
                {
                    Success = true,
                    Message = "Connected to TIA Portal",
                    Details = new System.Collections.Generic.Dictionary<string, object>
                    {
                        ["tia_version"] = status.TiaVersion,
                        ["project_open"] = status.TiaProjectOpen
                    }
                });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[TIA] Connect failed: {ex.Message}");
                await WriteJson(res, 500, new TiaActionResponse
                {
                    Success = false,
                    Message = ex.Message
                });
            }
        }

        private string FindWinccGraphicsZip()
        {
            string basePath = @"C:\Program Files\Siemens\Automation";
            string[] versions = { "Portal V20", "Portal V19", "Portal V18", "Portal V17" };
            foreach (var v in versions)
            {
                string zipPath = Path.Combine(basePath, v, "lib", "Graphics", "Graphics_All.zip");
                if (File.Exists(zipPath)) return zipPath;
            }
            return null;
        }

        private async Task HandleWinccGraphicsIndex(HttpListenerResponse res)
        {
            try
            {
                string zipPath = FindWinccGraphicsZip();
                if (zipPath == null)
                {
                    await WriteJson(res, 404, new { success = false, message = "Graphics_All.zip not found in any TIA Portal installation." });
                    return;
                }

                Console.WriteLine($"[TIA] Loading WinCC graphics index from: {zipPath}");
                var imageExts = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
                    { ".png", ".svg", ".jpg", ".jpeg", ".gif", ".bmp" };

                var entries = new List<object>();
                using (var zip = System.IO.Compression.ZipFile.OpenRead(zipPath))
                {
                    foreach (var entry in zip.Entries)
                    {
                        string ext = Path.GetExtension(entry.FullName);
                        if (!imageExts.Contains(ext) || entry.Length == 0) continue;

                        string name = Path.GetFileNameWithoutExtension(entry.Name);
                        string category = Path.GetDirectoryName(entry.FullName)?.Replace("\\", "/") ?? "";
                        // Clean category: remove [EMF], [SVG], [PNG], [WMF] tags
                        category = System.Text.RegularExpressions.Regex.Replace(category, @"\s*\[(EMF|SVG|PNG|WMF)\]", "");

                        entries.Add(new { name, path = entry.FullName.Replace("\\", "/"), category, size = entry.Length });
                    }
                }

                Console.WriteLine($"[TIA] WinCC graphics index: {entries.Count} entries");
                await WriteJson(res, 200, new { success = true, zip_path = zipPath, entries });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[TIA] WinCC graphics index error: {ex.Message}");
                await WriteJson(res, 500, new { success = false, message = ex.Message });
            }
        }

        private async Task HandleWinccGraphic(HttpListenerRequest req, HttpListenerResponse res)
        {
            try
            {
                string graphicPath = req.QueryString["path"];
                if (string.IsNullOrEmpty(graphicPath))
                {
                    await WriteJson(res, 400, new { success = false, message = "Missing 'path' query parameter." });
                    return;
                }

                string zipPath = FindWinccGraphicsZip();
                if (zipPath == null)
                {
                    await WriteJson(res, 404, new { success = false, message = "Graphics_All.zip not found." });
                    return;
                }

                using (var zip = System.IO.Compression.ZipFile.OpenRead(zipPath))
                {
                    var entry = zip.GetEntry(graphicPath);
                    if (entry == null)
                    {
                        await WriteJson(res, 404, new { success = false, message = $"Entry not found: {graphicPath}" });
                        return;
                    }

                    using (var stream = entry.Open())
                    using (var ms = new MemoryStream())
                    {
                        stream.CopyTo(ms);
                        byte[] bytes = ms.ToArray();
                        string ext = Path.GetExtension(graphicPath).ToLowerInvariant();
                        string mime = ext == ".svg" ? "image/svg+xml" :
                                      ext == ".jpg" || ext == ".jpeg" ? "image/jpeg" :
                                      ext == ".gif" ? "image/gif" :
                                      ext == ".bmp" ? "image/bmp" :
                                      "image/png";

                        // Return as raw image (not JSON) for direct use as img src
                        res.ContentType = mime;
                        res.StatusCode = 200;
                        res.ContentLength64 = bytes.Length;
                        await res.OutputStream.WriteAsync(bytes, 0, bytes.Length);
                        res.Close();
                    }
                }
            }
            catch (Exception ex)
            {
                await WriteJson(res, 500, new { success = false, message = ex.Message });
            }
        }

        private async Task HandleDisconnect(HttpListenerResponse res)
        {
            try
            {
                _tiaService.Disconnect();
                await WriteJson(res, 200, new TiaActionResponse
                {
                    Success = true,
                    Message = "Disconnected from TIA Portal"
                });
            }
            catch (Exception ex)
            {
                await WriteJson(res, 500, new TiaActionResponse
                {
                    Success = false,
                    Message = ex.Message
                });
            }
        }

        private async Task HandleOpenProject(HttpListenerRequest req, HttpListenerResponse res)
        {
            try
            {
                string body = await ReadBody(req);
                var request = Json.Deserialize<OpenProjectRequest>(body);

                if (request == null || string.IsNullOrEmpty(request.ProjectPath))
                {
                    await WriteJson(res, 400, new TiaActionResponse
                    {
                        Success = false,
                        Message = "Missing project_path"
                    });
                    return;
                }

                _tiaService.Connect(preferAttach: true);
                _tiaService.OpenProject(request.ProjectPath);

                await WriteJson(res, 200, new TiaActionResponse
                {
                    Success = true,
                    Message = $"Project opened",
                    Details = new System.Collections.Generic.Dictionary<string, object>
                    {
                        ["project_path"] = request.ProjectPath
                    }
                });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[TIA] Open project failed: {ex.Message}");
                await WriteJson(res, 500, new TiaActionResponse
                {
                    Success = false,
                    Message = ex.Message
                });
            }
        }

        private async Task HandleDemoMotorControl(HttpListenerRequest req, HttpListenerResponse res)
        {
            try
            {
                string body = await ReadBody(req);
                var request = Json.Deserialize<DemoRequest>(body);

                string projectPath = request?.ProjectPath ?? @"C:\TIA_Projects";
                string projectName = request?.ProjectName ?? "PacForge_Demo";

                Console.WriteLine($"[DEMO] Creating motor control demo: {projectName} in {projectPath}");

                var result = _tiaService.CreateDemoMotorProject(projectPath, projectName);

                await WriteJson(res, 200, new TiaActionResponse
                {
                    Success = result.Success,
                    Message = result.Success
                        ? $"Demo project created with {result.ImportedBlocks.Count} blocks"
                        : "Demo project created with warnings",
                    Details = new System.Collections.Generic.Dictionary<string, object>
                    {
                        ["project_path"] = result.ProjectPath,
                        ["device"] = result.DeviceName,
                        ["imported_blocks"] = result.ImportedBlocks,
                        ["warnings"] = result.Warnings,
                        ["compile_result"] = result.CompileResult
                    }
                });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[DEMO] Failed: {ex.Message}");
                Console.WriteLine($"[DEMO] Stack: {ex.StackTrace}");
                await WriteJson(res, 500, new TiaActionResponse
                {
                    Success = false,
                    Message = ex.Message
                });
            }
        }

        private async Task HandleDemoCreate(HttpListenerRequest req, HttpListenerResponse res)
        {
            try
            {
                string body = await ReadBody(req);
                var request = Json.Deserialize<CreateProjectWithSourcesRequest>(body);

                if (request?.Sources == null || request.Sources.Count == 0)
                {
                    await WriteJson(res, 400, new TiaActionResponse
                    {
                        Success = false,
                        Message = "Missing or empty sources"
                    });
                    return;
                }

                string projectPath = request.ProjectPath ?? @"C:\TIA_Projects";
                string projectName = request.ProjectName ?? "PacForge_Project";
                var importOrder = request.ImportOrder ?? new System.Collections.Generic.List<string>(request.Sources.Keys);

                Console.WriteLine($"[DEMO] Creating project with {request.Sources.Count} source(s): {projectName} in {projectPath}");

                var result = _tiaService.CreateProjectWithSources(projectPath, projectName, request.Sources, importOrder, request.IoModules, request.IoTags);

                await WriteJson(res, 200, new TiaActionResponse
                {
                    Success = result.Success,
                    Message = result.Success
                        ? $"Project created with {result.ImportedBlocks.Count} blocks"
                        : "Project created with warnings",
                    Details = new System.Collections.Generic.Dictionary<string, object>
                    {
                        ["project_path"] = result.ProjectPath,
                        ["device"] = result.DeviceName,
                        ["imported_blocks"] = result.ImportedBlocks,
                        ["warnings"] = result.Warnings,
                        ["compile_result"] = result.CompileResult
                    }
                });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[DEMO] Create failed: {ex.Message}");
                Console.WriteLine($"[DEMO] Stack: {ex.StackTrace}");
                await WriteJson(res, 500, new TiaActionResponse
                {
                    Success = false,
                    Message = ex.Message
                });
            }
        }

        private async Task HandleExportSources(HttpListenerResponse res)
        {
            try
            {
                Console.WriteLine("[TIA] Exporting sources from TIA Portal...");
                var result = _tiaService.ExportSources();
                await WriteJson(res, 200, result);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[TIA] Export sources failed: {ex.Message}");
                await WriteJson(res, 500, new ExportSourcesResponse
                {
                    Success = false,
                    Message = ex.Message
                });
            }
        }

        private async Task HandleImportHmi(HttpListenerRequest req, HttpListenerResponse res)
        {
            try
            {
                string body = await ReadBody(req);
                var request = Newtonsoft.Json.JsonConvert.DeserializeObject<ImportHmiRequest>(body);
                if (request == null)
                {
                    await WriteJson(res, 400, new ImportHmiResponse
                    {
                        Success = false,
                        Message = "Invalid request body"
                    });
                    return;
                }

                Console.WriteLine("[TIA] Importing HMI artifacts into TIA Portal...");
                var result = _tiaService.ImportHmiArtifacts(request);
                await WriteJson(res, 200, result);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[TIA] HMI import failed: {ex.Message}");
                await WriteJson(res, 500, new ImportHmiResponse
                {
                    Success = false,
                    Message = ex.Message
                });
            }
        }

        private async Task HandleExportHmi(HttpListenerResponse res)
        {
            try
            {
                Console.WriteLine("[TIA] Exporting HMI screens from TIA Portal...");
                var result = _tiaService.ExportHmiScreens();
                await WriteJson(res, 200, result);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[TIA] HMI export failed: {ex.Message}");
                await WriteJson(res, 500, new ExportHmiResponse
                {
                    Success = false,
                    Message = ex.Message
                });
            }
        }

        private async Task HandleExportHmiGraphics(HttpListenerRequest req, HttpListenerResponse res)
        {
            try
            {
                string body = await ReadBody(req);
                List<string> graphicNames = null;
                if (!string.IsNullOrWhiteSpace(body))
                {
                    try
                    {
                        var parsed = Newtonsoft.Json.Linq.JObject.Parse(body);
                        var namesToken = parsed["graphic_names"];
                        if (namesToken != null && namesToken.Type == Newtonsoft.Json.Linq.JTokenType.Array)
                        {
                            graphicNames = namesToken.ToObject<List<string>>();
                        }
                    }
                    catch { }
                }

                Console.WriteLine($"[TIA] Exporting HMI graphics (filter: {(graphicNames != null ? graphicNames.Count + " names" : "none")})...");
                var result = _tiaService.ExportHmiGraphics(graphicNames);
                await WriteJson(res, 200, result);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[TIA] HMI graphics export failed: {ex.Message}");
                await WriteJson(res, 500, new ExportHmiGraphicsResponse
                {
                    Success = false,
                    Message = ex.Message
                });
            }
        }

        private async Task HandleReimportCompile(HttpListenerRequest req, HttpListenerResponse res)
        {
            try
            {
                string body = await ReadBody(req);
                var request = Json.Deserialize<ReimportRequest>(body);

                if (request?.Sources == null || request.Sources.Count == 0)
                {
                    await WriteJson(res, 400, new TiaActionResponse
                    {
                        Success = false,
                        Message = "Missing or empty sources"
                    });
                    return;
                }

                Console.WriteLine($"[TIA] Reimport + compile: {request.Sources.Count} source(s)");
                var compileResult = _tiaService.ReimportAndCompile(request.Sources);
                var withSources = new CompileResultWithSourcesDto(compileResult, _tiaService.LastImportedSources);
                await WriteJson(res, 200, withSources);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[TIA] Reimport-compile failed: {ex.Message}");
                await WriteJson(res, 500, new TiaActionResponse
                {
                    Success = false,
                    Message = ex.Message
                });
            }
        }

        private async Task HandleLibraryOpen(HttpListenerRequest req, HttpListenerResponse res)
        {
            try
            {
                string body = await ReadBody(req);
                var request = Json.Deserialize<OpenLibraryRequest>(body);

                if (request == null || string.IsNullOrEmpty(request.LibraryPath))
                {
                    await WriteJson(res, 400, new LibraryContentsResponse
                    {
                        Success = false,
                        Message = "Missing library_path"
                    });
                    return;
                }

                Console.WriteLine($"[TIA] Opening library: {request.LibraryPath}");
                var result = _tiaService.OpenAndReadLibrary(request.LibraryPath);
                await WriteJson(res, 200, result);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[TIA] Library open failed: {ex.Message}");
                await WriteJson(res, 500, new LibraryContentsResponse
                {
                    Success = false,
                    Message = ex.Message
                });
            }
        }

        private async Task HandleLibraryExport(HttpListenerRequest req, HttpListenerResponse res)
        {
            try
            {
                string body = await ReadBody(req);
                var request = Json.Deserialize<ExportLibraryRequest>(body);

                if (request == null || string.IsNullOrEmpty(request.LibraryPath))
                {
                    await WriteJson(res, 400, new LibraryExportResponse
                    {
                        Success = false,
                        Message = "Missing library_path"
                    });
                    return;
                }

                Console.WriteLine($"[TIA] Exporting from library: {request.LibraryPath} ({(request.ItemPaths?.Count ?? 0)} items)");
                var result = _tiaService.ExportLibraryItems(request.LibraryPath, request.ItemPaths);
                await WriteJson(res, 200, result);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[TIA] Library export failed: {ex.Message}");
                await WriteJson(res, 500, new LibraryExportResponse
                {
                    Success = false,
                    Message = ex.Message
                });
            }
        }

        // --- Helpers ---

        private static async Task<string> ReadBody(HttpListenerRequest req)
        {
            using (var reader = new StreamReader(req.InputStream, Encoding.UTF8))
            {
                return await reader.ReadToEndAsync();
            }
        }

        private static async Task WriteJson(HttpListenerResponse res, int statusCode, object body)
        {
            res.StatusCode = statusCode;
            res.ContentType = "application/json; charset=utf-8";
            string json = Json.Serialize(body);
            byte[] bytes = Encoding.UTF8.GetBytes(json);
            res.ContentLength64 = bytes.Length;
            await res.OutputStream.WriteAsync(bytes, 0, bytes.Length);
            res.Close();
        }
    }
}
