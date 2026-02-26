/**
 * Deterministic conflict detection between knowledge sources.
 *
 * Runs before prompt assembly to flag contradictions between:
 * - Pattern vs Pattern (same category + device, different correction)
 * - Pattern vs Design Profile (keyword overlap with contradictory guidance)
 * - Pattern vs FB Template (structural contradiction for same device)
 * - Agent Knowledge vs Design Profile (keyword overlap)
 * - Agent Knowledge vs Pattern (keyword overlap with different guidance)
 * - Reference Library vs Design Profile (keyword overlap)
 * - Reference Library vs Pattern (keyword overlap with different guidance)
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

// --- SCL-specific vocabulary for keyword matching ---

const NAMING_TERMS = [
  "stat", "inst", "temp", "prefix", "suffix", "naming", "convention",
  "FB_", "FC_", "UDT_", "DB_", "iDB_", "OB_", "camelCase", "snake_case",
  "PascalCase", "lowercase", "uppercase",
];

const TIMER_TERMS = [
  "TON", "TOF", "TP", "TONR", "timer", "T#", "delay", "pulse",
  "IEC_Timer", "IEC_TIMER",
];

const STATE_TERMS = [
  "CASE", "state", "machine", "ELSE", "enum", "transition",
  "statState", "step", "sequence",
];

const IO_TERMS = [
  "%I", "%Q", "%M", "%IW", "%QW", "%MW", "io_mapping", "IO",
  "address", "tag", "input", "output",
];

const SAFETY_TERMS = [
  "interlock", "safety", "e-stop", "estop", "emergency", "fault",
  "safeguard", "F-",
];

const ALARM_TERMS = [
  "alarm", "reset", "latch", "acknowledge", "fault_handling",
];

/** Map correction types to their relevant term lists. */
const CATEGORY_TERMS: Record<string, string[]> = {
  NAMING: NAMING_TERMS,
  TIMING: TIMER_TERMS,
  STATE_LOGIC: STATE_TERMS,
  IO_MAPPING: IO_TERMS,
  SAFETY: SAFETY_TERMS,
  ALARM: ALARM_TERMS,
};

/**
 * Extract relevant terms from a text string, case-insensitive.
 * Returns the set of matched terms from our vocabulary.
 */
function extractTerms(text: string): Set<string> {
  const found = new Set<string>();
  const lower = text.toLowerCase();
  for (const terms of Object.values(CATEGORY_TERMS)) {
    for (const term of terms) {
      if (lower.includes(term.toLowerCase())) {
        found.add(term.toLowerCase());
      }
    }
  }
  return found;
}

/**
 * Determine which correction category a set of terms most aligns with.
 */
function inferCategory(terms: Set<string>): CorrectionType | null {
  let best: CorrectionType | null = null;
  let bestCount = 0;
  for (const [cat, catTerms] of Object.entries(CATEGORY_TERMS)) {
    let count = 0;
    for (const t of catTerms) {
      if (terms.has(t.toLowerCase())) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = cat as CorrectionType;
    }
  }
  return best;
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
 * Detect conflicts between all knowledge sources.
 */
export function detectConflicts(ctx: ConflictDetectionContext): KnowledgeConflict[] {
  // Reset ID counter for deterministic results
  conflictIdCounter = 0;

  const conflicts: KnowledgeConflict[] = [];

  // 1. Pattern vs Pattern — same (correction_type, device_type) but different corrections
  conflicts.push(...detectPatternVsPattern(ctx.patterns, ctx.overrides));

  // 2. Pattern vs Design Profile
  if (ctx.designProfile?.rules) {
    conflicts.push(...detectPatternVsDesignProfile(ctx.patterns, ctx.designProfile, ctx.overrides));
  }

  // 3. Pattern vs FB Template
  conflicts.push(...detectPatternVsFbTemplate(ctx.patterns, ctx.fbTemplates, ctx.overrides));

  // 4. Agent Knowledge vs Design Profile
  if (ctx.designProfile?.rules && ctx.agentKnowledgeDocs.length > 0) {
    conflicts.push(...detectKnowledgeVsDesignProfile(ctx.agentKnowledgeDocs, ctx.designProfile, ctx.overrides));
  }

  // 5. Agent Knowledge vs Pattern
  if (ctx.agentKnowledgeDocs.length > 0) {
    conflicts.push(...detectKnowledgeVsPattern(ctx.agentKnowledgeDocs, ctx.patterns, ctx.overrides));
  }

  // 6. Reference Library vs Design Profile
  const refSections = ctx.referenceSections ?? [];
  if (ctx.designProfile?.rules && refSections.length > 0) {
    conflicts.push(...detectRefLibraryVsDesignProfile(refSections, ctx.designProfile, ctx.overrides));
  }

  // 7. Reference Library vs Pattern
  if (refSections.length > 0) {
    conflicts.push(...detectRefLibraryVsPattern(refSections, ctx.patterns, ctx.overrides));
  }

  return conflicts;
}

/**
 * Two approved patterns with same correction_type + device_type but
 * meaningfully different corrected snippets.
 */
function detectPatternVsPattern(
  patterns: PatternCandidate[],
  overrides: KnowledgePriorityOverride[],
): KnowledgeConflict[] {
  const conflicts: KnowledgeConflict[] = [];
  const approved = patterns.filter((p) => p.status === "APPROVED");

  // Group by (correction_type, device_type)
  const groups = new Map<string, PatternCandidate[]>();
  for (const p of approved) {
    const key = `${p.correction_type}:${p.device_type}`;
    const group = groups.get(key) ?? [];
    group.push(p);
    groups.set(key, group);
  }

  for (const [, group] of groups) {
    if (group.length < 2) continue;

    // Compare each pair for contradictions
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];

        // Skip if both have empty corrected snippets
        if (!a.corrected_snippet && !b.corrected_snippet) continue;

        // If both have corrected snippets and they're meaningfully different
        if (a.corrected_snippet && b.corrected_snippet) {
          const aNorm = a.corrected_snippet.replace(/\s+/g, " ").trim().toLowerCase();
          const bNorm = b.corrected_snippet.replace(/\s+/g, " ").trim().toLowerCase();

          if (aNorm === bNorm) continue; // Same correction, no conflict

          // Check if the terms overlap significantly (same topic, different answer)
          const aTerms = extractTerms(a.corrected_snippet + " " + a.explanation_tag);
          const bTerms = extractTerms(b.corrected_snippet + " " + b.explanation_tag);
          const overlap = new Set([...aTerms].filter((t) => bTerms.has(t)));

          if (overlap.size < 2) continue; // Not enough overlap to be a real conflict

          const winner = resolveConflictWinner(
            "CORRECTION_PATTERN",
            "CORRECTION_PATTERN",
            a.correction_type,
            overrides,
          );

          conflicts.push({
            id: nextConflictId(),
            sourceA: {
              type: "CORRECTION_PATTERN",
              id: a.id,
              label: `Pattern: ${a.explanation_tag}`,
              excerpt: excerpt(a.corrected_snippet),
            },
            sourceB: {
              type: "CORRECTION_PATTERN",
              id: b.id,
              label: `Pattern: ${b.explanation_tag}`,
              excerpt: excerpt(b.corrected_snippet),
            },
            category: a.correction_type,
            description: `Two ${a.correction_type} patterns for ${a.device_type} devices give contradictory corrections.`,
            severity: "error",
            defaultWinner: winner,
          });
        }
      }
    }
  }

  return conflicts;
}

/**
 * A pattern's correction contradicts guidance in the design profile.
 */
function detectPatternVsDesignProfile(
  patterns: PatternCandidate[],
  profile: DesignProfile,
  overrides: KnowledgePriorityOverride[],
): KnowledgeConflict[] {
  const conflicts: KnowledgeConflict[] = [];
  const approved = patterns.filter((p) => p.status === "APPROVED");
  const profileTerms = extractTerms(profile.rules);

  if (profileTerms.size === 0) return conflicts;

  for (const pattern of approved) {
    const patternText = [
      pattern.explanation_tag,
      pattern.original_snippet,
      pattern.corrected_snippet,
    ].join(" ");
    const patternTerms = extractTerms(patternText);

    // Find overlapping terms
    const overlap = new Set([...patternTerms].filter((t) => profileTerms.has(t)));
    if (overlap.size < 2) continue;

    // Infer the conflict category from overlapping terms
    const category = inferCategory(overlap) ?? pattern.correction_type;

    // Find the profile text around the matching terms for the excerpt
    const profileRulesLower = profile.rules.toLowerCase();
    let profileExcerpt = "";
    for (const term of overlap) {
      const idx = profileRulesLower.indexOf(term);
      if (idx >= 0) {
        const start = Math.max(0, idx - 40);
        const end = Math.min(profile.rules.length, idx + term.length + 60);
        profileExcerpt = profile.rules.slice(start, end).replace(/\s+/g, " ").trim();
        break;
      }
    }

    const winner = resolveConflictWinner(
      "CORRECTION_PATTERN",
      "DESIGN_PROFILE",
      category,
      overrides,
    );

    conflicts.push({
      id: nextConflictId(),
      sourceA: {
        type: "CORRECTION_PATTERN",
        id: pattern.id,
        label: `Pattern: ${pattern.explanation_tag}`,
        excerpt: excerpt(pattern.corrected_snippet || pattern.explanation_tag),
      },
      sourceB: {
        type: "DESIGN_PROFILE",
        id: profile.id,
        label: `Design Profile: ${profile.name}`,
        excerpt: excerpt(profileExcerpt || profile.rules),
      },
      category,
      description: `Pattern (${pattern.correction_type}) may conflict with Design Profile "${profile.name}" on: ${[...overlap].join(", ")}.`,
      severity: "warning",
      defaultWinner: winner,
    });
  }

  return conflicts;
}

/**
 * A pattern's corrected code contradicts the structure of an FB template
 * for the same device category.
 */
function detectPatternVsFbTemplate(
  patterns: PatternCandidate[],
  templates: FbTemplate[],
  overrides: KnowledgePriorityOverride[],
): KnowledgeConflict[] {
  const conflicts: KnowledgeConflict[] = [];
  const approved = patterns.filter((p) => p.status === "APPROVED");

  for (const pattern of approved) {
    if (!pattern.corrected_snippet) continue;

    // Find templates matching the device type
    const matchingTemplates = templates.filter((t) => {
      const pDevice = pattern.device_type.toLowerCase();
      const tCategory = t.device_category.toLowerCase();
      return pDevice.includes(tCategory) || tCategory.includes(pDevice);
    });

    for (const template of matchingTemplates) {
      const patternTerms = extractTerms(pattern.corrected_snippet);
      const templateTerms = extractTerms(template.base_scl);

      const overlap = new Set([...patternTerms].filter((t) => templateTerms.has(t)));
      if (overlap.size < 2) continue;

      // Check for structural contradictions (different VAR sections, different patterns)
      const patternHasVar = /\bVAR(_TEMP|_INPUT|_OUTPUT|_IN_OUT)?\b/i.test(pattern.corrected_snippet);
      const templateHasVar = /\bVAR(_TEMP|_INPUT|_OUTPUT|_IN_OUT)?\b/i.test(template.base_scl);

      if (!patternHasVar || !templateHasVar) continue;

      const category = inferCategory(overlap) ?? pattern.correction_type;

      const winner = resolveConflictWinner(
        "CORRECTION_PATTERN",
        "FB_TEMPLATE",
        category,
        overrides,
      );

      conflicts.push({
        id: nextConflictId(),
        sourceA: {
          type: "CORRECTION_PATTERN",
          id: pattern.id,
          label: `Pattern: ${pattern.explanation_tag}`,
          excerpt: excerpt(pattern.corrected_snippet),
        },
        sourceB: {
          type: "FB_TEMPLATE",
          id: template.id,
          label: `Template: ${template.name} [${template.device_category}]`,
          excerpt: excerpt(template.base_scl),
        },
        category,
        description: `Pattern for ${pattern.device_type} may conflict with FB template "${template.name}" structure.`,
        severity: "warning",
        defaultWinner: winner,
      });
    }
  }

  return conflicts;
}

/**
 * Agent knowledge doc content contradicts design profile rules.
 */
function detectKnowledgeVsDesignProfile(
  docs: AgentKnowledgeDoc[],
  profile: DesignProfile,
  overrides: KnowledgePriorityOverride[],
): KnowledgeConflict[] {
  const conflicts: KnowledgeConflict[] = [];
  const profileTerms = extractTerms(profile.rules);

  if (profileTerms.size === 0) return conflicts;

  for (const doc of docs) {
    const docTerms = extractTerms(doc.title + " " + doc.content);
    const overlap = new Set([...docTerms].filter((t) => profileTerms.has(t)));

    if (overlap.size < 2) continue;

    const category = inferCategory(overlap) ?? "GENERAL";

    // Find excerpt from profile around the matching terms
    const profileRulesLower = profile.rules.toLowerCase();
    let profileExcerpt = "";
    for (const term of overlap) {
      const idx = profileRulesLower.indexOf(term);
      if (idx >= 0) {
        const start = Math.max(0, idx - 40);
        const end = Math.min(profile.rules.length, idx + term.length + 60);
        profileExcerpt = profile.rules.slice(start, end).replace(/\s+/g, " ").trim();
        break;
      }
    }

    const winner = resolveConflictWinner(
      "AGENT_KNOWLEDGE",
      "DESIGN_PROFILE",
      category,
      overrides,
    );

    conflicts.push({
      id: nextConflictId(),
      sourceA: {
        type: "AGENT_KNOWLEDGE",
        id: doc.id,
        label: `Knowledge: ${doc.title}`,
        excerpt: excerpt(doc.content),
      },
      sourceB: {
        type: "DESIGN_PROFILE",
        id: profile.id,
        label: `Design Profile: ${profile.name}`,
        excerpt: excerpt(profileExcerpt || profile.rules),
      },
      category,
      description: `Knowledge doc "${doc.title}" may conflict with Design Profile "${profile.name}" on: ${[...overlap].join(", ")}.`,
      severity: "warning",
      defaultWinner: winner,
    });
  }

  return conflicts;
}

/**
 * Agent knowledge doc content contradicts an approved correction pattern.
 */
function detectKnowledgeVsPattern(
  docs: AgentKnowledgeDoc[],
  patterns: PatternCandidate[],
  overrides: KnowledgePriorityOverride[],
): KnowledgeConflict[] {
  const conflicts: KnowledgeConflict[] = [];
  const approved = patterns.filter((p) => p.status === "APPROVED");

  for (const doc of docs) {
    const docTerms = extractTerms(doc.title + " " + doc.content);
    if (docTerms.size === 0) continue;

    for (const pattern of approved) {
      const patternText = [
        pattern.explanation_tag,
        pattern.original_snippet,
        pattern.corrected_snippet,
      ].join(" ");
      const patternTerms = extractTerms(patternText);

      const overlap = new Set([...docTerms].filter((t) => patternTerms.has(t)));
      if (overlap.size < 2) continue;

      const category = inferCategory(overlap) ?? pattern.correction_type;

      const winner = resolveConflictWinner(
        "AGENT_KNOWLEDGE",
        "CORRECTION_PATTERN",
        category,
        overrides,
      );

      conflicts.push({
        id: nextConflictId(),
        sourceA: {
          type: "AGENT_KNOWLEDGE",
          id: doc.id,
          label: `Knowledge: ${doc.title}`,
          excerpt: excerpt(doc.content),
        },
        sourceB: {
          type: "CORRECTION_PATTERN",
          id: pattern.id,
          label: `Pattern: ${pattern.explanation_tag}`,
          excerpt: excerpt(pattern.corrected_snippet || pattern.explanation_tag),
        },
        category,
        description: `Knowledge doc "${doc.title}" may conflict with ${pattern.correction_type} pattern on: ${[...overlap].join(", ")}.`,
        severity: "warning",
        defaultWinner: winner,
      });
    }
  }

  return conflicts;
}

/**
 * Reference library section content contradicts design profile rules.
 */
function detectRefLibraryVsDesignProfile(
  sections: ReferenceLibrarySection[],
  profile: DesignProfile,
  overrides: KnowledgePriorityOverride[],
): KnowledgeConflict[] {
  const conflicts: KnowledgeConflict[] = [];
  const profileTerms = extractTerms(profile.rules);

  if (profileTerms.size === 0) return conflicts;

  for (const section of sections) {
    const sectionTerms = extractTerms(section.heading + " " + section.content);
    const overlap = new Set([...sectionTerms].filter((t) => profileTerms.has(t)));

    if (overlap.size < 2) continue;

    const category = inferCategory(overlap) ?? "GENERAL";

    const profileRulesLower = profile.rules.toLowerCase();
    let profileExcerpt = "";
    for (const term of overlap) {
      const idx = profileRulesLower.indexOf(term);
      if (idx >= 0) {
        const start = Math.max(0, idx - 40);
        const end = Math.min(profile.rules.length, idx + term.length + 60);
        profileExcerpt = profile.rules.slice(start, end).replace(/\s+/g, " ").trim();
        break;
      }
    }

    const winner = resolveConflictWinner(
      "REFERENCE_LIBRARY",
      "DESIGN_PROFILE",
      category,
      overrides,
    );

    conflicts.push({
      id: nextConflictId(),
      sourceA: {
        type: "REFERENCE_LIBRARY",
        id: section.id,
        label: `Ref: ${section.heading}`,
        excerpt: excerpt(section.content),
      },
      sourceB: {
        type: "DESIGN_PROFILE",
        id: profile.id,
        label: `Design Profile: ${profile.name}`,
        excerpt: excerpt(profileExcerpt || profile.rules),
      },
      category,
      description: `Reference section "${section.heading}" may conflict with Design Profile "${profile.name}" on: ${[...overlap].join(", ")}.`,
      severity: "warning",
      defaultWinner: winner,
    });
  }

  return conflicts;
}

/**
 * Reference library section content contradicts an approved correction pattern.
 */
function detectRefLibraryVsPattern(
  sections: ReferenceLibrarySection[],
  patterns: PatternCandidate[],
  overrides: KnowledgePriorityOverride[],
): KnowledgeConflict[] {
  const conflicts: KnowledgeConflict[] = [];
  const approved = patterns.filter((p) => p.status === "APPROVED");

  for (const section of sections) {
    const sectionTerms = extractTerms(section.heading + " " + section.content);
    if (sectionTerms.size === 0) continue;

    for (const pattern of approved) {
      const patternText = [
        pattern.explanation_tag,
        pattern.original_snippet,
        pattern.corrected_snippet,
      ].join(" ");
      const patternTerms = extractTerms(patternText);

      const overlap = new Set([...sectionTerms].filter((t) => patternTerms.has(t)));
      if (overlap.size < 2) continue;

      const category = inferCategory(overlap) ?? pattern.correction_type;

      const winner = resolveConflictWinner(
        "REFERENCE_LIBRARY",
        "CORRECTION_PATTERN",
        category,
        overrides,
      );

      conflicts.push({
        id: nextConflictId(),
        sourceA: {
          type: "REFERENCE_LIBRARY",
          id: section.id,
          label: `Ref: ${section.heading}`,
          excerpt: excerpt(section.content),
        },
        sourceB: {
          type: "CORRECTION_PATTERN",
          id: pattern.id,
          label: `Pattern: ${pattern.explanation_tag}`,
          excerpt: excerpt(pattern.corrected_snippet || pattern.explanation_tag),
        },
        category,
        description: `Reference section "${section.heading}" may conflict with ${pattern.correction_type} pattern on: ${[...overlap].join(", ")}.`,
        severity: "warning",
        defaultWinner: winner,
      });
    }
  }

  return conflicts;
}
