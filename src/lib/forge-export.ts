/**
 * forge-export.ts
 * Utilities for building the TIA import bundle from Forge artifacts.
 * Orchestration logic lives in use-forge-tia-export.ts.
 */

import JSZip from "jszip";
import type { ForgeArtifact } from "@/types/forge";
import type { TiaManifest } from "@/types";

// ---------------------------------------------------------------------------
// Bundle builder
// ---------------------------------------------------------------------------

/**
 * Build a base64-encoded zip bundle from SCL artifacts.
 * Each artifact becomes a .scl file at the root of the zip.
 */
export async function buildSclBundle(artifacts: ForgeArtifact[]): Promise<string> {
  const zip = new JSZip();
  for (const a of artifacts) {
    // Skip library blocks — they already exist in TIA project from the global library
    if (a.language === "SCL" && !a.library_block) {
      zip.file(`${a.name}.scl`, a.content);
    }
  }
  const blob = await zip.generateAsync({ type: "base64" });
  return blob;
}

// ---------------------------------------------------------------------------
// Manifest builder for forge artifacts
// ---------------------------------------------------------------------------

const BLOCK_TYPE_ORDER: Record<string, number> = {
  UDT: 0,
  FB: 1,
  FC: 2,
  DB: 3,
  OB: 4,
  TAG_TABLE: 5,
};

/**
 * Topological sort using Kahn's algorithm.
 * Sorts within each type group by dependency order.
 * Falls back to type-order if a cycle is detected.
 */
function topoSort(artifacts: ForgeArtifact[]): ForgeArtifact[] {
  // First sort by type order
  const byType = [...artifacts].sort((a, b) => {
    const orderA = BLOCK_TYPE_ORDER[a.type] ?? 9;
    const orderB = BLOCK_TYPE_ORDER[b.type] ?? 9;
    return orderA - orderB;
  });

  const nameToArtifact = new Map(byType.map((a) => [a.name, a]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const a of byType) {
    inDegree.set(a.name, 0);
    adjacency.set(a.name, []);
  }

  // Build edges: dep → artifact (dep must come before artifact)
  for (const a of byType) {
    for (const dep of a.dependencies) {
      if (nameToArtifact.has(dep)) {
        adjacency.get(dep)!.push(a.name);
        inDegree.set(a.name, (inDegree.get(a.name) ?? 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) queue.push(name);
  }

  // Maintain type order within the zero-degree queue
  queue.sort((a, b) => {
    const ta = BLOCK_TYPE_ORDER[nameToArtifact.get(a)?.type ?? ""] ?? 9;
    const tb = BLOCK_TYPE_ORDER[nameToArtifact.get(b)?.type ?? ""] ?? 9;
    return ta - tb;
  });

  const sorted: ForgeArtifact[] = [];
  while (queue.length > 0) {
    const name = queue.shift()!;
    const artifact = nameToArtifact.get(name);
    if (artifact) sorted.push(artifact);

    const neighbors = adjacency.get(name) ?? [];
    for (const neighbor of neighbors) {
      const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If cycle detected (sorted.length < byType.length), fall back to type-order
  if (sorted.length < byType.length) {
    return byType;
  }

  return sorted;
}

/**
 * Build a TiaManifest from forge artifacts using dependency-aware topological ordering.
 * Forge artifacts already have explicit dependency lists.
 */
export function buildForgeManifest(
  artifacts: ForgeArtifact[],
  _tiaProjectPath: string,
  tiaVersion: string = "V20",
): TiaManifest {
  const sorted = topoSort(artifacts);

  return {
    manifest_version: "1.0",
    project_id: "",
    platform: "SIEMENS_TIA" as const,
    tia_version: tiaVersion,
    cpu_type: "S7-1500",
    created_at: new Date().toISOString(),
    created_by_user_id: "",
    generation_session_id: "",
    artifacts: sorted
      .filter((a) => a.language === "SCL" && !a.library_block)
      .map((a) => ({
        name: a.name,
        type: a.type,
        filename: `${a.name}.scl`,
        destination_folder: a.destination_folder,
        dependencies: a.dependencies,
        compile_after_import: a.compile_after_import,
        overwrite_strategy: "CREATE_OR_UPDATE" as const,
      })),
  };
}

// ---------------------------------------------------------------------------
// LAD XML builder wrapper
// ---------------------------------------------------------------------------

/**
 * Convert a LAD artifact (content = LadProgram JSON) to SimaticML XML.
 * Lazy-imports lad-xml-builder to avoid bundling unless needed.
 */
export async function buildLadXmlForArtifact(artifact: ForgeArtifact): Promise<string> {
  const { buildLadXml } = await import("@/lib/lad-xml-builder");
  const program = JSON.parse(artifact.content);
  // AI-generated LAD may omit fields that buildLadXml requires — fill defaults
  if (!program.variables) program.variables = [];
  if (!program.blockType) program.blockType = artifact.type; // "FC" | "FB"
  // Normalize variable scope/section — AI generates "STATIC"/"TEMP" but LadVariable expects "Static"/"Temp"
  const SCOPE_MAP: Record<string, string> = {
    STATIC: "Static", Static: "Static", static: "Static",
    TEMP: "Temp", Temp: "Temp", temp: "Temp",
    INPUT: "Input", Input: "Input", input: "Input",
    OUTPUT: "Output", Output: "Output", output: "Output",
    INOUT: "InOut", InOut: "InOut", inout: "InOut",
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const v of program.variables as any[]) {
    // AI may use "scope" instead of "section"
    const raw = v.section ?? v.scope ?? "Temp";
    v.section = SCOPE_MAP[raw] ?? "Temp";
  }
  // Strip "header comment" rungs that have no output coil — TIA Portal rejects rungs
  // with only contact elements (AI sometimes generates these as section dividers).
  const VALID_OUTPUT_TYPES = new Set([
    "OUTPUT_COIL", "SET_COIL", "RESET_COIL", "FB_CALL",
    "TON", "TOF", "CTU", "CTD", "CMP", "MATH", "MOVE",
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function hasOutputElement(node: any): boolean {
    if (!node) return false;
    if (node.type === "element") return VALID_OUTPUT_TYPES.has(node.element?.type);
    // Parallel or series: check branches/nodes recursively
    for (const arr of [node.branches, node.nodes]) {
      if (Array.isArray(arr)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (arr.some((c: any) => Array.isArray(c?.nodes) ? c.nodes.some(hasOutputElement) : hasOutputElement(c))) return true;
      }
    }
    return false;
  }
  if (Array.isArray(program.rungs)) {
    program.rungs = program.rungs.filter((rung: Record<string, unknown>) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodes = (rung.logic as any)?.nodes;
      if (!Array.isArray(nodes) || nodes.length === 0) return false;
      return nodes.some(hasOutputElement);
    });
  }
  return buildLadXml(program);
}

// ---------------------------------------------------------------------------
// HMI XML builder wrapper
// ---------------------------------------------------------------------------

/**
 * Convert an HMI artifact (content = HmiScreenSpec JSON) to WinCC SimaticML XML.
 * Lazy-imports hmi-xml-builder to avoid bundling unless needed.
 */
export async function buildHmiXmlForArtifact(artifact: ForgeArtifact): Promise<string> {
  const { buildScreenXml } = await import("@/lib/hmi-xml-builder");
  const screenSpec = JSON.parse(artifact.content);
  return buildScreenXml(screenSpec);
}
