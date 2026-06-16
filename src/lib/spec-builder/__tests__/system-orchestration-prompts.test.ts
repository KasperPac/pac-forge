import { describe, expect, it } from "vitest";
import {
  INTERLOCK_EFFECTS_DOC,
  COMPLETION_CRITERION_DOC,
  buildFdsSystemProcedureSystemPrompt,
} from "../system-orchestration-prompts";

describe("INTERLOCK_EFFECTS_DOC", () => {
  it("documents all five closed-set effects", () => {
    for (const effect of ["hold", "block_transition", "trigger", "enable", "disable"]) {
      expect(INTERLOCK_EFFECTS_DOC).toContain(`"${effect}"`);
    }
  });

  it("notes the effect_target requirement for block_transition and trigger", () => {
    expect(INTERLOCK_EFFECTS_DOC).toMatch(/effect_target.*REQUIRED/);
  });
});

describe("COMPLETION_CRITERION_DOC", () => {
  it("documents all five accepted kinds", () => {
    for (const kind of ["tag_equals", "tag_compare", "expression", "manual_ack", "placeholder"]) {
      expect(COMPLETION_CRITERION_DOC).toContain(`"${kind}"`);
    }
  });
});

describe("buildFdsSystemProcedureSystemPrompt", () => {
  it("still inlines the shared docs (regression — extraction didn't break the existing prompt)", () => {
    const prompt = buildFdsSystemProcedureSystemPrompt(
      {
        id: "00000000-0000-4000-8000-000000000001",
        doc_code: "X",
        title: "T",
      } as never,
      [],
      [],
      null,
    );
    // Both shared docs should appear verbatim in the assembled system-level prompt.
    expect(prompt).toContain(INTERLOCK_EFFECTS_DOC);
    expect(prompt).toContain(COMPLETION_CRITERION_DOC);
  });
});
