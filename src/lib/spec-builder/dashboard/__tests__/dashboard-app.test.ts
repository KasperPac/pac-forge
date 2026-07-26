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

describe("DashApp.deviceStatus", () => {
  const dev = (over: Record<string, unknown> = {}) => ({
    id: "d1", name: "M01", commands: [{ tag: "CMD" }],
    signals: [
      { id: "CMD", role: "command" },
      { id: "FBK", role: "feedback" },
      { id: "FLT", role: "fault" },
    ],
    ...over,
  });

  it("reports a fault even while the device is running", () => {
    const App = loadApp();
    expect(App.deviceStatus(dev(), { CMD: true, FBK: true, FLT: true })).toBe("fault");
  });

  it("reports running on feedback", () => {
    const App = loadApp();
    expect(App.deviceStatus(dev(), { CMD: true, FBK: true, FLT: false })).toBe("running");
  });

  it("reports starting when commanded with no feedback yet", () => {
    const App = loadApp();
    expect(App.deviceStatus(dev(), { CMD: true, FBK: false, FLT: false })).toBe("starting");
  });

  it("reports stopped when idle", () => {
    const App = loadApp();
    expect(App.deviceStatus(dev(), { CMD: false, FBK: false, FLT: false })).toBe("stopped");
  });

  it("never calls an instrument stopped — it has nothing to stop", () => {
    const App = loadApp();
    const pt = { id: "pt", name: "PT01", commands: [], signals: [{ id: "PV", role: "value" }] };
    expect(App.deviceKind(pt)).toBe("instrument");
    expect(App.deviceStatus(pt, { PV: 0 })).toBe("ok");
  });

  it("still faults an instrument when its fault signal is set", () => {
    const App = loadApp();
    const pt = {
      id: "pt", name: "PT01", commands: [],
      signals: [{ id: "PV", role: "value" }, { id: "F", role: "fault" }],
    };
    expect(App.deviceStatus(pt, { PV: 0, F: true })).toBe("fault");
  });

  it("distinguishes no-data from stopped", () => {
    const App = loadApp();
    expect(App.deviceStatus(dev(), {})).toBe("unknown");
  });
});

describe("DashApp.isOn", () => {
  it("treats true and non-zero as on, everything else as off", () => {
    const App = loadApp();
    expect(App.isOn(true)).toBe(true);
    expect(App.isOn(5)).toBe(true);
    expect(App.isOn(-1)).toBe(true);
    expect(App.isOn(false)).toBe(false);
    expect(App.isOn(0)).toBe(false);
    expect(App.isOn(null)).toBe(false);
    expect(App.isOn(undefined)).toBe(false);
  });
});

describe("DashApp.simStep", () => {
  const rule = {
    deviceId: "d1", triggerTag: "CMD", triggerValue: true,
    responseTag: "FBK", responseValue: true, responseType: "Bool",
    delayMs: 500, faultInjectable: true, description: "",
  };

  it("arms a timer on the first tick the command is active, without writing yet", () => {
    const App = loadApp();
    const r = App.simStep([rule], { CMD: true, FBK: false }, {}, 1000);
    expect(r.writes).toEqual([]);
    expect(r.pending.FBK).toBe(1500);
  });

  it("drives the feedback once the delay has elapsed", () => {
    const App = loadApp();
    const r = App.simStep([rule], { CMD: true, FBK: false }, { FBK: 1500 }, 1500);
    expect(r.writes).toEqual([{ tag: "FBK", value: true, type: "Bool" }]);
  });

  it("keeps waiting while the delay is still running", () => {
    const App = loadApp();
    const r = App.simStep([rule], { CMD: true, FBK: false }, { FBK: 1500 }, 1400);
    expect(r.writes).toEqual([]);
    expect(r.pending.FBK).toBe(1500);
  });

  it("retracts the feedback and cancels the timer when the command clears", () => {
    const App = loadApp();
    const r = App.simStep([rule], { CMD: false, FBK: true }, { FBK: 1500 }, 2000);
    expect(r.writes).toEqual([{ tag: "FBK", value: false, type: "Bool" }]);
    expect(r.pending.FBK).toBeUndefined();
  });

  it("does nothing once the feedback already matches", () => {
    const App = loadApp();
    const r = App.simStep([rule], { CMD: true, FBK: true }, {}, 9999);
    expect(r.writes).toEqual([]);
  });

  it("stays quiet when the command never fires", () => {
    const App = loadApp();
    const r = App.simStep([rule], { CMD: false, FBK: false }, {}, 9999);
    expect(r.writes).toEqual([]);
    expect(r.pending).toEqual({});
  });
});
