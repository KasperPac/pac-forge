import { useBridgeStatus } from "./use-tia-jobs";

export interface TiaVersionMismatch {
  mismatch: boolean;
  projectVersion: string | null;
  bridgeVersion: string | null;
  bridgeOnline: boolean;
}

/**
 * Compare a project's stored tia_version to the TIA Portal version detected by the bridge.
 * Returns `mismatch: true` only when both sides report a version and they differ.
 * When the bridge is offline or either version is unknown, `mismatch` is false —
 * guardrail should stay silent rather than shout about unknown state.
 */
export function useTiaVersionMismatch(projectVersion: string | null | undefined): TiaVersionMismatch {
  const { data: status } = useBridgeStatus();

  const bridgeVersion = status?.version ?? null;
  const bridgeOnline = status?.bridgeOnline ?? false;
  const normalizedProject = projectVersion?.trim() || null;

  const mismatch =
    bridgeOnline &&
    normalizedProject !== null &&
    bridgeVersion !== null &&
    normalizedProject !== bridgeVersion;

  return {
    mismatch,
    projectVersion: normalizedProject,
    bridgeVersion,
    bridgeOnline,
  };
}
