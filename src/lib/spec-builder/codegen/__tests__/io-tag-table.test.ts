// io-tag-table — G9-W4 regression: Send-to-TIA must create every physical
// tag the writers reference, derived verbatim from contract io_signals.
import { describe, expect, it } from "vitest";
import { deriveIoTags } from "../io-tag-table";
import type { IoSignalV2, UnitV2 } from "@/types/spec-contract-v2";

let uuidCounter = 0;
const uuid = () =>
  `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}`;

function signal(overrides: Partial<IoSignalV2> & Pick<IoSignalV2, "tag" | "signal_type">): IoSignalV2 {
  return {
    io_address: "I0.0",
    description: "",
    source: "wired",
    ...overrides,
  };
}

function unit(signals: IoSignalV2[], overrides: Partial<UnitV2> = {}): UnitV2 {
  return {
    unit_id: uuid(),
    unit_name: "Process Unit",
    equipment_type: "processing",
    description: "",
    excluded: false,
    equipment_modules: [
      {
        equipment_module_id: uuid(),
        equipment_module_name: "Agitator Module",
        description: "",
        control_modules: [
          {
            control_module_id: uuid(),
            control_module_name: "Agitator Motor",
            control_module_class: "motor_dol",
            is_safety: false,
            description: "",
            io_signals: signals,
          },
        ],
      },
    ],
    ...overrides,
  };
}

const contractOf = (...units: UnitV2[]) => ({ hierarchy: { units } });

describe("deriveIoTags", () => {
  it("maps DI/DO to Bool and AI/AO to Int, normalizing addresses to % notation", () => {
    const { tags, warnings } = deriveIoTags(
      contractOf(
        unit([
          signal({ tag: "AGITATOR_FB_RUN", signal_type: "DI", io_address: "I0.0" }),
          signal({ tag: "AGITATOR_CMD", signal_type: "DO", io_address: "%Q0.0" }),
          signal({ tag: "AGITATOR_SPEED_ACT", signal_type: "AI", io_address: "IW64" }),
          signal({ tag: "AGITATOR_SPEED_SP", signal_type: "AO", io_address: "%QW64" }),
        ]),
      ),
    );
    expect(warnings).toEqual([]);
    expect(tags).toEqual([
      { name: "AGITATOR_FB_RUN", dataType: "Bool", address: "%I0.0" },
      { name: "AGITATOR_CMD", dataType: "Bool", address: "%Q0.0" },
      { name: "AGITATOR_SPEED_ACT", dataType: "Int", address: "%IW64" },
      { name: "AGITATOR_SPEED_SP", dataType: "Int", address: "%QW64" },
    ]);
  });

  it("excludes internal and network_telegram signals", () => {
    const { tags } = deriveIoTags(
      contractOf(
        unit([
          signal({ tag: "STEP_LATCH", signal_type: "internal" }),
          signal({ tag: "DRIVE_STATUS_WORD", signal_type: "AI", source: "network_telegram" }),
          signal({ tag: "GATE_FB_OPEN", signal_type: "DI" }),
        ]),
      ),
    );
    expect(tags.map((t) => t.name)).toEqual(["GATE_FB_OPEN"]);
  });

  it("skips signals without an io_address, with a warning naming the tag", () => {
    const { tags, warnings } = deriveIoTags(
      contractOf(unit([signal({ tag: "GATE_CMD", signal_type: "DO", io_address: "  " })])),
    );
    expect(tags).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"GATE_CMD"');
  });

  it("dedupes identical duplicates silently and warns on conflicting duplicates, keeping the first", () => {
    const { tags, warnings } = deriveIoTags(
      contractOf(
        unit([
          signal({ tag: "GATE_FB_OPEN", signal_type: "DI", io_address: "%I1.0" }),
          signal({ tag: "GATE_FB_OPEN", signal_type: "DI", io_address: "I1.0" }),
          signal({ tag: "GATE_FB_OPEN", signal_type: "DI", io_address: "%I2.0" }),
        ]),
      ),
    );
    expect(tags).toEqual([{ name: "GATE_FB_OPEN", dataType: "Bool", address: "%I1.0" }]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("conflicting");
  });

  it("skips excluded units entirely", () => {
    const { tags } = deriveIoTags(
      contractOf(
        unit([signal({ tag: "IN_SCOPE_CMD", signal_type: "DO" })]),
        unit([signal({ tag: "OUT_OF_SCOPE_CMD", signal_type: "DO" })], { excluded: true }),
      ),
    );
    expect(tags.map((t) => t.name)).toEqual(["IN_SCOPE_CMD"]);
  });
});
