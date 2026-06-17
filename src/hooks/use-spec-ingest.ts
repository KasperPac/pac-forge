/**
 * React hook orchestrating DOCX ingest into a spec draft revision.
 *
 * Flow:
 *   1. `ingest(file)` → `ingestDocx(file)`.
 *   2. If deterministic → immediately create a `markup`-sourced draft via
 *      `create_draft_from_ingest`.
 *   3. If AI → park the draft in a Zustand slice and return; the caller
 *      (`spec-builder.tsx`) navigates to `/spec-builder/ingest-review` where
 *      the engineer confirms the hierarchy before a `foreign_ingest`-sourced
 *      draft is persisted.
 *   4. On error → surfaces via `error` + `progressStage: "error"`.
 *
 * This hook is deliberately thin — all non-trivial logic lives in
 * `src/lib/spec-builder/*-ingest*.ts`.
 */
import { useCallback, useState } from "react";
import { create } from "zustand";
import type { IngestResult, Warning } from "@/lib/spec-builder/docx-ingest";
import type { SpecContractV2, Hierarchy } from "@/types/spec-contract-v2";
import { ingestDocx } from "@/lib/spec-builder/docx-ingest";
import { useCreateDraftFromIngest } from "@/hooks/use-spec-revisions";
import type { SourceSection } from "@/lib/spec-builder/source-section-select";
import type { EmRequirement } from "@/lib/spec-builder/assemble-register-contract";
import type { InstrumentTag } from "@/types/spec-builder";
import { supabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Parked AI result store — the ingest-review route reads from here
// ---------------------------------------------------------------------------

interface ParkedAiIngest {
  specProjectId: string;
  draft: SpecContractV2;
  warnings: Warning[];
  sourceSections: SourceSection[];
  sourceFilename: string;
  emRequirements: EmRequirement[];
  /** True when the ingest seeded the hierarchy from the register (none existed). */
  seededHierarchy: boolean;
}

interface IngestReviewState {
  parked: ParkedAiIngest | null;
  park: (v: ParkedAiIngest) => void;
  clear: () => void;
}

export const useIngestReviewStore = create<IngestReviewState>((set) => ({
  parked: null,
  park: (v) => set({ parked: v }),
  clear: () => set({ parked: null }),
}));

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export type IngestProgressStage =
  | "idle"
  | "parsing"
  | "saving"
  | "awaiting_review"
  | "done"
  | "error";

export interface UseSpecIngestOptions {
  /** Called when a deterministic-path draft was committed. */
  onDraftCreated?: (revisionId: string) => void;
  /** Called when AI parse is done and review is required. */
  onReviewRequired?: () => void;
}

export function useSpecIngest(
  specProjectId: string | undefined,
  opts?: UseSpecIngestOptions,
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressStage, setProgressStage] = useState<IngestProgressStage>("idle");
  const [lastResult, setLastResult] = useState<IngestResult | null>(null);

  const createDraft = useCreateDraftFromIngest();
  const parkAi = useIngestReviewStore((s) => s.park);

  const ingest = useCallback(
    async (file: File) => {
      if (!specProjectId) {
        setError("No spec project selected");
        setProgressStage("error");
        return;
      }
      setLoading(true);
      setError(null);
      setProgressStage("parsing");

      try {
        // Register-aware ingest. The register/hierarchy is the source of truth
        // for structure + IO — the spec only layers behavior onto it.
        //  - If the project already has a confirmed hierarchy, map onto THAT
        //    (so bound requirements match the real module ids) and never touch it.
        //  - Otherwise seed the hierarchy deterministically from the register.
        const { data: reg } = await supabase
          .from("instrument_registers")
          .select("tags")
          .eq("spec_project_id", specProjectId)
          .eq("source", "upload")
          .maybeSingle();
        const registerTags = (reg?.tags ?? []) as InstrumentTag[];

        const { data: proj } = await supabase
          .from("spec_projects")
          .select("confirmed_units")
          .eq("id", specProjectId)
          .maybeSingle();
        const existing = proj?.confirmed_units as unknown[] | null | undefined;
        const existingUnits = Array.isArray(existing) && existing.length > 0
          ? (existing as Hierarchy["units"])
          : null;

        const result = await ingestDocx(file, registerTags, existingUnits);
        setLastResult(result);

        if (result.kind === "error") {
          setError(result.message);
          setProgressStage("error");
          return;
        }

        if (result.kind === "deterministic") {
          setProgressStage("saving");
          const rev = await createDraft.mutateAsync({
            specProjectId,
            tree: result.draft as unknown as Record<string, unknown>,
            source: "markup",
            parentRevisionId: result.parentRevisionId ?? null,
          });
          setProgressStage("done");
          opts?.onDraftCreated?.(rev.id);
          return;
        }

        // AI path — park for engineer confirmation
        parkAi({
          specProjectId,
          draft: result.draft,
          warnings: result.warnings,
          sourceSections: result.sourceSections,
          sourceFilename: result.sourceFilename,
          emRequirements: result.emRequirements,
          seededHierarchy: result.seededHierarchy,
        });
        setProgressStage("awaiting_review");
        opts?.onReviewRequired?.();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setProgressStage("error");
      } finally {
        setLoading(false);
      }
    },
    [specProjectId, createDraft, parkAi, opts],
  );

  return {
    ingest,
    loading,
    error,
    progressStage,
    lastResult,
  };
}
