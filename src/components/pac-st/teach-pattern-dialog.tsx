import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateApprovedPattern } from "@/hooks/use-patterns";
import type { CorrectionType } from "@/types";

const CATEGORY_LABELS: Record<CorrectionType, string> = {
  NAMING: "Naming Convention",
  IO_MAPPING: "IO Mapping",
  STATE_LOGIC: "State Logic",
  ALARM: "Alarm Handling",
  SAFETY: "Safety",
  TIMING: "Timer / Timing",
};

interface TeachPatternDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plcBrand: string;
}

export function TeachPatternDialog({
  open,
  onOpenChange,
  plcBrand,
}: TeachPatternDialogProps) {
  const [explanation, setExplanation] = useState("");
  const [wrongCode, setWrongCode] = useState("");
  const [correctCode, setCorrectCode] = useState("");
  const [category, setCategory] = useState<CorrectionType>("NAMING");
  const [deviceType, setDeviceType] = useState("");

  const createPattern = useCreateApprovedPattern();

  function reset() {
    setExplanation("");
    setWrongCode("");
    setCorrectCode("");
    setCategory("NAMING");
    setDeviceType("");
  }

  function handleSubmit() {
    if (!explanation.trim()) return;

    createPattern.mutate(
      {
        plc_brand: plcBrand,
        device_type: deviceType || "GENERAL",
        context: "Manual rule (teach by conversation)",
        original_snippet: wrongCode.trim(),
        corrected_snippet: correctCode.trim(),
        correction_type: category,
        explanation_tag: explanation.trim(),
      },
      {
        onSuccess: () => {
          reset();
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">Teach a Rule</DialogTitle>
          <DialogDescription>
            Define a correction rule that will be enforced in all future generations.
            Rules are saved as approved patterns immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Rule description */}
          <div className="space-y-1.5">
            <Label className="font-mono text-xs">Rule Description</Label>
            <Textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              placeholder="e.g. Always use TON timer with both IN and PT parameters supplied..."
              className="min-h-[80px] font-mono text-sm"
            />
          </div>

          {/* Category + Device type */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="font-mono text-xs">Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as CorrectionType)}>
                <SelectTrigger className="font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key} className="font-mono text-xs">
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="font-mono text-xs">Device Type (optional)</Label>
              <Input
                value={deviceType}
                onChange={(e) => setDeviceType(e.target.value)}
                placeholder="e.g. FB, UDT, FC"
                className="font-mono text-xs"
              />
            </div>
          </div>

          {/* Wrong code (optional) */}
          <div className="space-y-1.5">
            <Label className="font-mono text-xs">
              Wrong Code <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              value={wrongCode}
              onChange={(e) => setWrongCode(e.target.value)}
              placeholder="// Paste an example of wrong code here..."
              className="min-h-[60px] font-mono text-xs"
            />
          </div>

          {/* Correct code (optional) */}
          <div className="space-y-1.5">
            <Label className="font-mono text-xs">
              Correct Code <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              value={correctCode}
              onChange={(e) => setCorrectCode(e.target.value)}
              placeholder="// Paste the correct version here..."
              className="min-h-[60px] font-mono text-xs"
            />
          </div>
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
            onClick={handleSubmit}
            disabled={!explanation.trim() || createPattern.isPending}
            className="font-mono text-xs"
          >
            {createPattern.isPending ? "Saving..." : "Save Rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
