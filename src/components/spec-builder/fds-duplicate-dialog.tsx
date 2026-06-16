/**
 * FDS Co-Author — Duplicate equipment_module dialog.
 * Clones a completed equipment_module's behavioral data to target equipment_modules with tag remapping.
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
  UnitConfig,
  EquipmentModuleConfig,
  OperationSession,
} from "@/types/spec-builder";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  specProjectId: string;
  sourceSession: OperationSession;
  sourceEquipmentModule: EquipmentModuleConfig;
  units: UnitConfig[];
  existingSessions: OperationSession[];
}

export function FdsDuplicateDialog({
  open,
  onOpenChange,
  specProjectId,
  sourceSession,
  sourceEquipmentModule,
  units,
  existingSessions,
}: Props) {
  const duplicate = useDuplicateFdsSession();

  // Find equipment_modules with matching device structure (same number and types of control_modules)
  const sourceDeviceSignature = useMemo(() => {
    return sourceEquipmentModule.control_modules
      .map((d) => `${d.control_module_class}:${d.io_signals.length}`)
      .sort()
      .join(",");
  }, [sourceEquipmentModule]);

  // All equipment_modules across all units that match the source's device structure
  const matchingAssemblies = useMemo(() => {
    const matches: Array<{ unit: UnitConfig; equipment_module: EquipmentModuleConfig }> = [];
    for (const sub of units) {
      for (const asm of sub.equipment_modules) {
        if (asm.equipment_module_id === sourceEquipmentModule.equipment_module_id) continue; // skip source
        const sig = asm.control_modules
          .map((d) => `${d.control_module_class}:${d.io_signals.length}`)
          .sort()
          .join(",");
        if (sig === sourceDeviceSignature) {
          matches.push({ unit: sub, equipment_module: asm });
        }
      }
    }
    return matches;
  }, [units, sourceEquipmentModule, sourceDeviceSignature]);

  // Selected targets
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());

  // Build tag remap for each target
  const buildRemap = (target: EquipmentModuleConfig): Record<string, string> => {
    const remap: Record<string, string> = {};
    // Match control_modules by position (same index = same role)
    for (let i = 0; i < sourceEquipmentModule.control_modules.length && i < target.control_modules.length; i++) {
      const srcDev = sourceEquipmentModule.control_modules[i];
      const tgtDev = target.control_modules[i];
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
      .filter((m) => selectedTargets.has(m.equipment_module.equipment_module_id))
      .map((m) => ({
        unit_id: m.unit.unit_id,
        equipment_module_id: m.equipment_module.equipment_module_id,
        tag_remap: buildRemap(m.equipment_module),
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
            Duplicate Equipment Module
          </DialogTitle>
          <DialogDescription>
            Clone {sourceEquipmentModule.equipment_module_name}'s behavioral data to equipment_modules with matching device structures.
            Tags will be automatically remapped.
          </DialogDescription>
        </DialogHeader>

        {matchingAssemblies.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No equipment_modules with matching device structure found.
          </div>
        ) : (
          <ScrollArea className="max-h-[300px]">
            <div className="space-y-2">
              {matchingAssemblies.map(({ unit, equipment_module }) => {
                const existing = existingSessions.find(
                  (s) => s.equipment_module_id === equipment_module.equipment_module_id,
                );
                const isSelected = selectedTargets.has(equipment_module.equipment_module_id);
                const remap = buildRemap(equipment_module);
                const remapEntries = Object.entries(remap);

                return (
                  <button
                    key={equipment_module.equipment_module_id}
                    onClick={() => toggleTarget(equipment_module.equipment_module_id)}
                    className={`w-full text-left p-3 rounded-md border transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-muted-foreground/30"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{equipment_module.equipment_module_name}</span>
                      <div className="flex items-center gap-1.5">
                        {existing?.status === "complete" && (
                          <Badge variant="outline" className="text-[9px] text-amber-400">
                            Will overwrite
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[9px]">
                          {unit.unit_name}
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
