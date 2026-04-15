/**
 * FDS Co-Author — Assembly sidebar with status badges and subsystem grouping.
 */
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2,
  Circle,
  MessageSquare,
  ShieldCheck,
  ChevronRight,
  Boxes,
  Network,
} from "lucide-react";
import type { SubsystemConfig, FdsAssemblySession, FdsSessionStatus } from "@/types/spec-builder";
import { cn } from "@/lib/utils";

interface Props {
  subsystems: SubsystemConfig[];
  sessions: FdsAssemblySession[];
  selectedAssemblyId: string | null;
  selectedOrchestrationSubsystemId: string | null;
  onSelectAssembly: (subsystemId: string, assemblyId: string) => void;
  onSelectOrchestration: (subsystemId: string) => void;
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

const STATUS_LABEL: Record<FdsSessionStatus, string> = {
  not_started: "Not started",
  static_confirmed: "Static confirmed",
  in_progress: "In progress",
  complete: "Complete",
};

export function FdsAssemblySidebar({
  subsystems,
  sessions,
  selectedAssemblyId,
  selectedOrchestrationSubsystemId,
  onSelectAssembly,
  onSelectOrchestration,
}: Props) {
  const activeSubsystems = subsystems.filter((s) => !s.excluded);

  // Compute overall progress
  const totalAssemblies = activeSubsystems.reduce((s, sub) => s + sub.assemblies.length, 0);
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

      {/* Assembly tree */}
      <ScrollArea className="flex-1">
        <div className="p-1.5 space-y-3">
          {activeSubsystems.map((sub) => {
            const subSessions = sessions.filter((s) => s.subsystem_id === sub.subsystem_id);
            const allComplete = sub.assemblies.length > 0 &&
              sub.assemblies.every((a) =>
                subSessions.find((s) => s.assembly_id === a.assembly_id)?.status === "complete"
              );

            return (
              <div key={sub.subsystem_id} className="space-y-0.5">
                {/* Subsystem header */}
                <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground tracking-wide">
                  <Boxes className="h-3 w-3" />
                  <span className="truncate flex-1">{sub.subsystem_name}</span>
                  <Badge variant="outline" className="text-[9px] h-3.5 px-1">
                    {sub.equipment_type}
                  </Badge>
                </div>

                {/* Assemblies */}
                {sub.assemblies.map((asm) => {
                  const session = subSessions.find((s) => s.assembly_id === asm.assembly_id);
                  const status: FdsSessionStatus = session?.status ?? "not_started";
                  const Icon = STATUS_ICON[status];
                  const isSelected = selectedAssemblyId === asm.assembly_id &&
                    selectedOrchestrationSubsystemId === null;

                  return (
                    <button
                      key={asm.assembly_id}
                      onClick={() => onSelectAssembly(sub.subsystem_id, asm.assembly_id)}
                      className={cn(
                        "w-full flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-left transition-colors",
                        isSelected
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent/50"
                      )}
                    >
                      <Icon className={cn("h-3 w-3 shrink-0", STATUS_COLOR[status])} />
                      <span className="truncate flex-1">{asm.assembly_name}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {asm.devices.length}D
                      </span>
                    </button>
                  );
                })}

                {/* Subsystem orchestration button (shown when >1 assembly) */}
                {sub.assemblies.length > 1 && (
                  <>
                    <button
                      onClick={() => onSelectOrchestration(sub.subsystem_id)}
                      className={cn(
                        "w-full flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-left transition-colors",
                        selectedOrchestrationSubsystemId === sub.subsystem_id
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent/50"
                      )}
                    >
                      <Network className={cn("h-3 w-3 shrink-0", allComplete ? "text-green-400" : "text-muted-foreground")} />
                      <span className="truncate flex-1 italic">Orchestration</span>
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </>
                )}

                {/* Separator between subsystems */}
                <Separator className="mt-1" />
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
