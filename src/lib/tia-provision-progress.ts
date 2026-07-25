/**
 * Provision progress over the bridge WebSocket (G9-W9).
 *
 * The bridge emits `provision_progress` events throughout ProvisionProject.
 * The accumulation rule lives in a pure reducer so it is unit-tested; the
 * socket wrapper stays thin.
 */
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";

export interface ProvisionStep {
  label: string;
  progress: number;
  state: "active" | "done" | "error";
}

export interface ProvisionProgressEvent {
  provision_id?: string;
  step?: string;
  progress?: number;
  complete?: boolean;
  failed?: boolean;
  error?: string;
}

/**
 * Fold one bridge event into the step list: a new label supersedes the
 * previously active step (which becomes done); a repeated label is updated in
 * place. Errored steps stay errored.
 */
export function applyProvisionEvent(
  steps: ProvisionStep[],
  evt: ProvisionProgressEvent,
): ProvisionStep[] {
  const { step = "", progress = 0, complete = false, failed = false } = evt;
  const next: ProvisionStep = {
    label: step,
    progress,
    state: failed ? "error" : complete && progress >= 100 ? "done" : "active",
  };
  const settled = steps.map((s) => (s.state === "active" ? { ...s, state: "done" as const } : s));
  const existing = settled.findIndex((s) => s.label === step);
  if (existing >= 0) {
    settled[existing] = next;
    return settled;
  }
  return [...settled, next];
}

/**
 * Open the bridge WS and stream this provision's steps. Resolves once the
 * socket is open **or** immediately on error, so a bridge with no WS still
 * lets the HTTP POST fire. Caller closes the returned socket.
 */
export function connectProvisionWs(
  provisionId: string,
  onSteps: (next: (prev: ProvisionStep[]) => ProvisionStep[]) => void,
): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(DEFAULT_BRIDGE_CONFIG.wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => resolve(ws); // resolve anyway so the POST still fires
    ws.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data as string) as {
          type: string;
          data: ProvisionProgressEvent;
        };
        if (parsed.type !== "provision_progress") return;
        if (parsed.data.provision_id !== provisionId) return;
        onSteps((prev) => applyProvisionEvent(prev, parsed.data));
      } catch {
        // Malformed frame — ignore; progress is advisory, the POST is truth.
      }
    };
  });
}
