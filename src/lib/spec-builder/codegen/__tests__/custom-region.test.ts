import { describe, expect, it } from "vitest";
import { CUSTOM_REGION_BEGIN, CUSTOM_REGION_END, extractCustomRegion, mergeCustomRegion } from "../custom-region";

const fresh = [
  `FUNCTION "FC_Process_Unit_Process" : Void`,
  `BEGIN`,
  `   "UC_Process_Unit_DB"();`,
  `   ${CUSTOM_REGION_BEGIN}`,
  `   // (site/process-specific ties, one-shots, special cases)`,
  `   ${CUSTOM_REGION_END}`,
  `END_FUNCTION`,
].join("\n");

describe("extractCustomRegion", () => {
  it("returns the inner body", () => {
    const edited = fresh.replace(
      `   // (site/process-specific ties, one-shots, special cases)`,
      `   "SPECIAL_LAMP" := TRUE;`,
    );
    expect(extractCustomRegion(edited)).toContain(`"SPECIAL_LAMP" := TRUE;`);
  });
  it("returns null when a marker is missing or out of order", () => {
    expect(extractCustomRegion("no markers here")).toBeNull();
    expect(extractCustomRegion(`${CUSTOM_REGION_END}\n${CUSTOM_REGION_BEGIN}`)).toBeNull();
  });
});

describe("mergeCustomRegion", () => {
  it("carries the previous body into the fresh generation", () => {
    const edited = fresh.replace(
      `   // (site/process-specific ties, one-shots, special cases)`,
      `   "SPECIAL_LAMP" := TRUE;`,
    );
    const { content, warning } = mergeCustomRegion(fresh, edited);
    expect(warning).toBeUndefined();
    expect(content).toContain(`"SPECIAL_LAMP" := TRUE;`);
    expect(content).toContain(`"UC_Process_Unit_DB"();`);
  });
  it("returns fresh + warning when previous markers are mangled", () => {
    const { content, warning } = mergeCustomRegion(fresh, "markers gone");
    expect(content).toBe(fresh);
    expect(warning).toMatch(/NOT carried over/);
  });
  it("no-ops on null/undefined previous", () => {
    expect(mergeCustomRegion(fresh, null).content).toBe(fresh);
    expect(mergeCustomRegion(fresh, undefined).warning).toBeUndefined();
  });
});
