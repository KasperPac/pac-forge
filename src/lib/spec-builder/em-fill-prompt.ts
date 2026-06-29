import type { EmSequence, EmSeqState } from "./codegen/types";
import { regionId, renderRegion, defaultStub } from "./codegen/em-fill-regions";

export interface EmFillRegionBrief {
  /** Stable region id = regionId(sclName, fillId) — the AI must echo it verbatim in markers. */
  id: string;
  stateName: string;
  /** 1-based step number within the state. */
  step: number;
  /** Plain-language intent for this step (from the contract). */
  action: string;
  /** SCL guard that advances the step ("TRUE" when unconditional). */
  advance: string;
}

function sequentialStates(seq: EmSequence): EmSeqState[] {
  return seq.states.filter((s) => s.kind === "sequential");
}

/** One brief per sequential-state step. Pure — drives both the prompt and the test. */
export function emFillBriefs(seq: EmSequence): EmFillRegionBrief[] {
  const briefs: EmFillRegionBrief[] = [];
  for (const st of sequentialStates(seq)) {
    for (const step of st.steps) {
      briefs.push({
        id: regionId(seq.sclName, step.fillId),
        stateName: st.name,
        step: step.step,
        action: step.actionProse,
        advance: step.advance,
      });
    }
  }
  return briefs;
}

/** Generic, project-independent system prompt. NEVER mentions a specific machine. */
export function buildEmFillSystemPrompt(): string {
  return [
    "You write the body of a single SFC step inside a Siemens SCL FUNCTION_BLOCK.",
    "You are filling AI regions in a deterministic skeleton you must not otherwise change.",
    "",
    "HARD RULES (violating any one makes your output unusable):",
    "1. Output ONLY the regions you are asked to fill. Nothing before, between, or after them.",
    "2. Each region MUST be wrapped in the EXACT markers given to you:",
    "     // <ai-fill ID>",
    "     ...your step-body SCL...",
    "     // </ai-fill ID>",
    "   Echo every ID verbatim. Do not invent, rename, merge, or drop regions.",
    "3. NEVER emit the interface (VAR_INPUT/OUTPUT), the CASE frame, transition guards,",
    "   state constants, or the step-advance line — the skeleton owns all of those.",
    "4. Do NOT write `#step := ...`, `#state := ...`, `#done := ...` — advancing is the skeleton's job.",
    "5. Reference ONLY the pins listed in the pin catalogue, using the `#pin` syntax.",
    "6. Keep the supplied indentation (15 spaces). Plain assignments and IF/CASE only.",
    "7. If you cannot safely implement a step, return its stub body unchanged inside the markers.",
  ].join("\n");
}

/** Lists every pin the AI may reference, grouped by role. */
export function pinCatalogue(seq: EmSequence): string {
  const lines: string[] = [];
  lines.push("Status outputs (skeleton-owned, do NOT assign): #state, #step, #done, #fault");
  if (seq.cmdPins.length) lines.push(`Command inputs: ${seq.cmdPins.map((p) => `#${p}`).join(", ")}`);
  if (seq.interlockPins.length)
    lines.push(`Interlock inputs: ${seq.interlockPins.map((p) => `#${p}`).join(", ")}`);
  if (seq.sensors.length)
    lines.push(`Sensor inputs: ${seq.sensors.map((p) => `#${p.name}`).join(", ")}`);
  if (seq.actuators.length)
    lines.push(`Actuator outputs (you MAY assign): ${seq.actuators.map((p) => `#${p.name}`).join(", ")}`);
  return lines.join("\n");
}

/** Per-region prompt with the exact marker template the AI must reproduce. */
export function buildEmFillUserMessage(seq: EmSequence, briefs: EmFillRegionBrief[]): string {
  const blocks = briefs.map((b) => {
    const template = renderRegion(b.id, defaultStub(b.action, "               "), "               ");
    return [
      `Region ${b.id}`,
      `State: ${b.stateName}`,
      `Step ${b.step}`,
      `Intent: ${b.action}`,
      `complete when: ${b.advance}`,
      "Fill the marked region (replace the // stub line with real step-body SCL):",
      "```scl",
      template,
      "```",
    ].join("\n");
  });
  return [
    `FUNCTION_BLOCK: EM_${seq.sclName}`,
    "",
    "Pin catalogue:",
    pinCatalogue(seq),
    "",
    `Fill the following ${briefs.length} region(s):`,
    "",
    blocks.join("\n\n"),
  ].join("\n");
}
