using System;
using System.IO;
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
