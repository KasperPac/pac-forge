/**
 * TIA hardware catalogue — shaping the bridge's raw entries for a picker (G0-17).
 *
 * `GET /tia/hardware-catalog` returns one entry per (article number × firmware
 * version), so a single physical part shows up many times. Engineers pick a
 * part, then a firmware — so we group first.
 *
 * Pure module: no React, no fetch. Bridge contract lives in tia-bridge-contract.
 */
import type { CatalogEntryDto } from "@/lib/tia-bridge-contract";
import type { HardwareSignalType } from "@/types/spec-contract-v2";

/** One firmware revision of a part, with the string TIA needs to create it. */
export interface CatalogVersion {
  version: string;
  /** `OrderNumber:6ES7 516-3AN00-0AB0/V1.0` — exactly what CreateWithItem wants. */
  typeIdentifier: string;
}

/** A physical part, with every installed firmware revision of it. */
export interface CatalogProduct {
  articleNumber: string;
  typeName: string;
  description: string;
  catalogPath: string;
  /** Newest first. */
  versions: CatalogVersion[];
}

/**
 * Pull signal type and channel count out of a catalogue type name so a picked
 * card feeds the IO fit check immediately — `DI 16x24VDC HF` → 16 × DI.
 *
 * Siemens names outputs DQ/AQ; the FDS model is IEC (dialect.ts rule), so they
 * map to DO/AO here. Returns an empty object when the name doesn't encode it —
 * the engineer can still fill the fields by hand.
 */
export function inferModuleShape(typeName: string): {
  signal_type?: HardwareSignalType;
  channel_count?: number;
} {
  const name = (typeName ?? "").trim().toUpperCase();
  const match = name.match(/^(DI|DQ|DO|AI|AQ|AO)\s*(\d+)?\s*X?/);
  if (!match) return {};

  const siemens = match[1];
  const signal_type: HardwareSignalType =
    siemens === "DQ" || siemens === "DO" ? "DO"
    : siemens === "AQ" || siemens === "AO" ? "AO"
    : (siemens as HardwareSignalType);

  const channels = match[2] ? Number(match[2]) : undefined;
  return {
    signal_type,
    ...(channels && channels > 0 ? { channel_count: channels } : {}),
  };
}

/**
 * Siemens ruggedized (SIPLUS) variants carry 6AG1/6AG2 article prefixes and sit
 * alongside the standard 6ES7 parts in the catalogue. Standard parts are what
 * almost every project wants, so they sort first.
 */
export function isStandardPart(articleNumber: string): boolean {
  return articleNumber.trim().toUpperCase().startsWith("6ES7");
}

/** `V2.10` must sort above `V2.9`, so compare numerically rather than as text. */
function compareVersionsDesc(a: string, b: string): number {
  const parts = (v: string) =>
    (v.match(/\d+/g) ?? []).map(Number);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return b.localeCompare(a);
}

/**
 * Collapse raw catalogue entries into one row per article number, newest
 * firmware first, standard parts before SIPLUS variants.
 */
export function groupCatalogEntries(entries: CatalogEntryDto[]): CatalogProduct[] {
  const byArticle = new Map<string, CatalogProduct>();

  for (const e of entries) {
    const articleNumber = (e.article_number ?? "").trim();
    if (!articleNumber) continue; // can't be plugged without an MLFB

    let product = byArticle.get(articleNumber);
    if (!product) {
      product = {
        articleNumber,
        typeName: e.type_name ?? "",
        description: e.description ?? "",
        catalogPath: e.catalog_path ?? "",
        versions: [],
      };
      byArticle.set(articleNumber, product);
    }
    if (e.version && !product.versions.some((v) => v.version === e.version)) {
      product.versions.push({ version: e.version, typeIdentifier: e.type_identifier ?? "" });
    }
  }

  const products = [...byArticle.values()];
  for (const p of products) p.versions.sort((a, b) => compareVersionsDesc(a.version, b.version));

  return products.sort((a, b) => {
    const aStd = isStandardPart(a.articleNumber);
    const bStd = isStandardPart(b.articleNumber);
    if (aStd !== bStd) return aStd ? -1 : 1;
    return a.articleNumber.localeCompare(b.articleNumber);
  });
}
