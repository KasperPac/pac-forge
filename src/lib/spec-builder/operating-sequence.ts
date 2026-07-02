/**
 * Operating-sequence ("Steps & Actions") view helpers, shared by the DOCX
 * exporter and the structured editor so both present an EM's operation the same
 * way.
 *
 * The raw per-state transitions are too noisy to read directly: every command
 * transition repeats the same fault/health guards, and there is one fault→safe
 * transition per fault tag. So we hoist the guards that are common to the EM's
 * operational transitions into a single EM-level **permissives** list (shown
 * once), strip them from each row, and collapse the per-fault "→ safe state"
 * fan-in into a single "Loss of any permissive → <state>" line. What remains in
 * each step's "Advance when" is just the real operation: the command/limit that
 * moves it, plus any guard unique to that transition.
 */
import type { FunctionalDescriptionContent, SpecSection, UnitConfig } from "@/types/spec-builder";

/** The Action column for a step: device outputs held, or a sequence pointer. */
export function summarizeAction(fd: FunctionalDescriptionContent): string[] {
  // Command-driven acting state (SP-3c): one line per branch — label, the
  // AND-ed when-conditions, and the holds — plus the default hold. Machine
  // boolean, no prose. Both the DOCX exporter and the structured editor render
  // these lines verbatim, so no renderer change is needed.
  if (fd.command_branches?.length) {
    const holdText = (ds: { tag: string; state: string }[]) =>
      ds.map((d) => `${d.tag}: ${d.state}`).join(", ") || "—";
    const lines = fd.command_branches.map(
      (b) => `${b.label} — while ${b.when.join(" AND ")}: ${holdText(b.control_modules)}`,
    );
    if (fd.default_hold?.length) lines.push(`Default — ${holdText(fd.default_hold)}`);
    return lines;
  }
  if (fd.pattern === "sequential") return ["Sequenced — see steps below"];
  const ds = fd.control_module_states ?? [];
  if (!ds.length) return ["—"];
  return ds.map((d) => `${d.tag}: ${d.state}`);
}

/** One transition out of a step: the input condition and the step it goes to. */
export interface AdvanceRow {
  /** The triggering condition — an input tag test, plus any transition-specific guard. */
  condition: string;
  /** The target step number (e.g. "20"), or the state name if it can't be resolved to a step. */
  nextStep: string;
}

export interface EmStepView {
  step: number;
  stateName: string;
  action: string[];
  advance: AdvanceRow[];
}

export interface EmOperationView {
  /** Guards common to the EM's operational transitions — the "must hold" list, shown once. */
  permissives: string[];
  steps: EmStepView[];
}

/** First whitespace-delimited token of a serialized condition ("CM1_Fault = FALSE" → "CM1_Fault"). */
function tagOf(condition: string): string {
  return condition.trim().split(/\s+/)[0] ?? condition;
}

/** Split a serialized condition into its tag and the required test, for tabular display. */
export function permissiveParts(condition: string): { tag: string; requirement: string } {
  const trimmed = condition.trim();
  const idx = trimmed.indexOf(" ");
  if (idx < 0) return { tag: trimmed, requirement: "" };
  return { tag: trimmed.slice(0, idx), requirement: trimmed.slice(idx + 1).trim() };
}

/**
 * Build the cleaned operating-sequence view for one EM (its ordered state rows).
 * Pure + deterministic so the editor and the DOCX render identically.
 */
export function buildEmOperationView(states: SpecSection[]): EmOperationView {
  const contents = states.map((s) => s.content_json as unknown as FunctionalDescriptionContent);

  // Common permissives = intersection of the permissive lists across every
  // transition that carries guards (i.e. the operational ones). Empty-guard
  // transitions (fault trips, button-release) are ignored here.
  const guardLists: string[][] = [];
  for (const c of contents) for (const t of c.transitions ?? []) if (t.permissives.length) guardLists.push(t.permissives);
  const common = guardLists.length
    ? guardLists[0].filter((p) => guardLists.every((list) => list.includes(p)))
    : [];
  const commonSet = new Set(common);
  const commonTags = new Set(common.map(tagOf));

  // Map each state name to its step number so transitions reference the step.
  const stepByState: Record<string, number> = {};
  states.forEach((s, i) => { stepByState[s.state_name ?? ""] = (i + 1) * 10; });
  const stepLabel = (stateName: string): string => {
    const n = stepByState[stateName];
    return n != null ? String(n) : stateName;
  };

  const steps: EmStepView[] = states.map((s, i) => {
    const c = contents[i];
    const trs = c.transitions ?? [];

    // A "permissive trip" is an unguarded transition whose trigger is one of the
    // common-permissive tags going true (e.g. CM1_Fault = TRUE → Faulted).
    const isTrip = (t: { trigger: string; permissives: string[] }) =>
      t.permissives.length === 0 && commonTags.has(tagOf(t.trigger));

    const trips = trs.filter(isTrip);
    const operational = trs.filter((t) => !isTrip(t));

    const advance: AdvanceRow[] = [];
    for (const t of operational) {
      const extra = t.permissives.filter((p) => !commonSet.has(p));
      advance.push({
        condition: `${t.trigger}${extra.length ? ` AND ${extra.join(" AND ")}` : ""}`,
        nextStep: stepLabel(t.to_state),
      });
    }
    // Collapse trips to the same target into one boolean OR of their trigger
    // conditions (machine-readable, no prose); a lone trip is shown as-is.
    const tripsByTarget: Record<string, string[]> = {};
    for (const t of trips) (tripsByTarget[t.to_state] ??= []).push(t.trigger);
    for (const [target, triggers] of Object.entries(tripsByTarget)) {
      advance.push({
        condition: triggers.join(" OR "),
        nextStep: stepLabel(target),
      });
    }

    return {
      step: (i + 1) * 10,
      stateName: s.state_name ?? "",
      action: summarizeAction(c),
      advance,
    };
  });

  return { permissives: common, steps };
}

export interface EmStepGroup {
  emId: string;
  emName: string;
  states: SpecSection[];
}

/**
 * Group a unit's functional_description rows by equipment module, preserving
 * first-appearance order, and resolve each EM's display name from the unit
 * config. The EM id is read from content_json (compose writes it there) with a
 * fallback to the column.
 */
export function groupUnitStatesByEm(
  funcDescs: SpecSection[],
  unitCfg: UnitConfig | undefined,
): EmStepGroup[] {
  const emNameById: Record<string, string> = {};
  for (const e of unitCfg?.equipment_modules ?? []) emNameById[e.equipment_module_id] = e.equipment_module_name;

  const order: string[] = [];
  const byEm: Record<string, SpecSection[]> = {};
  for (const fd of funcDescs) {
    const emId =
      (fd.content_json as { equipment_module_id?: string })?.equipment_module_id ??
      (fd as { equipment_module_id?: string }).equipment_module_id ??
      "_";
    if (!byEm[emId]) { byEm[emId] = []; order.push(emId); }
    byEm[emId].push(fd);
  }
  return order.map((emId) => ({ emId, emName: emNameById[emId] ?? "Equipment Module", states: byEm[emId] }));
}
