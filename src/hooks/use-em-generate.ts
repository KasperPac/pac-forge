import { useCallback, useState } from "react";
import type { EmSequence } from "@/lib/spec-builder/codegen/types";
import { writeEmArtifacts } from "@/lib/spec-builder/codegen";
import { parseRegions, replaceRegion } from "@/lib/spec-builder/codegen/em-fill-regions";
import {
  emFillBriefs,
  buildEmFillSystemPrompt,
  buildEmFillUserMessage,
} from "@/lib/spec-builder/em-fill-prompt";
import { callNonStreaming } from "./use-generation";

export interface EmFillResult {
  /** EM FB SCL with AI-filled regions where available, deterministic stubs everywhere else. */
  fbContent: string;
  /** Region ids that were replaced by AI output. */
  filledRegions: string[];
  warnings: string[];
}

/**
 * Deterministic skeleton + best-effort AI fill of SFC step bodies.
 * The returned FB ALWAYS compiles: on skip/failure the deterministic stubs are kept.
 */
export async function fillEmFb(seq: EmSequence, signal: AbortSignal): Promise<EmFillResult> {
  const { artifacts } = writeEmArtifacts(seq);
  const skeleton = artifacts[0].content; // artifacts[0] is the FB
  const briefs = emFillBriefs(seq);
  if (briefs.length === 0) {
    return { fbContent: skeleton, filledRegions: [], warnings: [] };
  }

  const validIds = new Set(briefs.map((b) => b.id));
  try {
    const { content } = await callNonStreaming(
      buildEmFillSystemPrompt(),
      [{ role: "user", content: buildEmFillUserMessage(seq, briefs) }],
      signal,
    );
    const regions = parseRegions(content);
    let fbContent = skeleton;
    const filledRegions: string[] = [];
    for (const [id, body] of regions) {
      if (!validIds.has(id)) continue; // ignore invented regions
      if (body.trim().length === 0) continue; // ignore empty bodies — keep stub
      fbContent = replaceRegion(fbContent, id, body);
      filledRegions.push(id);
    }
    return { fbContent, filledRegions, warnings: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      fbContent: skeleton,
      filledRegions: [],
      warnings: [`AI fill failed (${msg}); keeping deterministic stubs.`],
    };
  }
}

/** Thin React wrapper for the EM-layer UI (consumed in C2). */
export function useEmGenerate() {
  const [pending, setPending] = useState(false);
  const run = useCallback(async (seq: EmSequence): Promise<EmFillResult> => {
    const controller = new AbortController();
    setPending(true);
    try {
      return await fillEmFb(seq, controller.signal);
    } finally {
      setPending(false);
    }
  }, []);
  return { pending, run };
}
