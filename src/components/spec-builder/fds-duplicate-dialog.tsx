/**
 * FDS Co-Author — Duplicate assembly dialog.
 * Clones a completed assembly's behavioral data to target assemblies with tag remapping.
 */
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Copy, ArrowRight, Loader2 } from "lucide-react";
import { useDuplicateFdsSession } from "@/hooks/use-fds-session";
import type {
  SubsystemConfig,
  AssemblyConfig,
  FdsAssemblySession,
} from "@/types/spec-builder";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  specProjectId: string;
  sourceSession: FdsAssemblySession;
  sourceAssembly: AssemblyConfig;
  subsystems: SubsystemConfig[];
  existingSessions: FdsAssemblySession[];
}

export function FdsDuplicateDialog({
  open,
  onOpenChange,
  specProjectId,
  sourceSession,
  sourceAssembly,
  subsystems,
  existingSessions,
}: Props) {
  const duplicate = useDuplicateFdsSession();

  // Find assemblies with matching device structure (same number and types of devices)
  const sourceDeviceSignature = useMemo(() => {
    return sourceAssembly.devices
      .map((d) => `${d.device_class}:${d.io_signals.length}`)
      .sort()
      .join(",");
  }, [sourceAssembly]);

  // All assemblies across all subsystems that match the source's device structure
  const matchingAssemblies = useMemo(() => {
    const matches: Array<{ subsystem: SubsystemConfig; assembly: AssemblyConfig }> = [];
    for (const sub of subsystems) {
      for (const asm of sub.assemblies) {
        if (asm.assembly_id === sourceAssembly.assembly_id) continue; // skip source
        const sig = asm.devices
          .map((d) => `${d.device_class}:${d.io_signals.length}`)
          .sort()
          .join(",");
        if (sig === sourceDeviceSignature) {
          matches.push({ subsystem: sub, assembly: asm });
        }
      }
    }
    return matches;
  }, [subsystems, sourceAssembly, sourceDeviceSignature]);

  // Selected targets
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());

  // Build tag remap for each target
  const buildRemap = (target: AssemblyConfig): Record<string, string> => {
    const remap: Record<string, string> = {};
    // Match devices by position (same index = same role)
    for (let i = 0; i < sourceAssembly.devices.length && i < target.devices.length; i++) {
      const srcDev = sourceAssembly.devices[i];
      const tgtDev = target.devices[i];
      // Map each signal
      for (let j = 0; j < srcDev.io_signals.length && j < tgtDev.io_signals.length; j++) {
        remap[srcDev.io_signals[j].tag] = tgtDev.io_signals[j].tag;
      }
    }
    return remap;
  };

  const toggleTarget = (asmId: string) => {
    setSelectedTargets((prev) => {
      const next = new Set(prev);
      if (next.has(asmId)) next.delete(asmId);
      else next.add(asmId);
      return next;
    });
  };

  const handleDuplicate = async () => {
    const targets = matchingAssemblies
      .filter((m) => selectedTargets.has(m.assembly.assembly_id))
      .map((m) => ({
        subsystem_id: m.subsystem.subsystem_id,
        assembly_id: m.assembly.assembly_id,
        tag_remap: buildRemap(m.assembly),
      }));

    if (targets.length === 0) return;

    await duplicate.mutateAsync({
      source_id: sourceSession.id,
      spec_project_id: specProjectId,
      targets,
    });

    onOpenChange(false);
    setSelectedTargets(new Set());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-4 w-4" />
            Duplicate Assembly
          </DialogTitle>
          <DialogDescription>
            Clone {sourceAssembly.assembly_name}'s behavioral data to assemblies with matching device structures.
            Tags will be automatically remapped.
          </DialogDescription>
        </DialogHeader>

        {matchingAssemblies.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No assemblies with matching device structure found.
          </div>
        ) : (
          <ScrollArea className="max-h-[300px]">
            <div className="space-y-2">
              {matchingAssemblies.map(({ subsystem, assembly }) => {
                const existing = existingSessions.find(
                  (s) => s.assembly_id === assembly.assembly_id,
                );
                const isSelected = selectedTargets.has(assembly.assembly_id);
                const remap = buildRemap(assembly);
                const remapEntries = Object.entries(remap);

                return (
                  <button
                    key={assembly.assembly_id}
                    onClick={() => toggleTarget(assembly.assembly_id)}
                    className={`w-full text-left p-3 rounded-md border transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-muted-foreground/30"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{assembly.assembly_name}</span>
                      <div className="flex items-center gap-1.5">
                        {existing?.status === "complete" && (
                          <Badge variant="outline" className="text-[9px] text-amber-400">
                            Will overwrite
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[9px]">
                          {subsystem.subsystem_name}
                        </Badge>
                      </div>
                    </div>
                    {isSelected && remapEntries.length > 0 && (
                      <div className="mt-2 space-y-0.5">
                        <span className="text-[10px] text-muted-foreground font-semibold">Tag remap:</span>
                        {remapEntries.slice(0, 4).map(([src, tgt]) => (
                          <div key={src} className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
                            <span>{src}</span>
                            <ArrowRight className="h-2.5 w-2.5" />
                            <span className="text-foreground">{tgt}</span>
                          </div>
                        ))}
                        {remapEntries.length > 4 && (
                          <span className="text-[10px] text-muted-foreground">
                            +{remapEntries.length - 4} more
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleDuplicate}
            disabled={selectedTargets.size === 0 || duplicate.isPending}
          >
            {duplicate.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Copy className="h-3.5 w-3.5 mr-1.5" />
            )}
            Duplicate to {selectedTargets.size} assembl{selectedTargets.size === 1 ? "y" : "ies"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
