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
    if (a.language === "SCL") {
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
 * Build a TiaManifest from forge artifacts using simple topological ordering.
 * Forge artifacts already have explicit dependency lists.
 */
export function buildForgeManifest(
  artifacts: ForgeArtifact[],
  _tiaProjectPath: string,
  tiaVersion: string = "V18",
): TiaManifest {
  // Sort by block type order, then by dependencies (simple sort — no circular deps expected)
  const sorted = [...artifacts].sort((a, b) => {
    const orderA = BLOCK_TYPE_ORDER[a.type] ?? 9;
    const orderB = BLOCK_TYPE_ORDER[b.type] ?? 9;
    return orderA - orderB;
  });

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
      .filter((a) => a.language === "SCL")
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
