import { useCallback, useRef, useState } from "react";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import type {
  ProvisionProjectRequest,
  ProvisionProjectResponse,
  IoModuleDto,
  IoTagDto,
} from "@/lib/tia-bridge-contract";
import type { ForgeHardwareConfig, ForgeIoEntry } from "@/types/forge";

const BRIDGE_BASE = DEFAULT_BRIDGE_CONFIG.baseUrl;

// ---------------------------------------------------------------------------
// Data mapping helpers
// ---------------------------------------------------------------------------

/** Map forge IoSignalType to TIA data type */
function signalTypeToDataType(signalType: string): string {
  switch (signalType) {
    case "DI": return "Bool";
    case "DO": return "Bool";
    case "AI": return "Word";
    case "AO": return "Word";
    default: return "Bool";
  }
}

/** Map forge IoSignalType to TIA address prefix */
function signalTypeToPrefix(signalType: string): string {
  switch (signalType) {
    case "DI": return "%I";
    case "DO": return "%Q";
    case "AI": return "%IW";
    case "AO": return "%QW";
    default: return "%I";
  }
}

/** Map ForgeHardwareConfig racks → IoModuleDto[] */
function buildIoModules(hardware: ForgeHardwareConfig): IoModuleDto[] {
  const modules: IoModuleDto[] = [];
  for (const rack of hardware.racks ?? []) {
    for (const mod of rack.modules ?? []) {
      if (mod.order_number) {
        modules.push({
          mlfb: mod.order_number,
          rack: rack.rack,
          slot: mod.slot,
          description: mod.module_type,
        });
      }
    }
  }
  return modules;
}

/** Map ForgeIoEntry[] → IoTagDto[] */
function buildIoTags(ioList: ForgeIoEntry[]): IoTagDto[] {
  return ioList
    .filter(io => io.tag_name && io.address)
    .map(io => ({
      name: io.tag_name,
      data_type: signalTypeToDataType(io.signal_type),
      logical_address: io.address.startsWith("%")
        ? io.address
        : `${signalTypeToPrefix(io.signal_type)}${io.address}`,
      comment: io.description || undefined,
    }));
}

// ---------------------------------------------------------------------------
// CPU order number lookup
// ---------------------------------------------------------------------------

const CPU_ORDER_NUMBERS: Record<string, string> = {
  "S7-1511":      "6ES7 511-1AK02-0AB0/V2.9",
  "S7-1512":      "6ES7 512-1DK01-0AB0/V2.9",
  "S7-1513":      "6ES7 513-1AL02-0AB0/V2.9",
  "S7-1515":      "6ES7 515-2AM02-0AB0/V2.9",
  "S7-1516":      "6ES7 516-3AN02-0AB0/V2.9",
  "S7-1517":      "6ES7 517-3AP00-0AB0/V2.9",
  "S7-1518":      "6ES7 518-4AP00-0AB0/V2.9",
  "S7-1500":      "6ES7 516-3AN02-0AB0/V2.9", // generic fallback → S7-1516
};

function cpuTypeToOrderNumber(cpuType: string): string | undefined {
  for (const [key, val] of Object.entries(CPU_ORDER_NUMBERS)) {
    if (cpuType.includes(key)) return val;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Progress step types
// ---------------------------------------------------------------------------

export interface ProvisionStep {
  label: string;
  progress: number;
  state: "pending" | "active" | "done" | "error";
}

export interface ProvisionStatus {
  phase: "idle" | "provisioning" | "done" | "error" | "skipped";
  created?: boolean;
  projectFilePath?: string;
  message?: string;
  warnings?: string[];
  /** Live steps from WS events */
  steps: ProvisionStep[];
  /** Provision ID used to correlate WS events */
  provisionId?: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useForgeProvision() {
  const [status, setStatus] = useState<ProvisionStatus>({ phase: "idle", steps: [] });
  const wsRef = useRef<WebSocket | null>(null);

  /** Open a WS connection and resolve when connected (or on error, so HTTP POST doesn't block forever) */
  function connectWs(provisionId: string): Promise<void> {
    return new Promise((resolve) => {
    if (wsRef.current) wsRef.current.close();
    const ws = new WebSocket(DEFAULT_BRIDGE_CONFIG.wsUrl);
    wsRef.current = ws;

    ws.onopen = () => resolve();
    ws.onerror = () => resolve(); // resolve anyway so the HTTP POST still fires

    ws.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data as string) as {
          type: string;
          data: { provision_id?: string; step?: string; progress?: number; complete?: boolean; failed?: boolean; error?: string };
        };
        if (parsed.type !== "provision_progress") return;
        if (parsed.data.provision_id !== provisionId) return;

        const { step = "", progress = 0, complete = false, failed = false } = parsed.data;
        setStatus(prev => {
          const steps = [...prev.steps];
          // Mark any previous active steps as done (unless already error)
          const updatedSteps = steps.map(s => s.state === "active" ? { ...s, state: "done" as const } : s);
          // Add new step
          const newStep: ProvisionStep = {
            label: step,
            progress,
            state: failed ? "error" : complete && progress >= 100 ? "done" : "active",
          };
          // Avoid duplicates by replacing if same label
          const existing = updatedSteps.findIndex(s => s.label === step);
          if (existing >= 0) {
            updatedSteps[existing] = newStep;
          } else {
            updatedSteps.push(newStep);
          }
          return { ...prev, steps: updatedSteps };
        });
      } catch {
        // Ignore
      }
    };

    ws.onclose = () => { wsRef.current = null; };
    }); // end Promise
  }

  function closeWs() {
    wsRef.current?.close();
    wsRef.current = null;
  }

  const provision = useCallback(async (
    tiaProjectPath: string,
    hardware: ForgeHardwareConfig,
    ioList: ForgeIoEntry[],
    projectName?: string,
  ): Promise<ProvisionProjectResponse | null> => {
    const provisionId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    setStatus({ phase: "provisioning", steps: [], provisionId });
    await connectWs(provisionId); // wait for WS handshake before HTTP POST so no events are missed

    const cpuOrderNumber =
      hardware.cpu_order_number ??
      cpuTypeToOrderNumber(hardware.cpu_type ?? "") ??
      undefined;

    const body: ProvisionProjectRequest = {
      tia_project_path: tiaProjectPath,
      project_name: projectName,
      cpu_order_number: cpuOrderNumber,
      provision_id: provisionId,
      io_modules: buildIoModules(hardware),
      io_tags: buildIoTags(ioList),
    };

    try {
      const resp = await fetch(`${BRIDGE_BASE}/tia/provision-project`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(600_000), // 10 min — TIA hardware compilation can take several minutes
      });

      const result: ProvisionProjectResponse = await resp.json();
      closeWs();

      if (result.success) {
        setStatus(prev => ({
          ...prev,
          phase: "done",
          created: result.created,
          projectFilePath: result.project_file_path,
          message: result.message,
          warnings: result.warnings,
        }));
      } else {
        setStatus(prev => ({ ...prev, phase: "error", message: result.message }));
      }

      return result;
    } catch (err) {
      closeWs();
      const msg = err instanceof Error ? err.message : String(err);
      const isOffline = msg.includes("Failed to fetch") || msg.includes("ECONNREFUSED") || msg.includes("network");
      const isTimeout = msg.includes("timed out") || msg.includes("TimeoutError");
      const displayMsg = isTimeout
        ? "TIA Portal is taking longer than expected. The project may still be compiling in the background — check TIA Portal directly."
        : msg;
      setStatus(prev => ({ ...prev, phase: isOffline ? "skipped" : "error", message: displayMsg }));
      return null;
    }
   
  }, []);

  const reset = useCallback(() => {
    closeWs();
    setStatus({ phase: "idle", steps: [] });
   
  }, []);

  return { provision, status, reset };
}
