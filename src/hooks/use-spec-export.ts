/**
 * Spec DOCX export — renders sections to a Word document,
 * saves to Dropbox (if configured), and records the export in spec_exports.
 */
import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useProject } from "@/hooks/use-projects";
import { useUiStore } from "@/stores/ui-store";
import { toDropboxApiPath } from "@/lib/dropbox-paths";
import { buildSpecDocx, buildSpecFilename } from "@/lib/spec-builder/docx-exporter";
import type { SpecProject, SpecSection } from "@/types/spec-builder";

export interface ExportStatus {
  phase: "idle" | "rendering" | "uploading" | "complete" | "error";
  message: string;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return btoa(binary);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function useSpecExport(spec: SpecProject | null) {
  const queryClient = useQueryClient();
  const dropboxRoot = useUiStore((s) => s.dropboxRoot);
  const { data: project } = useProject(spec?.project_id ?? undefined);
  const [status, setStatus] = useState<ExportStatus>({ phase: "idle", message: "" });
  const [lastPath, setLastPath] = useState<string | null>(null);

  const exportDocx = useCallback(
    async (sections: SpecSection[], opts: { uploadToDropbox: boolean }) => {
      if (!spec) return;
      setLastPath(null);
      try {
        // --- 1. Render DOCX ---
        setStatus({ phase: "rendering", message: "Rendering document…" });
        const blob = await buildSpecDocx(spec, sections);
        const filename = buildSpecFilename(spec);

        // --- 2. Always trigger a local download ---
        downloadBlob(blob, filename);

        // --- 3. Optionally upload to Dropbox ---
        let storagePath: string | null = null;
        if (opts.uploadToDropbox) {
          if (!project?.dropbox_folder_path || !dropboxRoot) {
            throw new Error("Dropbox not configured for this project");
          }
          const apiBasePath = toDropboxApiPath(project.dropbox_folder_path, dropboxRoot);
          if (!apiBasePath) {
            throw new Error("Could not derive Dropbox API path from project folder");
          }
          const targetFolder = `${apiBasePath}/51 DOC/08 FUNCTIONAL SPEC`;
          const targetPath = `${targetFolder}/${filename}`;

          setStatus({ phase: "uploading", message: "Creating Dropbox folder…" });
          // Best-effort folder create (ok if already exists)
          await supabase.functions.invoke("dropbox", {
            body: { action: "create-folder-path", path: targetFolder },
          });

          setStatus({ phase: "uploading", message: "Uploading to Dropbox…" });
          const contentBase64 = await blobToBase64(blob);
          const { data, error } = await supabase.functions.invoke("dropbox", {
            body: {
              action: "upload-file",
              path: targetPath,
              content_base64: contentBase64,
              mode: "overwrite",
            },
          });
          if (error) throw new Error(error.message);
          if (data?.error) throw new Error(data.error);
          storagePath = data?.path ?? targetPath;
        }

        // --- 4. Record the export ---
        const { error: insertError } = await supabase.from("spec_exports").insert({
          spec_project_id: spec.id,
          revision: spec.revision,
          storage_path: storagePath,
          page_count: null,
          status: "complete",
        });
        if (insertError) throw insertError;

        // Mark spec as complete on first successful export
        if (spec.status === "review") {
          await supabase
            .from("spec_projects")
            .update({ status: "complete" })
            .eq("id", spec.id);
          queryClient.invalidateQueries({ queryKey: ["spec_projects"] });
        }

        queryClient.invalidateQueries({ queryKey: ["spec_exports", spec.id] });
        setLastPath(storagePath);
        setStatus({
          phase: "complete",
          message: storagePath ? `Saved to ${storagePath}` : "Downloaded",
        });
      } catch (err) {
        setStatus({
          phase: "error",
          message: err instanceof Error ? err.message : "Export failed",
        });
      }
    },
    [spec, project, dropboxRoot, queryClient],
  );

  const reset = useCallback(() => setStatus({ phase: "idle", message: "" }), []);

  return { exportDocx, status, lastPath, reset };
}
