/**
 * Deterministic parser: alarm specification table → SpecContractV2 AlarmRow[].
 *
 * Identified by strict header match: the first table whose headers start
 * with the expected columns. Subsystem scoping is resolved by control_module_id or
 * equipment_module_id (both optional) — the contract leaves `unit_id` inferred
 * later.
 */
import type { AlarmRow } from "@/types/spec-contract-v2";
import type { ParsedDocxTable } from "@/lib/spec-builder/docx-ingest";
import { DocxIngestError } from "@/lib/spec-builder/docx-ingest-hierarchy";

const REQUIRED_HEADERS = [
  "Alarm Tag",
  "Description",
  "Tier",
  "Device ID",
  "Assembly ID",
  "Setpoint",
  "Delay",
] as const;

function headersMatch(headers: string[]): boolean {
  for (let i = 0; i < REQUIRED_HEADERS.length; i++) {
    if (headers[i]?.trim() !== REQUIRED_HEADERS[i]) return false;
  }
  return true;
}

function cleanUuid(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    return null;
  }
  return v;
}

export function parseAlarmTable(
  tables: ParsedDocxTable[],
): AlarmRow[] {
  const alarmTable = tables.find((t) => headersMatch(t.headers));
  if (!alarmTable) return [];

  return alarmTable.rows.map((row, idx) => {
    const tag = (row[0] ?? "").trim();
    const description = (row[1] ?? "").trim();
    const tierId = (row[2] ?? "").trim();
    const deviceId = cleanUuid(row[3] ?? "");
    const equipment_moduleId = cleanUuid(row[4] ?? "");
    const setpoint = (row[5] ?? "").trim();
    const delay = (row[6] ?? "").trim();

    if (!tag) {
      throw new DocxIngestError(`Alarm row ${idx + 1}: missing alarm tag`);
    }
    if (!tierId) {
      throw new DocxIngestError(`Alarm row ${idx + 1}: missing tier`);
    }

    const out: AlarmRow = {
      id: `alarm-${idx + 1}`,
      tier_id: tierId,
      control_module_id: deviceId,
      equipment_module_id: equipment_moduleId,
      unit_id: null,
      tag,
      description,
      action: "",
      setpoint: setpoint || undefined,
      delay: delay || undefined,
    };
    return out;
  });
}
