import path from "path"
import { spawn } from "child_process"
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** Vite plugin: POST /__bridge/start spawns the .NET TIA bridge if not already running. */
function bridgeLauncherPlugin(): Plugin {
  return {
    name: "bridge-launcher",
    configureServer(server) {
      server.middlewares.use("/__bridge/start", (_req, res) => {
        const child = spawn(
          "cmd.exe",
          ["/c", "dotnet", "run", "--project", "bridge/PacForgeBridge"],
          { stdio: "ignore", detached: true, windowsHide: true },
        );
        child.unref();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, pid: child.pid }));
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), bridgeLauncherPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "monaco-editor": ["monaco-editor", "@monaco-editor/react"],
          "vendor-ui": ["react", "react-dom", "react-router"],
          "vendor-data": ["@tanstack/react-query", "@supabase/supabase-js", "zustand"],
          "vendor-radix": [
            "@radix-ui/react-alert-dialog",
            "@radix-ui/react-avatar",
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-label",
            "@radix-ui/react-progress",
            "@radix-ui/react-radio-group",
            "@radix-ui/react-scroll-area",
            "@radix-ui/react-select",
            "@radix-ui/react-separator",
            "@radix-ui/react-slot",
            "@radix-ui/react-switch",
            "@radix-ui/react-tabs",
            "@radix-ui/react-toast",
            "@radix-ui/react-toggle",
            "@radix-ui/react-tooltip",
          ],
        },
      },
    },
  },
})
