# Handover — G9 validation ladder, warm-up lap in progress (2026-07-22)

> Written mid-session while switching PCs. Read this + `Docs/superpowers/plans/2026-07-22-g9-validation-ladder.md`
> (the ladder plan) and you have full context. Board: Forja, G9 phase.

## Where we are

The G9 validation ladder (FDS → running PLC, 4 complexity levels) is planned and
**the pre-flight warm-up lap is in progress**. We are at: random FDS generated and
confirmed, codegen verified complete, **Send to TIA not yet executed** — that is
the very next action.

- Warm-up spec: **"Pneumatic Conveying & Drying System for Plastic Pellets"**,
  spec_project `d13fb020-1b01-45f0-b8fe-30e26b44c2ac` (doc RAND-MRW027FK), 2 units /
  4 EMs / 12 CMs, confirmed. Codegen verified against the live rows: **32 artifacts,
  zero warnings** (4 EM bundles, 2 UCs, CFG/STAT, maintenance layer, SINA_SPEED drive
  DB, OB1). Fine to reuse it or generate a fresh random spec — both exercise the same path.

## Resume steps on the new PC

1. `git pull` (this doc + today's commits).
2. **TIA Portal V20 open** (no project needed — or a scratch project).
3. **Start the V20 bridge manually** — ⚠️ `npm run dev` auto-starts only the **V18**
   bridge (port 5103, stale v1.2.0). The app's Send-to-TIA / HMI panels talk to
   **5102 = V20**:
   `dotnet run --project bridge/PacForgeBridge/PacForgeBridge.csproj`
   Verify: `GET http://localhost:5102/tia/status` → `bridge_version: "1.3.0"`.
   (`connected:false` is normal — lazy attach.)
4. First call that touches Portal pops the **Openness whitelist prompt** (new exe
   checksum) → Accept. Looks hung until accepted.
5. `npm run dev`, log in.
6. Open the confirmed random spec → **Code Builder** (now lands on the EM step) →
   **Send to TIA → Assemble program → Import + compile**. Expect a shakeout round of
   SCL quirks; fix each generically via the gap protocol (board row per gap).
7. After clean compile: HMI panel → Build in TIA; then Level 1 (paste-ready brief in
   the ladder plan doc). While in Unified: the two 60-second G8-3/G8-4 probes
   (manually create a text list + a user role; do the dialogs exist?).

## What shipped today (all committed on master)

| Commit | What |
|---|---|
| `53e580d` | G9 validation-ladder plan doc (4 levels + pre-flight + gap protocol) |
| `fd4671c` / `5db68fd` | Roadmap: G6-7 row added → SHIPPED |
| `269f9f0` | **G6-7 Promote to library** — deriveFbTemplate (deterministic pin roles from writer conventions, FDS states, contract born reviewed), usePromoteFbTemplate, PromoteLibraryPanel in Code Builder; round-trip test (promoted CM template contract-wires in a different project). Status: Awaiting Testing — validate on the ladder (promote Level 1 blocks → instantiate in Level 2) |
| `2313ab2` | **Warm-up gap 1 (G9-W1)**: spec_sections granularity CHECK still had pre-ISA-88-rename vocabulary; migration `20260722000000` **applied to production** (drop → map rows → re-add + default), fds-compose writes V2 values, regression test |
| `d91f467` | **Warm-up gap 2 (G9-W2)**: Code Builder opened on the empty Device step for fully-synthesized projects (device FBs only exist via library instantiation — basic control is inlined into EM/MAP). Auto-advance to EM step + explanatory empty state |

## Board state (Forja 5099871231)

- **G9-1** Plan Created (ladder doc attached to G9 phase as Monday Doc 9509647).
- **G9-W1 / G9-W2** Done (gap-protocol rows, origin comments on each).
- **G6-7** Awaiting Testing (item 3104452298).

## Open items / gotchas

- `scripts/dev.mjs` starting only the V18 bridge is a footgun (bit us today) —
  consider making it start V20 (5102) too, or switching the default; not yet a board row.
- Supabase migration history verified in sync (`migration list`) after the push;
  `db push` remains Kasper-gated.
- The edge-function non-streaming Fable text-block fix is still **not deployed**
  (`supabase functions deploy generate`) — co-author streams, so not urgent.
- G8-3/G8-4 Openness probes still pending (do during the TIA session).
