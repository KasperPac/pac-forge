import { useState, useCallback } from "react";
import JSZip from "jszip";
import { loadSpecContract } from "@/lib/spec-builder/contract";
import { compileContract } from "@/lib/spec-builder/codegen/compile-contract";
import { buildDashboardModel } from "@/lib/spec-builder/dashboard/dashboard-model";
import { emitDashboard } from "@/lib/spec-builder/dashboard/dashboard-emit";
import { RUNTIME_FILES } from "@/lib/spec-builder/dashboard/runtime-files";
import { useFbTemplates } from "@/hooks/use-fb-templates";

/** Project metadata the caller supplies for the dashboard's title/README. */
export interface GenerateDashboardProject {
  name: string;
  revision: number;
  generatedNote: string;
}

/**
 * Packs a file map (path → text content) into a downloadable zip Blob.
 * Pure — no React, no IO beyond JSZip's in-memory packing — so it can be
 * unit-tested without mocking Supabase or React Query.
 */
export async function buildBundleZip(files: Map<string, string>): Promise<Blob> {
  const zip = new JSZip();
  for (const [name, content] of files) zip.file(name, content);
  // Generate as arraybuffer (universally supported, no environment feature
  // detection) rather than JSZip's own `type: "blob"`, then wrap ourselves —
  // some DOM environments (notably jsdom, used by this project's test suite)
  // ship a Blob implementation missing `arrayBuffer()` per the spec
  // (https://github.com/jsdom/jsdom#unimplemented-parts-of-the-web-platform).
  // Real browsers implement it natively, so the fallback below is a no-op there.
  const buffer = await zip.generateAsync({ type: "arraybuffer" });
  const blob = new Blob([buffer], { type: "application/zip" });
  if (typeof blob.arrayBuffer !== "function") {
    Object.defineProperty(blob, "arrayBuffer", { value: async () => buffer });
  }
  return blob;
}

/**
 * Chains the commissioning-dashboard pipeline: load the confirmed spec
 * contract, deterministically compile it (device/EM FB layer), derive the
 * dashboard model (devices/EMs/alarms/setpoints/sim rules), emit the static
 * runtime + generated model/README, and pack the result into a zip Blob
 * ready for download.
 */
export function useGenerateDashboard() {
  const { data: templates = [] } = useFbTemplates();
  const [isGenerating, setGenerating] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  const generate = useCallback(
    async (specId: string, project: GenerateDashboardProject): Promise<Blob> => {
      setGenerating(true);
      try {
        const contract = await loadSpecContract(specId);
        const compile = compileContract(contract, templates);
        const model = buildDashboardModel({
          contract,
          compile,
          project: { name: project.name, specId, revision: project.revision, generatedNote: project.generatedNote },
        });
        setWarnings(model.warnings);
        const files = emitDashboard(model, RUNTIME_FILES);
        return await buildBundleZip(files);
      } finally {
        setGenerating(false);
      }
    },
    [templates],
  );

  return { generate, isGenerating, warnings };
}
