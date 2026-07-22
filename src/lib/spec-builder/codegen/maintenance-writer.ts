// src/lib/spec-builder/codegen/maintenance-writer.ts
//
// G3 maintenance-layer writer — Maintenance_CMD seam DB (G3-1), the
// commissioning output-override FC (G3-2, must be OB1-LAST so its writes win
// over the MAP FCs), and the encoder-preset one-shot sequencer FC (G3-3,
// called pre-EM). Pure: no React/IO. Evidence: the golden master's
// hand-authored Maintenance_CMD.db / MAINT_Output_Override.scl /
// MAINT_Encoder_Preset.scl, generalized — every tag, address, and channel
// comes from the G0-5 contract data.
import type { CodegenArtifact } from "./types";
import { sclIdent } from "./sa-builder";
import { MAINTENANCE_DB } from "./naming";

const PROGRAM = "Program blocks";

/** One overridable DO (G0-5 maintenance.overridable_outputs, address joined
 *  from the hierarchy's IO list by the caller). */
export interface OverridableOutputInput {
  tag: string;
  address?: string;
  wireCheckOnly: boolean;
  description?: string;
}

/** One presettable axis with recorded TR-profile channels (G0-5 tier 2). */
export interface PresetChannelInput {
  axisId: string;
  /** SCL identifier stem for the seam members (`<ident>_preset_*`). */
  ident: string;
  ctrlAddress: string; // e.g. "%QB70"
  valueAddress: string; // e.g. "%QD71"
  statusAddress: string; // e.g. "%IB78" (recorded; sequencer is open-loop v1)
  /** Run interlock: the axis EM whose Execute state blocks the preset. */
  blockedWhileEmExecute?: { emName: string; executeIndex: number };
}

export interface MaintenanceInput {
  overridableOutputs: OverridableOutputInput[];
  presets: PresetChannelInput[];
}

export { MAINTENANCE_DB } from "./naming";

/** Ensure a leading % on a recorded IO address. */
function addr(a: string): string {
  return a.startsWith("%") ? a : `%${a}`;
}

function writeSeamDb(input: MaintenanceInput): CodegenArtifact {
  const members = [
    `      maintenance_mode : Bool;   // TRUE = drives commanded to Stopped, presets + output overrides enabled`,
    `      seq_test_mode : Bool;   // TRUE = UCs release the PackML command pins; dashboard drives them`,
    ...input.presets.flatMap((p) => [
      `      ${p.ident}_preset_execute : Bool;   // rising edge starts the ${p.axisId} encoder preset`,
      `      ${p.ident}_preset_value : DInt;   // value the encoder adopts`,
      `      ${p.ident}_preset_done : Bool;`,
      `      ${p.ident}_preset_step : Int;   // internal sequencer state`,
      `      ${p.ident}_preset_timer : Int;   // internal pulse counter`,
    ]),
    ...input.overridableOutputs.map((o) => {
      const notes = [o.address, o.wireCheckOnly ? "(wire check only)" : o.description]
        .filter(Boolean)
        .join(" ");
      return `      ov_${sclIdent(o.tag)} : Bool;${notes ? `   // ${notes}` : ""}`;
    }),
  ];
  const content = [
    `DATA_BLOCK "${MAINTENANCE_DB}"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `   STRUCT`,
    ...members,
    `   END_STRUCT;`,
    `BEGIN`,
    `END_DATA_BLOCK`,
    ``,
  ].join("\n");
  return {
    name: MAINTENANCE_DB, type: "DB", filename: `${MAINTENANCE_DB}.db`, content,
    dependencies: [], folder: PROGRAM, layer: "unit",
  };
}

function writeOverrideFc(outputs: OverridableOutputInput[]): CodegenArtifact {
  const content = [
    `FUNCTION "MAINT_Output_Override" : Void`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    ``,
    `BEGIN`,
    `   // Commissioning output overrides — MUST be the LAST call in OB1 so these`,
    `   // writes win over the MAP FCs. Only active in maintenance mode; outside`,
    `   // it this block writes nothing and the program owns the outputs.`,
    `   IF NOT "${MAINTENANCE_DB}".maintenance_mode THEN`,
    `      RETURN;`,
    `   END_IF;`,
    ``,
    ...outputs.map((o) => {
      const notes = [o.address ? addr(o.address) : undefined, o.wireCheckOnly ? "(wire check only)" : undefined]
        .filter(Boolean)
        .join(" ");
      return `   "${o.tag}" := "${MAINTENANCE_DB}".ov_${sclIdent(o.tag)};${notes ? `   // ${notes}` : ""}`;
    }),
    `END_FUNCTION`,
    ``,
  ].join("\n");
  return {
    name: "MAINT_Output_Override", type: "FC", filename: "MAINT_Output_Override.scl", content,
    dependencies: [MAINTENANCE_DB], folder: PROGRAM, layer: "unit",
  };
}

/** One axis's 3-step one-shot: arm (guarded) → hold trigger ~1 s of scans →
 *  done until the operator drops execute. Preset writes encoder EEPROM —
 *  one-shot pulses only, never cyclic. */
function presetCase(p: PresetChannelInput): string[] {
  const db = `"${MAINTENANCE_DB}"`;
  const guard = p.blockedWhileEmExecute
    ? `IF ${db}.${p.ident}_preset_execute AND ("EM_${p.blockedWhileEmExecute.emName}_DB".state <> ${p.blockedWhileEmExecute.executeIndex}) THEN`
    : `IF ${db}.${p.ident}_preset_execute THEN   // TODO no run-interlock: axis declares no blocked_while_em_execute EM`;
  return [
    ``,
    `   // --- ${p.axisId} encoder preset (ctrl ${addr(p.ctrlAddress)}, value ${addr(p.valueAddress)}, status ${addr(p.statusAddress)}) ---`,
    `   CASE ${db}.${p.ident}_preset_step OF`,
    `      0:`,
    `         ${db}.${p.ident}_preset_done := FALSE;`,
    `         ${guard}`,
    `            ${addr(p.valueAddress)} := DINT_TO_DWORD(${db}.${p.ident}_preset_value);`,
    `            ${db}.${p.ident}_preset_timer := 0;`,
    `            ${db}.${p.ident}_preset_step := 1;`,
    `         END_IF;`,
    `      1:   // hold the trigger ~1 s of scans`,
    `         ${addr(p.ctrlAddress)} := 16#01;`,
    `         ${db}.${p.ident}_preset_timer := ${db}.${p.ident}_preset_timer + 1;`,
    `         IF ${db}.${p.ident}_preset_timer >= 100 THEN`,
    `            ${db}.${p.ident}_preset_step := 2;`,
    `         END_IF;`,
    `      2:   // released; done until the operator drops execute`,
    `         ${db}.${p.ident}_preset_done := TRUE;`,
    `         IF NOT ${db}.${p.ident}_preset_execute THEN`,
    `            ${db}.${p.ident}_preset_step := 0;`,
    `         END_IF;`,
    `   END_CASE;`,
  ];
}

function writePresetFc(presets: PresetChannelInput[]): CodegenArtifact {
  const db = `"${MAINTENANCE_DB}"`;
  const content = [
    `FUNCTION "MAINT_Encoder_Preset" : Void`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    ``,
    `BEGIN`,
    `   // Maintenance-mode encoder preset (TR Encoder Profile preset submodule:`,
    `   // 1 control byte + DWord value out, status byte in). Preset writes the`,
    `   // encoder EEPROM — one-shot pulses only, never cyclic.`,
    ``,
    `   // trigger bytes default to zero every scan; the step logic pulses them`,
    ...presets.map((p) => `   ${addr(p.ctrlAddress)} := 16#00;`),
    ``,
    `   IF NOT ${db}.maintenance_mode THEN`,
    ...presets.flatMap((p) => [
      `      ${db}.${p.ident}_preset_step := 0;`,
      `      ${db}.${p.ident}_preset_done := FALSE;`,
    ]),
    `      RETURN;`,
    `   END_IF;`,
    ...presets.flatMap(presetCase),
    `END_FUNCTION`,
    ``,
  ].join("\n");
  return {
    name: "MAINT_Encoder_Preset", type: "FC", filename: "MAINT_Encoder_Preset.scl", content,
    dependencies: [MAINTENANCE_DB], folder: PROGRAM, layer: "unit",
  };
}

/**
 * Emit the maintenance layer plus its OB1 call lines. `presetCallLine` goes
 * BEFORE the EM calls (G5-2); `overrideCallLine` MUST stay the final OB1 call
 * (G5-3) so override writes win over the MAP FCs.
 */
export function writeMaintenanceArtifacts(input: MaintenanceInput): {
  artifacts: CodegenArtifact[];
  presetCallLine?: string;
  overrideCallLine?: string;
} {
  const artifacts: CodegenArtifact[] = [writeSeamDb(input)];
  let presetCallLine: string | undefined;
  let overrideCallLine: string | undefined;
  if (input.presets.length) {
    artifacts.push(writePresetFc(input.presets));
    presetCallLine = `   "MAINT_Encoder_Preset"();`;
  }
  if (input.overridableOutputs.length) {
    artifacts.push(writeOverrideFc(input.overridableOutputs));
    overrideCallLine = `   "MAINT_Output_Override"();   // MUST stay the last OB1 call`;
  }
  return { artifacts, presetCallLine, overrideCallLine };
}
