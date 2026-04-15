/**
 * Suggests the next functional spec document number by scanning
 * the Dropbox folder: {project_folder}/51 DOC/08 FUNCTIONAL SPEC/
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toDropboxApiPath } from "@/lib/dropbox-paths";
import { useUiStore } from "@/stores/ui-store";

interface DropboxEntry {
  name: string;
  path: string;
  tag: "file" | "folder";
}

/**
 * Given a project number like "PAC-2614" and the project's dropbox folder path,
 * scans the functional spec folder and returns the next available doc code.
 *
 * Doc code format: {project_number}-5008{xx}
 * where 50 = folder, 08 = subfolder, xx = sequential doc number
 */
export function useNextSpecDocCode(
  projectNumber: string | null | undefined,
  dropboxFolderPath: string | null | undefined,
) {
  const dropboxRoot = useUiStore((s) => s.dropboxRoot);

  return useQuery({
    queryKey: ["spec-doc-number", projectNumber, dropboxFolderPath],
    queryFn: async (): Promise<string> => {
      if (!projectNumber) return "";

      // Try scanning Dropbox folder for existing docs
      if (dropboxFolderPath && dropboxRoot) {
        const apiBasePath = toDropboxApiPath(dropboxFolderPath, dropboxRoot);
        if (apiBasePath) {
          const specFolderPath = `${apiBasePath}/51 DOC/08 FUNCTIONAL SPEC`;
          try {
            const { data, error } = await supabase.functions.invoke("dropbox", {
              body: { action: "list-folder", path: specFolderPath },
            });

            if (!error && data?.entries) {
              const entries = data.entries as DropboxEntry[];
              return deriveNextDocCode(projectNumber, entries);
            }
          } catch {
            // Folder may not exist yet — fall through to default
          }
        }
      }

      // Default: first doc
      return `${projectNumber}-500801`;
    },
    enabled: !!projectNumber,
    staleTime: 30_000,
  });
}

/**
 * Parse existing filenames to find the highest doc number and return the next one.
 *
 * Looks for filenames matching the pattern: {project_number}-5008{xx}
 * e.g. "PAC-2614-500801_Rev01_Something.docx" → extracts 01
 */
function deriveNextDocCode(projectNumber: string, entries: DropboxEntry[]): string {
  const prefix = `${projectNumber}-5008`.toLowerCase();
  let maxNum = 0;

  for (const entry of entries) {
    const name = entry.name.toLowerCase();
    const idx = name.indexOf(prefix);
    if (idx === -1) continue;

    // Extract the 2-digit number after the prefix
    const afterPrefix = name.slice(idx + prefix.length);
    const match = afterPrefix.match(/^(\d{1,3})/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }

  const nextNum = String(maxNum + 1).padStart(2, "0");
  return `${projectNumber}-5008${nextNum}`;
}
