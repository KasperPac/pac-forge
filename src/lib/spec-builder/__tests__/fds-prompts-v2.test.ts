import { describe, expect, it } from "vitest";
import { buildFdsInterviewSystemPrompt } from "../fds-prompts";
import catodoAssembly from "./__fixtures__/catodo-assembly.json";

describe("buildFdsInterviewSystemPrompt V2 snapshot", () => {
  it("produces stable output for the catodo lift assembly", () => {
    const prompt = buildFdsInterviewSystemPrompt(
      catodoAssembly.assembly as never,
      catodoAssembly.subsystem as never,
      catodoAssembly.tags as never,
      catodoAssembly.staticStates as never,
      catodoAssembly.completedSequentialStates as never,
      catodoAssembly.allStates as never,
    );
    expect(prompt).toMatchSnapshot();
  });

  it("includes the V2 marker fields in the rendered RESPONSE FORMAT", () => {
    const prompt = buildFdsInterviewSystemPrompt(
      catodoAssembly.assembly as never,
      catodoAssembly.subsystem as never,
      catodoAssembly.tags as never,
      catodoAssembly.staticStates as never,
      catodoAssembly.completedSequentialStates as never,
      catodoAssembly.allStates as never,
    );
    expect(prompt).toContain('"override_kind": "override"');
    expect(prompt).toContain('"kind": "tag_equals"');
    expect(prompt).toContain('"kind": "tag_compare"');
    expect(prompt).toContain('"next_step_id"');
    expect(prompt).toContain("state_id is a NUMBER");
  });

  it("renders the SEQUENTIAL STATES REMAINING table with numeric ids", () => {
    const prompt = buildFdsInterviewSystemPrompt(
      catodoAssembly.assembly as never,
      catodoAssembly.subsystem as never,
      catodoAssembly.tags as never,
      catodoAssembly.staticStates as never,
      catodoAssembly.completedSequentialStates as never,
      catodoAssembly.allStates as never,
    );
    // Both sequential states from the fixture must appear with their numeric ids.
    expect(prompt).toMatch(/- 6 +\(Execute\)/);
    expect(prompt).toMatch(/- 16 +\(Completing\)/);
    // The static state (Idle, id 4) must NOT appear in the remaining-table.
    const remainingBlock = prompt.split("# SEQUENTIAL STATES REMAINING")[1] ?? "";
    expect(remainingBlock).not.toMatch(/- 4 +\(Idle\)/);
  });
});
