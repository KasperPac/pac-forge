import { describe, it, expect } from "vitest";
import { reconcileArtifacts } from "../code-builder-reconcile";
import type { CodegenArtifact } from "@/lib/spec-builder/codegen";
import type { CodeBuilderArtifactRow } from "@/types/code-builder";

const artifact = (over: Partial<CodegenArtifact>): CodegenArtifact => ({
  name: "CM_Motor_M01_DB", type: "DB", filename: "CM_Motor_M01_DB.db",
  content: "DATA_BLOCK v1", dependencies: ["CM_Motor"], folder: "Program blocks",
  layer: "device", ownerId: "cm-1", ownerName: "M01", ...over,
});

const row = (over: Partial<CodeBuilderArtifactRow>): CodeBuilderArtifactRow => ({
  id: "r1", spec_id: "s1", revision: 2, artifact_name: "CM_Motor_M01_DB",
  layer: "device", owner_id: "cm-1", type: "DB", filename: "CM_Motor_M01_DB.db",
  folder: "Program blocks", dependencies: ["CM_Motor"],
  generated_content: "DATA_BLOCK v1", edited_content: null, status: "pending",
  approved_by: null, approved_at: null, acknowledged_warnings: [], review_status: null, review_findings: [], updated_at: "", ...over,
});

describe("reconcileArtifacts", () => {
  it("creates a pending view for a brand-new artifact", () => {
    const [v] = reconcileArtifacts({ specId: "s1", revision: 2, compiled: [artifact({})], existing: [] });
    expect(v.status).toBe("pending");
    expect(v.edited_content).toBeNull();
    expect(v.drift).toBe(false);
    expect(v.owner_name).toBe("M01");
  });

  it("preserves an approval and flags drift when the recompile differs", () => {
    const existing = [row({ status: "approved", generated_content: "DATA_BLOCK v0" })];
    const [v] = reconcileArtifacts({ specId: "s1", revision: 2, compiled: [artifact({ content: "DATA_BLOCK v1" })], existing });
    expect(v.status).toBe("approved");
    expect(v.generated_content).toBe("DATA_BLOCK v1");
    expect(v.drift).toBe(true);
  });

  it("preserves an edit and flags drift when the recompile differs", () => {
    const existing = [row({ edited_content: "DATA_BLOCK edited", generated_content: "DATA_BLOCK v0" })];
    const [v] = reconcileArtifacts({ specId: "s1", revision: 2, compiled: [artifact({ content: "DATA_BLOCK v1" })], existing });
    expect(v.edited_content).toBe("DATA_BLOCK edited");
    expect(v.drift).toBe(true);
  });

  it("does not flag drift when an approved artifact is unchanged", () => {
    const existing = [row({ status: "approved", generated_content: "DATA_BLOCK v1" })];
    const [v] = reconcileArtifacts({ specId: "s1", revision: 2, compiled: [artifact({ content: "DATA_BLOCK v1" })], existing });
    expect(v.drift).toBe(false);
  });

  it("defaults regionDrift to empty for a new artifact", () => {
    const [v] = reconcileArtifacts({ specId: "s1", revision: 2, compiled: [artifact({})], existing: [] });
    expect(v.regionDrift).toEqual([]);
  });

  it("lists AI-fill regions that changed between the reviewed and recompiled FB", () => {
    const oldFb = [
      "FUNCTION_BLOCK EM_X",
      "// <ai-fill EM_X:running.1>",
      '"M01".cmd_run := TRUE;',
      "// </ai-fill EM_X:running.1>",
      "// <ai-fill EM_X:running.2>",
      "// TODO (AI-fill): hold",
      "// </ai-fill EM_X:running.2>",
      "END_FUNCTION_BLOCK",
    ].join("\n");
    const newFb = oldFb.replace('"M01".cmd_run := TRUE;', '"M01".cmd_run := FALSE;');
    const existing = [row({
      artifact_name: "EM_X", type: "FB", layer: "em",
      status: "approved", generated_content: oldFb,
    })];
    const [v] = reconcileArtifacts({
      specId: "s1", revision: 2,
      compiled: [artifact({ name: "EM_X", type: "FB", layer: "em", content: newFb })],
      existing,
    });
    expect(v.drift).toBe(true);
    expect(v.regionDrift).toEqual(["EM_X:running.1"]);
  });

  it("carries persisted gate/review state from the prior row", () => {
    const existing = [row({
      acknowledged_warnings: ["MISSING_INTERLOCK:12"],
      review_status: "findings",
      review_findings: [{ severity: "WARNING", artifactName: "CM_Motor_M01_DB", message: "x" }],
    })];
    const [v] = reconcileArtifacts({ specId: "s1", revision: 2, compiled: [artifact({})], existing });
    expect(v.acknowledged_warnings).toEqual(["MISSING_INTERLOCK:12"]);
    expect(v.review_status).toBe("findings");
    expect(v.review_findings).toHaveLength(1);
  });

  it("defaults persisted gate/review state when there is no prior row", () => {
    const [v] = reconcileArtifacts({ specId: "s1", revision: 2, compiled: [artifact({})], existing: [] });
    expect(v.acknowledged_warnings).toEqual([]);
    expect(v.review_status).toBeNull();
    expect(v.review_findings).toEqual([]);
  });
});
