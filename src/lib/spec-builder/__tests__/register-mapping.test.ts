import { describe, it, expect } from "vitest";
import { parseMappingResponse } from "@/lib/spec-builder/register-mapping";

const validIds = new Set(["em-uuid-1", "em-uuid-2"]);

describe("parseMappingResponse", () => {
  it("keeps modules whose ids were provided, drops unknown ids", () => {
    const raw = JSON.stringify({
      unit_name: "Segment Wagon",
      modules: [
        { equipment_module_id: "em-uuid-1", source_requirements: "Rail movement..." },
        { equipment_module_id: "HALLUCINATED", source_requirements: "nope" },
      ],
      states: [], faults: [], process_model: null,
    });
    const { mapping, droppedIds } = parseMappingResponse(raw, validIds);
    expect(mapping.modules.map((m) => m.equipment_module_id)).toEqual(["em-uuid-1"]);
    expect(droppedIds).toEqual(["HALLUCINATED"]);
    expect(mapping.unit_name).toBe("Segment Wagon");
  });

  it("tolerates fenced ```json and surrounding prose", () => {
    const raw = "Here:\n```json\n{\"modules\":[],\"states\":[],\"faults\":[],\"process_model\":null}\n```";
    const { mapping } = parseMappingResponse(raw, validIds);
    expect(mapping.modules).toEqual([]);
  });
});
