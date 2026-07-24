import { describe, it, expect } from "vitest";
import { RUNTIME_FILES } from "@/lib/spec-builder/dashboard/runtime-files";

describe("RUNTIME_FILES", () => {
  it("bundles every static runtime file as a non-empty string", () => {
    for (const name of ["index.html", "styles.css", "plc-transport.js", "dashboard-app.js", "server.mjs"]) {
      expect(typeof RUNTIME_FILES[name]).toBe("string");
      expect(RUNTIME_FILES[name].length).toBeGreaterThan(0);
    }
  });
});
