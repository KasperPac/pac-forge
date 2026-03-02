import { useEffect, useState } from "react";
import { useSetupProjectFolder } from "@/hooks/use-dropbox";
import { useUpdateProject } from "@/hooks/use-projects";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

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

    // Start
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
          // Mark last step done
          setSteps((prev) => prev.map((s) => ({ ...s, status: "done" as const })));
          setFolderPath(result.path);

          // Update project with Dropbox folder path
          updateProject.mutate({
            id: projectId,
            updates: { dropbox_folder_path: result.path },
          });
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

  const isDone = !!folderPath;
  const hasError = !!error;

  return (
    <Dialog open={open} onOpenChange={isDone || hasError ? onOpenChange : undefined}>
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

        {folderPath && (
          <div className="rounded-md border border-green-500/20 bg-green-500/5 px-3 py-2">
            <div className="text-xs text-muted-foreground">Dropbox folder created:</div>
            <div className="mt-0.5 font-mono text-xs text-green-400">{folderPath}</div>
          </div>
        )}

        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex justify-end pt-1">
          <Button
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={!isDone && !hasError}
          >
            {isDone ? "Done" : hasError ? "Close" : "Setting up..."}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
