import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname =
  typeof globalThis.__dirname !== "undefined"
    ? globalThis.__dirname
    : path.dirname(fileURLToPath(import.meta.url));

// Load the runtime script into a window-like global (NO `document`, matching
// how the pure helpers are invoked outside a browser), then exercise it.
function loadApp(): any {
  const src = readFileSync(path.resolve(__dirname, "../runtime/dashboard-app.js"), "utf8");
  const win: any = { document: undefined };
  new Function("window", src)(win);
  return win.DashApp;
}

describe("DashApp.stateLabel", () => {
  it("maps an EM state index to its name", () => {
    const App = loadApp();
    const em = { states: [{ index: 0, name: "Idle" }, { index: 1, name: "Execute" }], stateTag: "EM.state" };
    expect(App.stateLabel(em, { "EM.state": 1 })).toBe("Execute");
    expect(App.stateLabel(em, { "EM.state": 9 })).toBe("#9"); // out-of-range → raw
  });
});

describe("DashApp.activeAlarms", () => {
  it("filters by trigger polarity", () => {
    const App = loadApp();
    const alarms = [{ tag: "T", trigger: "hi", class: "Fault", text: "x" }];
    expect(App.activeAlarms(alarms, { T: true })).toHaveLength(1);
    expect(App.activeAlarms(alarms, { T: false })).toHaveLength(0);
  });
});
