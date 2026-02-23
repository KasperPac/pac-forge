import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { InteractionMode } from "@/types";

interface ModeSelectorProps {
  mode: InteractionMode;
  onModeChange: (mode: InteractionMode) => void;
}

const MODES: Array<{ value: InteractionMode; label: string; desc: string }> = [
  { value: "GUIDED", label: "Guided", desc: "Step-by-step questions" },
  { value: "FREEFORM", label: "Free-form", desc: "Direct prompt" },
  { value: "HYBRID", label: "Hybrid", desc: "Guided + custom" },
];

export function ModeSelector({ mode, onModeChange }: ModeSelectorProps) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border p-0.5">
      {MODES.map((m) => (
        <Button
          key={m.value}
          variant="ghost"
          size="sm"
          className={cn(
            "h-6 px-2 font-mono text-xs",
            mode === m.value && "bg-accent text-accent-foreground"
          )}
          onClick={() => onModeChange(m.value)}
          title={m.desc}
        >
          {m.label}
        </Button>
      ))}
    </div>
  );
}
