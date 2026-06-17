import { describe, it, expect } from "vitest";
import { selectRelevantSections } from "@/lib/spec-builder/source-section-select";
import type { SourceSection } from "@/lib/spec-builder/source-section-select";
import type { EquipmentModuleConfig } from "@/types/spec-builder";

const sections: SourceSection[] = [
  { heading: "System Overview", body: "The line conveys product end to end.", order_index: 0 },
  { heading: "Conveyor CV01", body: "CV01 runs forward when M1 is commanded.", order_index: 1 },
  { heading: "Lift Table LFT01", body: "Raises pallets via M5.", order_index: 2 },
];

const em: EquipmentModuleConfig = {
  equipment_module_id: "em1",
  equipment_module_name: "Conveyor CV01",
  description: "",
  control_modules: [
    { control_module_id: "M1", control_module_name: "Drive M1", control_module_class: "motor",
      description: "", is_safety: false,
      io_signals: [{ tag: "CV01_M1_CMD", signal_type: "DO", io_address: "%Q0.0", description: "run" }] },
  ],
};

describe("selectRelevantSections", () => {
  it("includes the EM-matched section and global overview, not the unrelated EM", () => {
    const out = selectRelevantSections(sections, em, { maxChars: 10_000 });
    const headings = out.map((s) => s.heading);
    expect(headings).toContain("Conveyor CV01");
    expect(headings).toContain("System Overview"); // global keyword
    expect(headings).not.toContain("Lift Table LFT01");
  });

  it("respects the maxChars budget (drops lowest-priority first)", () => {
    const out = selectRelevantSections(sections, em, { maxChars: 40 });
    const total = out.reduce((n, s) => n + s.heading.length + s.body.length, 0);
    expect(total).toBeLessThanOrEqual(40);
  });
});
