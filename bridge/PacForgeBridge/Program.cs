using System;
using System.IO;
using System.Text;
using System.Threading;
using PacForgeBridge.HardwareExtractors;

namespace PacForgeBridge
{
    /// <summary>
    /// Wraps the original Console.Out writer and forwards each complete line
    /// to the WebSocket handler so the frontend can show a live log panel.
    /// </summary>
    class ConsoleBroadcastWriter : TextWriter
    {
        private readonly TextWriter _inner;
        private readonly WebSocketHandler _ws;
        private readonly StringBuilder _buf = new StringBuilder();

        public ConsoleBroadcastWriter(TextWriter inner, WebSocketHandler ws)
        {
            _inner = inner;
            _ws = ws;
        }

        public override Encoding Encoding => _inner.Encoding;

        public override void WriteLine(string value)
        {
            _inner.WriteLine(value);
            _ws.BroadcastLog(value ?? "");
        }

        public override void Write(char value)
        {
            _inner.Write(value);
            if (value == '\n')
            {
                string line = _buf.ToString().TrimEnd('\r');
                _buf.Clear();
                if (line.Length > 0) _ws.BroadcastLog(line);
            }
            else
            {
                _buf.Append(value);
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) _inner.Dispose();
            base.Dispose(disposing);
        }
    }

    class Program
    {
        private static readonly ManualResetEvent ShutdownEvent = new ManualResetEvent(false);

        static void Main(string[] args)
        {
#if TIA_V18
            int port = 5103;
            string bridgeVersion = "V18";
#elif TIA_V21
            int port = 5104;
            string bridgeVersion = "V21";
#else
            int port = 5102;
            string bridgeVersion = "V20";
#endif
            // Tee the console to %TEMP%\PacForgeridge-<port>.log so callers can read the diagnostics.
            try
            {
                string logDir = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "PacForge");
                System.IO.Directory.CreateDirectory(logDir);
                var logWriter = new System.IO.StreamWriter(System.IO.Path.Combine(logDir, $"bridge-{port}.log"), true, new System.Text.UTF8Encoding(false)) { AutoFlush = true };
                Console.SetOut(new TeeWriter(Console.Out, logWriter));
            }
            catch (Exception ex) { Console.WriteLine($"[Bridge] log tee unavailable: {ex.Message}"); }

            // Parse command-line arguments
            string bind = null;
            string token = Environment.GetEnvironmentVariable("PAC_BRIDGE_TOKEN");
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (args[i] == "--port" && int.TryParse(args[i + 1], out int p))
                    port = p;
                if (args[i] == "--bind")
                    bind = args[i + 1];
                if (args[i] == "--token")
                    token = args[i + 1];
                if (args[i] == "--validate-hardware-parsers")
                {
                    HardwareParserValidator.Run(args[i + 1]);
                    return;
                }
            }

            Console.WriteLine("==============================================");
            Console.WriteLine($"  PacForge TIA Bridge v1.0  [{bridgeVersion}]");
            Console.WriteLine("==============================================");
            Console.WriteLine();

            // Create services
            var tiaService = new TiaPortalService();
            var wsHandler = new WebSocketHandler();
            var jobExecutor = new JobExecutor(tiaService, wsHandler);
            string bindHost;
            try
            {
                bindHost = BridgeAccess.ResolveBindHost(bind);
            }
            catch (InvalidOperationException ex)
            {
                Console.WriteLine($"[BRIDGE] {ex.Message}");
                return;
            }
            var server = new BridgeServer(port, jobExecutor, wsHandler, tiaService, bindHost, token);

            // Redirect Console.Out so every WriteLine is also broadcast over WebSocket
            Console.SetOut(new ConsoleBroadcastWriter(Console.Out, wsHandler));

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
                if (!string.Equals(bindHost, "localhost", StringComparison.OrdinalIgnoreCase))
                    Console.WriteLine($"  Mesh:      http://{bindHost}:{port}");
                Console.WriteLine($"  Auth:      {(string.IsNullOrEmpty(token) ? "none (no --token / PAC_BRIDGE_TOKEN)" : "bearer token required (except GET /tia/status)")}");
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

    /// <summary>Writes to two TextWriters (console + log file).</summary>
    public class TeeWriter : System.IO.TextWriter
    {
        private readonly System.IO.TextWriter _a, _b;
        public TeeWriter(System.IO.TextWriter a, System.IO.TextWriter b) { _a = a; _b = b; }
        public override System.Text.Encoding Encoding => _a.Encoding;
        public override void Write(char value) { _a.Write(value); _b.Write(value); }
        public override void Write(string value) { _a.Write(value); _b.Write(value); }
        public override void WriteLine(string value) { _a.WriteLine(value); _b.WriteLine(value); }
        public override void Flush() { _a.Flush(); _b.Flush(); }
    }
}
