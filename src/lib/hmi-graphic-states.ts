import type { HmiGraphic } from "@/types/hmi-screen";

/**
 * Common WinCC state suffixes.
 * Order matters — longer/more specific patterns first.
 */
const STATE_PATTERNS: RegExp[] = [
  // Color-based states (grey, green, red, yellow, blue, orange, white, black)
  /[_\s-](grey|gray|green|red|yellow|blue|orange|white|black|cyan|magenta)$/i,
  // Boolean/operational states
  /[_\s-](on|off|run|running|stop|stopped|fault|faulted|alarm|warning|error|idle|standby|ready|active|inactive|disabled|enabled|open|opened|close|closed|opening|closing)$/i,
  // Numbered states (0-9, two digits)
  /[_\s-](\d{1,2})$/,
  // Direction states
  /[_\s-](left|right|up|down|forward|reverse|fwd|rev|cw|ccw)$/i,
  // Level/fill states
  /[_\s-](empty|full|half|low|high|medium|fill\d*)$/i,
  // Status states
  /[_\s-](ok|nok|good|bad|normal|abnormal|trip|tripped|maint|maintenance)$/i,
];

/**
 * Try to split a graphic name into base name + state suffix.
 * Returns null if no state pattern is detected.
 */
export function detectState(name: string): { baseName: string; state: string } | null {
  for (const pattern of STATE_PATTERNS) {
    const match = name.match(pattern);
    if (match) {
      const state = match[1];
      const baseName = name.slice(0, match.index!);
      if (baseName.length > 0) {
        return { baseName, state };
      }
    }
  }
  return null;
}

/**
 * Assign stateGroup and stateName to graphics that share a base name
 * within the same category. Only groups if 2+ variants exist.
 */
export function assignStateGroups(graphics: Map<string, HmiGraphic>): void {
  // Group candidates by category + baseName
  const candidates = new Map<string, { baseName: string; state: string; graphicName: string }[]>();

  for (const g of graphics.values()) {
    const result = detectState(g.name);
    if (!result) continue;
    const key = `${g.category ?? ""}::${result.baseName}`;
    let list = candidates.get(key);
    if (!list) {
      list = [];
      candidates.set(key, list);
    }
    list.push({ baseName: result.baseName, state: result.state, graphicName: g.name });
  }

  // Apply groups where 2+ variants exist
  for (const entries of candidates.values()) {
    if (entries.length < 2) continue;
    for (const entry of entries) {
      const g = graphics.get(entry.graphicName);
      if (g) {
        g.stateGroup = entry.baseName;
        g.stateName = entry.state;
      }
    }
  }
}

/** Group graphics by their stateGroup. Returns map of baseName → graphics[] */
export function getStateGroups(graphics: HmiGraphic[]): Map<string, HmiGraphic[]> {
  const groups = new Map<string, HmiGraphic[]>();
  for (const g of graphics) {
    if (!g.stateGroup) continue;
    let list = groups.get(g.stateGroup);
    if (!list) {
      list = [];
      groups.set(g.stateGroup, list);
    }
    list.push(g);
  }
  // Sort states within each group
  for (const list of groups.values()) {
    list.sort((a, b) => (a.stateName ?? "").localeCompare(b.stateName ?? ""));
  }
  return groups;
}
