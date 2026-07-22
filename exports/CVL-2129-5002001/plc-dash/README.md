# CVL-2129 Freezer — live-data dashboard (read-only)

Browser dashboard for real-time data from the freezer PLC (CPU 1511F-1 PN, FW V2.9,
project `CVL-2129-5002001 6.8`). A small Node server on any PC that can reach the
PLC proxies the S7-1500 **Web API** (`/api/jsonrpc`) and serves the page — no TIA,
no PLC download, no client-side certificate warnings.

**Monitoring only.** The server never calls `PlcProgram.Write`.

## Run

```
node server.mjs <plc-ip> [user] [password]     # then open http://localhost:8080
```

Defaults to the `Anonymous` user — for that to work the PLC's web server must grant
the **Everybody** user the *read variables* right. Otherwise create a web user with
read access in TIA (Security settings → Users and roles) and pass its credentials.

## PLC prerequisites (one-time, in TIA)

1. CPU Properties → **Web server** → enable (HTTPS).
2. Web server **user management**: give Everybody (or a dedicated user) *read variables*.
3. Download hardware config (CPU stop — needs a maintenance window).

## Pages

- **Overview** — connection, DI/DO on-counts, event counters, watch mirror
- **Digital In / Digital Out / Analog** — every IO tag from the project's tag tables,
  grouped by tag table, filterable, live lamps/values
- **Watch** — add any `DbName.member` by name (e.g. `TCP_1.Status`); persisted in
  `watch.json` next to the server
- **Events** — live event log: system/conveyor mode changes, pallet movements
  (with barcode + WMS task context on elevator events), elevator/conveyor/drive
  faults. Filterable by category + text; per-day JSONL download.

## Event logging

Rules live in `events-config.mjs` (every member verified against the project
extract). The engine (`events.mjs`) edge-detects on each poll cycle and appends
to `logs/events-YYYY-MM-DD.jsonl`; the UI shows the last 150 live.

- **Two capture modes, switched automatically:**
  - **PLC ring buffer (preferred)** — if the `EVENT_LOGGER` package
    (`../plc-logger/EVENT_LOGGER_PKG.scl`) is in the PLC and called from Main,
    events are captured **scan-accurately in the PLC itself** (500-entry ring in
    `EVENT_LOG_DB`, PLC timestamps). The server drains it and remembers its
    position (`logs/plc-drain-state.json`), so **server outages lose nothing**
    until the ring wraps (500 events). Poll rules switch off automatically.
  - **Polling fallback (~1 s resolution)** — without the PLC package, the server
    edge-detects on poll snapshots. Pulses shorter than a poll cycle can be
    missed; latching faults and pallet dwell times are safely above that.
- **"Who authorised Manual"** — the PLC has no user member; mode events log
  when, not who. If the HMI is ever changed to mirror its logged-in user to a
  PLC tag, set `USER_VAR` in `events-config.mjs` and mode events pick it up.
- Null transitions (comm loss / first poll) are never logged as events.
- Cat/Code decode map lives in `plc-log.mjs` — keep in sync with the SCL header.

## Files

- `server.mjs` — Web API proxy + page server (poll ~0.75 s, chunked batch reads)
- `index.html` — the dashboard (data-driven from `/state`; nothing hardcoded)
- `tags.mjs` — GENERATED IO register; regenerate with `gen-tags.mjs`
- `gen-tags.mjs` — builds `tags.mjs` from a bridge `/tia/extract-project` dump
- `mock-plc.mjs` — fake Web API for offline testing:
  `node mock-plc.mjs` then `PLC_PORT=9443 PLC_PLAIN_HTTP=1 node server.mjs 127.0.0.1 commission test`

## Notes

- FW V2.9 has the Web API but **not** WebApp hosting — that's why this runs on a PC.
  If the CPU is ever upgraded to FW ≥ V3.0, the page can be pushed onto the PLC itself
  (see `exports/SRL-1427-500802-PACKML/commissioning-hmi/plc-dash/deploy.mjs`).
- Data is polled, not pushed — expect ~1 s latency; the CPU web server runs at low
  priority and cannot disturb the control program.
