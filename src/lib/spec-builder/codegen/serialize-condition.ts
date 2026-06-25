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
export function serializeCondition(
  c: PermissiveCondition,
  pin: (tag: string) => string = (t) => t,
): string {
  if (c.value === "P_TRIG") return pin(c.tag);
  if (c.value === "N_TRIG") return `NOT ${pin(c.tag)}`;
  const op = OP_MAP[c.operator];
  if (typeof c.value === "boolean") return `${pin(c.tag)} ${op} ${c.value ? "TRUE" : "FALSE"}`;
  return `${pin(c.tag)} ${op} ${c.value}`;
}

/** AND-join a guard list, each term parenthesised. Empty guard → `TRUE`. */
export function serializeGuard(
  guard: PermissiveCondition[],
  pin: (tag: string) => string = (t) => t,
): string {
  if (!guard.length) return "TRUE";
  return guard.map((c) => `(${serializeCondition(c, pin)})`).join(" AND ");
}

/**
 * A transition's full advance condition. A `command` trigger ANDs its
 * expression with the guard; a `completion` trigger contributes no extra term,
 * so the guard alone is the advance.
 */
export function serializeAdvance(
  trigger: EmTrigger,
  guard: PermissiveCondition[],
  pin: (tag: string) => string = (t) => t,
): string {
  const guardStr = serializeGuard(guard, pin);
  if (trigger.kind === "completion") return guardStr;
  const trig = `(${serializeCondition(trigger.expr, pin)})`;
  return guardStr === "TRUE" ? trig : `${trig} AND ${guardStr}`;
}
