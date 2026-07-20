import { describe, expect, it } from "vitest";
import { validateSignalRouting } from "@/lib/spec-builder/signal-routing";
import type { SignalRoutingV1 } from "@/types/spec-contract-v2";

function coord(signal_routing: SignalRoutingV1) {
  return { unit_id: "u1", signal_routing };
}

const row = (
  id: string,
  em: string,
  pin: string,
): SignalRoutingV1["routing_rows"][number] => ({
  row_id: id,
  target: { equipment_module_id: em, pin },
  source: { kind: "io_tag", tag: `${pin}_src` },
  gates: [],
});

const ems = new Set(["em_drive", "em_ind"]);

describe("validateSignalRouting", () => {
  it("clean pass with full context", () => {
    const issues = validateSignalRouting(
      coord({
        safety_healthy: { gate_ids: ["estop"], exclude_maintenance: true },
        routing_rows: [
          row("r1", "em_drive", "ilk_Fwd"),
          row("r2", "em_drive", "ilk_Fwd_Fast"),
        ],
        two_detent: [{ jog_row_id: "r1", fast_row_id: "r2", fallback: true }],
        command_routing: {
          policy: "walk_to_execute_stop_on_unhealthy",
          seq_test_release: true,
        },
        first_out: { enabled: false },
      }),
      { memberEmIds: ems, safetyGateIds: new Set(["estop"]) },
    );
    expect(issues).toEqual([]);
  });

  it("errors on duplicate row_id and duplicate target pin", () => {
    const issues = validateSignalRouting(
      coord({
        routing_rows: [row("r1", "em_drive", "ilk_X"), row("r1", "em_drive", "ilk_X")],
        two_detent: [],
      } as never),
      { memberEmIds: ems },
    );
    expect(issues.some((i) => i.includes("duplicate row_id"))).toBe(true);
    expect(issues.some((i) => i.includes("duplicate target"))).toBe(true);
  });

  it("errors on target EM outside the unit (with context)", () => {
    const issues = validateSignalRouting(
      coord({ routing_rows: [row("r1", "em_foreign", "ilk_X")], two_detent: [] } as never),
      { memberEmIds: ems },
    );
    expect(issues.some((i) => i.includes("em_foreign"))).toBe(true);
  });

  it("errors on em_status source outside the unit (with context)", () => {
    const r = row("r1", "em_drive", "ilk_X");
    r.source = { kind: "em_status", equipment_module_id: "em_other_unit", member: "m" };
    const issues = validateSignalRouting(
      coord({ routing_rows: [r], two_detent: [] } as never),
      { memberEmIds: ems },
    );
    expect(issues.some((i) => i.includes("em_other_unit"))).toBe(true);
  });

  it("skips membership checks without context", () => {
    const issues = validateSignalRouting(
      coord({ routing_rows: [row("r1", "em_foreign", "ilk_X")], two_detent: [] } as never),
      {},
    );
    expect(issues).toEqual([]);
  });

  it("errors on unresolvable and self-referential two_detent", () => {
    const issues = validateSignalRouting(
      coord({
        routing_rows: [row("r1", "em_drive", "ilk_X")],
        two_detent: [
          { jog_row_id: "r1", fast_row_id: "r1", fallback: true },
          { jog_row_id: "missing", fast_row_id: "r1", fallback: true },
        ],
      } as never),
      { memberEmIds: ems },
    );
    expect(issues.some((i) => i.includes("same row"))).toBe(true);
    expect(issues.some((i) => i.includes("missing"))).toBe(true);
  });

  it("errors on unknown safety gate ids (with context), skips without", () => {
    const sr = {
      safety_healthy: { gate_ids: ["ghost"], exclude_maintenance: true },
      routing_rows: [],
      two_detent: [],
    } as never;
    expect(
      validateSignalRouting(coord(sr), { safetyGateIds: new Set(["estop"]) }).some(
        (i) => i.includes("ghost"),
      ),
    ).toBe(true);
    expect(validateSignalRouting(coord(sr), {})).toEqual([]);
  });

  it("no signal_routing → no issues", () => {
    expect(validateSignalRouting({ unit_id: "u1" } as never, {})).toEqual([]);
  });
});
