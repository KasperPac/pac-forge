# PLC-hosted commissioning dashboard — on-site runbook

Goal: the dashboard served **by the PLC itself** — type the PLC's IP in any
browser on the machine network, get the dashboard. No laptop server.

State as of 2026-07-08: **offline port complete and mock-tested** (all 8 tabs,
pendant hold-to-run, forces, alarms, session recovery — zero console errors).
Feasibility confirmed against the live PLC: `Api.Browse` on 192.168.0.10 lists
the full `WebApp.*` method set. Remaining work is the live deploy below.

## Files

| file | role |
|---|---|
| `index.html` | GENERATED — do not edit. Built from `../index.html` by `build.mjs` |
| `plc-client.js` | in-browser data layer (replaces `../server.mjs`): login overlay, batched reads, watchdog, alarms, seq runner |
| `build.mjs` | regenerate `index.html` after ANY edit to `../index.html` (`node build.mjs`) |
| `mock-plc.mjs` | offline test rig: `node mock-plc.mjs` → http://localhost:8090, login `commission` / `test` |
| `deploy.mjs` | pushes the app onto the PLC web server over the Web API |

## On-site deploy (~30 min, machine can keep running — no TIA, no download)

1. Laptop on the machine network (PLC = `192.168.0.10`).
2. ```
   cd exports/SRL-1427-500802-PACKML/commissioning-hmi/plc-dash
   node build.mjs                     # only if ../index.html changed since 2026-07-08
   node deploy.mjs 192.168.0.10 commission <password>
   ```
   The script checks permissions first. If it warns about a missing web-app
   right: TIA → Security settings → Users and roles → the commission user's
   role → runtime rights → "manage user pages" → download (machine stopped).
   That is the ONLY path that needs TIA.
3. Open `https://192.168.0.10/~dash/` — accept the self-signed cert once —
   log in as `commission`.
4. Shakedown checklist (compare against the laptop version if in doubt):
   - [ ] Overview tiles + rail/rotator mimic show live values (not `—`)
   - [ ] IO page: every lamp tracks its input; force a non-safety DI in
         maintenance mode; banner + auto-clear on maintenance exit
   - [ ] Pendant: arm, hold a button → motion; release stops ≤1.5 s;
         close the tab mid-hold → PLC guard drops the bit (dead-man)
   - [ ] Permissives: blocking terms highlight correctly
   - [ ] Alarms: trip an input → raise; restore → clear + history
   - [ ] VFD page: ZSW1 bits move, setpoint SET writes stick
   - [ ] Settings: presets + envelope writes work (maintenance mode)
   - [ ] Second device (phone) logged in at the same time — both live
5. If all good, make the bare IP land on the dashboard:
   ```
   node deploy.mjs 192.168.0.10 commission <password> --set-plc-default
   ```
   (If `WebServer.SetDefaultPage` fails, set the entry page in TIA:
   PLC → Web server → Entry page.)

## Gotchas / design notes

- **Sessions**: the page stores its token in `localStorage` so reloads reuse
  ONE session (G2 session pool is finite, sessions linger 30 min). Login only
  from the overlay; never hammer `Api.Login`.
- **Watchdog**: the page kicks `Sim_CMD.watchdog_kick` each poll (~0.5–0.8 s)
  while the sim pendant is armed; the PLC-side `SIM_Input_Guard` clears
  everything if kicks stop for 1.5 s. If arming won't stick on site, check
  poll round-trip time on the Alarms/console.
- **Forces don't raise alarms** — by design: the alarm mirror senses PHYSICAL
  tags; forces act at the `IO_Cond` seam downstream.
- **Redeploys**: just re-run `deploy.mjs` — resources are deleted/recreated.
- Known cosmetic: routine "Brake EMs reach Execute" checks state == 6 but the
  Carriage Brake EM's Execute is index 7 → that step never auto-ticks
  (pre-existing, also in the laptop version).
