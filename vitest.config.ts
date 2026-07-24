import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // CSS processing is disabled for plain component imports (perf — no postcss in tests),
    // but `?raw` imports (e.g. dashboard runtime bundling) must return real file contents,
    // not the empty-string stub vitest's CSS disabler substitutes by default.
    css: { include: [/\?raw$/] },
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
