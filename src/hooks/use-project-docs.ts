import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toDropboxApiPath } from "@/lib/dropbox-paths";

export interface DropboxEntry {
  name: string;
  path: string;
  tag: "file" | "folder";
}

/** Name of the documents folder within a job folder. */
export const DOC_FOLDER_NAME = "51 DOC";

async function invokeDropbox(action: string, params?: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("dropbox", {
    body: { action, ...params },
  });
  if (error) {
    let detail = error.message;
    if (error.context && typeof error.context.json === "function") {
      const b = await error.context.json().catch(() => null);
      if (b?.error) detail = b.error;
    }
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Dropbox-API path of the documents folder, or null if not resolvable. */
export function docFolderApiPath(
  dropboxFolderPath: string | null | undefined,
  dropboxRoot: string,
): string | null {
  if (!dropboxFolderPath || !dropboxRoot) return null;
  const base = toDropboxApiPath(dropboxFolderPath, dropboxRoot);
  if (!base) return null;
  return `${base}/${DOC_FOLDER_NAME}`;
}

/** List entries at <docRootApiPath>/<subPath> (subPath may be ""). */
export function useDocFolderListing(
  docRootApiPath: string | null,
  subPath: string,
) {
  const fullPath = docRootApiPath
    ? subPath
      ? `${docRootApiPath}/${subPath}`
      : docRootApiPath
    : null;
  return useQuery({
    queryKey: ["doc-folder", fullPath],
    queryFn: async (): Promise<DropboxEntry[]> => {
      const result = await invokeDropbox("list-folder", { path: fullPath });
      return (result.entries as DropboxEntry[]) ?? [];
    },
    enabled: !!fullPath,
    staleTime: 15_000,
  });
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const CHUNK = 0x8000; // 32 KB — keep String.fromCharCode arg count bounded
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function useUploadDocFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { apiFolderPath: string; filename: string; file: File }) => {
      const content_base64 = await fileToBase64(p.file);
      await invokeDropbox("upload-file", {
        path: `${p.apiFolderPath}/${p.filename}`,
        content_base64,
        mode: "add",
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doc-folder"] }),
  });
}

export function useMoveDocFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { fromPath: string; toPath: string }) => {
      await invokeDropbox("move-file", { from_path: p.fromPath, to_path: p.toPath });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doc-folder"] }),
  });
}
