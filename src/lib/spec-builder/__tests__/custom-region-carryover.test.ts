import { describe, expect, it } from "vitest";
import { carryOverCustomRegions } from "../custom-region-carryover";
import { CUSTOM_REGION_BEGIN, CUSTOM_REGION_END } from "../codegen/custom-region";

const freshProcess = [
  `FUNCTION "FC_Process_Unit_Process" : Void`, `BEGIN`,
  `   "UC_Process_Unit_DB"();`,
  `   ${CUSTOM_REGION_BEGIN}`, `   // (site/process-specific ties, one-shots, special cases)`, `   ${CUSTOM_REGION_END}`,
  `END_FUNCTION`,
].join("\n");
const editedPrev = freshProcess.replace(`   // (site/process-specific ties, one-shots, special cases)`, `   "LAMP" := TRUE;`);

describe("carryOverCustomRegions", () => {
  it("merges the prior revision's region into the fresh Process FC", async () => {
    const { contents, warnings } = await carryOverCustomRegions(
      [{ name: "FC_Process_Unit_Process", content: freshProcess }, { name: "Main", content: "OB" }],
      "spec-1", 2,
      async (_s, before, names) => {
        expect(before).toBe(2);
        expect(names).toEqual(["FC_Process_Unit_Process"]); // only Process FCs queried
        return [{ artifact_name: "FC_Process_Unit_Process", edited_content: editedPrev }];
      },
    );
    expect(contents.get("FC_Process_Unit_Process")).toContain(`"LAMP" := TRUE;`);
    expect(warnings).toEqual([]);
  });

  it("returns a warning and no content when prior markers are mangled", async () => {
    const { contents, warnings } = await carryOverCustomRegions(
      [{ name: "FC_Process_Unit_Process", content: freshProcess }],
      "spec-1", 2, async () => [{ artifact_name: "FC_Process_Unit_Process", edited_content: "mangled" }],
    );
    expect(contents.size).toBe(0);
    expect(warnings[0]).toMatch(/NOT carried over/);
  });

  it("no-ops when there are no Process FCs or no prior edits", async () => {
    const r = await carryOverCustomRegions([{ name: "Main", content: "OB" }], "s", 2, async () => []);
    expect(r.contents.size).toBe(0);
  });
});
