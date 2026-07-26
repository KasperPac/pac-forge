// src/lib/spec-builder/dashboard/__tests__/mimic.test.ts
//
// The mimic derives its layout from the ISA-88 hierarchy because the FDS
// carries no geometry. These exercise the two pure pieces — symbol choice and
// the derived positions — with no browser.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname =
  typeof globalThis.__dirname !== "undefined"
    ? globalThis.__dirname
    : path.dirname(fileURLToPath(import.meta.url));

interface MimicSymbol { kind: string; shape: string; code: string }
interface LayoutNode { id: string; role: string; x: number; y: number; w: number; h: number }
interface LayoutStage { name: string; x: number; w: number; nodes: LayoutNode[] }
interface LayoutLane { unit: string; top: number; stages: LayoutStage[] }
interface LayoutPlan { lanes: LayoutLane[]; width: number; height: number }
interface MimicApi {
  symbolFor(deviceType: string): MimicSymbol;
  shortLabel(name: string, max?: number): string;
  layout(model: { devices: unknown[] }): LayoutPlan;
}

/** Load the browser runtime into a window with no `document`, proving the
 *  pure helpers really are document-free. */
function loadMimic(): MimicApi {
  const src = readFileSync(path.resolve(__dirname, "../runtime/mimic.js"), "utf8");
  const win = { document: undefined } as { document: undefined; DashMimic?: MimicApi };
  new Function("window", src)(win);
  return win.DashMimic as MimicApi;
}

const dev = (id: string, unit: string, em: string, deviceType: string) => ({
  id, unit, em, deviceType, name: id, signals: [], commands: [],
});

describe("DashMimic.symbolFor", () => {
  it("puts driven equipment on the process line and instruments on lead lines", () => {
    const M = loadMimic();
    expect(M.symbolFor("motor").kind).toBe("inline");
    expect(M.symbolFor("valve").kind).toBe("inline");
    expect(M.symbolFor("hopper").kind).toBe("inline");
    expect(M.symbolFor("sensor_pressure").kind).toBe("instrument");
    expect(M.symbolFor("sensor_level").kind).toBe("instrument");
  });

  it("uses ISA-style identifiers per measurement class", () => {
    const M = loadMimic();
    expect(M.symbolFor("sensor_pressure").code).toBe("PT");
    expect(M.symbolFor("sensor_level").code).toBe("LT");
    expect(M.symbolFor("sensor_temperature").code).toBe("TT");
    expect(M.symbolFor("sensor_flow").code).toBe("FT");
    expect(M.symbolFor("sensor_weight").code).toBe("WT");
  });

  it("falls back to a plain box for an unknown class rather than dropping it", () => {
    const M = loadMimic();
    const s = M.symbolFor("something_nobody_has_modelled_yet");
    expect(s.kind).toBe("inline");
    expect(s.shape).toBe("box");
  });
});

describe("DashMimic.shortLabel", () => {
  it("leaves short names alone", () => {
    const M = loadMimic();
    expect(M.shortLabel("Blower Motor M01")).toBe("Blower Motor M01");
  });

  it("clips long names so neighbouring labels cannot overlap", () => {
    const M = loadMimic();
    const out = M.shortLabel("Blower Discharge Pressure Transmitter PT02");
    expect(out.length).toBeLessThanOrEqual(16);
    expect(out.endsWith("…")).toBe(true);
  });

  it("does not leave a dangling separator before the ellipsis", () => {
    const M = loadMimic();
    expect(M.shortLabel("Conveying Line Flow", 11)).toBe("Conveying…");
  });
});

describe("DashMimic.layout", () => {
  it("gives each unit its own lane", () => {
    const M = loadMimic();
    const plan = M.layout({
      devices: [dev("a", "Unit A", "EM1", "motor"), dev("b", "Unit B", "EM2", "motor")],
    });
    expect(plan.lanes).toHaveLength(2);
    expect(plan.lanes[0].unit).toBe("Unit A");
    expect(plan.lanes[1].top).toBeGreaterThan(plan.lanes[0].top);
  });

  it("lays equipment modules out left to right as process stages", () => {
    const M = loadMimic();
    const plan = M.layout({
      devices: [dev("a", "U", "Stage 1", "motor"), dev("b", "U", "Stage 2", "valve")],
    });
    const [s1, s2] = plan.lanes[0].stages;
    expect(s1.name).toBe("Stage 1");
    expect(s2.x).toBeGreaterThan(s1.x);
  });

  it("sits instruments above the process line the equipment sits on", () => {
    const M = loadMimic();
    const plan = M.layout({
      devices: [dev("m", "U", "EM", "motor"), dev("pt", "U", "EM", "sensor_pressure")],
    });
    const nodes = plan.lanes[0].stages[0].nodes;
    const motor = nodes.find((n) => n.id === "m")!;
    const pt = nodes.find((n) => n.id === "pt")!;
    expect(pt.y).toBeLessThan(motor.y);
    expect(pt.role).toBe("instrument");
  });

  it("sizes the canvas to fit the widest lane", () => {
    const M = loadMimic();
    const plan = M.layout({
      devices: [dev("a", "U", "E1", "motor"), dev("b", "U", "E2", "motor"), dev("c", "U", "E3", "motor")],
    });
    const last = plan.lanes[0].stages[2];
    expect(plan.width).toBeGreaterThan(last.x + last.w);
  });

  it("handles a device with no unit or EM without throwing", () => {
    const M = loadMimic();
    const plan = M.layout({ devices: [{ id: "x", deviceType: "motor", name: "X", signals: [], commands: [] }] });
    expect(plan.lanes[0].unit).toBe("Plant");
    expect(plan.lanes[0].stages[0].nodes).toHaveLength(1);
  });
});
