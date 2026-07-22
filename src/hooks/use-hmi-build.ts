/**
 * useHmiBuild (G8-1) — load the confirmed FDS contract, run the deterministic
 * FDS → HMI compiler (G7), and optionally push the lowered spec to the bridge's
 * POST /tia/hmi/build. Pure derivation + one bridge call; no AI.
 */
import { useCallback, useState } from "react";
import { loadSpecContract } from "@/lib/spec-builder/contract";
import { buildHmiIr } from "@/lib/spec-builder/hmi/hmi-compiler";
import { buildHmiBridgeSpec } from "@/lib/spec-builder/hmi/hmi-bridge-spec";
import { renderHmiBuildPack } from "@/lib/spec-builder/hmi/hmi-build-pack";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import type { HmiIr } from "@/lib/spec-builder/hmi/hmi-ir";

const BRIDGE_BASE = DEFAULT_BRIDGE_CONFIG.baseUrl;

export interface HmiBuildRun {
  ir: HmiIr;
  spec: Record<string, unknown>;
  manualSteps: string[];
  buildPackMarkdown: string;
}

export interface HmiBridgeResult {
  ok: boolean;
  /** Raw bridge response (per-object log + created counts) or error text. */
  detail: unknown;
}

export function useHmiBuild() {
  const [generating, setGenerating] = useState(false);
  const [run, setRun] = useState<HmiBuildRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [bridgeResult, setBridgeResult] = useState<HmiBridgeResult | null>(null);

  const generate = useCallback(
    async (specProjectId: string, opts?: { connection?: string; projectName?: string }) => {
      setGenerating(true);
      setError(null);
      setBridgeResult(null);
      try {
        const contract = await loadSpecContract(specProjectId);
        const ir = buildHmiIr(contract);
        const { spec, manualSteps } = buildHmiBridgeSpec(ir, {
          connection: opts?.connection || undefined,
        });
        const buildPackMarkdown = renderHmiBuildPack(ir, {
          projectName: opts?.projectName,
          manualSteps,
        });
        const next: HmiBuildRun = { ir, spec, manualSteps, buildPackMarkdown };
        setRun(next);
        return next;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setGenerating(false);
      }
    },
    [],
  );

  /** POST the lowered spec to the bridge. TIA must be open with the target
   *  project; Openness edits are slow — long timeout, and an HTTP timeout does
   *  NOT mean the build failed (re-inspect to verify). */
  const buildInTia = useCallback(async (spec: Record<string, unknown>) => {
    setBuilding(true);
    setBridgeResult(null);
    try {
      const resp = await fetch(`${BRIDGE_BASE}/tia/hmi/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(spec),
      });
      const detail = await resp.json().catch(() => resp.statusText);
      const result: HmiBridgeResult = { ok: resp.ok, detail };
      setBridgeResult(result);
      return result;
    } catch (e) {
      const result: HmiBridgeResult = {
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      };
      setBridgeResult(result);
      return result;
    } finally {
      setBuilding(false);
    }
  }, []);

  return { generate, generating, run, error, buildInTia, building, bridgeResult };
}
