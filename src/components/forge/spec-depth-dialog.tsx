import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Scan, ShieldCheck, CheckCheck } from "lucide-react";
import type { SpecAnalysisDepth } from "@/types/forge";
import { CHUNKED_THRESHOLD } from "@/types/forge";

interface SpecDepthDialogProps {
  open: boolean;
  onSelect: (depth: SpecAnalysisDepth) => void;
  onCancel: () => void;
  /** Length of the spec text in chars — used to show chunked mode info */
  specLength?: number;
}

const DEPTH_OPTIONS: Array<{
  depth: SpecAnalysisDepth;
  label: string;
  description: string;
  detail: string;
  icon: typeof Scan;
  badge: string;
  badgeClass: string;
}> = [
  {
    depth: 1,
    label: "Extract Only",
    description: "Single Claude pass — fast extraction",
    detail: "Best for simple specs or re-runs. One AI reads the spec and produces structured JSON.",
    icon: Scan,
    badge: "~30s",
    badgeClass: "text-emerald-500 border-emerald-500/50",
  },
  {
    depth: 2,
    label: "Extract + Challenge",
    description: "Claude extracts, Gemini audits for gaps",
    detail: "Recommended for most specs. A second model reads the original spec alongside the extraction and flags anything missed — especially analog thresholds, conditional staging, and alarm coverage.",
    icon: ShieldCheck,
    badge: "~60s",
    badgeClass: "text-blue-500 border-blue-500/50",
  },
  {
    depth: 3,
    label: "Extract + Challenge + Validate",
    description: "Full 3-pass with structured checklist",
    detail: "For critical or complex specs. After extraction and challenge, a third pass runs a structured checklist: analog input coverage, device references, settings linkage, alarm completeness, and trigger condition gaps.",
    icon: CheckCheck,
    badge: "~90s",
    badgeClass: "text-amber-500 border-amber-500/50",
  },
];

export function SpecDepthDialog({ open, onSelect, onCancel, specLength }: SpecDepthDialogProps) {
  const [selected, setSelected] = useState<SpecAnalysisDepth>(2);
  const isLargeSpec = specLength != null && specLength > CHUNKED_THRESHOLD;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Spec Analysis Depth</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Choose how many AI passes to run on the functional spec. More passes catch more gaps but take longer.
          </DialogDescription>
        </DialogHeader>

        {isLargeSpec && (
          <div className="flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-xs text-blue-400">
            <Scan className="h-3.5 w-3.5 shrink-0" />
            Large spec detected ({Math.round(specLength / 1000)}K chars). Chunked extraction will be used automatically — the spec will be surveyed first, then each subsystem extracted separately for better accuracy.
          </div>
        )}

        <div className="flex flex-col gap-2 mt-2">
          {DEPTH_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const isSelected = selected === opt.depth;
            return (
              <button
                key={opt.depth}
                type="button"
                className={`flex items-start gap-3 rounded-md border px-3 py-3 text-left transition-colors ${
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border/60 hover:border-border hover:bg-muted/30"
                }`}
                onClick={() => setSelected(opt.depth)}
              >
                <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{opt.label}</span>
                    <Badge variant="outline" className={`font-mono text-[10px] ${opt.badgeClass}`}>
                      {opt.badge}
                    </Badge>
                    {opt.depth === 2 && (
                      <Badge variant="outline" className="font-mono text-[10px] text-primary border-primary/50">
                        recommended
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{opt.description}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground/70">{opt.detail}</p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 mt-3">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onSelect(selected)}>
            Analyze Spec
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
