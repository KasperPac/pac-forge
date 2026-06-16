/**
 * forge-spec-chunker.ts
 * Splits spec text into chunks based on survey extraction targets.
 * Uses text anchor matching with section-heading fallback.
 */

import type { SpecSurveyResult, SpecChunk, SpecExtractionTarget } from "@/types/forge";
import { splitIntoSections } from "@/lib/document-sections";

/** Overlap chars added before/after chunk boundaries for context */
const BOUNDARY_OVERLAP = 500;

/** Max chunk size — if a chunk exceeds this, it's too large but we still use it */
const MAX_CHUNK_CHARS = 60_000;

/**
 * Build text chunks from survey extraction targets.
 * Returns one SpecChunk per target. If anchor matching fails for >50% of targets,
 * returns a single chunk with the full text (triggers single-shot fallback).
 */
export function buildChunksFromSurvey(
  specText: string,
  survey: SpecSurveyResult,
): SpecChunk[] {
  const targets = survey.extraction_targets;
  if (targets.length === 0) {
    return [makeSingleChunk(specText, survey)];
  }

  const chunks: SpecChunk[] = [];
  let matchedCount = 0;

  for (const target of targets) {
    const chunk = extractChunkForTarget(specText, target, survey);
    if (chunk) {
      matchedCount++;
      chunks.push(chunk);
    }
  }

  // If less than half matched by anchors, try section-heading fallback
  if (matchedCount < targets.length * 0.5) {
    const fallbackChunks = fallbackToSections(specText, targets, survey);
    if (fallbackChunks.length >= targets.length * 0.5) {
      return fallbackChunks;
    }
    // Still too few — return single chunk for single-shot fallback
    return [makeSingleChunk(specText, survey)];
  }

  // Fill in any unmatched targets with section-based fallback
  const matchedIds = new Set(chunks.map((c) => c.targetId));
  for (const target of targets) {
    if (matchedIds.has(target.id)) continue;
    const fallback = fallbackSingleTarget(specText, target, survey);
    if (fallback) chunks.push(fallback);
  }

  return chunks;
}

/** Try to extract a chunk for a target using start/end anchor matching. */
function extractChunkForTarget(
  specText: string,
  target: SpecExtractionTarget,
  survey: SpecSurveyResult,
): SpecChunk | null {
  const lowerText = specText.toLowerCase();

  // Find start position from anchors
  let startPos = -1;
  for (const anchor of target.start_anchors) {
    const idx = lowerText.indexOf(anchor.toLowerCase());
    if (idx !== -1) {
      startPos = idx;
      break;
    }
  }
  if (startPos === -1) return null;

  // Find end position from anchors (search after start)
  let endPos = specText.length;
  for (const anchor of target.end_anchors) {
    const idx = lowerText.indexOf(anchor.toLowerCase(), startPos + 100);
    if (idx !== -1) {
      endPos = idx;
      break;
    }
  }

  // Apply overlap
  const chunkStart = Math.max(0, startPos - BOUNDARY_OVERLAP);
  const chunkEnd = Math.min(specText.length, endPos + BOUNDARY_OVERLAP);
  let text = specText.substring(chunkStart, chunkEnd);

  // Warn if chunk is very large but still use it
  if (text.length > MAX_CHUNK_CHARS) {
    text = text.substring(0, MAX_CHUNK_CHARS);
  }

  return {
    targetId: target.id,
    targetName: target.name,
    text,
    contextPreamble: buildPreamble(target, survey),
  };
}

/** Fallback: use section heading matching for all targets. */
function fallbackToSections(
  specText: string,
  targets: SpecExtractionTarget[],
  survey: SpecSurveyResult,
): SpecChunk[] {
  const sections = splitIntoSections(specText);
  const chunks: SpecChunk[] = [];

  for (const target of targets) {
    const matchedSections = sections.filter((s) => {
      const heading = s.heading.toLowerCase();
      const name = target.name.toLowerCase();
      const unit = target.unit.toLowerCase();
      return heading.includes(name) || heading.includes(unit) || name.includes(heading);
    });

    if (matchedSections.length > 0) {
      const text = matchedSections.map((s) => `## ${s.heading}\n${s.content}`).join("\n\n");
      chunks.push({
        targetId: target.id,
        targetName: target.name,
        text: text.length > MAX_CHUNK_CHARS ? text.substring(0, MAX_CHUNK_CHARS) : text,
        contextPreamble: buildPreamble(target, survey),
      });
    }
  }

  return chunks;
}

/** Fallback for a single unmatched target. */
function fallbackSingleTarget(
  specText: string,
  target: SpecExtractionTarget,
  survey: SpecSurveyResult,
): SpecChunk | null {
  const sections = splitIntoSections(specText);
  const matched = sections.filter((s) => {
    const heading = s.heading.toLowerCase();
    return heading.includes(target.name.toLowerCase()) || heading.includes(target.unit.toLowerCase());
  });

  if (matched.length === 0) return null;

  const text = matched.map((s) => `## ${s.heading}\n${s.content}`).join("\n\n");
  return {
    targetId: target.id,
    targetName: target.name,
    text: text.length > MAX_CHUNK_CHARS ? text.substring(0, MAX_CHUNK_CHARS) : text,
    contextPreamble: buildPreamble(target, survey),
  };
}

/** Create a single chunk containing the full spec (for fallback to single-shot). */
function makeSingleChunk(specText: string, survey: SpecSurveyResult): SpecChunk {
  return {
    targetId: "FULL",
    targetName: "Full Specification",
    text: specText,
    contextPreamble: `PROJECT: ${survey.project_name}\nEXTRACTING: Full specification (single-shot mode)`,
  };
}

/** Build context preamble injected before each chunk's text. */
function buildPreamble(target: SpecExtractionTarget, survey: SpecSurveyResult): string {
  const allTargetNames = survey.extraction_targets
    .filter((t) => t.id !== target.id)
    .map((t) => t.name);
  const cc = survey.cross_cutting_concerns;

  const lines = [
    `PROJECT: ${survey.project_name}`,
    `ALL SUBSYSTEMS: ${survey.extraction_targets.map((t) => t.unit).filter((v, i, a) => a.indexOf(v) === i).join(", ")}`,
    `YOU ARE EXTRACTING: ${target.name} (unit: ${target.unit})`,
    `EXPECTED DEVICES: ${target.expected_control_module_count}`,
    target.expected_sequences.length > 0
      ? `EXPECTED SEQUENCES: ${target.expected_sequences.join(", ")}`
      : null,
    target.extraction_notes ? `FOCUS: ${target.extraction_notes}` : null,
    "",
    "CROSS-CUTTING CONCERNS (include if mentioned in this section):",
    cc.safety_systems.length > 0 ? `  Safety: ${cc.safety_systems.join(", ")}` : null,
    cc.global_settings.length > 0 ? `  Global settings: ${cc.global_settings.join(", ")}` : null,
    cc.shared_interlocks.length > 0 ? `  Shared interlocks: ${cc.shared_interlocks.join(", ")}` : null,
    "",
    allTargetNames.length > 0
      ? `OTHER TARGETS (do NOT extract control_modules belonging to these): ${allTargetNames.join(", ")}`
      : null,
  ];

  return lines.filter(Boolean).join("\n");
}
