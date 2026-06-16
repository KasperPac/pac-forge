import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, AlertCircle, Plug, SearchCode, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUpdateAuditProject } from "@/hooks/use-audit-session";
import { getBridgeConfigForVersion } from "@/lib/tia-bridge-contract";
import type { BridgeConfig, ProjectInfoResponse } from "@/lib/tia-bridge-contract";
import { useAuditStore } from "@/stores/audit-store";
import type { AuditProject } from "@/types/audit";
import { cn } from "@/lib/utils";

interface AuditConnectProps {
  session: AuditProject;
  onSessionUpdate: () => void;
}

type TiaVersion = "V20" | "V18";

async function fetchBridgeStatus(cfg: BridgeConfig) {
  try {
    const res = await fetch(`${cfg.baseUrl}/tia/status`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    console.log("[AuditConnect] bridge status:", data);
    return {
      connected: Boolean(data.connected ?? data.Connected),
      tia_project_open: Boolean(data.tia_project_open ?? data.TiaProjectOpen),
      tia_version: (data.tia_version ?? data.TiaVersion ?? null) as string | null,
    };
  } catch (e) {
    console.warn("[AuditConnect] fetchBridgeStatus failed:", e);
    return null;
  }
}

export function AuditConnect({ session, onSessionUpdate }: AuditConnectProps) {
  const store = useAuditStore();
  const queryClient = useQueryClient();
  const updateProject = useUpdateAuditProject();

  // Derive initial version from what's already saved on the project
  const [tiaVersion, setTiaVersion] = useState<TiaVersion>(
    session.tia_version?.includes("18") ? "V18" : "V20"
  );
  const bridgeCfg = getBridgeConfigForVersion(tiaVersion);

  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [tiaConnected, setTiaConnected] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectInfo, setProjectInfo] = useState<ProjectInfoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkStatusMutation = useMutation({
    mutationFn: () => fetchBridgeStatus(bridgeCfg),
    onSuccess: (status) => {
      setBridgeOnline(status !== null);
      setTiaConnected(status?.connected ?? false);
      setProjectOpen(status?.tia_project_open ?? false);
    },
  });

  // Auto-check on mount
  useEffect(() => {
    checkStatusMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check status whenever version changes
  function handleVersionChange(v: TiaVersion) {
    setTiaVersion(v);
    setBridgeOnline(false);
    setTiaConnected(false);
    setProjectOpen(false);
    setProjectInfo(null);
    setTimeout(() => checkStatusMutation.mutate(), 0);
  }

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${bridgeCfg.baseUrl}/tia/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "attach" }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ message: "Connect failed" }))) as {
          message?: string;
        };
        throw new Error(err.message ?? "Connect failed");
      }
    },
    onSuccess: () => {
      checkStatusMutation.mutate();
      void queryClient.invalidateQueries({ queryKey: ["tia-bridge-status"] });
    },
  });

  const fetchInfoMutation = useMutation({
    mutationFn: async (): Promise<ProjectInfoResponse> => {
      const res = await fetch(`${bridgeCfg.baseUrl}/tia/project-info`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ message: "Failed to get project info" }))) as {
          message?: string;
        };
        throw new Error(err.message ?? "Failed to get project info");
      }
      return (await res.json()) as ProjectInfoResponse;
    },
    onSuccess: async (info) => {
      setProjectInfo(info);
      setError(null);
      await updateProject.mutateAsync({
        id: session.id,
        updates: {
          name: info.project_name || session.name,
          tia_project_path: info.project_path || session.tia_project_path,
          tia_version: info.tia_version ?? tiaVersion,
          cpu_family: info.cpu_family,
          cpu_order_number: info.cpu_order_number,
        },
      });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : String(err));
    },
  });

  const canProceed = projectOpen && projectInfo;

  async function handleProceed() {
    try {
      await updateProject.mutateAsync({
        id: session.id,
        updates: { current_step: "extract" },
      });
      store.setStepStatus("connect", "completed");
      store.setCurrentStep("extract");
      store.setStepStatus("extract", "active");
      onSessionUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const statusDot = !bridgeOnline
    ? "bg-zinc-500"
    : !tiaConnected
      ? "bg-amber-500"
      : projectOpen
        ? "bg-green-500"
        : "bg-amber-500";

  const statusLabel = !bridgeOnline
    ? `Bridge offline (port ${bridgeCfg.baseUrl.split(":").pop()})`
    : !tiaConnected
      ? "Bridge online — TIA not connected"
      : projectOpen
        ? "TIA connected — project open"
        : "TIA connected — no project open";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      {/* TIA Version selector */}
      <div className="rounded-lg border border-border/70 bg-card/60 p-4">
        <div className="mb-3 font-mono text-xs uppercase tracking-wider text-muted-foreground">
          TIA Portal Version
        </div>
        <div className="flex gap-2">
          {(["V20", "V18"] as TiaVersion[]).map((v) => (
            <button
              key={v}
              onClick={() => handleVersionChange(v)}
              className={cn(
                "rounded-md border px-4 py-1.5 font-mono text-xs transition-colors",
                tiaVersion === v
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
              )}
            >
              {v}
            </button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2 text-xs"
            onClick={() => checkStatusMutation.mutate()}
            disabled={checkStatusMutation.isPending}
          >
            {checkStatusMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              "Check status"
            )}
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {tiaVersion === "V18"
            ? "Connects to PacForgeBridge.V18 on port 5103"
            : "Connects to PacForgeBridge on port 5102"}
        </p>
      </div>

      {/* Bridge status */}
      <div className="rounded-lg border border-border/70 bg-card/60 p-4">
        <div className="flex items-center gap-3">
          <Plug className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Bridge Status
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className={cn("inline-block h-2.5 w-2.5 rounded-full", statusDot)} />
            <span className="font-mono text-xs text-muted-foreground">{statusLabel}</span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-3 border-t border-border/40 pt-3">
          <div className="text-center">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Bridge
            </div>
            <div className={cn("mt-1 font-mono text-xs", bridgeOnline ? "text-green-400" : "text-zinc-500")}>
              {bridgeOnline ? "Online" : "Offline"}
            </div>
          </div>
          <div className="text-center">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              TIA Portal
            </div>
            <div className={cn("mt-1 font-mono text-xs", tiaConnected ? "text-green-400" : "text-zinc-500")}>
              {tiaConnected ? "Connected" : "Not connected"}
            </div>
          </div>
          <div className="text-center">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Project
            </div>
            <div className={cn("mt-1 font-mono text-xs", projectOpen ? "text-green-400" : "text-zinc-500")}>
              {projectOpen ? "Open" : "No project"}
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      {bridgeOnline && !tiaConnected && (
        <Button
          variant="outline"
          onClick={() => connectMutation.mutate()}
          disabled={connectMutation.isPending}
          className="gap-2"
        >
          {connectMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plug className="h-3.5 w-3.5" />
          )}
          Connect to TIA Portal
        </Button>
      )}

      {tiaConnected && !projectOpen && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-300">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Open the project in TIA Portal, then click <strong>Check status</strong> above.</span>
          </div>
        </div>
      )}

      {projectOpen && !projectInfo && (
        <Button
          onClick={() => fetchInfoMutation.mutate()}
          disabled={fetchInfoMutation.isPending}
          className="gap-2"
        >
          {fetchInfoMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <SearchCode className="h-3.5 w-3.5" />
          )}
          Scan Project
        </Button>
      )}

      {/* Prerequisites */}
      {!bridgeOnline && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-300">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              <strong>Prerequisites:</strong>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                <li>
                  Start <span className="font-mono">PacForgeBridge{tiaVersion === "V18" ? ".V18" : ""}</span> on this machine
                </li>
                <li>Open TIA Portal {tiaVersion} with a project</li>
                <li>Click &quot;Check status&quot; then &quot;Scan Project&quot;</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* Project info card */}
      {projectInfo && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4">
          <div className="flex items-center gap-2 mb-3">
            <SearchCode className="h-4 w-4 text-green-400" />
            <span className="font-mono text-xs font-medium text-green-400">
              {projectInfo.project_name}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "TIA Version", value: projectInfo.tia_version },
              { label: "CPU", value: projectInfo.cpu_family },
              { label: "Order No.", value: projectInfo.cpu_order_number },
              { label: "Blocks", value: String(projectInfo.block_count) },
              { label: "UDTs", value: String(projectInfo.udt_count) },
              { label: "Tag Tables", value: String(projectInfo.tag_table_count) },
              { label: "HMI Screens", value: String(projectInfo.hmi_screen_count) },
              { label: "Devices", value: String(projectInfo.control_module_count) },
            ].map((item) => (
              <div key={item.label}>
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {item.label}
                </div>
                <div className="mt-0.5 font-mono text-xs text-foreground">
                  {item.value || "—"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Errors */}
      {(error || connectMutation.isError) && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 font-mono text-xs text-red-400">
          {error ??
            (connectMutation.error instanceof Error
              ? connectMutation.error.message
              : "Connection failed")}
        </div>
      )}

      {/* Proceed */}
      {canProceed && (
        <div className="flex justify-end">
          <Button onClick={handleProceed} className="gap-2">
            <ArrowRight className="h-3.5 w-3.5" />
            Proceed to Extract
          </Button>
        </div>
      )}
    </div>
  );
}
