import { spawn } from "node:child_process";
import net from "node:net";

const KANBAN_DIR = "C:\\Users\\kaspe\\Documents\\VSCode Apps\\Kaban\\cyanluna.skills\\kanban-board";
const KANBAN_PORT = 5176;

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
