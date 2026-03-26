import type { ProcessStage, ProcessStageStatus } from "@/types/forge-matrix";
import { PROCESS_STAGE_ORDER } from "@/types/forge-matrix";
import type { Artifact } from "@/types";

/** Stage config for each generation stage. */
export const PROCESS_STAGE_CONFIG: Record<
  Exclude<ProcessStage, "qa" | "matrix">,
  { label: string; description: string; agentRole: string }
> = {
  io: {
    label: "IO List Generation",
    description: "Generate IO configuration artifacts from confirmed hardware modules",
    agentRole: "generate",
  },
  folders: {
    label: "Folder Structure",
    description: "Create TIA Portal folder structure per design profile rules",
    agentRole: "generate",
  },
  fb: {
    label: "Function Block Generation",
    description: "Generate FBs grouped by device type, using templates where available",
    agentRole: "generate",
  },
  db: {
    label: "Data Block Generation",
    description: "Generate Instance DBs and Global DBs from generated FBs",
    agentRole: "generate",
  },
  fc_ob: {
    label: "Process FC + OB1",
    description: "Generate Process FC linking all FBs and OB1 Main entry point",
    agentRole: "generate",
  },
};

/**
 * Collect all artifacts from completed stages to build context for the next stage.
 * When `compact` is true, FB artifacts are reduced to just their interface declarations
 * (VAR_INPUT/VAR_OUTPUT/VAR_IN_OUT) — the FC+OB stage only needs to know how to call FBs,
 * not their full implementation.
 */
export function getStageContext(
  stageArtifacts: Record<ProcessStage, Artifact[]>,
  upToStage: ProcessStage,
  compact = false,
): string {
  const sections: string[] = [];
  const targetIdx = PROCESS_STAGE_ORDER.indexOf(upToStage);

  for (const stage of PROCESS_STAGE_ORDER) {
    if (PROCESS_STAGE_ORDER.indexOf(stage) >= targetIdx) break;
    const artifacts = stageArtifacts[stage];
    if (artifacts.length === 0) continue;

    sections.push(`## Artifacts from ${stage.toUpperCase()} stage:`);
    for (const a of artifacts) {
      const content = compact && a.type === "FB"
        ? extractFbInterface(a.content)
        : a.content;
      sections.push(`### ${a.name} (${a.type})`);
      sections.push("```scl");
      sections.push(content);
      sections.push("```");
    }
    sections.push("");
  }

  return sections.join("\n");
}

/**
 * Extract just the interface declarations from an FB's SCL source.
 * Keeps the header + all VAR sections, strips the BEGIN...END implementation.
 */
function extractFbInterface(scl: string): string {
  // Find BEGIN keyword — everything before it is the interface
  const beginIdx = scl.search(/^BEGIN\b/m);
  if (beginIdx < 0) return scl; // No BEGIN found, return as-is

  const interfacePart = scl.substring(0, beginIdx).trimEnd();

  // Find the block name from the first line for the closing tag
  const blockEnd = scl.match(/^END_(FUNCTION_BLOCK|FUNCTION|DATA_BLOCK)/m);
  const endTag = blockEnd ? blockEnd[0] : "END_FUNCTION_BLOCK";

  return `${interfacePart}\nBEGIN\n  // (implementation omitted — interface only)\n${endTag}`;
}

/**
 * Check if all required previous stages are complete before running a stage.
 */
export function validateStagePrerequisites(
  stage: ProcessStage,
  stageStatuses: ProcessStageStatus[],
): { valid: boolean; missingStages: ProcessStage[] } {
  const targetIdx = PROCESS_STAGE_ORDER.indexOf(stage);
  const missing: ProcessStage[] = [];

  // Q&A must always be completed
  const qaStatus = stageStatuses.find((s) => s.stage === "qa");
  if (!qaStatus || qaStatus.status !== "completed") {
    missing.push("qa");
  }

  // Matrix must be completed before any generation stage
  if (targetIdx > PROCESS_STAGE_ORDER.indexOf("matrix")) {
    const matrixStatus = stageStatuses.find((s) => s.stage === "matrix");
    if (!matrixStatus || matrixStatus.status !== "completed") {
      missing.push("matrix");
    }
  }

  // For stages after IO, IO must be completed
  if (targetIdx > PROCESS_STAGE_ORDER.indexOf("io")) {
    const ioStatus = stageStatuses.find((s) => s.stage === "io");
    if (!ioStatus || ioStatus.status !== "completed") {
      missing.push("io");
    }
  }

  // FB stage must be completed before DB stage
  if (stage === "db") {
    const fbStatus = stageStatuses.find((s) => s.stage === "fb");
    if (!fbStatus || fbStatus.status !== "completed") {
      missing.push("fb");
    }
  }

  // DB + FB must be completed before FC+OB stage
  if (stage === "fc_ob") {
    for (const dep of ["fb", "db"] as ProcessStage[]) {
      const depStatus = stageStatuses.find((s) => s.stage === dep);
      if (!depStatus || depStatus.status !== "completed") {
        missing.push(dep);
      }
    }
  }

  return { valid: missing.length === 0, missingStages: missing };
}
