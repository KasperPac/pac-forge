import { useState, useEffect } from "react";
import { Play, AlertTriangle, Wifi, WifiOff, Package } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { TiaManifest, TiaJobType, SafetyWarning } from "@/types";

const JOB_TYPE_LABELS: Record<TiaJobType, string> = {
  IMPORT_ONLY: "Import Only",
  IMPORT_AND_COMPILE: "Import & Compile",
  COMPILE_ONLY: "Compile Only",
  EXPORT_REPORT: "Export Report",
};

const TIA_PATH_STORAGE_KEY = "pac-forge:tia-project-path";

interface TiaSubmitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manifest: TiaManifest | null;
  warnings: SafetyWarning[];
  bridgeConnected: boolean;
  jobType: TiaJobType;
  onConfirm: (tiaProjectPath: string) => void;
  submitting: boolean;
}

export function TiaSubmitDialog({
  open,
  onOpenChange,
  manifest,
  warnings,
  bridgeConnected,
  jobType,
  onConfirm,
  submitting,
}: TiaSubmitDialogProps) {
  const [tiaProjectPath, setTiaProjectPath] = useState(
    () => localStorage.getItem(TIA_PATH_STORAGE_KEY) ?? ""
  );
  const [acknowledged, setAcknowledged] = useState(false);

  const unacknowledgedWarnings = warnings.filter((w) => !w.acknowledged);
  const hasSafetyWarnings = unacknowledgedWarnings.length > 0;

  // Persist path to localStorage
  useEffect(() => {
    if (tiaProjectPath) {
      localStorage.setItem(TIA_PATH_STORAGE_KEY, tiaProjectPath);
    }
  }, [tiaProjectPath]);

  // Reset acknowledgment when dialog opens
  useEffect(() => {
    if (open) setAcknowledged(false);
  }, [open]);

  function handleSubmit() {
    onConfirm(tiaProjectPath);
  }

  if (!manifest) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Submit TIA Job — {JOB_TYPE_LABELS[jobType]}
          </DialogTitle>
          <DialogDescription>
            Review the manifest and confirm before writing to TIA Portal.
          </DialogDescription>
        </DialogHeader>

        {/* Manifest summary */}
        <div className="space-y-2">
          <div className="font-mono text-xs text-muted-foreground">MANIFEST</div>
          <div className="rounded-md border">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 px-3 py-2">
              <div className="font-mono text-xs text-muted-foreground">Platform</div>
              <div className="font-mono text-xs">{manifest.platform}</div>
              <div className="font-mono text-xs text-muted-foreground">TIA Version</div>
              <div className="font-mono text-xs">{manifest.tia_version}</div>
              <div className="font-mono text-xs text-muted-foreground">CPU</div>
              <div className="font-mono text-xs">{manifest.cpu_type}</div>
              <div className="font-mono text-xs text-muted-foreground">Artifacts</div>
              <div className="font-mono text-xs">{manifest.artifacts.length}</div>
            </div>
          </div>
        </div>

        {/* Ordered artifact list */}
        <ScrollArea className="max-h-32">
          <div className="space-y-1">
            {manifest.artifacts.map((a, i) => (
              <div key={a.name} className="flex items-center gap-2 px-1">
                <span className="font-mono text-xs text-muted-foreground">{i + 1}.</span>
                <Badge variant="outline" className="px-1 py-0 font-mono text-xs">
                  {a.type}
                </Badge>
                <span className="font-mono text-xs">{a.name}</span>
                {a.dependencies.length > 0 && (
                  <span className="font-mono text-xs text-muted-foreground">
                    dep: {a.dependencies.join(", ")}
                  </span>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>

        <Separator />

        {/* TIA project path */}
        <div className="space-y-2">
          <Label htmlFor="tia-path" className="font-mono text-xs text-muted-foreground">
            TIA PROJECT PATH
          </Label>
          <Input
            id="tia-path"
            value={tiaProjectPath}
            onChange={(e) => setTiaProjectPath(e.target.value)}
            placeholder="C:\TIA Projects\MyProject\MyProject.ap19"
            className="h-8 font-mono text-[11px]"
          />
        </div>

        {/* Bridge status */}
        <div className="flex items-center gap-2 rounded-md border px-3 py-2">
          {bridgeConnected ? (
            <>
              <Wifi className="h-3.5 w-3.5 text-green-400" />
              <span className="font-mono text-xs text-green-400">Bridge Online</span>
            </>
          ) : (
            <>
              <WifiOff className="h-3.5 w-3.5 text-amber-400" />
              <span className="font-mono text-xs text-amber-400">
                Bridge Offline — Job will be queued
              </span>
            </>
          )}
        </div>

        {/* Safety warnings */}
        {hasSafetyWarnings && (
          <>
            <Separator />
            <div className="space-y-2 rounded-md bg-destructive/10 p-3">
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <span className="font-mono text-xs font-medium text-destructive">
                  {unacknowledgedWarnings.length} Safety Warning{unacknowledgedWarnings.length !== 1 ? "s" : ""}
                </span>
              </div>
              <ScrollArea className="max-h-24">
                <div className="space-y-1">
                  {unacknowledgedWarnings.map((w) => (
                    <div key={w.id} className="font-mono text-xs text-destructive">
                      [{w.type}] {w.artifact_name}: {w.description}
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-destructive"
                />
                <span className="font-mono text-xs text-destructive">
                  I acknowledge these safety warnings and take responsibility for this TIA import
                </span>
              </label>
            </div>
          </>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || (hasSafetyWarnings && !acknowledged)}
          >
            <Play className="mr-1 h-4 w-4" />
            {submitting ? "Submitting..." : "Submit Job"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
