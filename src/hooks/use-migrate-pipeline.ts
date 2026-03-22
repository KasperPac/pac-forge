import { useRef, useState } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import { useUpdateMigrationSession } from "@/hooks/use-migrate-session";
import { useCreatePatternCandidate, useActivePatterns } from "@/hooks/use-patterns";
import {
  buildMigrationAnalysisSystemPrompt,
  buildMigrationAnalysisUserMessage,
  buildMigrationTransformSystemPrompt,
  buildMigrationTransformUserMessage,
  buildMigrationSTLTransformSystemPrompt,
  buildMigrationSTLTransformUserMessage,
  buildMigrationReportSystemPrompt,
  buildMigrationReportUserMessage,
  ANALYSIS_BATCH_SIZE,
} from "@/lib/migrate-prompts";
import {
  buildMigrationCompileFixSystemPrompt,
  buildMigrationCompileFixUserMessage,
} from "@/lib/migrate-compile-fix-prompt";
import { getRelevantReferenceSections } from "@/lib/reference-lookup";
import { applyDeterministicTransforms, inferBlockType } from "@/lib/migrate-deterministic";
import type { MigrationSession, MigrationPlanStep, MigratedBlock } from "@/types";

export interface MigratePipelineState {
  running: boolean;
  currentBlockName: string | null;
  currentBlockDescription: string | null;
  scanProgress: number;
  totalBlocks: number;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Local SCL scanner — extracts block type + first comment (no AI call)
// ---------------------------------------------------------------------------

function scanBlockInfo(scl: string): { blockType: string; description: string } {
  const typePatterns: Array<[RegExp, string]> = [
    [/FUNCTION_BLOCK\s/i, "Function Block (FB)"],
    [/ORGANIZATION_BLOCK\s/i, "Organization Block (OB)"],
    [/DATA_BLOCK\s/i, "Data Block (DB)"],
    [/FUNCTION\s/i, "Function (FC)"],
    [/TYPE\s/i, "User Data Type (UDT)"],
  ];
  let blockType = "Block";
  for (const [pattern, label] of typePatterns) {
    if (pattern.test(scl)) { blockType = label; break; }
  }

  // First block comment (* ... *) or line comment // ...
  const blockComment = scl.match(/\(\*\s*([\s\S]*?)\s*\*\)/);
  const lineComment = scl.match(/\/\/\s*(.+)/);
  let description = blockComment
    ? blockComment[1].replace(/\s+/g, " ").trim().slice(0, 120)
    : lineComment
    ? lineComment[1].trim().slice(0, 120)
    : "";

  return { blockType, description };
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err)
    return String((err as { message: unknown }).message);
  return String(err);
}

/** One compile error entry as captured from the WebSocket/job poll */
export interface CompileErrorEntry {
  artifactName: string;
  errorText: string;
  line?: number | null;
  column?: number | null;
  severity?: "ERROR" | "WARNING" | "INFO";
}

/** Result returned by runCompileFix */
export interface CompileFixResult {
  fixedCount: number;
  patternsSaved: number;
  couldNotFix: string[];
}

/**
 * Salvage completed objects from a truncated JSON array.
 * e.g. `[{...}, {...}, {` → `[{...}, {...}]`
 */
function recoverPartialJsonArray(raw: string): unknown[] {
  // Find the last occurrence of `}` followed only by optional whitespace/commas up to the end
  const lastClose = raw.lastIndexOf("}");
  if (lastClose === -1) return [];
  const candidate = raw.slice(0, lastClose + 1).trimEnd();
  // Strip trailing comma then close the array
  const closed = candidate.replace(/,\s*$/, "") + "]";
  // Ensure it starts with `[`
  const normalized = closed.trimStart().startsWith("[") ? closed : "[" + closed;
  try {
    const parsed = JSON.parse(normalized) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function useMigratePipeline() {
  const abortRef = useRef<AbortController | null>(null);
  const updateSession = useUpdateMigrationSession();
  const createPattern = useCreatePatternCandidate();
  const { data: migrationPatterns } = useActivePatterns("SIEMENS_MIGRATION");

  const [state, setState] = useState<MigratePipelineState>({
    running: false,
    currentBlockName: null,
    currentBlockDescription: null,
    scanProgress: 0,
    totalBlocks: 0,
    error: null,
  });

  function abort() {
    abortRef.current?.abort();
  }

  // -------------------------------------------------------------------------
  // Analysis
  // -------------------------------------------------------------------------

  async function runAnalysis(session: MigrationSession): Promise<void> {
    const controller = new AbortController();
    abortRef.current = controller;

    // Pre-scan all blocks locally (instant — no API call)
    const blockInfos = Object.entries(session.source_blocks).map(([name, scl]) => {
      const { blockType, description } = scanBlockInfo(scl);
      return { name, blockType, description };
    });

    setState({
      running: true,
      currentBlockName: blockInfos[0]?.name ?? null,
      currentBlockDescription: null,
      scanProgress: 0,
      totalBlocks: blockInfos.length,
      error: null,
    });

    // Cycle through block names while the AI processes — stop at the end
    let scanIdx = 0;
    const intervalId = window.setInterval(() => {
      if (scanIdx >= blockInfos.length) {
        window.clearInterval(intervalId);
        setState((s) => ({
          ...s,
          currentBlockName: "Compiling migration plan…",
          currentBlockDescription: null,
          scanProgress: blockInfos.length,
        }));
        return;
      }
      const info = blockInfos[scanIdx];
      setState((s) => ({
        ...s,
        currentBlockName: info.name,
        currentBlockDescription: info.description
          ? `${info.blockType} — ${info.description}`
          : info.blockType,
        scanProgress: scanIdx + 1,
      }));
      scanIdx++;
    }, 220);

    try {
      // Stop the scan animation — switching to batch progress display
      window.clearInterval(intervalId);

      // One reference lookup shared across all batches (avoids per-batch bloat)
      setState((s) => ({ ...s, currentBlockName: "Looking up reference docs…", currentBlockDescription: null }));
      const refContext = `S7-300 S7-400 migration to S7-1500 TIA Portal: deprecated instructions, OB restructuring, timer counter syntax, block optimisation, symbolic addressing, communication blocks`;
      const referenceSections = await getRelevantReferenceSections(
        refContext,
        "generation_request",
        "SIEMENS_TIA",
        controller.signal,
        6,
        undefined,
        "SCL",
      );

      const systemPrompt = buildMigrationAnalysisSystemPrompt(referenceSections);

      // Split blocks into batches to stay within Edge Function compute limits
      const langs = session.source_block_languages ?? {};
      const allBlocks = Object.entries(session.source_blocks).map(([name, src]) => ({ name, src, lang: langs[name] }));
      const batches: Array<typeof allBlocks> = [];
      for (let i = 0; i < allBlocks.length; i += ANALYSIS_BATCH_SIZE) {
        batches.push(allBlocks.slice(i, i + ANALYSIS_BATCH_SIZE));
      }

      let completedBatches = 0;
      setState((s) => ({
        ...s,
        currentBlockName: `0 / ${batches.length} batches complete`,
        currentBlockDescription: `Analysing ${allBlocks.length} blocks in ${batches.length} parallel batches`,
        scanProgress: 0,
      }));

      const batchResults = await Promise.all(
        batches.map(async (batch, batchIdx) => {
          const userMessage = buildMigrationAnalysisUserMessage(batch, batchIdx, batches.length);
          const { content } = await callNonStreaming(
            systemPrompt,
            [{ role: "user", content: userMessage }],
            controller.signal,
            16384
          );

          const stripped = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
          let batchSteps: MigrationPlanStep[];
          try {
            const raw = JSON.parse(stripped) as unknown;
            if (!Array.isArray(raw)) throw new Error(`Batch ${batchIdx + 1} returned non-array`);
            batchSteps = raw as MigrationPlanStep[];
          } catch {
            // Response may be truncated mid-array — recover completed objects
            const recovered = recoverPartialJsonArray(stripped);
            if (recovered.length > 0) {
              console.warn(`Batch ${batchIdx + 1}: truncated JSON, recovered ${recovered.length} steps`);
              batchSteps = recovered as MigrationPlanStep[];
            } else {
              throw new Error(`Batch ${batchIdx + 1} returned invalid JSON: ${content.slice(0, 200)}`);
            }
          }

          completedBatches++;
          setState((s) => ({
            ...s,
            currentBlockName: `${completedBatches} / ${batches.length} batches complete`,
            scanProgress: Math.round((completedBatches / batches.length) * blockInfos.length),
          }));

          return { batchIdx, steps: batchSteps };
        })
      );

      // Re-order by original batch index and assign stable IDs
      const allPlanSteps: MigrationPlanStep[] = batchResults
        .sort((a, b) => a.batchIdx - b.batchIdx)
        .flatMap(({ steps }, i) =>
          steps.map((s, j) => ({ ...s, id: `step_${i * 1000 + j + 1}` }))
        );

      const plan = allPlanSteps;
      const breakingCount = plan.filter((s) => s.severity === "BREAKING").length;
      const warningCount = plan.filter((s) => s.severity === "WARNING").length;
      const infoCount = plan.filter((s) => s.severity === "INFO").length;
      const summary = `Found ${plan.length} migration items across ${Object.keys(session.source_blocks).length} blocks: ${breakingCount} BREAKING, ${warningCount} WARNING, ${infoCount} INFO.`;

      await updateSession.mutateAsync({
        id: session.id,
        updates: { migration_plan: plan, analysis_summary: summary, current_step: "approve_plan" },
      });
    } catch (err) {
      setState((s) => ({ ...s, error: extractErrorMessage(err) }));
      throw err;
    } finally {
      window.clearInterval(intervalId);
      setState((s) => ({ ...s, running: false, currentBlockName: null, currentBlockDescription: null }));
    }
  }

  // -------------------------------------------------------------------------
  // Transform — block by block
  // -------------------------------------------------------------------------

  async function runTransform(session: MigrationSession): Promise<void> {
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ running: true, currentBlockName: "Looking up reference docs…", currentBlockDescription: null, scanProgress: 0, totalBlocks: Object.keys(session.source_blocks).length, error: null });

    try {
      // One shared reference lookup for all blocks — avoids per-block AI call overhead
      const refContext = `S7-300 S7-400 migration to S7-1500: naming conventions, timer TON TOF TP, counter CTU CTD, symbolic addressing, block call syntax, data types TIME S5TIME`;
      const sharedRefSections = await getRelevantReferenceSections(
        refContext,
        "generation_request",
        "SIEMENS_TIA",
        controller.signal,
        8,
        undefined,
        "SCL",
      );
      const sharedSystemPrompt = buildMigrationTransformSystemPrompt(sharedRefSections, migrationPatterns ?? []);

      const results: MigratedBlock[] = [];
      let transformedCount = 0;
      const blockLangs = session.source_block_languages ?? {};

      // Lazily build STL system prompt only if needed
      let stlSystemPrompt: string | null = null;

      for (const [blockName, originalScl] of Object.entries(session.source_blocks)) {
        if (controller.signal.aborted) break;

        setState((s) => ({
          ...s,
          currentBlockName: blockName,
          currentBlockDescription: null,
          scanProgress: transformedCount,
        }));

        const blockLang = blockLangs[blockName] ?? "SCL";

        // ── LAD / FBD / GRAPH: cannot auto-convert — create placeholder with flag ──
        if (blockLang === "LAD" || blockLang === "FBD" || blockLang === "GRAPH") {
          const block: MigratedBlock = {
            name: blockName,
            block_type: inferBlockType(originalScl),
            original_scl: originalScl,
            migrated_scl: `(* Manual migration required — source language: ${blockLang} *)\n(* Re-implement this block in SCL or use the TIA Portal LAD editor in the target project *)`,
            approved: false,
            changes_applied: [],
            flagged_decisions: [
              {
                id: "flag_lad_1",
                location: "entire block",
                issue: `Block is written in ${blockLang} — automatic conversion to SCL is not supported. Manual re-implementation required in the target S7-1500 project.`,
                original_code: originalScl.slice(0, 500),
                proposed_solution: "Re-implement this block in the target TIA Portal project using the LAD editor or convert to SCL manually.",
                accepted: null,
              },
            ],
          };
          results.push(block);
          transformedCount++;
          setState((s) => ({ ...s, scanProgress: transformedCount }));
          continue;
        }

        // ── STL / AWL: AI converts to SCL ────────────────────────────────────
        if (blockLang === "STL") {
          if (!stlSystemPrompt) stlSystemPrompt = buildMigrationSTLTransformSystemPrompt();

          const userMessage = buildMigrationSTLTransformUserMessage(blockName, originalScl);
          let block: MigratedBlock;

          try {
            const { content } = await callNonStreaming(
              stlSystemPrompt,
              [{ role: "user", content: userMessage }],
              controller.signal,
              16384,
            );

            const stripped = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
            block = JSON.parse(stripped) as MigratedBlock;
            block.original_scl = originalScl;
            block.name = blockName;
          } catch {
            block = {
              name: blockName,
              block_type: inferBlockType(originalScl),
              original_scl: originalScl,
              migrated_scl: `(* STL→SCL conversion failed — manual conversion required *)\n${originalScl}`,
              approved: false,
              changes_applied: ["STL→SCL AI conversion failed"],
              flagged_decisions: [
                {
                  id: "flag_stl_1",
                  location: "entire block",
                  issue: "AI failed to parse or convert this STL block",
                  original_code: originalScl.slice(0, 500),
                  proposed_solution: "Manually convert STL to SCL in TIA Portal",
                  accepted: null,
                },
              ],
            };
          }

          results.push(block);
          transformedCount++;
          setState((s) => ({ ...s, scanProgress: transformedCount }));
          continue;
        }

        // ── SCL / DB: existing deterministic + AI path ───────────────────────
        const approvedSteps = session.migration_plan.filter(
          (s) => s.block_name === blockName && s.approved && !s.skipped,
        );

        // ── Step 1: deterministic transforms (timers, counters, S5TIME) ──────
        const {
          scl: detScl,
          changesApplied: detChanges,
          handledTypes,
          flaggedComments,
        } = applyDeterministicTransforms(originalScl, approvedSteps);

        // Steps the AI still needs to handle
        const remainingSteps = approvedSteps.filter(
          (s) => !handledTypes.includes(s.change_type),
        );

        // Flagged decisions from deterministic stage (e.g. active R pin)
        const deterministicFlags = flaggedComments.map((msg, i) => ({
          id: `det_flag_${i + 1}`,
          location: "deterministic transform",
          issue: msg,
          original_code: "",
          proposed_solution: "Handle reset logic manually — set IN := FALSE when reset required",
          accepted: null as null,
        }));

        let block: MigratedBlock;

        if (remainingSteps.length === 0) {
          // ── All steps handled deterministically — skip AI entirely ──────────
          block = {
            name: blockName,
            block_type: inferBlockType(detScl),
            original_scl: originalScl,
            migrated_scl: detScl,
            approved: false,
            changes_applied: detChanges,
            flagged_decisions: deterministicFlags,
          };
        } else {
          // ── Step 2: AI handles remaining steps on already-transformed SCL ──
          const userMessage = buildMigrationTransformUserMessage(
            blockName,
            detScl,
            session.migration_plan,
            handledTypes,
          );

          const { content } = await callNonStreaming(
            sharedSystemPrompt,
            [{ role: "user", content: userMessage }],
            controller.signal,
            16384,
          );

          const stripped = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
          try {
            block = JSON.parse(stripped) as MigratedBlock;
            block.original_scl = originalScl;
            block.name = blockName;
            // Merge deterministic changes + flags with AI result
            block.changes_applied = [...detChanges, ...(block.changes_applied ?? [])];
            block.flagged_decisions = [
              ...deterministicFlags,
              ...(block.flagged_decisions ?? []),
            ];
          } catch {
            block = {
              name: blockName,
              block_type: inferBlockType(detScl),
              original_scl: originalScl,
              migrated_scl: detScl,
              approved: false,
              changes_applied: [...detChanges, `AI parse error — deterministic changes preserved`],
              flagged_decisions: deterministicFlags,
            };
          }
        }

        results.push(block);
        transformedCount++;
        setState((s) => ({ ...s, scanProgress: transformedCount }));
      }

      const totalFlags = results.reduce((n, b) => n + (b.flagged_decisions?.length ?? 0), 0);
      // Stay on transform if there are flagged decisions requiring human review; otherwise go to compile
      await updateSession.mutateAsync({
        id: session.id,
        updates: {
          migrated_blocks: results,
          current_step: totalFlags > 0 ? "transform" : "compile",
        },
      });
    } finally {
      setState((s) => ({ ...s, running: false, currentBlockName: null }));
    }
  }

  // -------------------------------------------------------------------------
  // Report
  // -------------------------------------------------------------------------

  async function runReport(session: MigrationSession): Promise<void> {
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ running: true, currentBlockName: "Report Generation", currentBlockDescription: null, scanProgress: 0, totalBlocks: 0, error: null });

    try {
      const systemPrompt = buildMigrationReportSystemPrompt();
      const userMessage = buildMigrationReportUserMessage(session);

      const { content } = await callNonStreaming(
        systemPrompt,
        [{ role: "user", content: userMessage }],
        controller.signal,
        8192
      );

      await updateSession.mutateAsync({
        id: session.id,
        updates: {
          report_markdown: content,
          current_step: "report",
        },
      });
    } finally {
      setState((s) => ({ ...s, running: false, currentBlockName: null }));
    }
  }

  // -------------------------------------------------------------------------
  // Compile-fix loop — called manually after compile errors appear
  // -------------------------------------------------------------------------

  async function runCompileFix(
    session: MigrationSession,
    errors: CompileErrorEntry[],
  ): Promise<CompileFixResult> {
    const controller = new AbortController();
    abortRef.current = controller;

    setState((s) => ({
      ...s,
      running: true,
      currentBlockName: "Analysing compile errors…",
      currentBlockDescription: null,
      error: null,
    }));

    try {
      // Group errors by block name, formatting location info when available
      const errorsByBlock = new Map<string, string[]>();
      for (const { artifactName, errorText, line, column } of errors) {
        if (!errorsByBlock.has(artifactName)) errorsByBlock.set(artifactName, []);
        const location = line != null ? ` [line ${line}${column != null ? `:${column}` : ""}]` : "";
        errorsByBlock.get(artifactName)!.push(`${location} ${errorText}`.trim());
      }

      // Build blocks payload — only blocks that have errors AND migrated SCL
      const blocksToFix = Array.from(errorsByBlock.entries()).flatMap(([name, errs]) => {
        const block = session.migrated_blocks.find((b) => b.name === name);
        if (!block) return [];
        return [{ name, scl: block.migrated_scl, errors: errs }];
      });

      if (blocksToFix.length === 0) {
        return { fixedCount: 0, patternsSaved: 0, couldNotFix: [] };
      }

      setState((s) => ({
        ...s,
        currentBlockName: `Fixing ${blocksToFix.length} block(s)…`,
        totalBlocks: blocksToFix.length,
        scanProgress: 0,
      }));

      const systemPrompt = buildMigrationCompileFixSystemPrompt();
      const userMessage = buildMigrationCompileFixUserMessage(blocksToFix);

      const { content } = await callNonStreaming(
        systemPrompt,
        [{ role: "user", content: userMessage }],
        controller.signal,
        16384,
      );

      const stripped = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
      type FixEntry = {
        name: string;
        fixed_scl: string;
        corrections: Array<{
          error_fixed: string;
          change_made: string;
          original_snippet: string;
          fixed_snippet: string;
          correction_type: string;
        }>;
        could_not_fix: string[];
      };
      let fixEntries: FixEntry[];
      try {
        fixEntries = JSON.parse(stripped) as FixEntry[];
      } catch {
        throw new Error(`Compile-fix agent returned invalid JSON: ${content.slice(0, 200)}`);
      }

      // Apply fixes to session blocks
      const updatedBlocks = session.migrated_blocks.map((block) => {
        const fix = fixEntries.find((f) => f.name === block.name);
        if (!fix || !fix.fixed_scl) return block;
        return { ...block, migrated_scl: fix.fixed_scl };
      });

      await updateSession.mutateAsync({
        id: session.id,
        updates: { migrated_blocks: updatedBlocks },
      });

      // Save corrections as PENDING migration patterns (one per correction, not per block)
      let patternsSaved = 0;
      const couldNotFix: string[] = [];

      for (const fix of fixEntries) {
        couldNotFix.push(...(fix.could_not_fix ?? []));

        for (const correction of fix.corrections ?? []) {
          if (!correction.original_snippet || !correction.fixed_snippet) continue;
          if (correction.original_snippet.trim() === correction.fixed_snippet.trim()) continue;

          try {
            await createPattern.mutateAsync({
              plc_brand: "SIEMENS_MIGRATION",
              device_type: fix.name,
              context: `S7-300→S7-1500 compile fix: ${correction.error_fixed}`,
              original_snippet: correction.original_snippet,
              corrected_snippet: correction.fixed_snippet,
              correction_type: correction.correction_type ?? "OTHER",
              explanation_tag: correction.change_made,
            });
            patternsSaved++;
          } catch {
            // Non-fatal — pattern save failure shouldn't block the fix
          }
        }
      }

      setState((s) => ({ ...s, scanProgress: blocksToFix.length }));
      return { fixedCount: fixEntries.length, patternsSaved, couldNotFix };
    } catch (err) {
      setState((s) => ({ ...s, error: extractErrorMessage(err) }));
      throw err;
    } finally {
      setState((s) => ({ ...s, running: false, currentBlockName: null, currentBlockDescription: null }));
    }
  }

  return {
    ...state,
    runAnalysis,
    runTransform,
    runReport,
    runCompileFix,
    abort,
  };
}
