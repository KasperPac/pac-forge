/**
 * Knowledge source priority system.
 *
 * Defines the hierarchy of knowledge sources injected into AI generation prompts.
 * Higher priority (lower number) wins when two sources conflict.
 */

export const KNOWLEDGE_SOURCES = {
  PLATFORM_RULES: {
    priority: 1,
    label: "Platform Rules",
    description: "Foundational SCL/TIA rules — immutable baseline for all code generation.",
  },
  DESIGN_PROFILE: {
    priority: 2,
    label: "Design Profile",
    description: "Customer-specific code standards scoped to a project.",
  },
  CORRECTION_PATTERN: {
    priority: 3,
    label: "Correction Pattern",
    description: "Structured WRONG/CORRECT pairs learned from real compile failures.",
  },
  FB_TEMPLATE: {
    priority: 4,
    label: "FB Template",
    description: "Company-standard function block templates used as structural starting points.",
  },
  AGENT_KNOWLEDGE: {
    priority: 5,
    label: "Agent Knowledge",
    description: "Free-form reference documents distributed to specific agents.",
  },
  REFERENCE_LIBRARY: {
    priority: 6,
    label: "Reference Library",
    description: "Sectioned reference documents with topic tags, auto-retrieved by relevance.",
  },
  PROMPT_SECTION: {
    priority: 7,
    label: "Prompt Section",
    description: "Custom system prompt overrides managed by administrators.",
  },
} as const;

export type KnowledgeSource = keyof typeof KNOWLEDGE_SOURCES;

export interface KnowledgePriorityOverride {
  id: string;
  source_a: KnowledgeSource;
  source_b: KnowledgeSource;
  winner: KnowledgeSource;
  scope: string; // "global" | "category:NAMING" | "category:IO_MAPPING" | etc.
  reason: string | null;
  created_by: string | null;
  created_at: string;
}

/**
 * Given two conflicting sources, determine the winner based on:
 * 1. Permanent overrides (if any match)
 * 2. Default priority hierarchy
 */
export function resolveConflictWinner(
  sourceA: KnowledgeSource,
  sourceB: KnowledgeSource,
  category: string | null,
  overrides: KnowledgePriorityOverride[],
): KnowledgeSource {
  // Check for a matching override (most specific first)
  if (category) {
    const categoryOverride = overrides.find(
      (o) =>
        o.scope === `category:${category}` &&
        ((o.source_a === sourceA && o.source_b === sourceB) ||
          (o.source_a === sourceB && o.source_b === sourceA)),
    );
    if (categoryOverride) return categoryOverride.winner;
  }

  // Check global override
  const globalOverride = overrides.find(
    (o) =>
      o.scope === "global" &&
      ((o.source_a === sourceA && o.source_b === sourceB) ||
        (o.source_a === sourceB && o.source_b === sourceA)),
  );
  if (globalOverride) return globalOverride.winner;

  // Fall back to default priority (lower number = higher priority = wins)
  return KNOWLEDGE_SOURCES[sourceA].priority <= KNOWLEDGE_SOURCES[sourceB].priority
    ? sourceA
    : sourceB;
}

/**
 * Build the priority hierarchy text block for injection into system prompts.
 */
export function buildPriorityHierarchyBlock(): string {
  return `## Knowledge Priority (highest to lowest)
When any guidance below conflicts, follow the higher-priority source.
1. Platform Rules (foundational SCL/TIA rules)
2. Design Profile (customer-specific standards)
3. Correction Patterns (learned compile fixes)
4. FB Templates (code structure templates)
5. Agent Knowledge (reference documents)
6. Reference Library (sectioned reference docs)`;
}
