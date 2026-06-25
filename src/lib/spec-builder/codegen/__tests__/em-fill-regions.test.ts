import { describe, it, expect } from "vitest";
import {
  regionId, defaultStub, renderRegion, parseRegions, replaceRegion, regionDrift,
} from "../em-fill-regions";

const ID = regionId("EM_Drive", "running.1");

function doc(body: string): string {
  return [
    "         10:",
    renderRegion(ID, body, "         "),
    "         20: ;",
  ].join("\n");
}

describe("region markers", () => {
  it("composes a stable region id", () => {
    expect(ID).toBe("EM_Drive:running.1");
  });

  it("renders open/close markers around a body", () => {
    const r = renderRegion(ID, "   #x := TRUE;", "");
    expect(r).toBe("// <ai-fill EM_Drive:running.1>\n   #x := TRUE;\n// </ai-fill EM_Drive:running.1>");
  });

  it("parses a region body back out", () => {
    const regions = parseRegions(doc(defaultStub("ramp drive", "            ")));
    expect(regions.get(ID)).toBe("            // TODO (AI-fill): ramp drive");
  });

  it("parses CRLF documents", () => {
    const crlf = doc("   #x := TRUE;").replace(/\n/g, "\r\n");
    expect(parseRegions(crlf).get(ID)).toBe("   #x := TRUE;");
  });

  it("replaces exactly one region body, preserving markers and siblings", () => {
    const before = doc(defaultStub("ramp drive", "            "));
    const after = replaceRegion(before, ID, "            #cmd_run := TRUE;");
    expect(after).toContain("// <ai-fill EM_Drive:running.1>");
    expect(after).toContain("            #cmd_run := TRUE;");
    expect(after).toContain("// </ai-fill EM_Drive:running.1>");
    expect(after).toContain("         20: ;");
    expect(parseRegions(after).get(ID)).toBe("            #cmd_run := TRUE;");
  });

  it("is a no-op for an unknown region id", () => {
    const before = doc("   #x := TRUE;");
    expect(replaceRegion(before, "EM_Drive:does.not.exist", "   #y := FALSE;")).toBe(before);
  });

  it("detects body drift between two versions", () => {
    const a = doc("   #x := TRUE;");
    const b = replaceRegion(a, ID, "   #x := FALSE;");
    expect(regionDrift(a, b)).toEqual([ID]);
    expect(regionDrift(a, a)).toEqual([]);
  });
});
