/**
 * Deterministic conflict detection across prescriptive knowledge sources.
 *
 * Only scans sources that express prescriptive rules (Design Profiles,
 * Agent Knowledge Docs). Descriptive sources like correction patterns,
 * FB templates, and reference library sections are excluded because they
 * describe facts or past fixes, not mandates — scanning them produces
 * false positives.
 *
 * Detection strategy:
 * 1. Normalize prescriptive sources into comparable text blocks
 * 2. Extract "stance phrases" — what each source mandates or prohibits
 * 3. Flag when two sources take opposite stances on the same subject
 *    (e.g., "always prefix inputs with i_" vs "never prefix inputs")
 *
 * A "conflict" requires:
 * - Both sources mention the same subject/topic
 * - One source mandates it (positive) and another prohibits it (negative)
 *
 * Each conflict receives a confidence score (0.0–1.0) based on:
 * - Subject similarity (word overlap ratio)
 * - Indicator strength (how forceful the mandate/prohibition is)
 * - Subject specificity (longer, more precise subjects = higher confidence)
 *
 * Only conflicts with confidence >= 0.50 are returned.
 */

import type { PatternCandidate, DesignProfile, FbTemplate, AgentKnowledgeDoc, ReferenceLibrarySection } from "@/types";
import type { CorrectionType } from "@/types/pattern";
import type { KnowledgeSource, KnowledgePriorityOverride } from "./knowledge-priority";
import { resolveConflictWinner } from "./knowledge-priority";

export interface KnowledgeConflict {
  id: string;
  sourceA: {
    type: KnowledgeSource;
    id: string;
    label: string;
    excerpt: string;
  };
  sourceB: {
    type: KnowledgeSource;
    id: string;
    label: string;
    excerpt: string;
  };
  category: CorrectionType | "GENERAL";
  description: string;
  severity: "warning" | "error";
  /** Pre-computed winner based on overrides + default priority */
  defaultWinner: KnowledgeSource;
  /** Confidence score 0.0–1.0 based on subject similarity, indicator strength, specificity */
  confidence: number;
}

export interface ConflictDetectionContext {
  patterns: PatternCandidate[];
  designProfile?: DesignProfile;
  fbTemplates: FbTemplate[];
  agentKnowledgeDocs: AgentKnowledgeDoc[];
  referenceSections?: ReferenceLibrarySection[];
  overrides: KnowledgePriorityOverride[];
}

// --- Confidence thresholds ---

/** Minimum confidence to include a conflict in results. */
const MIN_CONFIDENCE = 0.50;

/** Minimum subject similarity for the pre-filter (loose gate to catch candidates). */
const MIN_SIMILARITY_PREFILTER = 0.30;

// --- Confidence weights ---

/** Weight for subject similarity in confidence score. */
const W_SIMILARITY = 0.50;
/** Weight for indicator strength in confidence score. */
const W_STRENGTH = 0.30;
/** Weight for subject specificity in confidence score. */
const W_SPECIFICITY = 0.20;

// --- Indicator strength maps ---

/** Strength of each positive indicator (0.0 = weak suggestion, 1.0 = absolute mandate). */
const POSITIVE_STRENGTH: Record<string, number> = {
  "always": 0.9, "must": 1.0, "shall": 0.95, "should": 0.6,
  "require": 0.9, "mandatory": 1.0, "use": 0.3, "prefix": 0.4,
  "include": 0.4, "add": 0.3, "ensure": 0.7, "apply": 0.5,
};

/** Strength of each negative indicator (0.0 = weak suggestion, 1.0 = absolute prohibition). */
const NEGATIVE_STRENGTH: Record<string, number> = {
  "never": 1.0, "don't": 0.7, "do not": 0.8, "must not": 1.0,
  "shall not": 0.95, "should not": 0.6, "avoid": 0.5,
  "no ": 0.4, "without": 0.3, "remove": 0.5, "exclude": 0.6,
  "not required": 0.4, "not necessary": 0.3, "unnecessary": 0.3,
  "don't use": 0.8, "do not use": 0.85,
  "no prefix": 0.6, "no suffix": 0.6,
};

/** Positive mandate indicators — the source says DO this. */
const POSITIVE_INDICATORS = Object.keys(POSITIVE_STRENGTH);

/** Negative mandate indicators — the source says DON'T do this. */
const NEGATIVE_INDICATORS = Object.keys(NEGATIVE_STRENGTH);

// --- Stance extraction ---

/**
 * A stance extracted from a source: a subject + whether the source
 * is for or against it.
 */
interface Stance {
  /** The subject phrase (lowercased, normalized) */
  subject: string;
  /** Whether the source mandates (true) or prohibits (false) this subject */
  positive: boolean;
  /** The original sentence containing this stance */
  sentence: string;
  /** Best-guess correction category */
  category: CorrectionType | "GENERAL";
  /** How forceful the mandate/prohibition is (0.0–1.0) */
  indicatorStrength: number;
}

/**
 * Subject keywords and the categories they belong to.
 */
const SUBJECT_CATEGORIES: Array<{ pattern: RegExp; category: CorrectionType }> = [
  { pattern: /\b(prefix|suffix|naming|camelcase|snake.?case|pascal.?case|convention|variable.?name)\b/i, category: "NAMING" },
  { pattern: /\b(timer|ton|tof|tp|t#|delay|pulse|pt\b)/i, category: "TIMING" },
  { pattern: /\b(state|case\b|machine|enum|transition|sequence|step)\b/i, category: "STATE_LOGIC" },
  { pattern: /\b(io|input|output|%[IQ]|address|tag|mapping)\b/i, category: "IO_MAPPING" },
  { pattern: /\b(safety|interlock|e.?stop|emergency|safeguard)\b/i, category: "SAFETY" },
  { pattern: /\b(alarm|reset|latch|acknowledge|fault)\b/i, category: "ALARM" },
];

function inferCategory(text: string): CorrectionType | "GENERAL" {
  for (const { pattern, category } of SUBJECT_CATEGORIES) {
    if (pattern.test(text)) return category;
  }
  return "GENERAL";
}

/**
 * Split text into sentences (handles common separators in teachings/docs).
 */
function splitSentences(text: string): string[] {
  // Split on periods, newlines, semicolons, bullet points
  return text
    .split(/(?:\.\s+|\n+|;\s*|(?:^|\n)\s*[-•*]\s*)/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 10); // Skip very short fragments
}

/**
 * Extract the "subject" from a sentence — what it's talking about.
 * Returns a normalized key that can be compared across sources.
 *
 * Strategy: find the noun phrase after the mandate verb.
 * "always prefix inputs with i_" → "prefix inputs"
 * "never use TON timers" → "use ton timers"
 * "do not include PT parameter" → "include pt parameter"
 */
function extractSubject(sentence: string): string | null {
  const lower = sentence.toLowerCase().trim();

  // Try to extract what comes after the mandate/prohibition word
  // Pattern: [mandate word] [subject phrase]
  const mandatePatterns = [
    // Negative first (longer patterns match first to avoid "use" matching inside "do not use")
    /(?:never|don't|do not|must not|shall not|should not|avoid)\s+(.{5,60})/i,
    /(?:no\s+)(.{3,60})/i,
    /(?:without)\s+(.{3,60})/i,
    /(?:not required|not necessary|unnecessary)\s*(?:to\s+)?(.{3,60})/i,
    // Positive
    /(?:always|must|shall|should|require)\s+(.{5,60})/i,
    /(?:ensure|make sure)\s+(?:that\s+)?(.{5,60})/i,
  ];

  for (const re of mandatePatterns) {
    const m = lower.match(re);
    if (m?.[1]) {
      // Clean up the extracted subject
      return m[1]
        .replace(/[.,;:!?]+$/, "") // trim trailing punctuation
        .replace(/\s+/g, " ")
        .trim();
    }
  }

  return null;
}

/**
 * Extract stances from a text — what it mandates and what it prohibits.
 */
function extractStances(text: string): Stance[] {
  const stances: Stance[] = [];
  const sentences = splitSentences(text);

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();

    // Determine if this sentence is positive or negative, and track the matched indicator
    let isNegative = false;
    let matchedIndicator = "";
    let strength = 0;

    for (const neg of NEGATIVE_INDICATORS) {
      if (lower.includes(neg)) {
        isNegative = true;
        matchedIndicator = neg;
        strength = NEGATIVE_STRENGTH[neg] ?? 0.5;
        break;
      }
    }

    let isPositive = false;
    if (!isNegative) {
      for (const pos of POSITIVE_INDICATORS) {
        if (lower.includes(pos)) {
          isPositive = true;
          matchedIndicator = pos;
          strength = POSITIVE_STRENGTH[pos] ?? 0.5;
          break;
        }
      }
    }

    // Skip sentences that don't express a clear stance
    if (!isPositive && !isNegative) continue;

    // Suppress lint warning for unused variable
    void matchedIndicator;

    // Extract the subject
    const subject = extractSubject(sentence);
    if (!subject) continue;

    const category = inferCategory(subject);

    stances.push({
      subject,
      positive: !isNegative,
      sentence,
      category,
      indicatorStrength: strength,
    });
  }

  return stances;
}

/**
 * Compute similarity between two subjects as a 0.0–1.0 score.
 * Uses word overlap ratio of the smaller set against the larger.
 */
function computeSubjectSimilarity(a: string, b: string): number {
  const aWords = new Set(a.split(/\s+/).filter((w) => w.length > 2));
  const bWords = new Set(b.split(/\s+/).filter((w) => w.length > 2));

  if (aWords.size === 0 || bWords.size === 0) return 0;

  // Count overlapping words
  let overlap = 0;
  const smaller = aWords.size <= bWords.size ? aWords : bWords;
  const larger = aWords.size <= bWords.size ? bWords : aWords;

  for (const word of smaller) {
    if (larger.has(word)) overlap++;
  }

  return overlap / smaller.size;
}

/**
 * Combine subject similarity, indicator strength, and subject specificity
 * into a single confidence score (0.0 to 1.0).
 */
function computeConfidence(
  subjectSimilarity: number,
  stanceA: Stance,
  stanceB: Stance,
): number {
  const avgStrength = (stanceA.indicatorStrength + stanceB.indicatorStrength) / 2;

  // Specificity: subjects with 5+ meaningful words are high specificity
  const avgWords = (
    stanceA.subject.split(/\s+/).filter((w) => w.length > 2).length +
    stanceB.subject.split(/\s+/).filter((w) => w.length > 2).length
  ) / 2;
  const specificity = Math.min(avgWords / 5, 1.0);

  return subjectSimilarity * W_SIMILARITY + avgStrength * W_STRENGTH + specificity * W_SPECIFICITY;
}

// --- Source normalization ---

interface NormalizedSource {
  type: KnowledgeSource;
  id: string;
  label: string;
  text: string;
  displayExcerpt: string;
}

/** Truncate text to a reasonable excerpt length. */
function excerpt(text: string, maxLen = 120): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen) + "...";
}

let conflictIdCounter = 0;

function nextConflictId(): string {
  conflictIdCounter++;
  return `conflict-${conflictIdCounter}`;
}

/**
 * Normalize knowledge sources into a flat list of comparable text blocks.
 *
 * Only sources that express **prescriptive rules** are scanned:
 * - Design Profile — user-written mandates and conventions
 * - Agent Knowledge Docs — may contain operational rules distributed by PM
 *
 * Sources NOT scanned (they don't express mandates):
 * - Correction Patterns — descriptive text about past fixes (WRONG/CORRECT pairs)
 * - FB Templates — structural descriptions, not prescriptive rules
 * - Reference Library — factual technical documentation
 */
function normalizeSources(ctx: ConflictDetectionContext): NormalizedSource[] {
  const sources: NormalizedSource[] = [];

  // Design Profile — prescriptive rules, scan for stances
  if (ctx.designProfile?.rules?.trim()) {
    sources.push({
      type: "DESIGN_PROFILE",
      id: ctx.designProfile.id,
      label: `Design Profile: ${ctx.designProfile.name}`,
      text: ctx.designProfile.rules,
      displayExcerpt: excerpt(ctx.designProfile.rules),
    });
  }

  // Agent Knowledge Docs — may contain operational rules, scan for stances
  for (const doc of ctx.agentKnowledgeDocs) {
    sources.push({
      type: "AGENT_KNOWLEDGE",
      id: doc.id,
      label: `Knowledge: ${doc.title}`,
      text: [doc.title, doc.content].join("\n"),
      displayExcerpt: excerpt(doc.content),
    });
  }

  return sources;
}

/**
 * Compute a stable fingerprint for a conflict, based on the two source excerpts.
 * Order-independent: (A, B) and (B, A) produce the same fingerprint.
 */
export function computeConflictFingerprint(conflict: KnowledgeConflict): string {
  const parts = [
    `${conflict.sourceA.type}:${conflict.sourceA.excerpt}`,
    `${conflict.sourceB.type}:${conflict.sourceB.excerpt}`,
  ].sort();
  const input = parts.join("|");
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return `cf-${Math.abs(hash).toString(36)}`;
}

/**
 * Detect conflicts across ALL knowledge sources.
 *
 * Strategy:
 * 1. Normalize every knowledge source into a text block
 * 2. Extract "stances" from each — what it mandates and what it prohibits
 * 3. Compare stances across all source pairs
 * 4. Flag when source A mandates something that source B prohibits (or vice versa)
 *    about the same subject
 * 5. Compute confidence score and filter to >= 50%
 * 6. Sort by confidence descending
 */
export function detectConflicts(ctx: ConflictDetectionContext): KnowledgeConflict[] {
  conflictIdCounter = 0;

  const sources = normalizeSources(ctx);
  const conflicts: KnowledgeConflict[] = [];

  // Extract stances for each source
  const sourceStances = sources.map((s) => ({
    source: s,
    stances: extractStances(s.text),
  }));

  // Track already-flagged pairs to avoid duplicates
  const flagged = new Set<string>();

  // Compare stances across every source pair
  for (let i = 0; i < sourceStances.length; i++) {
    for (let j = i + 1; j < sourceStances.length; j++) {
      const a = sourceStances[i];
      const b = sourceStances[j];

      for (const stanceA of a.stances) {
        for (const stanceB of b.stances) {
          // Skip if same polarity — both mandate or both prohibit
          if (stanceA.positive === stanceB.positive) continue;

          // Compute subject similarity (continuous score)
          const similarity = computeSubjectSimilarity(stanceA.subject, stanceB.subject);

          // Loose pre-filter — catch more candidates than the old binary 50% gate
          if (similarity < MIN_SIMILARITY_PREFILTER) continue;

          // Deduplicate — one conflict per source pair per subject
          const pairKey = [a.source.id, b.source.id].sort().join(":");
          const conflictKey = `${pairKey}:${stanceA.subject}`;
          if (flagged.has(conflictKey)) continue;
          flagged.add(conflictKey);

          // Compute full confidence score
          const confidence = computeConfidence(similarity, stanceA, stanceB);

          // Filter: only include if confidence meets threshold
          if (confidence < MIN_CONFIDENCE) continue;

          const category = stanceA.category !== "GENERAL" ? stanceA.category : stanceB.category;

          const winner = resolveConflictWinner(
            a.source.type,
            b.source.type,
            category,
            ctx.overrides,
          );

          // Higher severity when both are mandatory sources
          const mandatorySources: KnowledgeSource[] = [
            "DESIGN_PROFILE",
            "PLATFORM_RULES",
          ];
          const severity = mandatorySources.includes(a.source.type) && mandatorySources.includes(b.source.type)
            ? "error"
            : "warning";

          // Determine which is the positive and which is negative
          const positive = stanceA.positive ? stanceA : stanceB;
          const negative = stanceA.positive ? stanceB : stanceA;
          const posSource = stanceA.positive ? a.source : b.source;
          const negSource = stanceA.positive ? b.source : a.source;

          conflicts.push({
            id: nextConflictId(),
            sourceA: {
              type: posSource.type,
              id: posSource.id,
              label: posSource.label,
              excerpt: excerpt(positive.sentence),
            },
            sourceB: {
              type: negSource.type,
              id: negSource.id,
              label: negSource.label,
              excerpt: excerpt(negative.sentence),
            },
            category,
            description: `Contradictory guidance: "${posSource.label}" says to ${positive.subject}, but "${negSource.label}" says not to ${negative.subject}.`,
            severity,
            defaultWinner: winner,
            confidence,
          });
        }
      }
    }
  }

  // Sort by confidence descending — most certain conflicts first
  conflicts.sort((a, b) => b.confidence - a.confidence);

  return conflicts;
}
