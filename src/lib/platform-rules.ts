/**
 * Platform rules — section-based loading with role filtering.
 *
 * The monolithic platform rules string is split into tagged sections at runtime.
 * Each prompt builder requests only the sections relevant to its role, reducing
 * token waste (e.g., the matrix step doesn't need SCL syntax rules).
 *
 * Section tagging is defined in PLATFORM_SECTION_ROLES below.
 * Adding a new platform (Rockwell, Omron) means adding a new rules string
 * and a corresponding section map — the loader is platform-agnostic.
 */
import { PROMPT_DEFAULTS } from "@/lib/prompt-defaults";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Roles that consume platform rules */
export type PlatformRuleRole =
  | "generate"      // Code generation (Pac-ST chat, device FB, process code)
  | "review"        // Standards review + rewrite
  | "compile_fix"   // Compile error fixing
  | "matrix"        // Process linkage matrix (device wiring + sequences)
  | "plan"          // PM planning
  | "summary"       // PM summary
  | "process_qa"    // Process Q&A review
  | "forge_device"  // Forge device FB generation
  | "forge_process" // Forge process code generation
  | "all";          // Matches every role

interface PlatformSection {
  /** Section number from the markdown heading (e.g., 1, 2, 3...) */
  number: number;
  /** Section title (e.g., "NAMING CONVENTIONS (Siemens Style Guide)") */
  title: string;
  /** Full section content including heading */
  content: string;
  /** Roles that should receive this section */
  roles: PlatformRuleRole[];
}

// ---------------------------------------------------------------------------
// Section → Role mapping
// ---------------------------------------------------------------------------

/**
 * Maps section numbers to the roles that need them.
 * "all" means every role gets the section.
 * Sections not listed here default to ["generate", "review", "compile_fix"].
 */
const PLATFORM_SECTION_ROLES: Record<number, PlatformRuleRole[]> = {
  1:  ["all"],                                           // Naming conventions — everyone needs these
  2:  ["generate", "review", "compile_fix", "forge_device"], // FB + instance DB rules
  3:  ["generate", "compile_fix", "forge_device"],        // Block declaration templates
  4:  ["generate", "review", "compile_fix"],              // Data types + conversions
  5:  ["generate", "review", "forge_device"],             // FC vs FB guidance
  6:  ["generate", "compile_fix"],                        // IEC timers, counters, edges
  7:  ["generate", "review", "compile_fix"],              // SCL syntax rules
  8:  ["generate", "review"],                             // Code formatting
  9:  ["generate", "review"],                             // PLCopen async patterns
  10: ["generate", "review"],                             // Status + error reporting
  11: ["generate", "forge_device", "forge_process"],      // Artifact generation rules
  12: ["generate", "review", "compile_fix"],              // Common mistakes
};

const DEFAULT_ROLES: PlatformRuleRole[] = ["generate", "review", "compile_fix"];

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/** Parse the monolithic platform rules string into tagged sections */
function parseSections(rulesText: string): PlatformSection[] {
  const sections: PlatformSection[] = [];
  // Split on "### N." headings (e.g., "### 1. NAMING CONVENTIONS")
  const sectionRegex = /^### (\d+)\.\s+(.+)$/gm;
  const matches = [...rulesText.matchAll(sectionRegex)];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const number = parseInt(match[1], 10);
    const title = match[2].trim();
    const startIdx = match.index!;
    const endIdx = i + 1 < matches.length ? matches[i + 1].index! : rulesText.length;
    const content = rulesText.slice(startIdx, endIdx).trim();

    sections.push({
      number,
      title,
      content,
      roles: PLATFORM_SECTION_ROLES[number] ?? DEFAULT_ROLES,
    });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let _cachedSections: PlatformSection[] | null = null;

function getSections(): PlatformSection[] {
  if (!_cachedSections) {
    _cachedSections = parseSections(PROMPT_DEFAULTS.shared.platform_rules);
  }
  return _cachedSections;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Full platform rules (all sections) — backward compatible */
export const PLATFORM_RULES = PROMPT_DEFAULTS.shared.platform_rules;

/**
 * Load platform rules filtered by role.
 * Returns only sections tagged for the given role(s).
 *
 * @param roles - One or more roles to filter by. A section is included if
 *                it matches ANY of the provided roles or has role "all".
 * @returns Concatenated section text with header.
 *
 * @example
 * // Matrix step — gets naming + architecture sections only
 * const rules = loadPlatformRules("matrix");
 *
 * // Code generation — gets everything except matrix-only sections
 * const rules = loadPlatformRules("generate");
 *
 * // Multiple roles
 * const rules = loadPlatformRules("generate", "review");
 */
export function loadPlatformRules(...roles: PlatformRuleRole[]): string {
  const sections = getSections();
  const roleSet = new Set(roles);

  const filtered = sections.filter((s) =>
    s.roles.some((r) => r === "all" || roleSet.has(r)),
  );

  if (filtered.length === 0) return "";

  const header = "## Siemens TIA Platform Rules (S7-1200/1500, TIA Portal V17–V20)\n";
  return header + "\n" + filtered.map((s) => s.content).join("\n\n---\n\n");
}

/**
 * Get the list of available sections with their role assignments.
 * Useful for debugging and the prompt editor UI.
 */
export function getPlatformRuleSections(): Array<{
  number: number;
  title: string;
  roles: PlatformRuleRole[];
  charCount: number;
}> {
  return getSections().map((s) => ({
    number: s.number,
    title: s.title,
    roles: s.roles,
    charCount: s.content.length,
  }));
}
