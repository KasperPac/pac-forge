import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  Plug,
  Check,
  AlertCircle,
  ImagePlus,
  Circle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import { parseScreenXml } from "@/lib/hmi-xml-parser";

type Step = "idle" | "connecting" | "connected" | "opening" | "project-open" | "exporting" | "done";

interface TiaImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportScreens: (data: {
    screens: Record<string, string>;
    tagTables: Record<string, string>;
  }) => void;
  onImportAsTemplates?: (screens: import("@/types/hmi-screen").HmiScreenSpec[]) => void;
}

export function TiaImportDialog({
  open,
  onOpenChange,
  onImportScreens,
  onImportAsTemplates,
}: TiaImportDialogProps) {
  const [step, setStep] = useState<Step>("idle");
  const [projectPath, setProjectPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("");
  const [_screenCount, setScreenCount] = useState(0);
  const [parsedScreens, setParsedScreens] = useState<import("@/types/hmi-screen").HmiScreenSpec[]>([]);

  const callBridge = async (
    endpoint: string,
    body?: Record<string, unknown>,
  ) => {
    const res = await fetch(
      `${DEFAULT_BRIDGE_CONFIG.baseUrl}${endpoint}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : "{}",
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch(
        `${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/status`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (res.ok) return await res.json();
    } catch {
      // offline
    }
    return null;
  }, []);

  // When dialog opens, check current state and auto-advance
  useEffect(() => {
    if (!open) return;

    setError(null);
    setScreenCount(0);

    (async () => {
      setStep("connecting");
      setStatusText("Checking bridge...");

      let status = await checkStatus();
      if (!status) {
        setStep("idle");
        setError("Bridge is not running. Start it with: dotnet run --project bridge/PacForgeBridge");
        return;
      }

      // Bridge is online — is TIA connected?
      if (!status.connected) {
        setStatusText("Attaching to TIA Portal...");
        try {
          const result = await callBridge("/tia/connect", { mode: "attach" });
          if (!result.success) throw new Error(result.message);
          // Re-check status after connecting (connect auto-detects open projects)
          status = await checkStatus();
        } catch (err) {
          setStep("idle");
          setError(err instanceof Error ? err.message : "Failed to connect to TIA Portal");
          return;
        }
      }

      // At this point TIA is connected — check if project is open
      if (status?.tia_project_open) {
        setStep("project-open");
        setStatusText("Connected — project is open, ready to export");
      } else {
        setStep("connected");
        setStatusText("Connected to TIA Portal — open a project");
      }
    })();
  }, [open, checkStatus]);

  // When dialog closes, disconnect
  const handleClose = async (isOpen: boolean) => {
    if (!isOpen) {
      // Reset state
      setStep("idle");
      setError(null);
      setStatusText("");
      setScreenCount(0);
    }
    onOpenChange(isOpen);
  };

  const handleOpenProject = async () => {
    if (!projectPath.trim()) return;
    setStep("opening");
    setError(null);
    setStatusText("Opening project...");
    try {
      const result = await callBridge("/tia/open-project", {
        project_path: projectPath.trim(),
      });
      if (!result.success) throw new Error(result.message);
      setStep("project-open");
      setStatusText("Project opened — ready to export");
    } catch (err) {
      setStep("connected");
      setError(err instanceof Error ? err.message : "Failed to open project");
    }
  };

  const handleExport = async () => {
    setStep("exporting");
    setError(null);
    setStatusText("Exporting screens...");
    try {
      const screenResult = await callBridge("/tia/export-hmi");
      if (!screenResult.success) throw new Error(screenResult.message);

      const count = Object.keys(screenResult.screens ?? {}).length;
      setScreenCount(count);
      onImportScreens({
        screens: screenResult.screens ?? {},
        tagTables: screenResult.tag_tables ?? {},
      });

      // Parse screens and count referenced graphics
      const allParsed: import("@/types/hmi-screen").HmiScreenSpec[] = [];
      let graphicCount = 0;
      for (const [name, xml] of Object.entries(screenResult.screens ?? {})) {
        try {
          const parsed = parseScreenXml(xml as string);
          parsed.name = name;
          allParsed.push(parsed);
          for (const el of parsed.elements) {
            if (el.graphicName) graphicCount++;
          }
        } catch { /* skip */ }
      }
      setParsedScreens(allParsed);

      setStep("done");
      setStatusText(
        `${count} screen(s) imported` +
        (graphicCount > 0 ? `. ${graphicCount} graphic reference(s) found — upload them via the Graphics panel.` : ""),
      );
    } catch (err) {
      setStep("project-open");
      setError(err instanceof Error ? err.message : "Export failed");
    }
  };

  const isLoading = step === "connecting" || step === "opening" || step === "exporting";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plug className="h-5 w-5" />
            Import from TIA Portal
          </DialogTitle>
          <DialogDescription>
            Connect to TIA Portal and import HMI screens and graphics
          </DialogDescription>
        </DialogHeader>

        {/* Progress steps */}
        <div className="flex items-center gap-2 text-xs">
          <StepIndicator
            state={
              step === "connecting" ? "active" :
              step === "idle" && !error ? "pending" :
              step === "idle" && error ? "error" :
              "done"
            }
            label="Connect"
          />
          <div className="h-px flex-1 bg-border" />
          <StepIndicator
            state={
              step === "opening" ? "active" :
              step === "connected" ? "pending" :
              step === "project-open" || step === "exporting" || step === "done" ? "done" :
              "pending"
            }
            label="Project"
          />
          <div className="h-px flex-1 bg-border" />
          <StepIndicator
            state={
              step === "exporting" ? "active" :
              step === "done" ? "done" :
              "pending"
            }
            label="Import"
          />
        </div>

        <Separator />

        {/* Status line */}
        {(statusText || isLoading) && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {statusText}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Idle with error — retry button */}
        {step === "idle" && error && (
          <Button
            variant="outline"
            onClick={() => {
              setError(null);
              // Re-trigger the open effect
              onOpenChange(false);
              setTimeout(() => onOpenChange(true), 100);
            }}
          >
            Retry
          </Button>
        )}

        {/* Connected — enter project path */}
        {step === "connected" && (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Enter the path to your TIA project file (.ap18).
            </div>
            <Input
              placeholder="C:\path\to\project.ap18"
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleOpenProject()}
              className="font-mono text-xs"
              autoFocus
            />
            <Button
              onClick={handleOpenProject}
              disabled={!projectPath.trim()}
              className="w-full"
            >
              Open Project
            </Button>
          </div>
        )}

        {/* Project open — export */}
        {step === "project-open" && (
          <div className="space-y-3">
            <Button onClick={handleExport} className="w-full gap-2">
              <ImagePlus className="h-4 w-4" />
              Export Screens
            </Button>
          </div>
        )}

        {/* Done */}
        {step === "done" && (
          <div className="space-y-3">
            {onImportAsTemplates && parsedScreens.length > 0 && (
              <Button
                variant="outline"
                onClick={() => {
                  onImportAsTemplates(parsedScreens);
                  setStatusText(`${parsedScreens.length} screen(s) saved as templates`);
                }}
                className="w-full gap-2"
              >
                <ImagePlus className="h-4 w-4" />
                Also Save as Templates ({parsedScreens.length})
              </Button>
            )}
            <Button onClick={() => handleClose(false)} className="w-full gap-2">
              <Check className="h-4 w-4" />
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StepIndicator({
  state,
  label,
}: {
  state: "pending" | "active" | "done" | "error";
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {state === "done" ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : state === "active" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
      ) : state === "error" ? (
        <AlertCircle className="h-3.5 w-3.5 text-destructive" />
      ) : (
        <Circle className="h-3.5 w-3.5 text-muted-foreground/30" />
      )}
      <span
        className={
          state === "done"
            ? "font-medium text-green-500"
            : state === "active"
              ? "font-medium text-blue-500"
              : state === "error"
                ? "text-destructive"
                : "text-muted-foreground"
        }
      >
        {label}
      </span>
    </div>
  );
}
