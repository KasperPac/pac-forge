import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// Two csproj files exist: V18 (for TIA Portal V18) and V20 (default, for V20).
// Override via BRIDGE_CSPROJ env var if needed.
const BRIDGE_CSPROJ =
  process.env.BRIDGE_CSPROJ ||
  "bridge/PacForgeBridge/PacForgeBridge.V18.csproj";
// V18 bridge listens on 5103, V20 bridge on 5102 (see Program.cs TIA_V18 block)
const BRIDGE_PORT = BRIDGE_CSPROJ.includes("V18") ? 5103 : 5102;

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const onDone = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(300);
    socket.once("connect", () => onDone(true));
    socket.once("timeout", () => onDone(false));
    socket.once("error", () => onDone(false));
    socket.connect(port, "127.0.0.1");
  });
}

async function main() {
  // ── TIA Bridge ──
  const bridgeRunning = await isPortOpen(BRIDGE_PORT);
  if (bridgeRunning) {
    console.log(`[bridge] already running on http://localhost:${BRIDGE_PORT}/`);
  } else {
    console.log("[bridge] starting .NET TIA bridge...");
    console.log(`[bridge] using ${BRIDGE_CSPROJ}`);
    const bridge = spawn(
      "cmd.exe",
      ["/c", "dotnet", "run", "--project", BRIDGE_CSPROJ],
      { stdio: "inherit", windowsHide: true, cwd: PROJECT_ROOT }
    );
    bridge.on("error", (err) => {
      console.error("[bridge] failed to start:", err.message);
    });
    bridge.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[bridge] exited with code ${code}`);
      }
    });
  }

  // ── Vite ──
  const vite = spawn("cmd.exe", ["/c", "vite"], {
    stdio: "inherit",
    windowsHide: true,
  });

  vite.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
