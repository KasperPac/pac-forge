import { describe, expect, it } from "vitest";
import {
  buildEmStateMachineInterviewPrompt,
  buildEmStateMachineOpeningMessage,
} from "@/lib/spec-builder/em-state-machine-prompts";
import {
  buildFdsInterviewSystemPrompt,
  buildFdsOpeningMessage,
} from "@/lib/spec-builder/fds-prompts";
import type {
  EquipmentModuleConfig,
  UnitConfig,
  InstrumentTag,
} from "@/types/spec-builder";
import type { EmStateV2, OperatorMode } from "@/types/spec-contract-v2";
import type { SourceSection } from "@/lib/spec-builder/source-section-select";

const unit: UnitConfig = {
  unit_id: "u1", unit_name: "Carriage Unit", equipment_type: "Other",
  description: "", excluded: false, equipment_modules: [],
} as unknown as UnitConfig;

const em: EquipmentModuleConfig = {
  equipment_module_id: "em1", equipment_module_name: "Carriage Drive", description: "",
  control_modules: [
    {
      control_module_id: "d1", control_module_name: "Drive M01", control_module_class: "motor",
      is_safety: false, description: "",
      io_signals: [
        { tag: "CAR_M01_CMD", signal_type: "DO", io_address: "Q0.0", description: "Run fwd" },
        { tag: "CAR_M01_FB", signal_type: "DI", io_address: "I0.0", description: "Running" },
      ],
    },
  ],
} as unknown as EquipmentModuleConfig;

const modes: OperatorMode[] = [
  { mode_id: "auto", name: "Auto", is_default: true },
  { mode_id: "manual", name: "Manual", is_default: false },
];

const tags: InstrumentTag[] = [
  { tag: "CAR_M01_CMD", signal_direction: "DO", description: "Run fwd" } as unknown as InstrumentTag,
  { tag: "CAR_M01_FB", signal_direction: "DI", description: "Running" } as unknown as InstrumentTag,
];

const emStates: EmStateV2[] = [
  { state_id: "idle", name: "Idle", kind: "static", allowed_modes: [], is_safe_state: true },
  { state_id: "auto_cycle", name: "Auto Cycle", kind: "sequential", allowed_modes: ["auto"], is_safe_state: false },
];

const sections: SourceSection[] = [
  { heading: "Carriage", body: "Driven by a pendant, forward and reverse to limits.", order_index: 0 } as unknown as SourceSection,
];

// ---------------------------------------------------------------------------
// Stage A — state machine interview
// ---------------------------------------------------------------------------
describe("Stage A ground-then-refine", () => {
  it("uses GROUND/REFINE phases when customer-spec context is present", () => {
    const p = buildEmStateMachineInterviewPrompt(em, unit, modes, sections);
    expect(p).toContain("PHASE 1 — GROUND");
    expect(p).toContain("PHASE 2 — REFINE");
    // still renders the section body
    expect(p).toContain("pendant");
  });

  it("falls back to cold interview when no context is present", () => {
    const p = buildEmStateMachineInterviewPrompt(em, unit, modes, []);
    expect(p).not.toContain("PHASE 1 — GROUND");
    expect(p).toContain("One question per turn");
  });

  it("opening message proposes a draft when context is present", () => {
    const m = buildEmStateMachineOpeningMessage(em, sections);
    expect(m).toContain("PHASE 1");
    expect(m.toLowerCase()).toContain("propose");
  });

  it("opening message asks a cold question when no context is present", () => {
    const m = buildEmStateMachineOpeningMessage(em, []);
    expect(m).not.toContain("PHASE 1");
    expect(m.toLowerCase()).toContain("what distinct states");
  });
});

// ---------------------------------------------------------------------------
// Stage B — behavior interview
// ---------------------------------------------------------------------------
describe("Stage B ground-then-refine", () => {
  it("uses GROUND/REFINE phases when customer-spec context is present", () => {
    const p = buildFdsInterviewSystemPrompt(em, unit, tags, {}, {}, emStates, sections);
    expect(p).toContain("PHASE 1 — GROUND");
    expect(p).toContain("PHASE 2 — REFINE");
    expect(p).toContain("pendant");
  });

  it("keeps the strict cold interview protocol when no context is present", () => {
    const p = buildFdsInterviewSystemPrompt(em, unit, tags, {}, {}, emStates, []);
    expect(p).not.toContain("PHASE 1 — GROUND");
    expect(p).toContain("MUST NOT emit a JSON table update until every field");
  });

  it("opening message proposes a draft when context is present", () => {
    const m = buildFdsOpeningMessage(em, tags, "Auto Cycle", sections);
    expect(m).toContain("PHASE 1");
    expect(m.toLowerCase()).toContain("propose");
  });

  it("opening message asks a cold question when no context is present", () => {
    const m = buildFdsOpeningMessage(em, tags, "Auto Cycle", []);
    expect(m).not.toContain("PHASE 1");
  });
});
