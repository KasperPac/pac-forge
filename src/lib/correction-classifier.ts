import type { DiffResult } from "./diff-engine";
import { getChangedContent } from "./diff-engine";
import type { CorrectionType } from "@/types";

export interface ClassifiedCorrection {
  correctionType: CorrectionType;
  originalSnippet: string;
  correctedSnippet: string;
  explanationTag: string;
  confidence: number;
}

interface ClassificationRule {
  type: CorrectionType;
  /** Patterns to match in added or removed lines */
  patterns: RegExp[];
  explanationTag: string;
}

const CLASSIFICATION_RULES: ClassificationRule[] = [
  // NAMING — variable/block name changes
  {
    type: "NAMING",
    patterns: [
      /\b(?:VAR|VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_TEMP)\b/i,
      /\b(?:FB_|FC_|UDT_|DB_|iDB_)\w+/,
      /\b(?:FUNCTION_BLOCK|FUNCTION|TYPE)\s+\w+/i,
      /:=\s*\w+\s*;.*(?:renamed|rename)/i,
    ],
    explanationTag: "Variable or block naming convention change",
  },

  // IO_MAPPING — IO address, array index, or mapping changes
  {
    type: "IO_MAPPING",
    patterns: [
      /%[IQM]\w+/,
      /\bIO\w*\[/i,
      /\bAddress\b/i,
      /\bSlot\b/i,
      /\bModule\b/i,
      /\bTag\w*\b/i,
      /ARRAY\s*\[/i,
    ],
    explanationTag: "IO mapping or address indexing correction",
  },

  // STATE_LOGIC — state machine changes
  {
    type: "STATE_LOGIC",
    patterns: [
      /\bCASE\b/i,
      /\bState\b/i,
      /\b(?:INIT|IDLE|RUN|FAULT|RESET|STOP|MANUAL|AUTO)\b/,
      /\bSTATE_\w+/,
      /:=\s*\d+\s*;.*(?:state|step)/i,
    ],
    explanationTag: "State machine logic or transition correction",
  },

  // ALARM — alarm/fault handling changes
  {
    type: "ALARM",
    patterns: [
      /\b(?:Alarm|Fault|Warning|Error)\w*/i,
      /\bLatch\b/i,
      /\bReset\b/i,
      /\bAck\w*/i,
      /\bTrip\b/i,
    ],
    explanationTag: "Alarm or fault handling correction",
  },

  // SAFETY — safety-related changes
  {
    type: "SAFETY",
    patterns: [
      /\b(?:Safety|Interlock|EStop|E_Stop|Emergency)\w*/i,
      /\b(?:Guard|SafetyOk|Safety_OK)\b/i,
      /\b(?:STO|SS1|SS2|SLS|SBC)\b/,
    ],
    explanationTag: "Safety interlock or protection correction",
  },

  // TIMING — timer/timing changes
  {
    type: "TIMING",
    patterns: [
      /\b(?:TON|TOF|TP|TONR)\b/,
      /\b(?:Timer|Delay|Timeout|Duration)\w*/i,
      /\bT#\d+/,
      /\bPT\s*:=/i,
      /\bET\b/i,
    ],
    explanationTag: "Timer or timing parameter correction",
  },
];

/**
 * Classify corrections from a diff result into pattern candidate types.
 * Returns one ClassifiedCorrection per detected pattern type.
 */
export function classifyCorrections(
  diff: DiffResult,
  context: { artifactName: string; deviceType?: string }
): ClassifiedCorrection[] {
  if (!diff.hasChanges) return [];

  const { addedLines, removedLines } = getChangedContent(diff);
  const addedText = addedLines.join("\n");
  const removedText = removedLines.join("\n");
  const allChangedText = addedText + "\n" + removedText;

  const results: ClassifiedCorrection[] = [];
  const seenTypes = new Set<CorrectionType>();

  for (const rule of CLASSIFICATION_RULES) {
    if (seenTypes.has(rule.type)) continue;

    let matchCount = 0;
    for (const pattern of rule.patterns) {
      if (pattern.test(allChangedText)) {
        matchCount++;
      }
    }

    if (matchCount > 0) {
      seenTypes.add(rule.type);

      // Build snippet context: take up to 5 lines each
      const originalSnippet = removedLines.slice(0, 5).join("\n");
      const correctedSnippet = addedLines.slice(0, 5).join("\n");

      results.push({
        correctionType: rule.type,
        originalSnippet: originalSnippet || "(no removed lines)",
        correctedSnippet: correctedSnippet || "(no added lines)",
        explanationTag: `${rule.explanationTag} in ${context.artifactName}`,
        confidence: Math.min(matchCount / rule.patterns.length, 1),
      });
    }
  }

  return results;
}
