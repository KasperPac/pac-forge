import { useState } from "react";
import { Download, AlertTriangle, Package } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { downloadExportBundle } from "@/lib/tia-export";
import type { ExportFormat } from "@/lib/tia-export";
import type { Artifact, TiaManifest, SafetyWarning } from "@/types";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifacts: Artifact[];
  manifest: TiaManifest;
  warnings: SafetyWarning[];
  projectName: string;
  onExported?: () => void;
}

export function ExportDialog({
  open,
  onOpenChange,
  artifacts,
  manifest,
  warnings,
  projectName,
  onExported,
}: ExportDialogProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("both");

  const unacknowledgedWarnings = warnings.filter((w) => !w.acknowledged);
  const hasSafetyWarnings = unacknowledgedWarnings.length > 0;

  async function handleExport() {
    setExporting(true);
    try {
      await downloadExportBundle(artifacts, manifest, projectName, { format });
      onExported?.();
      onOpenChange(false);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Export Artifact Bundle
          </DialogTitle>
          <DialogDescription>
            Download a zip containing all artifacts and the TIA manifest for offline import.
          </DialogDescription>
        </DialogHeader>

        {/* Manifest summary */}
        <div className="space-y-2">
          <div className="font-mono text-[10px] text-muted-foreground">MANIFEST</div>
          <div className="rounded-md border">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 px-3 py-2">
              <div className="font-mono text-[10px] text-muted-foreground">Platform</div>
              <div className="font-mono text-[10px]">{manifest.platform}</div>
              <div className="font-mono text-[10px] text-muted-foreground">TIA Version</div>
              <div className="font-mono text-[10px]">{manifest.tia_version}</div>
              <div className="font-mono text-[10px] text-muted-foreground">CPU</div>
              <div className="font-mono text-[10px]">{manifest.cpu_type}</div>
              <div className="font-mono text-[10px] text-muted-foreground">Artifacts</div>
              <div className="font-mono text-[10px]">{manifest.artifacts.length}</div>
            </div>
          </div>
        </div>

        {/* Artifact list */}
        <ScrollArea className="max-h-32">
          <div className="space-y-1">
            {manifest.artifacts.map((a, i) => (
              <div key={a.name} className="flex items-center gap-2 px-1">
                <span className="font-mono text-[9px] text-muted-foreground">{i + 1}.</span>
                <Badge variant="outline" className="px-1 py-0 font-mono text-[8px]">
                  {a.type}
                </Badge>
                <span className="font-mono text-[10px]">{a.name}</span>
                {a.dependencies.length > 0 && (
                  <span className="font-mono text-[8px] text-muted-foreground">
                    dep: {a.dependencies.join(", ")}
                  </span>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>

        <Separator />

        {/* Export format selector */}
        <div className="space-y-2">
          <div className="font-mono text-[10px] text-muted-foreground">EXPORT FORMAT</div>
          <RadioGroup
            value={format}
            onValueChange={(v) => setFormat(v as ExportFormat)}
            className="gap-1.5"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="both" id="fmt-both" />
              <Label htmlFor="fmt-both" className="font-mono text-[10px] cursor-pointer">
                Both SCL + SimaticML XML
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="scl" id="fmt-scl" />
              <Label htmlFor="fmt-scl" className="font-mono text-[10px] cursor-pointer">
                SCL only (External Source import)
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="xml" id="fmt-xml" />
              <Label htmlFor="fmt-xml" className="font-mono text-[10px] cursor-pointer">
                SimaticML XML only (native TIA import)
              </Label>
            </div>
          </RadioGroup>
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
                    <div key={w.id} className="font-mono text-[9px] text-destructive">
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
                <span className="font-mono text-[10px] text-destructive">
                  I acknowledge these safety warnings and take responsibility for this export
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
            onClick={handleExport}
            disabled={exporting || (hasSafetyWarnings && !acknowledged)}
          >
            <Download className="mr-1 h-4 w-4" />
            {exporting ? "Exporting..." : "Download Bundle"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
