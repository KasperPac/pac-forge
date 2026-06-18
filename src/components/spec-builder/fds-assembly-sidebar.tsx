/**
 * FDS Co-Author — Equipment Module sidebar with status badges and unit grouping.
 */
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2,
  Circle,
  MessageSquare,
  ShieldCheck,
  Boxes,
} from "lucide-react";
import type { UnitConfig, OperationSession, FdsSessionStatus } from "@/types/spec-builder";
import { cn } from "@/lib/utils";

interface Props {
  units: UnitConfig[];
  sessions: OperationSession[];
  selectedEquipmentModuleId: string | null;
  onSelectEquipmentModule: (unitId: string, equipment_moduleId: string) => void;
}

const STATUS_ICON: Record<FdsSessionStatus, typeof Circle> = {
  not_started: Circle,
  static_confirmed: ShieldCheck,
  in_progress: MessageSquare,
  complete: CheckCircle2,
};

const STATUS_COLOR: Record<FdsSessionStatus, string> = {
  not_started: "text-muted-foreground",
  static_confirmed: "text-blue-400",
  in_progress: "text-amber-400",
  complete: "text-green-400",
};

export function FdsAssemblySidebar({
  units,
  sessions,
  selectedEquipmentModuleId,
  onSelectEquipmentModule,
}: Props) {
  const activeUnits = units.filter((s) => !s.excluded);

  // Compute overall progress
  const totalAssemblies = activeUnits.reduce((s, sub) => s + sub.equipment_modules.length, 0);
  const completeSessions = sessions.filter((s) => s.status === "complete").length;

  return (
    <div className="flex flex-col h-full">
      {/* Header with progress */}
      <div className="p-3 border-b space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">Assemblies</span>
          <Badge variant="outline" className="text-[10px] h-4 px-1.5">
            {completeSessions}/{totalAssemblies}
          </Badge>
        </div>
        {totalAssemblies > 0 && (
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-300"
              style={{ width: `${(completeSessions / totalAssemblies) * 100}%` }}
            />
          </div>
        )}
      </div>

      {/* Equipment Module tree */}
      <ScrollArea className="flex-1">
        <div className="p-1.5 space-y-3">
          {activeUnits.map((sub) => {
            const subSessions = sessions.filter((s) => s.unit_id === sub.unit_id);

            return (
              <div key={sub.unit_id} className="space-y-0.5">
                {/* Unit header */}
                <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground tracking-wide">
                  <Boxes className="h-3 w-3" />
                  <span className="truncate flex-1">{sub.unit_name}</span>
                  <Badge variant="outline" className="text-[9px] h-3.5 px-1">
                    {sub.equipment_type}
                  </Badge>
                </div>

                {/* Assemblies */}
                {sub.equipment_modules.map((asm) => {
                  const session = subSessions.find((s) => s.equipment_module_id === asm.equipment_module_id);
                  const status: FdsSessionStatus = session?.status ?? "not_started";
                  const Icon = STATUS_ICON[status];
                  const isSelected = selectedEquipmentModuleId === asm.equipment_module_id;

                  return (
                    <button
                      key={asm.equipment_module_id}
                      onClick={() => onSelectEquipmentModule(sub.unit_id, asm.equipment_module_id)}
                      className={cn(
                        "w-full flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-left transition-colors",
                        isSelected
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent/50"
                      )}
                    >
                      <Icon className={cn("h-3 w-3 shrink-0", STATUS_COLOR[status])} />
                      <span className="truncate flex-1">{asm.equipment_module_name}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {asm.control_modules.length}D
                      </span>
                    </button>
                  );
                })}

                {/* Separator between units */}
                <Separator className="mt-1" />
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
