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
}

export interface ConflictDetectionContext {
  patterns: PatternCandidate[];
  designProfile?: DesignProfile;
  fbTemplates: FbTemplate[];
  agentKnowledgeDocs: AgentKnowledgeDoc[];
  referenceSections?: ReferenceLibrarySection[];
  overrides: KnowledgePriorityOverride[];
}

// --- Stance extraction ---

/** Positive mandate indicators — the source says DO this. */
const POSITIVE_INDICATORS = [
  "always", "must", "shall", "should", "require", "mandatory",
  "use", "prefix", "include", "add", "ensure", "apply",
];

/** Negative mandate indicators — the source says DON'T do this. */
const NEGATIVE_INDICATORS = [
  "never", "don't", "do not", "must not", "shall not", "should not",
  "avoid", "no ", "without", "remove", "exclude", "not required",
  "not necessary", "unnecessary", "don't use", "do not use",
  "no prefix", "no suffix",
];

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

    // Determine if this sentence is positive or negative
    let isNegative = false;
    for (const neg of NEGATIVE_INDICATORS) {
      if (lower.includes(neg)) {
        isNegative = true;
        break;
      }
    }

    let isPositive = false;
    if (!isNegative) {
      for (const pos of POSITIVE_INDICATORS) {
        if (lower.includes(pos)) {
          isPositive = true;
          break;
        }
      }
    }

    // Skip sentences that don't express a clear stance
    if (!isPositive && !isNegative) continue;

    // Extract the subject
    const subject = extractSubject(sentence);
    if (!subject) continue;

    const category = inferCategory(subject);

    stances.push({
      subject,
      positive: !isNegative,
      sentence,
      category,
    });
  }

  return stances;
}

/**
 * Check if two subjects are similar enough to be about the same thing.
 * Uses word overlap — if >50% of the words in the shorter subject
 * appear in the longer one, they're about the same topic.
 */
function subjectsSimilar(a: string, b: string): boolean {
  const aWords = new Set(a.split(/\s+/).filter((w) => w.length > 2));
  const bWords = new Set(b.split(/\s+/).filter((w) => w.length > 2));

  if (aWords.size === 0 || bWords.size === 0) return false;

  // Count overlapping words
  let overlap = 0;
  const smaller = aWords.size <= bWords.size ? aWords : bWords;
  const larger = aWords.size <= bWords.size ? bWords : aWords;

  for (const word of smaller) {
    if (larger.has(word)) overlap++;
  }

  // Need >50% of the smaller set to overlap
  return overlap / smaller.size > 0.5;
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
 * Detect conflicts across ALL knowledge sources.
 *
 * Strategy:
 * 1. Normalize every knowledge source into a text block
 * 2. Extract "stances" from each — what it mandates and what it prohibits
 * 3. Compare stances across all source pairs
 * 4. Flag when source A mandates something that source B prohibits (or vice versa)
 *    about the same subject
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

          // Skip if subjects aren't similar
          if (!subjectsSimilar(stanceA.subject, stanceB.subject)) continue;

          // Deduplicate — one conflict per source pair per subject
          const pairKey = [a.source.id, b.source.id].sort().join(":");
          const conflictKey = `${pairKey}:${stanceA.subject}`;
          if (flagged.has(conflictKey)) continue;
          flagged.add(conflictKey);

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
          });
        }
      }
    }
  }

  return conflicts;
}
