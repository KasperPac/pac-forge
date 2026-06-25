import type { CompletionCriterion } from "@/types/spec-contract-v2";

/** tag_compare op → SCL operator (`==` becomes `=`). */
const CMP_OP: Record<"<" | "<=" | ">" | ">=" | "==", string> = {
  "<": "<", "<=": "<=", ">": ">", ">=": ">=", "==": "=",
};

/** Render a literal for an SCL equality term. */
function literal(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return String(value);
  return value;
}

/** True when a criterion cannot be evaluated deterministically. */
export function isUnevaluable(c: CompletionCriterion): boolean {
  return c.kind === "manual_ack" || c.kind === "placeholder";
}

/**
 * Lower ONE completion criterion to an SCL boolean term. `pin` maps a contract
 * tag to its FB-local pin reference (e.g. `brake_open` → `#fb_brake_open`);
 * unmapped tags pass through. `manual_ack`/`placeholder` cannot be evaluated
 * deterministically → render `FALSE`; callers should record a warning so the
 * step is never silently auto-advanced.
 */
export function serializeCompletion(
  c: CompletionCriterion,
  pin: (tag: string) => string = (t) => t,
): string {
  switch (c.kind) {
    case "tag_equals":
      return `${pin(c.tag)} = ${literal(c.value)}`;
    case "tag_compare":
      return `${pin(c.tag)} ${CMP_OP[c.op]} ${c.value}`;
    case "expression":
      return `(${c.text})`;
    case "manual_ack":
    case "placeholder":
      return "FALSE";
  }
}

/** AND-join a criteria list, each term parenthesised. Empty → `TRUE`. */
export function serializeCompletionGuard(
  cs: CompletionCriterion[],
  pin: (tag: string) => string = (t) => t,
): string {
  if (!cs.length) return "TRUE";
  return cs.map((c) => `(${serializeCompletion(c, pin)})`).join(" AND ");
}
