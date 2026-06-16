// src/hooks/use-random-fds-generate.ts
/**
 * Hook for generating a random V2 FDS spec.
 *   Stage 1 — small AI theme call (names + prose).
 *   Stage 2 — fully deterministic V2 builder (assembleRandomFds).
 *
 * The hook is a thin wrapper around assembleRandomFds + the existing
 * mutation hooks. It does not own validator logic — the builder Zod-
 * parses every contract it produces, and writeSpecContract runs the
 * full structural validator before persisting.
 */
import { useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { callNonStreaming } from "@/hooks/use-generation";
import {
  useCreateSpecProject,
  useUpdateSpecProject,
  useDeleteSpecProject,
  useSaveInstrumentRegister,
} from "@/hooks/use-spec-projects";
import type { SpecProjectUpdate } from "@/types/spec-builder";
import { writeSpecContract } from "@/lib/spec-builder/contract";
import { supabase } from "@/lib/supabase";
import { buildRandomFdsThemePrompt } from "@/lib/spec-builder/random/theme-prompt";
import { RandomFdsThemeSchema } from "@/lib/spec-builder/random/theme-schema";
import { assembleRandomFds } from "@/lib/spec-builder/random/assemble";

export interface RandomFdsParams {
  units: number;
  equipment_modules: number;
  control_modules: number;
  projectId: string;
  projectNumber?: string;
  clientName?: string;
  onProgress?: (stage: string) => void;
}

function extractJson(raw: string): unknown {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/, "")
    .trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error(`No JSON object found in AI response (length: ${raw.length})`);
  }
  return JSON.parse(trimmed.slice(first, last + 1));
}

export function useRandomFdsGenerate() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const createSpec = useCreateSpecProject();
  const updateSpec = useUpdateSpecProject();
  const deleteSpec = useDeleteSpecProject();
  const saveRegister = useSaveInstrumentRegister();
  const queryClient = useQueryClient();

  const generate = useCallback(
    async (params: RandomFdsParams): Promise<string | null> => {
      setLoading(true);
      setError(null);
      abortRef.current = new AbortController();

      let createdSpecId: string | null = null;
      try {
        // Stage 1 — AI theme
        params.onProgress?.("Generating theme…");
        const prompt = buildRandomFdsThemePrompt({
          units: params.units,
          equipment_modules: params.equipment_modules,
          control_modules: params.control_modules,
        });
        const { content } = await callNonStreaming(
          prompt,
          [
            {
              role: "user",
              content: `Generate a theme for exactly ${params.units} units, ${params.equipment_modules} equipment_modules, ${params.control_modules} control_modules.`,
            },
          ],
          abortRef.current.signal,
          4096,
          { prompt_name: "random-fds-theme", agent_role: "design_engineer", pipeline_step: "random_fds_theme" },
        );

        const themeRaw = extractJson(content);
        const themeParse = RandomFdsThemeSchema.safeParse(themeRaw);
        if (!themeParse.success) {
          throw new Error(
            `Stage 1 theme failed schema validation:\n${themeParse.error.message}`,
          );
        }
        const theme = themeParse.data;

        // Create the spec row early so the project_id is stable for Stage 2 rows.
        params.onProgress?.("Creating spec…");
        const docCode = `RAND-${Date.now().toString(36).toUpperCase()}`;
        const spec = await createSpec.mutateAsync({
          project_id: params.projectId,
          doc_code: docCode,
          title: theme.title,
          client_name: params.clientName,
          project_number: params.projectNumber,
          plc_model: theme.plc_model,
          hmi_type: theme.hmi_type,
          system_description: theme.system_description,
          safety_classification: theme.safety_classification ?? undefined,
          fault_philosophy: theme.fault_philosophy,
          design_principles: theme.design_principles,
        });
        createdSpecId = spec.id;

        // Stage 2 — deterministic build
        params.onProgress?.("Building V2 spec…");
        const result = assembleRandomFds(theme, { projectId: spec.id });

        // Wizard-data + validator gate (throws ContractValidationError on failure)
        params.onProgress?.("Writing contract…");
        await writeSpecContract(spec.id, result.patch);

        // Mirror the projectFields onto the spec row so updateSpec invalidates the
        // wizard summary query keys the UI consumes. writeSpecContract already
        // persisted these JSONB columns; the cast bridges the V2 contract shapes
        // (looser `equipment_type: string`, `state_id: string|number`) onto the
        // legacy `UnitConfig` / `OperatingState` interfaces which is safe at
        // the DB layer (JSONB) and the migrate*() helpers on read.
        await updateSpec.mutateAsync({
          id: spec.id,
          confirmed_units: (result.patch.hierarchy?.units ?? []) as unknown as SpecProjectUpdate["confirmed_units"],
          confirmed_states: (result.patch.states ?? []) as unknown as SpecProjectUpdate["confirmed_states"],
          alarm_tiers: result.patch.alarm_tiers ?? [],
        });

        // Instrument register
        params.onProgress?.("Saving instrument register…");
        await saveRegister.mutateAsync({
          spec_project_id: spec.id,
          raw_filename: `${docCode}-random-fds.synthetic`,
          tags: result.instrumentRegister.tags,
          units: result.instrumentRegister.units,
          parse_warnings: [],
          haiku_usage: { input: 0, output: 0, total: 0 },
        });

        // Direct inserts for tables writeSpecContract does not route yet.
        params.onProgress?.("Seeding sessions + sections…");
        if (result.functionalDescriptionRows.length > 0) {
          await supabase
            .from("spec_sections")
            .delete()
            .eq("spec_project_id", spec.id)
            .eq("section_type", "functional_description");
          const { error: secErr } = await supabase
            .from("spec_sections")
            .insert(result.functionalDescriptionRows);
          if (secErr) throw new Error(`spec_sections insert: ${secErr.message}`);
        }
        if (result.equipment_moduleSessions.length > 0) {
          await supabase.from("fds_operation_sessions").delete().eq("spec_project_id", spec.id);
          const { error: sesErr } = await supabase
            .from("fds_operation_sessions")
            .insert(result.equipment_moduleSessions);
          if (sesErr) throw new Error(`fds_operation_sessions insert: ${sesErr.message}`);
        }
        if (result.unit_procedures.length > 0) {
          await supabase
            .from("fds_unit_procedures")
            .delete()
            .eq("spec_project_id", spec.id);
          const { error: orchErr } = await supabase
            .from("fds_unit_procedures")
            .insert(result.unit_procedures);
          if (orchErr) throw new Error(`fds_unit_procedures insert: ${orchErr.message}`);
        }

        queryClient.invalidateQueries({ queryKey: ["spec_sections", spec.id] });
        queryClient.invalidateQueries({ queryKey: ["fds_operation_sessions", spec.id] });
        queryClient.invalidateQueries({ queryKey: ["fds_unit_procedures", spec.id] });
        await queryClient.refetchQueries({
          queryKey: ["spec_projects", "by_project", params.projectId],
        });

        return spec.id;
      } catch (err) {
        const aborted = abortRef.current?.signal.aborted ?? false;
        if (!aborted) {
          const msg = err instanceof Error ? err.message : "Generation failed";
          console.error("[random-fds] generation failed:", err);
          setError(msg);
        }
        // Clean up orphan spec row on BOTH error and abort paths — otherwise
        // canceling after createSpec succeeded leaks rows on every click.
        if (createdSpecId) {
          try {
            await deleteSpec.mutateAsync({ id: createdSpecId, projectId: params.projectId });
          } catch (cleanupErr) {
            console.error("[random-fds] cleanup failed:", cleanupErr);
          }
        }
        return null;
      } finally {
        setLoading(false);
        abortRef.current = null;
      }
    },
    [createSpec, updateSpec, deleteSpec, saveRegister, queryClient],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { generate, loading, error, cancel };
}
