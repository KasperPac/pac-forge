import type { SafetyWarning, SafetyWarningType } from "@/types";

interface AnalysisInput {
  name: string;
  type: string;
  content: string;
}

interface SafetyRule {
  type: SafetyWarningType;
  /** Regex patterns to detect the issue */
  detect: RegExp[];
  /** Regex patterns that indicate the issue is properly mitigated */
  mitigatedBy?: RegExp[];
  description: string;
}

const SAFETY_RULES: SafetyRule[] = [
  // Missing interlock: motor/valve output without interlock check
  {
    type: "MISSING_INTERLOCK",
    detect: [
      // Output assignment to motor/valve without preceding interlock check
      /(?:Motor|Valve|Pump|Drive)(?:_?\w+)?\.(?:Run|Start|Enable|Output)\s*:=\s*TRUE/i,
    ],
    mitigatedBy: [
      /Interlock/i,
      /SafetyOk/i,
      /Safety_OK/i,
      /EStop/i,
      /E_Stop/i,
      /Emergency/i,
    ],
    description: "Motor/valve output set without visible interlock check in the same FB",
  },

  // Unsafe motor logic: direct output write without safety gate
  {
    type: "UNSAFE_MOTOR",
    detect: [
      // Direct Q output write (physical output)
      /%Q\w+\s*:=/,
      // Direct output without safety condition
      /Output\s*:=\s*(?:Input|Command|Request)/i,
    ],
    mitigatedBy: [
      /AND\s+\w*[Ss]afety/,
      /IF\s+\w*[Ss]afety/,
      /SafetyOk/i,
      /Safety_OK/i,
    ],
    description: "Direct physical output write without safety condition gate",
  },

  // Alarm reset violation: auto-reset pattern detected
  {
    type: "ALARM_RESET_VIOLATION",
    detect: [
      // Auto-reset: alarm cleared without operator action
      /Alarm\w*\s*:=\s*FALSE/i,
      /Fault\w*\s*:=\s*FALSE/i,
      // Reset without operator acknowledgment
      /(?:Alarm|Fault)\w*\s*:=\s*NOT\s/i,
    ],
    mitigatedBy: [
      // Operator reset pattern: only reset when operator requests AND condition cleared
      /Reset\w*\s+AND\s+NOT\s+\w*(?:Fault|Alarm)/i,
      /AckReset/i,
      /Ack_Reset/i,
      /OperatorReset/i,
      /Operator_Reset/i,
      /ManualReset/i,
    ],
    description: "Alarm appears to auto-reset without operator acknowledgment",
  },

  // IO index mismatch: array access without bounds check
  {
    type: "IO_MISMATCH",
    detect: [
      // Array access with variable index
      /\[\w+(?:Index|Idx|i|j|k|n)\]/i,
    ],
    mitigatedBy: [
      /IF\s+\w+(?:Index|Idx|i|j|k|n)\s*[<>]=?\s*\d+/i,
      /AND\s+\w+(?:Index|Idx|i|j|k|n)\s*[<>]=?\s*\d+/i,
      /LIMIT\s*\(/i,
    ],
    description: "Array access with variable index without visible bounds validation",
  },

  // Array out-of-bounds risk
  {
    type: "ARRAY_OOB",
    detect: [
      // Array declaration with subsequent access beyond declared range
      /ARRAY\s*\[\s*(\d+)\s*\.\.\s*(\d+)\s*\]/i,
    ],
    mitigatedBy: [
      /LIMIT\s*\(/i,
      /MIN\s*\(/i,
      /MAX\s*\(/i,
    ],
    description: "Array used without LIMIT/MIN/MAX bounds protection",
  },

  // Uninitialized state machine
  {
    type: "UNINITIALIZED_STATE",
    detect: [
      // CASE statement without an ELSE or default init
      /CASE\s+\w+\s+OF/i,
    ],
    mitigatedBy: [
      /ELSE/i,
      /State\s*:=\s*\d+\s*;.*(?:INIT|IDLE|DEFAULT)/i,
    ],
    description: "State machine CASE block may lack default/ELSE handling for unknown states",
  },
];

/**
 * Analyze a single artifact's SCL content for safety issues.
 * Returns an array of SafetyWarning objects.
 */
function analyzeArtifact(artifact: AnalysisInput): SafetyWarning[] {
  const warnings: SafetyWarning[] = [];
  const lines = artifact.content.split("\n");

  for (const rule of SAFETY_RULES) {
    for (const detectPattern of rule.detect) {
      // Find all lines matching the detection pattern
      for (let i = 0; i < lines.length; i++) {
        if (!detectPattern.test(lines[i])) continue;

        // Check if the issue is mitigated — look in a window around the match
        const windowStart = Math.max(0, i - 15);
        const windowEnd = Math.min(lines.length, i + 15);
        const window = lines.slice(windowStart, windowEnd).join("\n");

        let mitigated = false;
        if (rule.mitigatedBy) {
          for (const mitigationPattern of rule.mitigatedBy) {
            if (mitigationPattern.test(window)) {
              mitigated = true;
              break;
            }
          }
        }

        if (!mitigated) {
          // Avoid duplicate warnings for the same rule + artifact
          const alreadyWarned = warnings.some(
            (w) => w.type === rule.type && w.artifact_name === artifact.name
          );
          if (!alreadyWarned) {
            warnings.push({
              id: crypto.randomUUID(),
              type: rule.type,
              artifact_name: artifact.name,
              description: rule.description,
              line: i + 1,
              acknowledged: false,
            });
          }
        }
      }
    }
  }

  return warnings;
}

/**
 * Analyze multiple artifacts for safety issues.
 */
export function analyzeArtifacts(
  artifacts: AnalysisInput[]
): SafetyWarning[] {
  const allWarnings: SafetyWarning[] = [];
  for (const artifact of artifacts) {
    allWarnings.push(...analyzeArtifact(artifact));
  }
  return allWarnings;
}
