import { packmlByName } from "./packml-canonical";
import type { ProposedStateMapping } from "./types";

/**
 * Hand-curated synonym map. Kept minimal — only what the in-scope specs
 * (Catodo, Norte-Sur English, CVL-2129) use. Extending this list is a
 * platform-level change: add a new synonym only when a real spec needs it.
 */
const SYNONYMS: Record<string, string> = {
  "running": "Execute",
  "run": "Execute",
  "auto run": "Execute",
  "stopped": "Stopped",
  "stop": "Stopped",
  "fault": "Aborted",
  "faulted": "Aborted",
  "e-stop": "Aborting",
  "estop": "Aborting",
  "emergency stop": "Aborting",
  "standby": "Idle",
  "ready": "Idle",
  "init": "Resetting",
  "initialise": "Resetting",
  "initialize": "Resetting",
  "reset": "Resetting",
  "paused": "Held",
  "pause": "Holding",
};

export function proposeStateMapping(legacyName: string): ProposedStateMapping {
  const trimmed = legacyName.trim();
  const lower = trimmed.toLowerCase();

  // 1. Exact match
  const exact = packmlByName(trimmed);
  if (exact) {
    return {
      legacy_name: trimmed,
      match_source: "exact",
      packml_id: exact.packml_id,
    };
  }

  // 2. Synonym map
  const canonical = SYNONYMS[lower];
  if (canonical) {
    const matched = packmlByName(canonical);
    if (matched) {
      return {
        legacy_name: trimmed,
        match_source: "synonym",
        packml_id: matched.packml_id,
      };
    }
  }

  // 3. Unmapped — engineer decides
  return { legacy_name: trimmed, match_source: "unmapped" };
}
