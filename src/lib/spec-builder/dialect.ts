/**
 * Dialect helpers — IEC ↔ Siemens signal-type conversion.
 *
 * Canonical dialect in the DB is IEC (DI, DO, AI, AO, internal). Siemens
 * (DQ / AQ) is produced only at code-emission sites — i.e. the 4 generation
 * paths called out in CLAUDE.md (Pac-ST pipeline, process code, TIA Console
 * demo pipeline, compile fix). Import this module in those sites — nowhere
 * else. Readers and writers should keep data in IEC.
 *
 * Pure and stateless: no React, no DB, no side effects.
 */

export type SiemensSignalType = "DI" | "DQ" | "AI" | "AQ" | "internal";
export type IecSignalType = "DI" | "DO" | "AI" | "AO" | "internal";

/**
 * IEC → Siemens. DO→DQ, AO→AQ; other values pass through unchanged.
 * Use only at code-emission sites.
 */
export function toSiemens(sig: IecSignalType): SiemensSignalType {
  switch (sig) {
    case "DO":
      return "DQ";
    case "AO":
      return "AQ";
    default:
      return sig;
  }
}

/**
 * Siemens → IEC. DQ→DO, AQ→AO; other values pass through unchanged.
 */
export function toIec(sig: SiemensSignalType): IecSignalType {
  switch (sig) {
    case "DQ":
      return "DO";
    case "AQ":
      return "AO";
    default:
      return sig;
  }
}

/**
 * Tolerant input → canonical IEC. Accepts already-IEC forms, Siemens forms,
 * or mixed case (e.g. "do", "dq", "Ao"). Unknown values → "internal".
 * Used by ingest + legacy upgrade paths.
 */
export function convertSignalDirection(sig: string): IecSignalType {
  if (typeof sig !== "string") return "internal";
  const v = sig.trim().toUpperCase();
  switch (v) {
    case "DI":
      return "DI";
    case "DO":
      return "DO";
    case "DQ":
      return "DO";
    case "AI":
      return "AI";
    case "AO":
      return "AO";
    case "AQ":
      return "AO";
    case "INTERNAL":
      return "internal";
    default:
      return "internal";
  }
}
