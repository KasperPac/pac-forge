// src/lib/spec-builder/codegen/io-conditioning-writer.ts
//
// G1-4b — project-level IO conditioning layer. Functionally significant
// per-signal delays (G0-2 `conditioning`) and the blanket tier-2 DI debounce
// (`engineering.io_conditioning_defaults.di_debounce_ms`) lower to TON/TOF
// multi-instances (house SCL pattern) inside one FB_IO_Conditioning, whose
// conditioned values land in the IO_Cond global DB. Called FIRST in OB1 so
// every downstream reader (MAP FCs, coordinators) sees this scan's
// conditioned value — the golden master's FORCE_Input_Cond/IO_Cond pattern
// generalized. Pure; no React/IO.
import type { CodegenArtifact } from "./types";
import { sclIdent } from "./sa-builder";
import { IO_COND_DB, IO_COND_FB } from "./naming";

const PROGRAM = "Program blocks";

/** One conditioned DI: the resolved delays (explicit ?? blanket). */
export interface ConditionedSignal {
  tag: string;
  onDelayMs?: number;
  offDelayMs?: number;
}

/**
 * Emit the conditioning layer. Empty input → nothing (no dead blocks).
 * `callLine` MUST be the first OB1 call.
 */
export function writeIoConditioning(signals: ConditionedSignal[]): {
  artifacts: CodegenArtifact[];
  callLine?: string;
} {
  const rows = signals.filter((s) => s.onDelayMs !== undefined || s.offDelayMs !== undefined);
  if (!rows.length) return { artifacts: [] };

  const db: CodegenArtifact = {
    name: IO_COND_DB,
    type: "DB",
    filename: `${IO_COND_DB}.db`,
    content: [
      `DATA_BLOCK "${IO_COND_DB}"`,
      `{ S7_Optimized_Access := 'TRUE' }`,
      `VERSION : 0.1`,
      `   STRUCT`,
      ...rows.map((r) => `      ${sclIdent(r.tag)} : Bool;   // conditioned ${r.tag}`),
      `   END_STRUCT;`,
      `BEGIN`,
      `END_DATA_BLOCK`,
      ``,
    ].join("\n"),
    dependencies: [],
    folder: PROGRAM,
    layer: "device",
  };

  const timerVars: string[] = [];
  const body: string[] = [];
  for (const r of rows) {
    const ident = sclIdent(r.tag);
    const parts = [
      r.onDelayMs !== undefined ? `on-delay ${r.onDelayMs} ms` : undefined,
      r.offDelayMs !== undefined ? `off-delay ${r.offDelayMs} ms` : undefined,
    ].filter(Boolean);
    body.push(`   // ${r.tag}: ${parts.join(", ")}`);
    let source = `"${r.tag}"`;
    if (r.onDelayMs !== undefined) {
      timerVars.push(`      t_on_${ident} : TON;`);
      body.push(`   #t_on_${ident}(IN := ${source}, PT := T#${r.onDelayMs}MS);`);
      source = `#t_on_${ident}.Q`;
    }
    if (r.offDelayMs !== undefined) {
      timerVars.push(`      t_off_${ident} : TOF;`);
      body.push(`   #t_off_${ident}(IN := ${source}, PT := T#${r.offDelayMs}MS);`);
      source = `#t_off_${ident}.Q`;
    }
    body.push(`   "${IO_COND_DB}".${ident} := ${source};`);
  }

  const fb: CodegenArtifact = {
    name: IO_COND_FB,
    type: "FB",
    filename: `${IO_COND_FB}.scl`,
    content: [
      `FUNCTION_BLOCK "${IO_COND_FB}"`,
      `{ S7_Optimized_Access := 'TRUE' }`,
      `VERSION : 0.1`,
      `   VAR`,
      ...timerVars,
      `   END_VAR`,
      ``,
      `BEGIN`,
      `   // IO conditioning — runs FIRST in OB1 so every downstream reader`,
      `   // (MAP FCs, unit coordinators) sees this scan's conditioned value.`,
      ...body,
      `END_FUNCTION_BLOCK`,
      ``,
    ].join("\n"),
    dependencies: [IO_COND_DB],
    folder: PROGRAM,
    layer: "device",
  };

  const inst: CodegenArtifact = {
    name: `${IO_COND_FB}_DB`,
    type: "DB",
    filename: `${IO_COND_FB}_DB.db`,
    content: [
      `DATA_BLOCK "${IO_COND_FB}_DB"`,
      `{ S7_Optimized_Access := 'TRUE' }`,
      `VERSION : 0.1`,
      `"${IO_COND_FB}"`,
      `BEGIN`,
      `END_DATA_BLOCK`,
      ``,
    ].join("\n"),
    dependencies: [IO_COND_FB],
    folder: PROGRAM,
    layer: "device",
  };

  return { artifacts: [db, fb, inst], callLine: `   "${IO_COND_FB}_DB"();` };
}
