// src/components/spec-builder/monitors/monitor-helpers.ts
/**
 * Pure helpers for the MonitorPicker dialog: default construction,
 * one-line summary rendering for list rows, and inline validation
 * (Zod safeParse + effect-specific business rules).
 */
import { MonitorV2Schema, type CompletionCriterion, type MonitorV2 } from "@/types/spec-contract-v2";

export function createDefaultMonitor(): MonitorV2 {
  return {
    monitor_id: crypto.randomUUID(),
    condition: { kind: "tag_equals", tag: "", value: true },
    effect: "fault",
    fault_ref: { fault_code: "F_NEW", severity: "fault" },
    auto_clear: false,
    priority: 0,
  };
}

function summariseCondition(c: CompletionCriterion): string {
  const tail = "within_ms" in c && c.within_ms != null ? ` (${c.within_ms}ms)` : "";
  switch (c.kind) {
    case "tag_equals":
      return `${c.tag || "?"} = ${String(c.value)}${tail}`;
    case "tag_compare":
      return `${c.tag || "?"} ${c.op} ${c.value}${tail}`;
    case "expression":
      return `${c.text || "(no expression)"}${tail}`;
    case "manual_ack":
      return `manual: ${c.prompt}`;
    case "placeholder":
      return `placeholder: ${c.prompt}`;
  }
}

function summariseEffect(m: MonitorV2): string {
  switch (m.effect) {
    case "alarm":
      return `alarm ${m.fault_ref?.fault_code ?? "?"}`;
    case "fault":
      return `fault ${m.fault_ref?.fault_code ?? "?"}`;
    case "hold":
      return "hold";
    case "branch_to":
      return `branch to ${m.target_step_id ?? "?"}`;
  }
}

export function summariseMonitor(m: MonitorV2): string {
  return `${summariseCondition(m.condition)} → ${summariseEffect(m)}`;
}

export type ValidateResult = { ok: true } | { ok: false; errors: string[] };

export function validateMonitor(m: MonitorV2): ValidateResult {
  const errors: string[] = [];

  // Schema-level
  const parsed = MonitorV2Schema.safeParse(m);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
  }

  // Condition-level business rules
  if (m.condition.kind === "tag_equals" || m.condition.kind === "tag_compare") {
    if (!m.condition.tag || m.condition.tag.trim() === "") {
      errors.push("condition.tag: tag is required");
    }
  }
  if (m.condition.kind === "expression") {
    if (!m.condition.text || m.condition.text.trim() === "") {
      errors.push("condition.text: expression is required");
    }
  }

  // Effect-level business rules
  if ((m.effect === "alarm" || m.effect === "fault") && !m.fault_ref) {
    errors.push("fault_ref: required for alarm and fault effects");
  }
  if (m.fault_ref && (!m.fault_ref.fault_code || m.fault_ref.fault_code.trim() === "")) {
    errors.push("fault_ref.fault_code: code is required");
  }
  if (m.effect === "branch_to" && (!m.target_step_id || m.target_step_id.trim() === "")) {
    errors.push("target_step_id: required for branch_to effect");
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
