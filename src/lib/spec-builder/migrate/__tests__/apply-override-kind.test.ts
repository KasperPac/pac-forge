import { describe, expect, it } from "vitest";
import { applyOverrideKind } from "../apply-override-kind";
import type { EquipmentModuleContract } from "@/types/spec-contract-v2";

const ASM_ID = "00000000-0000-0000-0000-000000000aaa";
const SUB_ID = "00000000-0000-0000-0000-000000000bbb";

function makeEquipmentModule(overrides: Partial<EquipmentModuleContract> = {}): EquipmentModuleContract {
  return {
    equipment_module_id: ASM_ID,
    unit_id: SUB_ID,
    static_states: {},
    sequential_states: {},
    ...overrides,
  } as EquipmentModuleContract;
}

describe("applyOverrideKind", () => {
  it("wraps sequential_states with override_kind: 'override'", () => {
    const input = {
      [ASM_ID]: makeEquipmentModule({
        sequential_states: {
          "execute": {
            permissives: [],
            steps: [],
            notes: null,
          } as never,
        },
      }),
    };
    const out = applyOverrideKind(input);
    expect(out[ASM_ID].sequential_states["execute"].override_kind).toBe("override");
  });

  it("wraps legacy static_states array into StaticStateV2 with override_kind", () => {
    const input = {
      [ASM_ID]: makeEquipmentModule({
        static_states: {
          "idle": [{ tag: "MOTOR_01.RUN", description: "off", state: "false" }] as never,
        },
      }),
    };
    const out = applyOverrideKind(input);
    const wrapped = out[ASM_ID].static_states["idle"];
    expect(Array.isArray(wrapped)).toBe(false);
    expect((wrapped as { override_kind: string }).override_kind).toBe("override");
    expect((wrapped as { control_modules: unknown[] }).control_modules).toHaveLength(1);
  });

  it("preserves existing StaticStateV2 wrapping (idempotent)", () => {
    const input = {
      [ASM_ID]: makeEquipmentModule({
        static_states: {
          "idle": {
            override_kind: "override",
            control_modules: [{ tag: "X", description: "y", state: "z" }],
            notes: null,
          } as never,
        },
      }),
    };
    const out = applyOverrideKind(input);
    expect(out[ASM_ID].static_states["idle"]).toEqual(input[ASM_ID].static_states["idle"]);
  });

  it("preserves notes when wrapping", () => {
    const input = {
      [ASM_ID]: makeEquipmentModule({
        sequential_states: {
          "execute": {
            permissives: [],
            steps: [],
            notes: "Must not run during inhibit.",
          } as never,
        },
      }),
    };
    const out = applyOverrideKind(input);
    expect(out[ASM_ID].sequential_states["execute"].notes).toBe(
      "Must not run during inhibit.",
    );
  });
});
