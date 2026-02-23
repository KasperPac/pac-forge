import { useState } from "react";
import { ChevronRight, ChevronLeft, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { buildGuidedPrompt, type GuidedAnswers } from "@/lib/prompt-builder";

interface PromptBuilderProps {
  onSubmit: (prompt: string) => void;
  disabled?: boolean;
}

const DEVICE_TYPES = [
  "Motor",
  "Conveyor Zone",
  "Valve",
  "Auto/Manual Station",
  "Custom",
];

const DEFAULT_STATES = ["INIT", "IDLE", "RUN", "FAULT", "RESET"];

const IO_MAPPING_OPTIONS = [
  { value: "array_indexed" as const, label: "Array-indexed via UDT" },
  { value: "individual_tags" as const, label: "Individual tags per instance" },
];

const TOTAL_STEPS = 6;

export function PromptBuilder({ onSubmit, disabled }: PromptBuilderProps) {
  const [step, setStep] = useState(0);

  // Answers
  const [deviceType, setDeviceType] = useState("");
  const [customDeviceType, setCustomDeviceType] = useState("");
  const [instanceCount, setInstanceCount] = useState(1);
  const [ioMapping, setIoMapping] = useState<"array_indexed" | "individual_tags">("array_indexed");
  const [states, setStates] = useState<string[]>([...DEFAULT_STATES]);
  const [customState, setCustomState] = useState("");
  const [alarmRequirements, setAlarmRequirements] = useState(
    "Standard latching alarms with operator reset"
  );
  const [specialRequirements, setSpecialRequirements] = useState("");

  const effectiveDevice = deviceType === "Custom" ? customDeviceType : deviceType;

  function canAdvance(): boolean {
    switch (step) {
      case 0: return effectiveDevice.trim().length > 0;
      case 1: return instanceCount >= 1;
      case 2: return true;
      case 3: return states.length > 0;
      case 4: return true;
      case 5: return true;
      default: return false;
    }
  }

  function addCustomState() {
    const s = customState.trim().toUpperCase();
    if (s && !states.includes(s)) {
      setStates([...states, s]);
      setCustomState("");
    }
  }

  function removeState(state: string) {
    setStates(states.filter((s) => s !== state));
  }

  function handleGenerate() {
    const answers: GuidedAnswers = {
      deviceType: effectiveDevice,
      instanceCount,
      ioMapping,
      states,
      alarmRequirements,
      specialRequirements,
    };
    onSubmit(buildGuidedPrompt(answers));
  }

  return (
    <div className="space-y-3 p-3">
      {/* Progress */}
      <div className="flex items-center gap-1.5">
        <div className="font-mono text-xs text-muted-foreground">
          GUIDED MODE — Step {step + 1}/{TOTAL_STEPS}
        </div>
        <div className="flex-1" />
        <div className="flex gap-0.5">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1 w-4 rounded-full",
                i <= step ? "bg-primary" : "bg-muted"
              )}
            />
          ))}
        </div>
      </div>

      {/* Step 0: Device Type */}
      {step === 0 && (
        <div className="space-y-2">
          <Label className="font-mono text-xs">What device type?</Label>
          <div className="flex flex-wrap gap-1">
            {DEVICE_TYPES.map((dt) => (
              <Button
                key={dt}
                variant={deviceType === dt ? "default" : "outline"}
                size="sm"
                className="h-7 px-2 font-mono text-xs"
                onClick={() => setDeviceType(dt)}
              >
                {dt}
              </Button>
            ))}
          </div>
          {deviceType === "Custom" && (
            <Input
              value={customDeviceType}
              onChange={(e) => setCustomDeviceType(e.target.value)}
              placeholder="Enter device type..."
              className="h-7 font-mono text-xs"
            />
          )}
        </div>
      )}

      {/* Step 1: Instance Count */}
      {step === 1 && (
        <div className="space-y-2">
          <Label className="font-mono text-xs">How many instances?</Label>
          <Input
            type="number"
            min={1}
            max={999}
            value={instanceCount}
            onChange={(e) => setInstanceCount(Math.max(1, parseInt(e.target.value) || 1))}
            className="h-7 w-24 font-mono text-xs"
          />
          <div className="font-mono text-xs text-muted-foreground">
            Number of {effectiveDevice} instances to generate
          </div>
        </div>
      )}

      {/* Step 2: IO Mapping */}
      {step === 2 && (
        <div className="space-y-2">
          <Label className="font-mono text-xs">IO mapping approach?</Label>
          <div className="space-y-1">
            {IO_MAPPING_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setIoMapping(opt.value)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left",
                  ioMapping === opt.value
                    ? "border-primary bg-accent"
                    : "border-border hover:bg-accent/50"
                )}
              >
                <div
                  className={cn(
                    "h-3 w-3 rounded-full border-2",
                    ioMapping === opt.value
                      ? "border-primary bg-primary"
                      : "border-muted-foreground"
                  )}
                />
                <span className="font-mono text-xs">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 3: State Machine States */}
      {step === 3 && (
        <div className="space-y-2">
          <Label className="font-mono text-xs">State machine states</Label>
          <div className="flex flex-wrap gap-1">
            {states.map((s) => (
              <Badge
                key={s}
                variant="secondary"
                className="cursor-pointer font-mono text-xs"
                onClick={() => removeState(s)}
                title="Click to remove"
              >
                {s} ×
              </Badge>
            ))}
          </div>
          <div className="flex gap-1">
            <Input
              value={customState}
              onChange={(e) => setCustomState(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCustomState()}
              placeholder="Add custom state..."
              className="h-7 flex-1 font-mono text-xs"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={addCustomState}
              disabled={!customState.trim()}
            >
              Add
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Alarm Requirements */}
      {step === 4 && (
        <div className="space-y-2">
          <Label className="font-mono text-xs">Alarm requirements</Label>
          <Textarea
            value={alarmRequirements}
            onChange={(e) => setAlarmRequirements(e.target.value)}
            className="min-h-[60px] resize-none font-mono text-xs"
            rows={3}
          />
          <div className="font-mono text-xs text-muted-foreground">
            Default: latching alarms, no auto-reset, operator reset only
          </div>
        </div>
      )}

      {/* Step 5: Special Requirements */}
      {step === 5 && (
        <div className="space-y-2">
          <Label className="font-mono text-xs">Special requirements (optional)</Label>
          <Textarea
            value={specialRequirements}
            onChange={(e) => setSpecialRequirements(e.target.value)}
            placeholder="Any additional requirements..."
            className="min-h-[60px] resize-none font-mono text-xs"
            rows={3}
          />
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 font-mono text-xs"
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0}
        >
          <ChevronLeft className="mr-0.5 h-3 w-3" />
          Back
        </Button>

        {step < TOTAL_STEPS - 1 ? (
          <Button
            variant="default"
            size="sm"
            className="h-7 font-mono text-xs"
            onClick={() => setStep(step + 1)}
            disabled={!canAdvance()}
          >
            Next
            <ChevronRight className="ml-0.5 h-3 w-3" />
          </Button>
        ) : (
          <Button
            variant="default"
            size="sm"
            className="h-7 font-mono text-xs"
            onClick={handleGenerate}
            disabled={disabled || !canAdvance()}
          >
            <Wand2 className="mr-1 h-3 w-3" />
            Generate
          </Button>
        )}
      </div>
    </div>
  );
}
