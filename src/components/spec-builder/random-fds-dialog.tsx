/**
 * Dialog for generating a random FDS with configurable counts.
 * Opens from the spec builder sidebar.
 */
import { useState } from "react";
import { Loader2, Dices } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRandomFdsGenerate } from "@/hooks/use-random-fds-generate";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RandomFdsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectNumber?: string;
  clientName?: string;
  onCreated: (specId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RandomFdsDialog({
  open,
  onOpenChange,
  projectId,
  projectNumber,
  clientName,
  onCreated,
}: RandomFdsDialogProps) {
  const [units, setSubsystems] = useState(2);
  const [equipment_modules, setAssemblies] = useState(4);
  const [control_modules, setDevices] = useState(12);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);

  const { generate, loading, error, cancel } = useRandomFdsGenerate();

  // Enforce: equipment_modules >= units, control_modules >= equipment_modules
  const handleSubsystemsChange = (v: number[]) => {
    const val = v[0];
    setSubsystems(val);
    if (equipment_modules < val) setAssemblies(val);
    if (control_modules < val) setDevices(val);
  };

  const handleAssembliesChange = (v: number[]) => {
    const val = v[0];
    setAssemblies(val);
    if (control_modules < val) setDevices(val);
  };

  const handleDevicesChange = (v: number[]) => {
    setDevices(v[0]);
  };

  const totalSignals = Math.round(control_modules * 2.5); // rough estimate

  const handleGenerate = async () => {
    setProgressLabel(null);
    const specId = await generate({
      units,
      equipment_modules,
      control_modules,
      projectId,
      projectNumber,
      clientName,
      onProgress: (stage) => setProgressLabel(stage),
    });
    setProgressLabel(null);
    if (specId) {
      onCreated(specId);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!loading) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Dices className="h-4 w-4" />
            Generate Random FDS
          </DialogTitle>
          <DialogDescription>
            The design engineer agent will create a complete functional spec for a random industrial machine matching your parameters.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-4">
          {/* Subsystems */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Subsystems</Label>
              <span className="font-mono text-xs text-muted-foreground tabular-nums w-6 text-right">
                {units}
              </span>
            </div>
            <Slider
              min={1}
              max={8}
              step={1}
              value={[units]}
              onValueChange={handleSubsystemsChange}
              disabled={loading}
            />
            <p className="text-[10px] text-muted-foreground">
              Functional stations (e.g. Infeed, Processing, Outfeed)
            </p>
          </div>

          {/* Assemblies */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Assemblies</Label>
              <span className="font-mono text-xs text-muted-foreground tabular-nums w-6 text-right">
                {equipment_modules}
              </span>
            </div>
            <Slider
              min={units}
              max={20}
              step={1}
              value={[equipment_modules]}
              onValueChange={handleAssembliesChange}
              disabled={loading}
            />
            <p className="text-[10px] text-muted-foreground">
              Coordinated device groups (e.g. Conveyor CV01, Lift Table LFT01)
            </p>
          </div>

          {/* Devices */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Devices</Label>
              <span className="font-mono text-xs text-muted-foreground tabular-nums w-6 text-right">
                {control_modules}
              </span>
            </div>
            <Slider
              min={equipment_modules}
              max={60}
              step={1}
              value={[control_modules]}
              onValueChange={handleDevicesChange}
              disabled={loading}
            />
            <p className="text-[10px] text-muted-foreground">
              Physical control_modules with IO (motors, valves, sensors)
            </p>
          </div>

          {/* Summary */}
          <div className="rounded-md border border-border/50 bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              The agent will generate a random machine with{" "}
              <span className="font-mono text-foreground">{units}</span> units,{" "}
              <span className="font-mono text-foreground">{equipment_modules}</span> equipment_modules,{" "}
              <span className="font-mono text-foreground">{control_modules}</span> control_modules, and ~
              <span className="font-mono text-foreground">{totalSignals}</span> IO signals.
            </p>
          </div>

          {loading && progressLabel && (
            <div className="rounded-md border border-border/50 bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">{progressLabel}</p>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {loading ? (
            <Button variant="outline" size="sm" onClick={cancel}>
              Cancel
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
          <Button size="sm" onClick={handleGenerate} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Dices className="h-3.5 w-3.5 mr-1.5" />
                Generate
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
