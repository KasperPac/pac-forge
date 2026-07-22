// events.mjs — poll-based event engine for the dashboard logger.
// Compares consecutive poll snapshots against the rules in events-config.mjs,
// appends hits to a daily JSONL file, and keeps a ring buffer for the UI.
//
// Poll-based means ~1 poll-cycle resolution: a pulse shorter than one cycle
// can be missed. Latching faults and pallet dwell times are well above that;
// this is a queryable complement to the HMI alarm log, not a replacement.
import fs from "node:fs";
import path from "node:path";
import { RULES, DEVICE_STATUS, USER_VAR } from "./events-config.mjs";

const RING_MAX = 1000;

export function createEventEngine(baseDir) {
  const logDir = path.join(baseDir, "logs");
  fs.mkdirSync(logDir, { recursive: true });

  let prev = null;            // last snapshot (null until first good poll)
  let deviceNames = null;     // HMI_DEV_VSD_MOT_TAG[i] once resolved
  const ring = [];
  const counts = { info: 0, warn: 0, fault: 0 };

  // vars the poller must read every cycle for the engine
  const varIds = [...new Set(RULES.flatMap((r) => [r.var, ...(r.ctx ?? [])]).concat(USER_VAR ? [USER_VAR] : []))];
  // vars to read once (device name array), consumed via setDeviceNames()
  const oneShotIds = Array.from({ length: DEVICE_STATUS.to - DEVICE_STATUS.from + 1 },
    (_, k) => DEVICE_STATUS.nameVar(DEVICE_STATUS.from + k));

  const logFile = () => path.join(logDir, `events-${new Date().toISOString().slice(0, 10)}.jsonl`);

  function ingest(ev) {
    ring.push(ev);
    if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
    counts[ev.sev] = (counts[ev.sev] ?? 0) + 1;
    fs.appendFile(logFile(), JSON.stringify(ev) + "\n", () => {});
  }

  function emit(rule, v, p, V) {
    const ev = {
      ts: new Date().toISOString(),
      cat: rule.cat, sev: rule.sev,
      text: rule.text(v, p, V, deviceNames),
      var: rule.var, value: v, prev: p,
    };
    if (rule.ctx) {
      ev.ctx = {};
      for (const c of rule.ctx) if (V[c] != null && V[c] !== "") ev.ctx[c] = V[c];
    }
    ingest(ev);
  }

  return {
    varIds, oneShotIds, ingest,
    setDeviceNames(byIndex) { deviceNames = byIndex; },
    get haveDeviceNames() { return deviceNames != null; },
    recent: (n = 150) => ring.slice(-n),
    counts: () => ({ ...counts, total: ring.length }),
    tick(V) {
      if (prev) {
        for (const r of RULES) {
          const v = V[r.var], p = prev[r.var];
          if (v == null || p == null || v === p) continue; // null = comm loss/first read: never an event
          if (r.on === "rise" && !(p === false && v === true)) continue;
          if (r.on === "fall" && !(p === true && v === false)) continue;
          if (r.on === "nonzero" && !(v !== 0 && v !== false)) continue;
          // "change" accepts any non-null delta
          emit(r, v, p, V);
        }
      }
      prev = { ...V };
    },
  };
}
