import { useMemo, useState } from "react";
import { Folder, FileText, ChevronRight, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useUiStore } from "@/stores/ui-store";
import type { Project } from "@/types/project";
import {
  classifyDoc,
  folderCodeFromName,
  isVendorFolderName,
  nextSequence,
  suggestAssignName,
  type DocState,
} from "@/lib/doc-control";
import {
  docFolderApiPath,
  useDocFolderListing,
  useMoveDocFile,
  useUploadDocFile,
  DOC_FOLDER_NAME,
  type DropboxEntry,
} from "@/hooks/use-project-docs";
import { useDocOverrides, useAddDocOverride } from "@/hooks/use-doc-overrides";
import { useOpenLocalFile } from "@/hooks/use-open-local-file";
import { toast } from "@/hooks/use-toast";
import { DocStatusBadge } from "./doc-status-badge";
import { ResolveDocDialog, type ResolveContext } from "./resolve-doc-dialog";
import { UploadDocDialog, type UploadResult } from "./upload-doc-dialog";

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

  const openLocal = useOpenLocalFile();
  const moveDoc = useMoveDocFile();
  const uploadDoc = useUploadDocFile();
  const addOverride = useAddDocOverride();

  const [resolveCtx, setResolveCtx] = useState<ResolveContext | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const apiFolderPath = subPath ? `${docRoot}/${subPath}` : docRoot;
  const fileNames = files.map((f) => f.name);

  // Local absolute path = dropboxRoot + dropbox_folder_path tail + subPath + name.
  function localPathFor(entry: DropboxEntry): string {
    // entry.path is the Dropbox display path; convert to a local OS path.
    const tail = entry.path.replace(/\//g, "\\");
    return `${dropboxRoot}${tail}`;
  }

  async function handleOpen(entry: DropboxEntry) {
    try {
      await openLocal.mutateAsync(localPathFor(entry));
    } catch {
      await navigator.clipboard.writeText(localPathFor(entry)).catch(() => {});
      toast({
        title: "Couldn't open locally",
        description: "Bridge unavailable — the file path was copied to your clipboard.",
      });
    }
  }

  async function handleFix(entry: DropboxEntry, suggestedName: string) {
    const from = `${apiFolderPath}/${entry.name}`;
    const to = `${apiFolderPath}/${suggestedName}`;
    await moveDoc.mutateAsync({ fromPath: from, toPath: to });
    toast({ title: "Renamed", description: suggestedName });
  }

  function openResolve(entry: DropboxEntry) {
    if (!subfolderCode) {
      toast({
        title: "Move into a numbered sub-folder first",
        description: "Documents directly under 51 DOC can't be auto-numbered.",
      });
      return;
    }
    const seq = nextSequence(fileNames, docFolderCode, subfolderCode);
    setResolveCtx({
      filename: entry.name,
      fromPath: `${apiFolderPath}/${entry.name}`,
      apiFolderPath: apiFolderPath!,
      suggestedName: suggestAssignName(entry.name, {
        projectNumber: project.project_number ?? "",
        folderCode: docFolderCode,
        subfolderCode,
        seq,
      }),
      relPath: relPath(entry),
    });
  }

  async function handleAssignNumber(ctx: ResolveContext) {
    await moveDoc.mutateAsync({
      fromPath: ctx.fromPath,
      toPath: `${ctx.apiFolderPath}/${ctx.suggestedName}`,
    });
    setResolveCtx(null);
    toast({ title: "Number assigned", description: ctx.suggestedName });
  }

  async function handleMarkCustomer(ctx: ResolveContext, note: string) {
    await addOverride.mutateAsync({ projectId: project.id, relPath: ctx.relPath, note });
    setResolveCtx(null);
    toast({ title: "Marked customer-supplied" });
  }

  function computeNumberedName(file: File): string {
    if (!subfolderCode) return file.name;
    const seq = nextSequence(fileNames, docFolderCode, subfolderCode);
    return suggestAssignName(file.name, {
      projectNumber: project.project_number ?? "",
      folderCode: docFolderCode,
      subfolderCode,
      seq,
    });
  }

  async function handleUpload(r: UploadResult) {
    if (!apiFolderPath) return;
    await uploadDoc.mutateAsync({ apiFolderPath, filename: r.filename, file: r.file });
    if (r.markCustomer) {
      await addOverride.mutateAsync({
        projectId: project.id,
        relPath: subPath
          ? `${DOC_FOLDER_NAME}/${subPath}/${r.filename}`
          : `${DOC_FOLDER_NAME}/${r.filename}`,
      });
    }
    setUploadOpen(false);
    toast({ title: "Uploaded", description: r.filename });
  }

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
      {/* Breadcrumb + Upload button */}
      <div className="flex items-center justify-between">
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
        <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
          <Upload className="mr-1 h-3.5 w-3.5" /> Upload
        </Button>
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
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => handleOpen(entry)}>
              Open
            </Button>
            {result.state === "non_conforming" && result.suggestedName && (
              <Button
                size="sm"
                variant="ghost"
                className="text-pac-blue-700"
                onClick={() => handleFix(entry, result.suggestedName!)}
              >
                Fix
              </Button>
            )}
            {result.state === "needs_review" && (
              <Button size="sm" variant="ghost" onClick={() => openResolve(entry)}>
                Resolve
              </Button>
            )}
          </div>
        </div>
      ))}

      {!isLoading && folders.length === 0 && files.length === 0 && (
        <p className="font-mono text-sm text-muted-foreground">This folder is empty.</p>
      )}

      <ResolveDocDialog
        ctx={resolveCtx}
        open={!!resolveCtx}
        onOpenChange={(o) => !o && setResolveCtx(null)}
        onAssignNumber={handleAssignNumber}
        onMarkCustomer={handleMarkCustomer}
        busy={moveDoc.isPending || addOverride.isPending}
      />
      <UploadDocDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        computeNumberedName={computeNumberedName}
        onConfirm={handleUpload}
        busy={uploadDoc.isPending}
      />
    </Card>
  );
}
