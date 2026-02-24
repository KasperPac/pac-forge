import { useState, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, FileCode2, Plus, Minus, Equal } from "lucide-react";
import { cn } from "@/lib/utils";
import { computeDiff } from "@/lib/diff-engine";
import { classifyCorrections } from "@/lib/correction-classifier";
import { useCreatePatternCandidate } from "@/hooks/use-patterns";
import { usePacStStore } from "@/stores/pac-st-store";
import type { DiffResult, DiffHunk } from "@/lib/diff-engine";
import type { ClassifiedCorrection } from "@/lib/correction-classifier";

interface TeachUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plcBrand: string;
}

const HUNK_COLORS: Record<string, string> = {
  added: "bg-green-500/10 text-green-400",
  removed: "bg-red-500/10 text-red-400",
  unchanged: "text-muted-foreground",
};

const HUNK_ICONS = {
  added: Plus,
  removed: Minus,
  unchanged: Equal,
};

function DiffView({ diff }: { diff: DiffResult }) {
  return (
    <ScrollArea className="h-56 rounded-md border">
      <div className="p-2">
        {diff.hunks.map((hunk: DiffHunk, hi: number) => (
          <div key={hi}>
            {hunk.lines.map((line, li) => {
              const Icon = HUNK_ICONS[hunk.type];
              return (
                <div
                  key={`${hi}-${li}`}
                  className={cn(
                    "flex items-start gap-1 px-1 font-mono text-xs leading-5",
                    HUNK_COLORS[hunk.type],
                  )}
                >
                  <Icon className="mt-1 h-3 w-3 shrink-0 opacity-50" />
                  <span className="whitespace-pre-wrap break-all">{line}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

export function TeachUploadDialog({
  open,
  onOpenChange,
  plcBrand,
}: TeachUploadDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploadedContent, setUploadedContent] = useState<string | null>(null);
  const [uploadedFilename, setUploadedFilename] = useState("");
  const [selectedArtifactName, setSelectedArtifactName] = useState("");
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [corrections, setCorrections] = useState<ClassifiedCorrection[]>([]);

  const generatedArtifacts = usePacStStore((s) => s.generatedArtifacts);
  const createPattern = useCreatePatternCandidate();

  const reset = useCallback(() => {
    setUploadedContent(null);
    setUploadedFilename("");
    setSelectedArtifactName("");
    setDiff(null);
    setCorrections([]);
  }, []);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    setUploadedContent(text);
    setUploadedFilename(file.name);

    // Auto-select matching artifact by filename
    const match = generatedArtifacts.find(
      (a) => a.filename === file.name || a.name === file.name.replace(/\.scl$/i, ""),
    );
    if (match) {
      setSelectedArtifactName(match.name);
      runDiff(match.content, text, match.name, match.type);
    }

    // Reset file input so the same file can be re-uploaded
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [generatedArtifacts]);

  const handleArtifactSelect = useCallback(
    (name: string) => {
      setSelectedArtifactName(name);
      if (!uploadedContent) return;

      const artifact = generatedArtifacts.find((a) => a.name === name);
      if (artifact) {
        runDiff(artifact.content, uploadedContent, artifact.name, artifact.type);
      }
    },
    [uploadedContent, generatedArtifacts],
  );

  function runDiff(original: string, corrected: string, artifactName: string, deviceType: string) {
    const result = computeDiff(original, corrected);
    setDiff(result);

    if (result.hasChanges) {
      const classified = classifyCorrections(result, { artifactName, deviceType });
      setCorrections(classified);
    } else {
      setCorrections([]);
    }
  }

  const handleCreatePatterns = useCallback(() => {
    if (corrections.length === 0) return;

    let completed = 0;
    for (const correction of corrections) {
      createPattern.mutate(
        {
          plc_brand: plcBrand,
          device_type: correction.correctionType,
          context: `Upload correction: ${uploadedFilename} vs ${selectedArtifactName}`,
          original_snippet: correction.originalSnippet,
          corrected_snippet: correction.correctedSnippet,
          correction_type: correction.correctionType,
          explanation_tag: correction.explanationTag,
        },
        {
          onSuccess: () => {
            completed++;
            if (completed === corrections.length) {
              reset();
              onOpenChange(false);
            }
          },
        },
      );
    }
  }, [corrections, plcBrand, uploadedFilename, selectedArtifactName, createPattern, reset, onOpenChange]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">Teach from Corrected Code</DialogTitle>
          <DialogDescription>
            Upload a corrected .scl file to compare against a generated artifact.
            Detected corrections will be saved as pattern candidates for review.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* File upload */}
          <div className="space-y-1.5">
            <Label className="font-mono text-xs">Upload Corrected File</Label>
            <div
              className={cn(
                "flex cursor-pointer items-center justify-center rounded-md border-2 border-dashed px-4 py-6 transition-colors hover:border-foreground/30",
                uploadedContent ? "border-green-500/30 bg-green-500/5" : "border-muted-foreground/20",
              )}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".scl,.txt"
                className="hidden"
                onChange={handleFileUpload}
              />
              {uploadedContent ? (
                <div className="flex items-center gap-2">
                  <FileCode2 className="h-4 w-4 text-green-500" />
                  <span className="font-mono text-xs">{uploadedFilename}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    ({uploadedContent.split("\n").length} lines)
                  </span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1 text-muted-foreground">
                  <Upload className="h-5 w-5" />
                  <span className="font-mono text-xs">Click to upload .scl file</span>
                </div>
              )}
            </div>
          </div>

          {/* Artifact selector */}
          {uploadedContent && (
            <div className="space-y-1.5">
              <Label className="font-mono text-xs">Compare Against</Label>
              {generatedArtifacts.length === 0 ? (
                <div className="rounded-md border border-dashed px-4 py-3 text-center font-mono text-xs text-muted-foreground">
                  No generated artifacts available. Generate code first.
                </div>
              ) : (
                <Select value={selectedArtifactName} onValueChange={handleArtifactSelect}>
                  <SelectTrigger className="font-mono text-xs">
                    <SelectValue placeholder="Select a generated artifact..." />
                  </SelectTrigger>
                  <SelectContent>
                    {generatedArtifacts.map((a) => (
                      <SelectItem key={a.id} value={a.name} className="font-mono text-xs">
                        {a.name} ({a.type})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* Diff view */}
          {diff && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="font-mono text-xs">Diff</Label>
                <span className="font-mono text-[10px] text-muted-foreground">
                  +{diff.addedCount} / -{diff.removedCount} lines
                </span>
              </div>
              {diff.hasChanges ? (
                <DiffView diff={diff} />
              ) : (
                <div className="rounded-md border px-4 py-3 text-center font-mono text-xs text-muted-foreground">
                  No differences detected. The files are identical.
                </div>
              )}
            </div>
          )}

          {/* Detected patterns */}
          {corrections.length > 0 && (
            <div className="space-y-1.5">
              <Label className="font-mono text-xs">
                Detected Corrections ({corrections.length})
              </Label>
              <div className="space-y-1">
                {corrections.map((c, i) => (
                  <div
                    key={i}
                    className="rounded-md border px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-accent px-1.5 py-0.5 font-mono text-[10px] font-medium">
                        {c.correctionType}
                      </span>
                      <span className="font-mono text-xs">{c.explanationTag}</span>
                      <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                        {Math.round(c.confidence * 100)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
            className="font-mono text-xs"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreatePatterns}
            disabled={corrections.length === 0 || createPattern.isPending}
            className="font-mono text-xs"
          >
            {createPattern.isPending
              ? "Saving..."
              : `Create ${corrections.length} Pattern(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
