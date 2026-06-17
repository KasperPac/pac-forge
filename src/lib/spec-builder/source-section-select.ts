import type { EquipmentModuleConfig } from "@/types/spec-builder";

export interface SourceSection {
  heading: string;
  body: string;
  order_index: number;
}

export interface SelectOptions {
  /** Max total chars (heading+body) across returned sections. */
  maxChars?: number;
}

const GLOBAL_HEADING_RE = /overview|control philosophy|scope|introduction|general/i;
const DEFAULT_MAX_CHARS = 6_000;

/**
 * Deterministically pick the source sections relevant to one equipment module:
 * sections whose heading/body mention the EM name, a control-module id/name, or
 * a tag — plus "global" sections (overview / control philosophy / scope).
 * Global sections rank first; then EM-matched by document order. Truncated to
 * the char budget, dropping lowest-priority sections whole.
 */
export function selectRelevantSections(
  sections: SourceSection[],
  em: EquipmentModuleConfig,
  opts: SelectOptions = {},
): SourceSection[] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;

  const needles = new Set<string>();
  needles.add(em.equipment_module_name.toLowerCase());
  for (const cm of em.control_modules) {
    needles.add(cm.control_module_id.toLowerCase());
    needles.add(cm.control_module_name.toLowerCase());
    for (const sig of cm.io_signals) needles.add(sig.tag.toLowerCase());
  }

  const matched: SourceSection[] = [];
  const global: SourceSection[] = [];
  for (const s of sections) {
    const hay = `${s.heading}\n${s.body}`.toLowerCase();
    if (GLOBAL_HEADING_RE.test(s.heading)) {
      global.push(s);
    } else if ([...needles].some((n) => n.length > 1 && hay.includes(n))) {
      matched.push(s);
    }
  }

  const ranked = [
    ...global.sort((a, b) => a.order_index - b.order_index),
    ...matched.sort((a, b) => a.order_index - b.order_index),
  ];

  const out: SourceSection[] = [];
  let used = 0;
  for (const s of ranked) {
    const size = s.heading.length + s.body.length;
    if (used + size > maxChars) continue;
    out.push(s);
    used += size;
  }
  return out;
}
