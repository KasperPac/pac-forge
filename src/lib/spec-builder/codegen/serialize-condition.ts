import type { PermissiveCondition, EmTrigger } from "@/types/spec-contract-v2";

/** Contract operator → SCL operator (`!=` becomes `<>`). */
const OP_MAP: Record<PermissiveCondition["operator"], string> = {
  "=": "=",
  "!=": "<>",
  ">": ">",
  "<": "<",
  ">=": ">=",
  "<=": "<=",
};

/**
 * One permissive → an SCL boolean term. Booleans render as `tag = TRUE/FALSE`;
 * numerics use SCL operators; the edge sentinels render as a bare tag (rising)
 * or `NOT tag` (falling). Edge-detection instances are a later refinement.
 */
export function serializeCondition(c: PermissiveCondition): string {
  if (c.value === "P_TRIG") return c.tag;
  if (c.value === "N_TRIG") return `NOT ${c.tag}`;
  const op = OP_MAP[c.operator];
  if (typeof c.value === "boolean") return `${c.tag} ${op} ${c.value ? "TRUE" : "FALSE"}`;
  return `${c.tag} ${op} ${c.value}`;
}

/** AND-join a guard list, each term parenthesised. Empty guard → `TRUE`. */
export function serializeGuard(guard: PermissiveCondition[]): string {
  if (!guard.length) return "TRUE";
  return guard.map((c) => `(${serializeCondition(c)})`).join(" AND ");
}

/**
 * A transition's full advance condition. A `command` trigger ANDs its
 * expression with the guard; a `completion` trigger contributes no extra term,
 * so the guard alone is the advance.
 */
export function serializeAdvance(trigger: EmTrigger, guard: PermissiveCondition[]): string {
  const guardStr = serializeGuard(guard);
  if (trigger.kind === "completion") return guardStr;
  const trig = `(${serializeCondition(trigger.expr)})`;
  return guardStr === "TRUE" ? trig : `${trig} AND ${guardStr}`;
}
