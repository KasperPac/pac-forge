import type { ProposedModes } from "./types";

interface ModeHintRule {
  match: RegExp;
  mode_name: string;          // suggested operator-facing label
  hint_template: string;      // "{state}" interpolated
}

const RULES: ModeHintRule[] = [
  {
    match: /manual/i,
    mode_name: "Manual",
    hint_template: "Detected state '{state}' — consider adding a Manual mode",
  },
  {
    match: /service|maintenance/i,
    mode_name: "Service",
    hint_template: "Detected state '{state}' — consider adding a Service mode",
  },
];

/**
 * Pre-populates the default `auto` mode and surfaces hints for other modes
 * the engineer may want to declare based on existing state names. Hints are
 * suggestions only; the engineer chooses whether to act on them.
 */
export function proposeModes(legacyStateNames: string[]): ProposedModes {
  const seen = new Set<string>();
  const hints = [];

  for (const state of legacyStateNames) {
    for (const rule of RULES) {
      if (rule.match.test(state) && !seen.has(rule.mode_name)) {
        seen.add(rule.mode_name);
        hints.push({
          detected_state: state,
          hint: rule.hint_template.replace("{state}", state),
        });
      }
    }
  }

  return {
    modes: [{ mode_id: "auto", name: "Auto", is_default: true }],
    hints,
  };
}
