import { useEffect, useRef, useState } from "react";
import { useSetupProjectFolder, useListDropboxFolder } from "@/hooks/use-dropbox";
import { useUpdateProject } from "@/hooks/use-projects";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, CheckCircle2, XCircle, FolderOpen, Plus, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface DropboxFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  clientName: string;
  projectNumber: string;
  descriptionShort: string;
}

type Mode = "choose" | "create" | "link";

type Step = {
  label: string;
  status: "pending" | "active" | "done" | "error";
};

export function DropboxFolderDialog({
  open,
  onOpenChange,
  projectId,
  clientName,
  projectNumber,
  descriptionShort,
}: DropboxFolderDialogProps) {
  const setupFolder = useSetupProjectFolder();
  const listFolder = useListDropboxFolder();
  const updateProject = useUpdateProject();

  const [mode, setMode] = useState<Mode>("choose");
  const [steps, setSteps] = useState<Step[]>([
    { label: "Checking client folder...", status: "pending" },
    { label: "Creating folder structure...", status: "pending" },
    { label: "Copying job template...", status: "pending" },
  ]);
  const [folderCreated, setFolderCreated] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createStarted, setCreateStarted] = useState(false);

  // Link existing state
  const [existingFolders, setExistingFolders] = useState<Array<{ name: string; path: string }>>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [loadingFolders, setLoadingFolders] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setMode("choose");
      setSteps([
        { label: "Checking client folder...", status: "pending" },
        { label: "Creating folder structure...", status: "pending" },
        { label: "Copying job template...", status: "pending" },
      ]);
      setFolderCreated(false);
      setFolderName("");
      setLocalPath("");
      setSaved(false);
      setError(null);
      setCreateStarted(false);
      setExistingFolders([]);
      setSelectedFolder(null);
      setLoadingFolders(false);
    }
  }, [open]);

  function startCreate() {
    if (createStarted) return;
    setMode("create");
    setCreateStarted(true);

    let stepIndex = 0;
    function updateStep(status: "active" | "done" | "error") {
      setSteps((prev) => {
        const next = [...prev];
        next[stepIndex] = { ...next[stepIndex], status };
        return next;
      });
    }

    function advanceStep() {
      updateStep("done");
      stepIndex++;
      if (stepIndex < 3) {
        setSteps((prev) => {
          const next = [...prev];
          next[stepIndex] = { ...next[stepIndex], status: "active" };
          return next;
        });
      }
    }

    updateStep("active");

    setupFolder.mutate(
      {
        client_name: clientName,
        project_number: projectNumber,
        description_short: descriptionShort,
        onProgress: (step) => {
          if (step.includes("Creating")) advanceStep();
          else if (step.includes("Copying")) advanceStep();
        },
      },
      {
        onSuccess: (result) => {
          setSteps((prev) => prev.map((s) => ({ ...s, status: "done" as const })));
          const parts = (result.path as string).replace(/\\/g, "/").split("/").filter(Boolean);
          setFolderName(parts[parts.length - 1] ?? "");
          setFolderCreated(true);
          setTimeout(() => inputRef.current?.focus(), 50);
        },
        onError: (err) => {
          setError(err instanceof Error ? err.message : "Failed to setup folder");
          setSteps((prev) =>
            prev.map((s) =>
              s.status === "active" ? { ...s, status: "error" as const } : s
            )
          );
        },
      }
    );
  }

  function startLink() {
    setMode("link");
    setLoadingFolders(true);
    setError(null);

    const clientPath = `/Pac/Jobs/${clientName}`;
    listFolder.mutate(clientPath, {
      onSuccess: (entries) => {
        const folders = entries
          .filter((e) => e.tag === "folder")
          .sort((a, b) => a.name.localeCompare(b.name));
        setExistingFolders(folders);
        setLoadingFolders(false);
      },
      onError: (err) => {
        setError(err instanceof Error ? err.message : "Failed to list folders");
        setLoadingFolders(false);
      },
    });
  }

  function handleSavePath() {
    const trimmed = localPath.trim();
    if (!trimmed) return;
    updateProject.mutate({
      id: projectId,
      updates: { dropbox_folder_path: trimmed },
    });
    setSaved(true);
  }

  function handleSelectExisting(folder: { name: string; path: string }) {
    setSelectedFolder(folder.name);
    setFolderName(folder.name);
    setMode("create"); // reuse the path confirmation UI
    setFolderCreated(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  const hasError = !!error;
  const canClose = saved || hasError || mode === "choose";

  return (
    <Dialog open={open} onOpenChange={canClose ? onOpenChange : undefined}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4" />
            {mode === "choose" ? "Dropbox Folder Setup" :
             mode === "link" ? "Link Existing Folder" :
             selectedFolder ? "Link Existing Folder" : "Create New Folder"}
          </DialogTitle>
        </DialogHeader>

        {/* Mode chooser */}
        {mode === "choose" && (
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              Link this project to a Dropbox job folder for <span className="font-mono text-foreground">{clientName}</span>.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={startCreate}
                className="flex flex-col items-center gap-2 rounded-lg border border-border/70 bg-card/60 p-4 transition-colors hover:bg-accent/30"
              >
                <Plus className="h-6 w-6 text-muted-foreground" />
                <span className="text-sm font-medium">Create New</span>
                <span className="text-[10px] text-muted-foreground text-center">
                  Copy job template to a new folder
                </span>
              </button>
              <button
                onClick={startLink}
                className="flex flex-col items-center gap-2 rounded-lg border border-border/70 bg-card/60 p-4 transition-colors hover:bg-accent/30"
              >
                <Link2 className="h-6 w-6 text-muted-foreground" />
                <span className="text-sm font-medium">Link Existing</span>
                <span className="text-[10px] text-muted-foreground text-center">
                  Select an existing job folder
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Link existing — folder browser */}
        {mode === "link" && (
          <div className="space-y-3 py-2">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              /Pac/Jobs/{clientName}
            </div>
            {loadingFolders && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loadingFolders && existingFolders.length === 0 && !hasError && (
              <div className="py-6 text-center text-xs text-muted-foreground">
                No folders found for this client.
              </div>
            )}
            {!loadingFolders && existingFolders.length > 0 && (
              <ScrollArea className="h-[250px]">
                <div className="space-y-1 pr-3">
                  {existingFolders.map((folder) => (
                    <button
                      key={folder.path}
                      onClick={() => handleSelectExisting(folder)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md border border-border/40 px-3 py-2 text-left transition-colors hover:bg-accent/30",
                      )}
                    >
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate font-mono text-xs">{folder.name}</span>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
            <Button variant="ghost" size="sm" onClick={() => setMode("choose")} className="font-mono text-xs">
              Back
            </Button>
          </div>
        )}

        {/* Create new — progress steps */}
        {mode === "create" && !selectedFolder && (
          <div className="space-y-3 py-2">
            {steps.map((step, i) => (
              <div key={i} className="flex items-center gap-3">
                {step.status === "pending" && (
                  <div className="h-4 w-4 rounded-full border border-muted-foreground/30" />
                )}
                {step.status === "active" && (
                  <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                )}
                {step.status === "done" && (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                )}
                {step.status === "error" && (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                <span
                  className={`font-mono text-xs ${
                    step.status === "pending"
                      ? "text-muted-foreground/50"
                      : step.status === "error"
                        ? "text-destructive"
                        : "text-foreground"
                  }`}
                >
                  {step.label}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Path confirmation (shared between create + link existing) */}
        {folderCreated && !saved && (
          <div className="space-y-3 rounded-lg border border-border/70 bg-background/40 p-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Confirm Local Windows Path
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedFolder ? "Selected" : "Created"} folder{" "}
              <span className="font-mono text-foreground">{folderName}</span>.
              Open it in Windows Explorer, copy the full path from the address bar, then paste below.
            </p>
            <Input
              ref={inputRef}
              className="font-mono text-xs"
              placeholder={`C:\\Users\\...\\Dropbox\\Pac\\Jobs\\${clientName}\\${folderName}`}
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSavePath();
              }}
            />
          </div>
        )}

        {saved && (
          <div className="rounded-md border border-green-500/20 bg-green-500/5 px-3 py-2">
            <div className="text-xs text-muted-foreground">Dropbox folder linked:</div>
            <div className="mt-0.5 font-mono text-xs text-green-400 break-all">{localPath.trim()}</div>
          </div>
        )}

        {hasError && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          {folderCreated && !saved && (
            <Button
              size="sm"
              onClick={handleSavePath}
              disabled={!localPath.trim()}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Save Path
            </Button>
          )}
          {(canClose || folderCreated) && (
            <Button
              size="sm"
              variant={folderCreated && !saved ? "ghost" : "default"}
              onClick={() => onOpenChange(false)}
              disabled={mode === "create" && !folderCreated && !hasError}
            >
              {saved ? "Done" : hasError ? "Close" : folderCreated ? "Skip" : "Cancel"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
