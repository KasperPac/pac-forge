import { useMemo, useState } from "react";
import { Folder, FileText, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useUiStore } from "@/stores/ui-store";
import type { Project } from "@/types/project";
import {
  classifyDoc,
  folderCodeFromName,
  isVendorFolderName,
  type DocState,
} from "@/lib/doc-control";
import {
  docFolderApiPath,
  useDocFolderListing,
  DOC_FOLDER_NAME,
  type DropboxEntry,
} from "@/hooks/use-project-docs";
import { useDocOverrides } from "@/hooks/use-doc-overrides";
import { DocStatusBadge } from "./doc-status-badge";

export default function ProjectDocuments({ project }: { project: Project }) {
  const dropboxRoot = useUiStore((s) => s.dropboxRoot);
  const docRoot = docFolderApiPath(project.dropbox_folder_path, dropboxRoot);

  // subPath: "" at the 51 DOC root, else "01 REFERENCE DOCS" etc.
  const [subPath, setSubPath] = useState("");
  const { data: entries = [], isLoading, error } = useDocFolderListing(docRoot, subPath);
  const { data: overrides = [] } = useDocOverrides(project.id);

  const docFolderCode = folderCodeFromName(DOC_FOLDER_NAME) ?? "51";
  // Current sub-folder is the last segment of subPath (if any).
  const currentSubName = subPath.split("/").pop() ?? "";
  const subfolderCode = subPath ? folderCodeFromName(currentSubName) : null;
  const isVendorFolder = subPath ? isVendorFolderName(currentSubName) : false;

  const overrideSet = useMemo(
    () => new Set(overrides.map((o) => o.rel_path)),
    [overrides],
  );

  const folders = entries.filter((e) => e.tag === "folder");
  const files = entries.filter((e) => e.tag === "file");

  function relPath(entry: DropboxEntry): string {
    return subPath
      ? `${DOC_FOLDER_NAME}/${subPath}/${entry.name}`
      : `${DOC_FOLDER_NAME}/${entry.name}`;
  }

  const classified = files.map((f) => ({
    entry: f,
    result: classifyDoc({
      filename: f.name,
      docFolderCode,
      subfolderCode,
      projectNumber: project.project_number ?? "",
      isVendorFolder,
      hasOverride: overrideSet.has(relPath(f)),
    }),
  }));

  const counts = classified.reduce(
    (acc, c) => {
      acc[c.result.state] += 1;
      return acc;
    },
    { conforming: 0, non_conforming: 0, needs_review: 0, customer_supplied: 0 } as Record<DocState, number>,
  );

  if (!project.dropbox_folder_path) {
    return (
      <Card className="p-4">
        <p className="font-mono text-sm text-muted-foreground">
          No Dropbox job folder is set for this project. Set the folder on the
          project Overview to browse documents.
        </p>
      </Card>
    );
  }

  if (!dropboxRoot) {
    return (
      <Card className="p-4">
        <p className="font-mono text-sm text-muted-foreground">
          Local Dropbox root is not configured. Set it in your profile to resolve
          document paths.
        </p>
      </Card>
    );
  }

  const breadcrumb = subPath ? subPath.split("/") : [];

  return (
    <Card className="p-4 space-y-3">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
        <button className="hover:text-foreground" onClick={() => setSubPath("")}>
          {DOC_FOLDER_NAME}
        </button>
        {breadcrumb.map((seg, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3" />
            <button
              className="hover:text-foreground"
              onClick={() => setSubPath(breadcrumb.slice(0, i + 1).join("/"))}
            >
              {seg}
            </button>
          </span>
        ))}
      </div>

      {/* Conformance summary */}
      <div className="flex flex-wrap gap-3 font-mono text-xs">
        <span className="text-pac-signal-green">{counts.conforming} conforming</span>
        <span className="text-pac-signal-red">{counts.non_conforming} non-conforming</span>
        <span className="text-pac-signal-amber">{counts.needs_review} need review</span>
        <span className="text-muted-foreground">{counts.customer_supplied} customer-supplied</span>
      </div>

      {error && (
        <p className="font-mono text-sm text-pac-signal-red">{String(error)}</p>
      )}
      {isLoading && (
        <p className="font-mono text-sm text-muted-foreground">Loading…</p>
      )}

      {/* Folders */}
      {folders.map((f) => (
        <button
          key={f.path}
          className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left hover:bg-muted"
          onClick={() => setSubPath(subPath ? `${subPath}/${f.name}` : f.name)}
        >
          <Folder className="h-4 w-4 text-pac-blue-600" />
          <span className="font-mono text-xs text-foreground">{f.name}</span>
        </button>
      ))}

      {/* Files */}
      {classified.map(({ entry, result }) => (
        <div
          key={entry.path}
          className="flex items-center justify-between rounded-md border border-border px-3 py-2"
        >
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="truncate font-mono text-xs text-foreground">{entry.name}</span>
            <DocStatusBadge state={result.state} />
          </div>
          {/* Actions wired in Task 8 */}
        </div>
      ))}

      {!isLoading && folders.length === 0 && files.length === 0 && (
        <p className="font-mono text-sm text-muted-foreground">This folder is empty.</p>
      )}
    </Card>
  );
}
