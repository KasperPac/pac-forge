import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import type { CompileError, SafetyWarning } from "@/types";

interface BottomPanelProps {
  compileErrors: CompileError[];
  logs: string[];
  warnings: SafetyWarning[];
  onErrorClick?: (artifactName: string, line: number | null) => void;
}

const SEVERITY_COLORS: Record<string, string> = {
  ERROR: "text-red-400",
  WARNING: "text-amber-400",
  INFO: "text-blue-400",
};

export function BottomPanel({ compileErrors, logs, warnings, onErrorClick }: BottomPanelProps) {
  const { bottomPanelOpen, bottomPanelTab, setBottomPanelOpen, setBottomPanelTab } = useUiStore();

  const tabs = [
    { id: "compile" as const, label: "Compile", count: compileErrors.length },
    { id: "logs" as const, label: "Logs", count: logs.length },
    { id: "warnings" as const, label: "Warnings", count: warnings.filter((w) => !w.acknowledged).length },
  ];

  return (
    <div className="border-t">
      {/* Tab bar — always visible */}
      <div className="flex items-center justify-between px-2 py-1">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setBottomPanelTab(tab.id)}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] transition-colors",
                bottomPanelTab === tab.id && bottomPanelOpen
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
              {tab.count > 0 && (
                <Badge
                  variant={tab.id === "compile" && tab.count > 0 ? "destructive" : "secondary"}
                  className="h-4 px-1 text-[9px]"
                >
                  {tab.count}
                </Badge>
              )}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0"
          onClick={() => setBottomPanelOpen(!bottomPanelOpen)}
        >
          {bottomPanelOpen ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronUp className="h-3 w-3" />
          )}
        </Button>
      </div>

      {/* Panel content */}
      {bottomPanelOpen && (
        <ScrollArea className="h-48">
          <div className="p-2">
            {/* Compile Output */}
            {bottomPanelTab === "compile" && (
              <div className="space-y-0.5">
                {compileErrors.length === 0 ? (
                  <div className="py-4 text-center font-mono text-[10px] text-muted-foreground">
                    No compile output.
                  </div>
                ) : (
                  compileErrors.map((err, idx) => (
                    <button
                      key={idx}
                      className="flex w-full items-start gap-2 rounded px-2 py-1 text-left hover:bg-accent/50"
                      onClick={() => onErrorClick?.(err.artifact_name, err.line)}
                    >
                      <span className={cn("font-mono text-[10px] font-bold", SEVERITY_COLORS[err.severity])}>
                        {err.severity}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {err.artifact_name}
                        {err.line != null ? `:${err.line}` : ""}
                        {err.column != null ? `:${err.column}` : ""}
                      </span>
                      <span className="flex-1 font-mono text-[10px]">{err.error_text}</span>
                    </button>
                  ))
                )}
              </div>
            )}

            {/* Logs */}
            {bottomPanelTab === "logs" && (
              <div className="space-y-0.5">
                {logs.length === 0 ? (
                  <div className="py-4 text-center font-mono text-[10px] text-muted-foreground">
                    No logs.
                  </div>
                ) : (
                  logs.map((log, idx) => (
                    <div key={idx} className="font-mono text-[10px] text-muted-foreground">
                      {log}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Warnings */}
            {bottomPanelTab === "warnings" && (
              <div className="space-y-0.5">
                {warnings.length === 0 ? (
                  <div className="py-4 text-center font-mono text-[10px] text-muted-foreground">
                    No warnings.
                  </div>
                ) : (
                  warnings.map((w) => (
                    <div
                      key={w.id}
                      className={cn(
                        "flex items-start gap-2 rounded px-2 py-1 font-mono text-[10px]",
                        w.acknowledged ? "text-muted-foreground" : "text-amber-400"
                      )}
                    >
                      <span className="font-bold">{w.type}</span>
                      <span className="text-muted-foreground">
                        {w.artifact_name}{w.line != null ? `:${w.line}` : ""}
                      </span>
                      <span className="flex-1">{w.description}</span>
                      {w.acknowledged && (
                        <Badge variant="outline" className="text-[8px]">ACK</Badge>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
