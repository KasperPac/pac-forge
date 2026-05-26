/**
 * Renders spec_sections.functional_description.content_json from V2
 * AssemblyContract state tables. Mirrors the shape produced by
 * src/lib/spec-builder/orchestrator.ts so DOCX export and the live
 * wizard's post-processing both work unchanged.
 *
 * If `generateSpec` ever changes its content_json shape, this file's
 * snapshot test will fail and force a paired update.
 */
import type {
  DeviceStateEntry,
  SequentialStateV2,
  StaticStateV2,
} from "@/types/spec-contract-v2";

export interface SequentialSectionContent {
  pattern: "sequential";
  permissives: string[];
  steps: Array<{
    step: number;
    action: string;
    completion_criteria: string;
  }>;
  notes: string | null;
}

export interface StaticSectionContent {
  pattern: "static";
  device_states: Array<{ tag: string; state: string }>;
}

export function renderSequentialContentJson(
  seq: SequentialStateV2,
): SequentialSectionContent {
  return {
    pattern: "sequential",
    permissives: seq.permissives.map((p) => `${p.tag} ${p.operator} ${String(p.value)}`),
    steps: seq.steps.map((s) => ({
      step: s.step,
      action: s.action,
      completion_criteria: s.completion_criteria_text,
    })),
    notes: seq.notes,
  };
}

export function renderStaticContentJson(
  staticState: StaticStateV2 | DeviceStateEntry[],
): StaticSectionContent {
  const devices = Array.isArray(staticState) ? staticState : staticState.devices;
  return {
    pattern: "static",
    device_states: devices.map((d) => ({ tag: d.tag, state: d.state })),
  };
}
