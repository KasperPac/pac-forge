import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

const KANBAN_DIR = "C:\\Users\\kaspe\\Documents\\VSCode Apps\\Kaban\\cyanluna.skills\\kanban-board";
const KANBAN_PORT = 5176;
const BRIDGE_PORT = 5102;
const BRIDGE_SLN = path.join(PROJECT_ROOT, "bridge", "PacForgeBridge.sln");

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
  // ── Kanban ──
  const kanbanRunning = await isPortOpen(KANBAN_PORT);
  if (kanbanRunning) {
    console.log(`[kanban] already running on http://localhost:${KANBAN_PORT}/`);
  } else {
    console.log("[kanban] starting...");
    spawn(
      "cmd.exe",
      ["/c", "pnpm", "--dir", KANBAN_DIR, "dev", "--", "--port", String(KANBAN_PORT)],
      { stdio: "inherit", windowsHide: true }
    );
  }

  // ── TIA Bridge ──
  const bridgeRunning = await isPortOpen(BRIDGE_PORT);
  if (bridgeRunning) {
    console.log(`[bridge] already running on http://localhost:${BRIDGE_PORT}/`);
  } else {
    console.log("[bridge] starting .NET TIA bridge...");
    const bridge = spawn(
      "cmd.exe",
      ["/c", "dotnet", "run", "--project", "bridge/PacForgeBridge"],
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
