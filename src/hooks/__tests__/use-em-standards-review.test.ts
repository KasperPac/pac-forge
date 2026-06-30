import { describe, it, expect } from "vitest";
import { buildEmReviewInput } from "../use-em-standards-review";

describe("buildEmReviewInput", () => {
  const platformRules = "## Platform Rules\nUse interlocks.";

  it("includes the FB name and SCL in the user message", () => {
    const { userMessage } = buildEmReviewInput(
      { name: "EM_Carriage_Drive", type: "FB", content: 'FUNCTION_BLOCK EM_Carriage_Drive\n"M01".cmd_run := TRUE;\nEND_FUNCTION_BLOCK' },
      platformRules,
    );
    expect(userMessage).toContain("EM_Carriage_Drive");
    expect(userMessage).toContain('"M01".cmd_run := TRUE;');
    expect(userMessage).toContain("```scl");
  });

  it("produces a non-empty system prompt from the reviewer sections", () => {
    const { systemPrompt } = buildEmReviewInput(
      { name: "EM_X", type: "FB", content: "FUNCTION_BLOCK EM_X\nEND_FUNCTION_BLOCK" },
      platformRules,
    );
    expect(systemPrompt.length).toBeGreaterThan(0);
    expect(systemPrompt).toContain("Platform Rules");
  });

  it("is generic — carries no machine-specific tokens of its own", () => {
    const { systemPrompt, userMessage } = buildEmReviewInput(
      { name: "EM_X", type: "FB", content: "FUNCTION_BLOCK EM_X\nEND_FUNCTION_BLOCK" },
      platformRules,
    );
    for (const token of ["conveyor", "lift", "stamp", "carriage", "wagon"]) {
      expect(systemPrompt.toLowerCase()).not.toContain(token);
      // userMessage only contains the caller-supplied FB, never a hard-coded name
      expect(userMessage.toLowerCase()).not.toContain(token);
    }
  });
});
