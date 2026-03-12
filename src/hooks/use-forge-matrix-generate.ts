import { useState, useCallback } from "react";
import { streamFromEdgeFunction } from "@/hooks/use-generation";
import {
  buildDeviceLinkagePrompt,
  buildDeviceLinkageUserMessage,
  buildSequencesPrompt,
  buildSequencesUserMessage,
} from "@/lib/forge-prompts";
import type { ForgeDeviceEntry, ForgeIoEntry, SpecAnalysis } from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";
import type { ProcessLinkageMatrix } from "@/types/process-builder";

const DEVICE_LINKAGE_MAX_TOKENS = 20000;
const SEQUENCES_MAX_TOKENS = 28000;

function tryParseJson<T>(text: string): T | null {
  try {
    const parsed = JSON.parse(text.trim());
    if (typeof parsed === "object" && parsed !== null) return parsed as T;
  } catch { /* fall through */ }
  return null;
}

function extractTaggedBlock(content: string, tag: string): string | null {
  const re = new RegExp(`\\[${tag}\\]\\s*([\\s\\S]*?)\\s*\\[\\/${tag}\\]`);
  const m = content.match(re);
  return m ? m[1] : null;
}

function extractJsonFromContent(content: string): string | null {
  // Try fenced code block first
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1];
  // Fall back to outermost JSON object
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start !== -1 && end > start) return content.slice(start, end + 1);
  return null;
}

function parseDeviceLinkage(content: string): Pick<ProcessLinkageMatrix, "deviceLinkage"> {
  const tagged = extractTaggedBlock(content, "DEVICE_LINKAGE");
  if (tagged) {
    const result = tryParseJson<Pick<ProcessLinkageMatrix, "deviceLinkage">>(tagged);
    if (result?.deviceLinkage) return result;
    throw new Error(`Device linkage JSON is invalid: ${tagged.slice(0, 200)}…`);
  }
  const raw = extractJsonFromContent(content);
  if (raw) {
    const result = tryParseJson<Pick<ProcessLinkageMatrix, "deviceLinkage">>(raw);
    if (result?.deviceLinkage) return result;
  }
  throw new Error(`Could not parse device linkage. Last 300: ${content.slice(-300)}`);
}

function parseSequences(content: string): Pick<ProcessLinkageMatrix, "processSequences" | "globalData" | "notes" | "generatedAt"> {
  const tagged = extractTaggedBlock(content, "SEQUENCES_DATA");
  if (tagged) {
    const result = tryParseJson<Pick<ProcessLinkageMatrix, "processSequences" | "globalData" | "notes" | "generatedAt">>(tagged);
    if (result?.processSequences) return result;
    throw new Error(`Sequences JSON is invalid: ${tagged.slice(0, 200)}…`);
  }
  const raw = extractJsonFromContent(content);
  if (raw) {
    const result = tryParseJson<Pick<ProcessLinkageMatrix, "processSequences" | "globalData" | "notes" | "generatedAt">>(raw);
    if (result?.processSequences) return result;
  }
  throw new Error(`Could not parse sequences. Last 300: ${content.slice(-300)}`);
}

/**
 * Hook to generate a ProcessLinkageMatrix from session data.
 * Runs two parallel AI calls (device linkage + sequences/global data) and merges results.
 */
export function useForgeMatrixGenerate() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(
    async (
      devices: ForgeDeviceEntry[],
      ioList: ForgeIoEntry[],
      specAnalysis: SpecAnalysis | null,
      fbTemplates?: FbTemplate[],
    ): Promise<ProcessLinkageMatrix> => {
      setLoading(true);
      setError(null);

      try {
        const [deviceContent, sequenceContent] = await Promise.all([
          streamFromEdgeFunction(
            {
              system_prompt: buildDeviceLinkagePrompt(),
              messages: [{ role: "user", content: buildDeviceLinkageUserMessage(devices, ioList, fbTemplates) }],
              stream: true,
            },
            new AbortController().signal,
            () => {},
            DEVICE_LINKAGE_MAX_TOKENS,
          ),
          streamFromEdgeFunction(
            {
              system_prompt: buildSequencesPrompt(),
              messages: [{ role: "user", content: buildSequencesUserMessage(devices, specAnalysis) }],
              stream: true,
            },
            new AbortController().signal,
            () => {},
            SEQUENCES_MAX_TOKENS,
          ),
        ]);

        const { deviceLinkage } = parseDeviceLinkage(deviceContent);
        const { processSequences, globalData, notes, generatedAt } = parseSequences(sequenceContent);

        return {
          version: 1,
          deviceLinkage,
          globalData: globalData ?? [],
          processSequences: processSequences ?? [],
          notes: notes ?? "",
          generatedAt: generatedAt ?? new Date().toISOString(),
          lastReviewedAt: null,
          reviewStatus: "draft",
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { generate, loading, error };
}
