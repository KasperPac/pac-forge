import { useEffect, useRef, useState } from "react";
import { useSetupProjectFolder } from "@/hooks/use-dropbox";
import { useUpdateProject } from "@/hooks/use-projects";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, CheckCircle2, XCircle, FolderOpen } from "lucide-react";

interface DropboxFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  clientName: string;
  projectNumber: string;
  descriptionShort: string;
}

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
  const updateProject = useUpdateProject();
  const [steps, setSteps] = useState<Step[]>([
    { label: "Checking client folder...", status: "pending" },
    { label: "Creating folder structure...", status: "pending" },
    { label: "Copying job template...", status: "pending" },
  ]);
  // folderCreated = Dropbox API steps done, but local path not yet confirmed
  const [folderCreated, setFolderCreated] = useState(false);
  // folderName = last segment of the Dropbox API path (for the hint)
  const [folderName, setFolderName] = useState("");
  // localPath = user-confirmed Windows filesystem path
  const [localPath, setLocalPath] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || started) return;
    setStarted(true);

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
          if (step.includes("Creating")) {
            advanceStep();
          } else if (step.includes("Copying")) {
            advanceStep();
          }
        },
      },
      {
        onSuccess: (result) => {
          setSteps((prev) => prev.map((s) => ({ ...s, status: "done" as const })));
          // Extract folder name from API path for the hint
          const parts = (result.path as string).replace(/\\/g, "/").split("/").filter(Boolean);
          setFolderName(parts[parts.length - 1] ?? "");
          setFolderCreated(true);
          // Focus the input after render
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleSavePath() {
    const trimmed = localPath.trim();
    if (!trimmed) return;
    updateProject.mutate({
      id: projectId,
      updates: { dropbox_folder_path: trimmed },
    });
    setSaved(true);
  }

  const hasError = !!error;
  const canClose = saved || hasError;

  return (
    <Dialog open={open} onOpenChange={canClose ? onOpenChange : undefined}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4" />
            Setting Up Dropbox Folder
          </DialogTitle>
        </DialogHeader>

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

        {folderCreated && !saved && (
          <div className="space-y-3 rounded-lg border border-border/70 bg-background/40 p-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Confirm Local Windows Path
            </div>
            <p className="text-xs text-muted-foreground">
              The Dropbox folder <span className="font-mono text-foreground">{folderName}</span> was
              created. Open it in Windows Explorer, click the address bar to copy the full path,
              then paste it below.
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
          <Button
            size="sm"
            variant={folderCreated && !saved ? "ghost" : "default"}
            onClick={() => onOpenChange(false)}
            disabled={!canClose}
          >
            {saved ? "Done" : hasError ? "Close" : folderCreated ? "Skip" : "Setting up..."}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
