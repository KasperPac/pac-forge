using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Threading;
using System.Threading.Tasks;
using Siemens.Engineering.SW;

namespace PacForgeBridge
{
    public class JobExecutor
    {
        private readonly TiaPortalService _tiaService;
        private readonly WebSocketHandler _wsHandler;
        private readonly ConcurrentDictionary<string, JobState> _jobs
            = new ConcurrentDictionary<string, JobState>();
        private readonly ConcurrentQueue<string> _queue = new ConcurrentQueue<string>();
        private readonly AutoResetEvent _signal = new AutoResetEvent(false);
        private Thread _worker;
        private volatile bool _running;

        public JobExecutor(TiaPortalService tiaService, WebSocketHandler wsHandler)
        {
            _tiaService = tiaService;
            _wsHandler = wsHandler;
        }

        public void Start()
        {
            _running = true;
            _worker = new Thread(WorkerLoop)
            {
                Name = "JobExecutor",
                IsBackground = true
            };
            _worker.Start();
            Console.WriteLine("[JOBS] Executor started.");
        }

        public void Stop()
        {
            _running = false;
            _signal.Set();
            _worker?.Join(TimeSpan.FromSeconds(5));
            Console.WriteLine("[JOBS] Executor stopped.");
        }

        public JobState EnqueueJob(SubmitJobRequest request)
        {
            var job = new JobState
            {
                JobId = request.JobId,
                JobType = request.JobType,
                Manifest = request.Manifest,
                ArtifactBundle = request.ArtifactBundle,
                TiaProjectPath = request.TiaProjectPath,
                CurrentStep = "Queued"
            };

            _jobs[job.JobId] = job;
            _queue.Enqueue(job.JobId);
            _signal.Set();
            return job;
        }

        public JobState GetJob(string jobId)
        {
            _jobs.TryGetValue(jobId, out JobState job);
            return job;
        }

        public bool CancelJob(string jobId)
        {
            if (!_jobs.TryGetValue(jobId, out JobState job))
                return false;

            if (job.Status == "COMPLETED" || job.Status == "FAILED" || job.Status == "CANCELLED")
                return false;

            job.CancellationRequested = true;
            job.Status = "CANCELLED";
            job.CompletedAt = DateTime.UtcNow;

            Task.Run(() => _wsHandler.Broadcast(BridgeEvent.JobFailed(jobId, "Cancelled by user")));
            return true;
        }

        private void WorkerLoop()
        {
            while (_running)
            {
                _signal.WaitOne(TimeSpan.FromSeconds(1));

                while (_queue.TryDequeue(out string jobId))
                {
                    if (!_jobs.TryGetValue(jobId, out JobState job))
                        continue;

                    if (job.CancellationRequested)
                        continue;

                    ExecuteJob(job);
                }
            }
        }

        private void ExecuteJob(JobState job)
        {
            Console.WriteLine($"[JOBS] Executing job: {job.JobId} ({job.JobType})");
            job.Status = "RUNNING";
            job.StartedAt = DateTime.UtcNow;
            job.CurrentStep = "Starting";

            Task.Run(() => _wsHandler.Broadcast(BridgeEvent.JobStarted(job.JobId)));

            try
            {
                // Step 1: Connect to TIA Portal
                UpdateProgress(job, 5, "Connecting to TIA Portal");
                _tiaService.Connect(preferAttach: true);

                // Step 2: Open project (skip if no path — use whatever is already open in TIA)
                if (!string.IsNullOrWhiteSpace(job.TiaProjectPath))
                {
                    UpdateProgress(job, 10, "Opening project");
                    _tiaService.OpenProject(job.TiaProjectPath);
                }
                else
                {
                    UpdateProgress(job, 10, "Using currently open project");
                    if (!_tiaService.IsProjectOpen)
                        throw new InvalidOperationException("No TIA project open and no tia_project_path supplied. Open a project in TIA Portal first.");
                }

                // Step 3: Get PLC Software target
                UpdateProgress(job, 15, "Locating PLC");
                PlcSoftware plcSoftware = _tiaService.GetPlcSoftware();

                // Determine what to do based on job type
                bool doImport = job.JobType == "IMPORT_ONLY" || job.JobType == "IMPORT_AND_COMPILE";
                bool doCompile = job.JobType == "COMPILE_ONLY" || job.JobType == "IMPORT_AND_COMPILE";

                // Step 4: Import artifacts
                if (doImport && job.Manifest?.Artifacts != null)
                {
                    ImportArtifacts(job, plcSoftware);

                    // Re-acquire PlcSoftware — Transaction in ImportArtifacts may have
                    // invalidated internal COM handles (CompileProvider, etc.)
                    plcSoftware = _tiaService.GetPlcSoftware();
                }

                // Step 5: Compile
                if (doCompile)
                {
                    CompileProject(job, plcSoftware);
                }

                // Step 6: Save
                UpdateProgress(job, 95, "Saving project");
                _tiaService.SaveProject();

                // Done
                job.Status = "COMPLETED";
                job.CompletedAt = DateTime.UtcNow;
                job.Progress = 100;
                job.CurrentStep = "Done";

                Console.WriteLine($"[JOBS] Job completed: {job.JobId}");
                Task.Run(() => _wsHandler.Broadcast(BridgeEvent.JobCompleted(job.JobId)));
            }
            catch (Exception ex)
            {
                job.Status = "FAILED";
                job.CompletedAt = DateTime.UtcNow;
                job.ErrorMessage = ex.Message;
                job.CurrentStep = "Failed";

                Console.WriteLine($"[JOBS] Job failed: {job.JobId} — {ex.Message}");
                Console.WriteLine($"[JOBS] Stack trace: {ex.StackTrace}");
                Task.Run(() => _wsHandler.Broadcast(BridgeEvent.JobFailed(job.JobId, ex.Message)));
            }
        }

        private void ImportArtifacts(JobState job, PlcSoftware plcSoftware)
        {
            // Extract artifact bundle to temp directory
            string tempDir = Path.Combine(Path.GetTempPath(), "PacForge", job.JobId);
            Directory.CreateDirectory(tempDir);

            try
            {
                // Decode and extract base64 ZIP bundle
                if (!string.IsNullOrEmpty(job.ArtifactBundle))
                {
                    byte[] zipBytes = Convert.FromBase64String(job.ArtifactBundle);
                    string zipPath = Path.Combine(tempDir, "bundle.zip");
                    File.WriteAllBytes(zipPath, zipBytes);
                    ZipFile.ExtractToDirectory(zipPath, tempDir);
                    File.Delete(zipPath);
                }

                List<ManifestArtifactDto> artifacts = job.Manifest.Artifacts;
                int totalArtifacts = artifacts.Count;

                // Import in manifest order (already topologically sorted)
                _tiaService.WithTransaction("PacForge Import", () =>
                {
                    for (int i = 0; i < totalArtifacts; i++)
                    {
                        if (job.CancellationRequested)
                        {
                            Console.WriteLine($"[JOBS] Import cancelled at artifact {i + 1}/{totalArtifacts}");
                            break;
                        }

                        var artifact = artifacts[i];
                        int progress = 20 + (int)((double)i / totalArtifacts * 50); // 20-70%
                        UpdateProgress(job, progress, $"Importing {artifact.Name}", artifact.Name);

                        // Find the SCL file in the extracted bundle
                        string sclFile = FindArtifactFile(tempDir, artifact.Filename);

                        if (sclFile == null)
                        {
                            Console.WriteLine($"[JOBS] Skipping {artifact.Name}: file not found ({artifact.Filename})");
                            job.SkippedArtifacts.Add(artifact.Name);

                            Task.Run(() => _wsHandler.Broadcast(
                                BridgeEvent.ArtifactImported(job.JobId, artifact.Name, false, "File not found in bundle")));
                            continue;
                        }

                        try
                        {
                            _tiaService.ImportArtifact(plcSoftware, artifact.Name, sclFile, artifact.DestinationFolder);
                            job.ImportedArtifacts.Add(artifact.Name);

                            Task.Run(() => _wsHandler.Broadcast(
                                BridgeEvent.ArtifactImported(job.JobId, artifact.Name, true)));
                        }
                        catch (Exception ex)
                        {
                            Console.WriteLine($"[JOBS] Import failed for {artifact.Name}: {ex.Message}");
                            job.SkippedArtifacts.Add(artifact.Name);

                            Task.Run(() => _wsHandler.Broadcast(
                                BridgeEvent.ArtifactImported(job.JobId, artifact.Name, false, ex.Message)));
                        }
                    }
                });
            }
            finally
            {
                // Clean up temp directory
                try { Directory.Delete(tempDir, true); }
                catch { }
            }
        }

        private void CompileProject(JobState job, PlcSoftware plcSoftware)
        {
            UpdateProgress(job, 75, "Compiling");
            Task.Run(() => _wsHandler.Broadcast(BridgeEvent.CompileStarted(job.JobId)));

            CompileResultDto result = _tiaService.CompileAll(plcSoftware);
            job.CompileResult = result;

            // Broadcast individual compile errors/warnings via WebSocket
            foreach (var error in result.Errors)
            {
                Task.Run(() => _wsHandler.Broadcast(BridgeEvent.CompileError(
                    job.JobId, error.ArtifactName, error.Line, error.Column, error.ErrorText, "ERROR")));
            }
            foreach (var warning in result.Warnings)
            {
                Task.Run(() => _wsHandler.Broadcast(BridgeEvent.CompileError(
                    job.JobId, warning.ArtifactName, warning.Line, warning.Column, warning.ErrorText, "WARNING")));
            }

            Task.Run(() => _wsHandler.Broadcast(BridgeEvent.CompileCompleted(job.JobId, result.Success)));

            UpdateProgress(job, 90, result.Success ? "Compilation successful" : "Compilation completed with errors");
        }

        private void UpdateProgress(JobState job, int progress, string step, string artifact = null)
        {
            job.Progress = progress;
            job.CurrentStep = step;
            Task.Run(() => _wsHandler.Broadcast(BridgeEvent.JobProgress(job.JobId, progress, step, artifact)));
        }

        /// <summary>
        /// Find an artifact file in the extracted bundle directory.
        /// Searches root and subdirectories.
        /// </summary>
        private string FindArtifactFile(string directory, string filename)
        {
            // Direct match in root
            string directPath = Path.Combine(directory, filename);
            if (File.Exists(directPath))
                return directPath;

            // Search subdirectories
            string[] files = Directory.GetFiles(directory, filename, SearchOption.AllDirectories);
            return files.Length > 0 ? files[0] : null;
        }
    }
}
