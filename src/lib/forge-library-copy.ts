/**
 * forge-library-copy.ts
 * Copy library blocks from a TIA Portal global library into the open project
 * via the bridge's /tia/library/copy-to-project endpoint.
 */

import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import type { LibraryCopyToProjectRequest, LibraryCopyToProjectResponse } from "@/lib/tia-bridge-contract";
import { buildLibraryFolder } from "@/lib/dropbox-paths";
import type { ForgeArtifact } from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";

const BRIDGE_BASE = DEFAULT_BRIDGE_CONFIG.baseUrl;

/**
 * Copy library blocks into the TIA project by calling the bridge endpoint.
 * Groups artifacts by their source library and sends one request per library.
 * Only sends FB/FC blocks as master copy paths — UDTs come along as dependencies.
 */
export async function copyLibraryBlocksToProject(
  dropboxRoot: string,
  libraryArtifacts: ForgeArtifact[],
  fbTemplates: FbTemplate[],
  projectPath?: string,
): Promise<{ success: boolean; copied: string[]; skipped: string[]; warnings: string[] }> {
  // Group library artifacts by their source library
  const byLibrary = new Map<string, Set<string>>();

  for (const a of libraryArtifacts) {
    if (!a.fb_template_id) continue;
    const template = fbTemplates.find(t => t.id === a.fb_template_id);
    if (!template?.library_name) continue;

    // Only send FBs/FCs as master copy targets — UDTs come as dependencies
    if (a.type !== "FB" && a.type !== "FC") continue;

    const libName = template.library_name;
    if (!byLibrary.has(libName)) byLibrary.set(libName, new Set());
    byLibrary.get(libName)!.add(a.name);
  }

  const allCopied: string[] = [];
  const allSkipped: string[] = [];
  const allWarnings: string[] = [];

  for (const [libName, blockNames] of byLibrary) {
    const libraryFolder = buildLibraryFolder(dropboxRoot, libName);
    const body: LibraryCopyToProjectRequest = {
      library_path: libraryFolder,
      project_path: projectPath,
      master_copy_paths: [...blockNames],
      type_paths: [],
    };

    try {
      const resp = await fetch(`${BRIDGE_BASE}/tia/library/copy-to-project`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

      if (!resp.ok) {
        allWarnings.push(`Library copy failed (${resp.status}): ${await resp.text()}`);
        continue;
      }

      const result: LibraryCopyToProjectResponse = await resp.json();
      allCopied.push(...result.copied_blocks);
      allSkipped.push(...result.skipped_blocks);
      allWarnings.push(...result.warnings);
    } catch (err) {
      allWarnings.push(`Library copy error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    success: true,
    copied: allCopied,
    skipped: allSkipped,
    warnings: allWarnings,
  };
}
