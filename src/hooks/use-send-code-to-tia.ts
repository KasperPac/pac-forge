/**
 * useSendCodeToTia — assemble the FULL generated program (all layers, with
 * any Code Builder edits overlaid) into the bridge's reimport-compile
 * sources map, in dependency order (UDT → FB → FC → DB → OB). The bridge
 * deletes + reimports each block, then compiles everything; TIA must be
 * OFFLINE and open with the target project.
 */
import { useCallback, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { loadSpecContract } from "@/lib/spec-builder/contract";
import { compileContract } from "@/lib/spec-builder/codegen";
import { deriveIoTags, IO_TAG_TABLE_NAME } from "@/lib/spec-builder/codegen/io-tag-table";
import { carryOverCustomRegions, loadPriorEditsSupabase } from "@/lib/spec-builder/custom-region-carryover";
import {
  cpuOrderNumberFromHardware,
  ioModulesFromHardware,
  ioTagsFromMigrationTags,
} from "@/lib/spec-builder/tia-provision-inputs";
import { connectProvisionWs, type ProvisionStep } from "@/lib/tia-provision-progress";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import type {
  CreateMigrationTagsResponse,
  IoModuleDto,
  MigrationTagDto,
  ProvisionProjectRequest,
  ProvisionProjectResponse,
} from "@/lib/tia-bridge-contract";
import { useFbTemplates } from "@/hooks/use-fb-templates";
import { useReimportCompile } from "@/hooks/use-reimport-compile";

const TYPE_ORDER: Record<string, number> = { UDT: 0, FB: 1, FC: 2, DB: 3, OB: 4 };

/** What a fresh-project build needs from the FDS's hardware model (G9-W9). */
export interface ProvisionInputs {
  /** undefined ⇒ no CPU resolvable; the fresh build must stay disabled. */
  cpuOrderNumber?: string;
  ioModules: IoModuleDto[];
  /** module_type of modules with no order number — reported, not plugged. */
  missingOrderNumbers: string[];
}

export interface CodeSendPlan {
  /** name → SCL, insertion-ordered for import (UDTs first, OB last). */
  sources: Record<string, string>;
  /** name → folder path, omitted for artifacts that live in the root
   *  "Program blocks" folder (G5-4). */
  folders: Record<string, string>;
  countsByType: Record<string, number>;
  /** Block names whose content is a Code Builder edit, not raw generation. */
  editedBlocks: string[];
  /** Physical IO tags to create in TIA before import (G9-W4). */
  ioTags: MigrationTagDto[];
  /** Fresh-project build inputs derived from contract.hardware (G9-W9). */
  provision: ProvisionInputs;
  warnings: string[];
}

/** Create the plan's IO tags in TIA's tag table before importing sources. */
async function createIoTags(tags: MigrationTagDto[]): Promise<CreateMigrationTagsResponse> {
  const response = await fetch(`${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/migration/create-tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tags, tableName: IO_TAG_TABLE_NAME }),
    // Per-tag Openness cost adds up on IO-heavy projects (G9-W5 margin).
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`IO tag creation failed (${response.status}): ${body}`);
  }
  return (await response.json()) as CreateMigrationTagsResponse;
}

export function useSendCodeToTia(specId: string | undefined, revision: number | undefined) {
  const { data: templates = [] } = useFbTemplates();
  const reimport = useReimportCompile();
  const [plan, setPlan] = useState<CodeSendPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildPlan = useCallback(async (): Promise<CodeSendPlan> => {
    if (!specId || revision === undefined) throw new Error("spec/revision not ready");
    setPlanning(true);
    setError(null);
    try {
      const contract = await loadSpecContract(specId);
      const result = compileContract(contract, templates);
      const { data: rows, error: dbError } = await supabase
        .from("code_builder_artifacts")
        .select("artifact_name, edited_content")
        .eq("spec_id", specId)
        .eq("revision", revision);
      if (dbError) throw dbError;
      const edits = new Map(
        (rows ?? [])
          .filter((r) => r.edited_content)
          .map((r) => [r.artifact_name as string, r.edited_content as string]),
      );

      // G5-4 §3: a Process FC without a current-revision edit may still have
      // a prior revision's hand-authored custom region — carry it forward so
      // it ships in `sources`, not just the fresh (region-blanked) generation.
      const carryOver = await carryOverCustomRegions(
        result.artifacts.map((a) => ({ name: a.name, content: a.content })),
        specId, revision, loadPriorEditsSupabase,
      );
      for (const [name, content] of carryOver.contents) {
        if (!edits.has(name)) edits.set(name, content);
      }

      const sorted = [...result.artifacts].sort(
        (a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9),
      );
      const sources: Record<string, string> = {};
      const folders: Record<string, string> = {};
      const countsByType: Record<string, number> = {};
      const editedBlocks: string[] = [];
      for (const a of sorted) {
        const edited = edits.get(a.name);
        sources[a.name] = edited ?? a.content;
        if (a.folder && a.folder !== "Program blocks") folders[a.name] = a.folder;
        if (edited) editedBlocks.push(a.name);
        countsByType[a.type] = (countsByType[a.type] ?? 0) + 1;
      }
      const ioTagDerivation = deriveIoTags(contract);
      const provisionIo = ioModulesFromHardware(contract.hardware);
      const provisionWarnings = provisionIo.missingOrderNumbers.length
        ? [
            `Hardware: ${provisionIo.missingOrderNumbers.join(", ")} have no order number and cannot be plugged into a fresh project.`,
          ]
        : [];
      const next: CodeSendPlan = {
        sources,
        folders,
        countsByType,
        editedBlocks,
        ioTags: ioTagDerivation.tags,
        provision: {
          cpuOrderNumber: cpuOrderNumberFromHardware(contract.hardware),
          ioModules: provisionIo.modules,
          missingOrderNumbers: provisionIo.missingOrderNumbers,
        },
        warnings: [
          ...result.warnings,
          ...ioTagDerivation.warnings,
          ...carryOver.warnings,
          ...provisionWarnings,
        ],
      };
      setPlan(next);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setPlanning(false);
    }
  }, [specId, revision, templates]);

  const [creatingTags, setCreatingTags] = useState(false);
  const [tagResult, setTagResult] = useState<CreateMigrationTagsResponse | null>(null);

  const [provisioning, setProvisioning] = useState(false);
  const [provisionSteps, setProvisionSteps] = useState<ProvisionStep[]>([]);
  const [provisionResult, setProvisionResult] = useState<ProvisionProjectResponse | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  /**
   * Build a NEW TIA project (hardware + program) from the FDS in one bridge
   * call. Unlike `send`, this needs no open project — the bridge creates it.
   */
  const provisionFresh = useCallback(
    async (
      sendPlan: CodeSendPlan,
      opts: { projectPath: string; projectName: string },
    ): Promise<ProvisionProjectResponse | null> => {
      setProvisioning(true);
      setProvisionSteps([]);
      setProvisionResult(null);
      setError(null);

      const provisionId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
      // Connect before the POST so no early progress events are missed.
      wsRef.current = await connectProvisionWs(provisionId, (next) => setProvisionSteps(next));

      const body: ProvisionProjectRequest = {
        tia_project_path: opts.projectPath,
        project_name: opts.projectName,
        cpu_order_number: sendPlan.provision.cpuOrderNumber,
        provision_id: provisionId,
        io_modules: sendPlan.provision.ioModules,
        io_tags: ioTagsFromMigrationTags(sendPlan.ioTags),
        sources: sendPlan.sources,
        // `sources` is insertion-ordered UDT → FB → FC → DB → OB (buildPlan).
        import_order: Object.keys(sendPlan.sources),
      };

      try {
        const response = await fetch(`${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/provision-project`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          // Creating hardware + importing a full program + compiling runs to
          // minutes on Openness; matches the reimport path's ceiling.
          signal: AbortSignal.timeout(600_000),
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Fresh project build failed (${response.status}): ${text}`);
        }
        const result = (await response.json()) as ProvisionProjectResponse;
        setProvisionResult(result);
        if (!result.success) setError(result.message);
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(
          msg.includes("timed out") || msg.includes("TimeoutError")
            ? "TIA Portal is taking longer than expected. The project may still be building — check TIA Portal directly."
            : msg.startsWith("Fresh project build failed")
              ? msg
              : `Fresh project build failed: ${msg}`,
        );
        return null;
      } finally {
        wsRef.current?.close();
        wsRef.current = null;
        setProvisioning(false);
      }
    },
    [],
  );

  const send = useCallback(
    async (sendPlan: CodeSendPlan) => {
      // G9-W4: physical IO tags must exist before the blocks that reference
      // them compile. A failure here aborts the send — importing without the
      // tags would fail compile on every physical IO access anyway.
      if (sendPlan.ioTags.length > 0) {
        setCreatingTags(true);
        setTagResult(null);
        try {
          setTagResult(await createIoTags(sendPlan.ioTags));
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          return null;
        } finally {
          setCreatingTags(false);
        }
      }
      // Reimport errors surface via reimport.error (sendError) — swallow the
      // rejection so the fire-and-forget onClick has no unhandled promise.
      return reimport
        .mutateAsync({ sources: sendPlan.sources, folders: sendPlan.folders })
        .catch(() => null);
    },
    [reimport],
  );

  return {
    buildPlan,
    plan,
    planning,
    error,
    send,
    sending: creatingTags || reimport.isPending,
    tagResult,
    compileResult: reimport.data ?? null,
    sendError: reimport.error ? String(reimport.error) : null,
    provisionFresh,
    provisioning,
    provisionSteps,
    provisionResult,
  };
}
