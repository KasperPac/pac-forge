using System;
using System.Threading;

namespace PacForgeBridge
{
    class Program
    {
        private static readonly ManualResetEvent ShutdownEvent = new ManualResetEvent(false);

        static void Main(string[] args)
        {
            int port = 5102;

            // Parse command-line arguments
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (args[i] == "--port" && int.TryParse(args[i + 1], out int p))
                    port = p;
            }

            Console.WriteLine("==============================================");
            Console.WriteLine("  PacForge TIA Bridge v1.0");
            Console.WriteLine("==============================================");
            Console.WriteLine();

            // Create services
            var tiaService = new TiaPortalService();
            var wsHandler = new WebSocketHandler();
            var jobExecutor = new JobExecutor(tiaService, wsHandler);
            var server = new BridgeServer(port, jobExecutor, wsHandler, tiaService);

            // Handle Ctrl+C gracefully
            Console.CancelKeyPress += (s, e) =>
            {
                e.Cancel = true;
                Console.WriteLine();
                Console.WriteLine("[BRIDGE] Shutdown requested...");
                ShutdownEvent.Set();
            };

            try
            {
                // Start services
                server.Start();
                jobExecutor.Start();

                // Print status
                var status = tiaService.GetStatus();
                Console.WriteLine($"  HTTP:      http://localhost:{port}");
                Console.WriteLine($"  WebSocket: ws://localhost:{port}/tia/ws");
                Console.WriteLine($"  TIA Portal: {status.TiaVersion ?? "Not detected"}");
                Console.WriteLine();
                Console.WriteLine("Endpoints:");
                Console.WriteLine($"  GET  /tia/status            Bridge status");
                Console.WriteLine($"  GET  /tia/compile-result    Last compile result");
                Console.WriteLine($"  POST /tia/connect           Connect to TIA Portal");
                Console.WriteLine($"  POST /tia/disconnect        Disconnect TIA Portal");
                Console.WriteLine($"  POST /tia/open-project      Open TIA project");
                Console.WriteLine($"  POST /tia/demo/motor-control Create motor demo");
                Console.WriteLine($"  POST /tia/demo/create       Create project from SCL");
                Console.WriteLine($"  POST /tia/jobs              Submit job");
                Console.WriteLine($"  GET  /tia/jobs/{{id}}         Job status");
                Console.WriteLine($"  GET  /tia/jobs/{{id}}/results Job results");
                Console.WriteLine($"  POST /tia/jobs/{{id}}/cancel  Cancel job");
                Console.WriteLine($"  WS   /tia/ws                Real-time events");
                Console.WriteLine();
                Console.WriteLine("Press Ctrl+C to stop.");
                Console.WriteLine();

                // Wait for shutdown signal
                ShutdownEvent.WaitOne();
            }
            finally
            {
                Console.WriteLine("[BRIDGE] Stopping services...");
                jobExecutor.Stop();
                server.Stop();
                wsHandler.CloseAll().Wait();
                tiaService.Dispose();
                Console.WriteLine("[BRIDGE] Shutdown complete.");
            }
        }
    }
}
