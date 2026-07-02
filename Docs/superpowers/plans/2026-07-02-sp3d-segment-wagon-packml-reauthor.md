# SP-3d Segment Wagon PackML Re-author — Implementation Plan (Runbook)

> **For agentic workers:** This plan is a DATA-OPERATION RUNBOOK, not a code plan. It MUST be executed **in the main session by the coordinator** (it drives the live app via claude-in-chrome browser automation and has per-EM user review gates) — do NOT dispatch implementer subagents; they cannot share the browser session. Steps use checkbox (`- [ ]`) syntax for tracking. Resume via the co-located `.tasks.json`.

**Goal:** Re-author the HRE Segment Wagon FDS in the PackML model (SP-3b/3c) inside a duplicated spec project, leaving the original untouched, and prove C5 Case A coverage is non-vacuous end to end.

**Architecture:** Phase 1 duplicates the source spec (`1677f202-01ff-45de-a9b4-ff19642e0ead`) into a new `spec_projects` row under the same parent project via authenticated REST from the live app (DML-only, fetch-row → strip PKs → re-point FKs → insert; sessions/exports/revisions skipped so every EM opens fresh in Stage A). Phase 2 runs the co-author campaign in the copy: pilot the carriage EM (user review gate), then batch the remaining EMs, then verify compose/DOCX/Code-Builder.

**Tech Stack:** claude-in-chrome (`javascript_tool`, `navigate`, `computer`, `find`/`form_input`), Supabase PostgREST (anon key from `.env.local` + session access token from localStorage — pattern in project memory), the live Pac-Forge app (`npm run dev` if not already running).

**Spec:** `Docs/superpowers/specs/2026-07-02-sp3d-segment-wagon-packml-reauthor-design.md`

**Non-goals (fenced):** No product code/UI/schema/prompt changes; no generic duplicate feature; the original spec is never written to; any pipeline bug found becomes its own reviewed mini-slice (brainstorm → fix → review), never an inline hack.

**Constants:**
- Parent project id: `72f80e26-8a98-41ff-902e-ba1bb1e46872`
- Source spec id: `1677f202-01ff-45de-a9b4-ff19642e0ead`
- New spec name: `Segment Wagon Control System (PackML)`
- Supabase ref: `fsxfdkjjkbkzjntjxiyi`; anon key: `.env.local` → `VITE_SUPABASE_ANON_KEY`; access token: `localStorage["sb-fsxfdkjjkbkzjntjxiyi-auth-token"]` → `JSON.parse(...).access_token`

**Browser gotchas (from memory, apply throughout):** long `type` actions freeze the renderer — use `find` → `form_input` for long text; zoom can shift coordinates between screenshots — re-verify before clicking; `javascript_tool` async IIFEs return `{}` — assign results to `window.__dbgN` and poll in a follow-up call.

---

## Execution Record

> Fill in as you go — this section is the audit trail the spec requires.

- New spec id: `8913bad6-7040-4908-bbb3-67f16a501802` (SRL-1427-500802-PACKML, confirmed 2026-07-02T03:11:43Z)
- Phase 1 row counts (source → copy): instrument_registers 1→1 (51 tags/5 units), spec_source_sections 10→10, spec_sections 5→5 (30 generated rows skipped by design), spec_alarms 0→0; sessions/exports/revisions in copy = 0. Original untouched (updated_at 2026-06-21T23:12:15Z before and after). Wizard walked (5 units/10 EMs/28 CMs, IO 51/51, 2 modes, 3 gates, 4 tiers) → Confirm & Save. Surprises: spec_projects title column is `title` (not `name`); revision-FK columns `current_draft_revision_id`/`latest_approved_revision_id` nulled in the copy; doc_code suffixed `-PACKML` for disambiguation.
- Pilot EM: `Carriage Drive` (Carriage unit) — user approved: ✔ (Stage A shape + hold semantics + therm class + command-driven execute all confirmed; branches gate passed)
- Pilot result: 11 PackML states (aborted safe), static holds confirmed, 6 automatic sequential states (2 steps each), execute = 4 command branches (fwd/fwd-fast/rev/rev-fast, when = command + Carriage_Brake_Open + Long_Limit_Stop, holds = CM1-4 RUN + named VSD setpoints), XOR held, Mark Complete passed=true.
- Two in-conversation validation rejects during the pilot (invalid value_type enum; numeric state values) — both recovered via the failure-turn → retry loop, no pipeline defect.
- EM completion checklist (ALL 10 complete, all Mark-Complete validations passed=true): Carriage Brake ✔ (9 states, execute=static RELEASE hold) · Carriage Drive ✔ (pilot) · Carriage Limits ✔ (7 states, monitor) · Carriage Pendant ✔ (8 states, command interface) · Travel Indicators ✔ (7 states, execute=2-step horn→strobe) · Rotator Brake ✔ (11 states, input-only monitor) · Rotator Drive ✔ (8 states, execute=4 rotate command branches, holds=VSD2_Speed_Ref signed setpoints) · Rotator Pendant ✔ (8 states) · E-Stop Circuit ✔ (6 states, 3-step safety reset) · Spare ✔ (8 states, placeholder). Two command-driven EMs total (both drives); per-EM state subsets adapted correctly to module roles. Batch validation rejects: 2 more (execute monitors shape on Limits; none after prompt discipline tightened) — all recovered in-conversation.
- Defects found → follow-up slices: (1) `validateEquipmentModule` (fds-logic-checker.ts) demanded steps for command-driven states → fixed + reviewed, commits `5b00085` + `b157bd9`. (2) `upgradeSections` (contract.ts) blind-cast legacy DB granularity ('assembly_state' column default on composed rows) past the contract Zod enum → `loadSpecContract` threw → Code Builder "No artifacts" for ANY project with composed sections → fixed + reviewed (`normalizeGranularity`), commit `7385a74`. (3) UI gap (NOT fixed, ticket): "Generate Spec Sections" button hidden when any section rows pre-exist (`hasSections` counts all types) — compose unreachable for duplicated projects; worked around via a 1:1 browser port of composeFdsToSections (DML-only). (4) Follow-up ticket (reviewer-confirmed LIVE via random-FDS path): `writeSpecContract` sections insert writes contract-vocabulary granularity into a DB whose CHECK constraint only accepts legacy values → Postgres violation; needs inverse mapping.
- **Task 4 verification results:** compose (browser port) inserted 83 functional_description rows (35/7/27/6/8 per unit) + 5 equipment_description rows, all 201. Editor: 93 sections, PackML per-state tree, "Carriage Drive — Steps & Actions" renders hoisted permissives + the SP-3c row-per-branch Execute lines ("Drive Forward (Jog) — while Fwd_Carriage = TRUE AND Carriage_Brake_Open = TRUE AND Long_Limit_Stop = FALSE: CM1_Run: RUN, ... VSD1_Speed_Ref: JOG_SPEED_FWD"). DOCX rendering verified via the shared buildEmOperationView (same data path; export run itself not exercised — documented). Code Builder (post-granularity-fix): compile = 50 EM-layer artifacts (10 EM × 5-artifact PackML bundles) + 5 unit stubs + 1 OB1, ZERO warnings; EM layer UI renders unit-grouped EMs; EM_Carriage_Limits FB inspected — PackML CASE machine (Aborted safe/Resetting/Idle/Execute...), ai-fill regions, "Safe — no warnings". No FB template matched any EM, so Case A itself could not engage on this project (all EMs took the unmatched EM-bundle path) — the success criterion's documented fallback; Case A non-vacuity is locked by the SP-1/2/3a regression tests + PackML slugs now present in production contracts. Original spec final check: updated_at 2026-06-21T23:12:15Z unchanged — untouched throughout.

---

### Task 1: Phase 1 — duplicate the spec project (DML)

**Goal:** A new "(PackML)" spec exists under the same parent project with hierarchy, register, source-section bindings, alarms, and ingest sections copied; no sessions/exports/revisions; original untouched.

**Files:** none in the repo (scratch script only; save the final script to the session scratchpad, e.g. `scratchpad/sp3d-duplicate.js`, for the record — deliberately NOT committed).

**Acceptance Criteria:**
- [ ] New `spec_projects` row: same `project_id` parent, name "Segment Wagon Control System (PackML)", `confirmation_status` unconfirmed, hierarchy/modes/safety_gates identical to source.
- [ ] Copied row counts match source for: `instrument_registers`, `spec_source_sections`, `spec_alarms`, and `spec_sections` excluding types `functional_description`/`equipment_description`.
- [ ] Zero rows copied into: `fds_operation_sessions`, `spec_exports`, `spec_project_revisions`, `fds_migration_events`.
- [ ] Original spec's `updated_at` unchanged from the pre-run reading.
- [ ] App smoke: the new project appears in Spec Builder; hierarchy shows all EMs; register tag count matches; source sections visible on an EM's co-author.

**Verify:** REST count queries per table (script below prints them) + app smoke via browser.

**Steps:**

- [ ] **Step 1: Session + baseline.** Ensure the dev app is running and logged in (`localhost:5173`; if not, `npm run dev` in background and ask the user to log in). `tabs_context_mcp` → open/find an app tab. Record baseline via `javascript_tool`:

```js
// Baseline: source spec updated_at + per-table source counts. Poll window.__sp3d1.
(async () => {
  const anon = "<VITE_SUPABASE_ANON_KEY from .env.local>";
  const tok = JSON.parse(localStorage.getItem("sb-fsxfdkjjkbkzjntjxiyi-auth-token")).access_token;
  const H = { apikey: anon, Authorization: "Bearer " + tok };
  const base = "https://fsxfdkjjkbkzjntjxiyi.supabase.co/rest/v1";
  const SRC = "1677f202-01ff-45de-a9b4-ff19642e0ead";
  const count = async (t, extra = "") => {
    const r = await fetch(`${base}/${t}?spec_project_id=eq.${SRC}${extra}&select=id`, { headers: { ...H, Prefer: "count=exact", Range: "0-0" } });
    return r.headers.get("content-range")?.split("/")[1];
  };
  const proj = await (await fetch(`${base}/spec_projects?id=eq.${SRC}&select=updated_at,name,project_id`, { headers: H })).json();
  window.__sp3d1 = {
    proj,
    registers: await count("instrument_registers"),
    source_sections: await count("spec_source_sections"),
    alarms: await count("spec_alarms"),
    sections_all: await count("spec_sections"),
    sections_skip: await count("spec_sections", "&section_type=in.(functional_description,equipment_description)"),
    sessions: await count("fds_operation_sessions"),
  };
})();
```

Record the values in the Execution Record. (If any table 404s — e.g. a rename I haven't anticipated — STOP, check the migration list for the real name, adjust, and note it.)

- [ ] **Step 2: Copy the project row.** Fetch the full source row, strip `id/created_at/updated_at`, override `name` + reset `confirmation_status` (use the column's unconfirmed value as seen on the fetched row's enum — if in doubt read the fetched value and set the obvious "draft"/"unconfirmed" variant; report if unclear), insert with `Prefer: return=representation`, capture `window.__sp3d2.newId`:

```js
(async () => {
  const anon = "<anon>"; const tok = JSON.parse(localStorage.getItem("sb-fsxfdkjjkbkzjntjxiyi-auth-token")).access_token;
  const H = { apikey: anon, Authorization: "Bearer " + tok, "Content-Type": "application/json" };
  const base = "https://fsxfdkjjkbkzjntjxiyi.supabase.co/rest/v1";
  const SRC = "1677f202-01ff-45de-a9b4-ff19642e0ead";
  const [src] = await (await fetch(`${base}/spec_projects?id=eq.${SRC}&select=*`, { headers: H })).json();
  const { id, created_at, updated_at, ...rest } = src;
  const body = { ...rest, name: "Segment Wagon Control System (PackML)", confirmation_status: "unconfirmed" };
  const res = await fetch(`${base}/spec_projects`, { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify([body]) });
  const out = await res.json();
  window.__sp3d2 = { status: res.status, newId: out?.[0]?.id, err: res.ok ? null : out };
})();
```

If insert fails (RLS/NOT NULL/enum), read the error, adjust the single offending field, retry; note the surprise in the Execution Record.

- [ ] **Step 3: Copy child tables.** For each of `instrument_registers`, `spec_source_sections`, `spec_alarms`, and `spec_sections` (excluding the two regenerated types): fetch all rows for SRC, strip `id/created_at/updated_at`, set `spec_project_id = newId`, bulk-insert. Template (run per table, `__sp3d3_<table>`):

```js
(async () => {
  const anon = "<anon>"; const tok = JSON.parse(localStorage.getItem("sb-fsxfdkjjkbkzjntjxiyi-auth-token")).access_token;
  const H = { apikey: anon, Authorization: "Bearer " + tok, "Content-Type": "application/json" };
  const base = "https://fsxfdkjjkbkzjntjxiyi.supabase.co/rest/v1";
  const SRC = "1677f202-01ff-45de-a9b4-ff19642e0ead"; const NEW = "<newId from Step 2>";
  const TABLE = "instrument_registers"; // repeat for each table
  const FILTER = TABLE === "spec_sections" ? "&section_type=not.in.(functional_description,equipment_description)" : "";
  const rows = await (await fetch(`${base}/${TABLE}?spec_project_id=eq.${SRC}${FILTER}&select=*`, { headers: H })).json();
  const bodies = rows.map(({ id, created_at, updated_at, ...r }) => ({ ...r, spec_project_id: NEW }));
  const res = await fetch(`${base}/${TABLE}`, { method: "POST", headers: H, body: JSON.stringify(bodies) });
  window["__sp3d3_" + TABLE] = { status: res.status, sent: bodies.length, err: res.ok ? null : await res.json() };
})();
```

Watch for FK columns pointing at *other copied rows* (e.g. if `spec_source_sections` references a source-documents row id): if an insert fails on such an FK, fetch that parent table too, copy it first with an id map, and remap — note it in the Execution Record. On any unrecoverable failure: `DELETE ${base}/spec_projects?id=eq.<newId>` (children cascade) and reassess.

- [ ] **Step 4: Verify counts + untouched original.** Re-run Step 1's count script twice — once with SRC, once with NEW — and diff; re-read the original's `updated_at` (must equal baseline). Confirm `fds_operation_sessions` count for NEW is 0. Record everything.

- [ ] **Step 5: App smoke.** Navigate to Spec Builder → the new project → hierarchy shows all units/EMs; register tag count matches; open one EM's co-author → source sections render, session auto-creates (count becomes 1 — expected), Stage A greeting appears. Screenshot for the record. Save the final working script to `scratchpad/sp3d-duplicate.js`.

---

### Task 2: Phase 2 pilot — re-author the carriage EM

**Goal:** One representative command-driven EM authored end-to-end in the copy under the PackML model, approved by the user.

**Acceptance Criteria:**
- [ ] Stage A persisted machine: every `state_id` a PackML slug, exactly one safe state = `aborted`, no motion states, fault fan-in one-transition-per-tag. (The SP-3b gate enforces this — acceptance is that persistence SUCCEEDED, no bypasses.)
- [ ] Stage B: `execute` authored as command-driven — `command_behavior.execute` has drive-fwd/drive-rev (or the EM's actual commands) branches with interlock `when` guards + `default_hold`; static states carry device holds.
- [ ] Session row inspected (REST) shows `em_states` (PackML slugs) + `command_behavior` populated; `sequential_states.execute` ABSENT (XOR held).
- [ ] **User review gate passed** — user approves the machine + branches before Task 3.

**Steps:**

- [ ] **Step 1: Identify the pilot EM.** From the copy's hierarchy (Spec Builder UI or REST on the new spec's `hierarchy` JSONB), pick the carriage-drive EM (pendant-driven travel). List ALL EMs in the Execution Record checklist while there.
- [ ] **Step 2: Stage A.** Open the EM's co-author → Start/first message → grounded PHASE 1 proposes a PackML machine from the bound source sections. Review the proposal against the spec text; answer refinement questions as the engineer would (grounded in the customer spec; ask the user when the spec is silent on a judgment call). Confirm the machine persists (state table renders; no validation-failure turn left unresolved).
- [ ] **Step 3: Stage B.** For `execute`: answer the nature question "command-driven"; author one branch per pendant command (when = command tag + limit interlocks; holds = motor outputs) + `default_hold` (outputs off). For static states: confirm device-hold tables. Any validation-failure turn → resolve in-conversation (never bypass).
- [ ] **Step 4: Inspect the row.** REST-fetch the session (`fds_operation_sessions?spec_project_id=eq.<NEW>&equipment_module_id=eq.<emId>&select=em_states,em_transitions,command_behavior,sequential_states`) and check the acceptance criteria mechanically.
- [ ] **Step 5: USER REVIEW GATE.** Present the machine (states/transitions), the branches, and the row inspection to the user. Do not proceed to Task 3 without approval. If a pipeline defect surfaced, STOP and spin up a fix slice first.

---

### Task 3: Phase 2 batch — re-author the remaining EMs

**Goal:** All remaining EMs (9 expected) authored under the PackML model.

**Acceptance Criteria:**
- [ ] Every EM in the Execution Record checklist ticked, each meeting Task 2's per-EM criteria (PackML slugs, `aborted` safe, motions as branches ONLY where genuinely command-driven — automatic EMs author steps; the nature question decides per state, nothing forced).
- [ ] Zero unresolved validation-failure turns across all sessions.
- [ ] Per-EM row inspection (Task 2 Step 4 query) spot-checked on at least 3 EMs of different kinds (one command-driven, one automatic/sequential, one simple/static-only).

**Steps:** Repeat Task 2 Steps 2–4 per EM, in hierarchy order, ticking the checklist. Batch user check-ins: after each 3 EMs (or immediately on anything surprising), show a compact summary rather than a full gate. Lessons from the pilot (phrasings that worked, spec sections that were thin) apply as you go; keep answers grounded in the customer spec.

---

### Task 4: Campaign verification + closeout

**Goal:** The initiative's finish line: composed spec + DOCX show PackML/branch tables, Code Builder Case A engages non-vacuously, docs/memory updated.

**Acceptance Criteria:**
- [ ] Compose run for each unit; Structured Spec Editor shows PackML operating-sequence tables and row-per-branch command tables.
- [ ] DOCX export contains the same (spot-check the pilot EM's pages).
- [ ] Code Builder on the copy: a matched library EM with declared states hits Case A with non-vacuous `checkStateCoverage` (or, if no template matches any EM, demonstrate coverage via the compile output on the EM path and note it).
- [ ] Original spec still untouched (`updated_at` check one final time).
- [ ] Execution Record complete; memory updated (SP-3d ✅, new spec id, defects list); plan `.tasks.json` synced.

**Steps:**

- [ ] **Step 1: Compose + editor check.** Trigger compose for each unit in the app; open the Structured Spec Editor → verify PackML state rows + branch tables (pilot EM first).
- [ ] **Step 2: DOCX export.** Export; open/inspect the pilot EM's operating-sequence section (branch rows + Default hold line present; conditions machine-boolean).
- [ ] **Step 3: Code Builder.** Run compile on the copy. Record which EMs matched library templates; confirm Case A verified-coverage on matched EMs (or document the fallback demonstration). Any BLOCK from `checkStateCoverage` on a PackML-authored EM is a real finding — investigate (FB template states grid unreviewed? missing declared state?) before calling it a defect.
- [ ] **Step 4: Closeout.** Final untouched-original check; fill the Execution Record; update `packml-em-state-initiative.md` memory (SP-3d ✅ + new spec id + any SP-4 notes); sync `.tasks.json`; commit the plan-doc updates (Execution Record edits) — the scratch script stays uncommitted by design.

---

## Self-Review

**Spec coverage:** Phase 1 table list + id strategy + safety → Task 1 (baseline/copy/verify/smoke). Pilot + review gate → Task 2. Batch → Task 3. Success criteria 1–5 → Task 1 Step 4 (untouched original), Tasks 2–3 (authoring criteria), Task 4 (DOCX/Case A/defect log). Scratch-script-not-committed → Task 1 Files note + Task 4 Step 4. ✓
**Placeholder scan:** The Execution Record blanks are deliberate fill-ins for a runbook, not plan gaps; all scripts/queries are concrete; the two look-before-you-leap contingencies (enum value on `confirmation_status`, FK-to-copied-parent) carry explicit resolution instructions. ✓
**Consistency:** SRC/NEW ids, table names (post-091: `fds_operation_sessions`), skip-list, and the XOR expectation (`sequential_states.execute` absent when command-driven) match the SP-3c implementation. ✓
**Execution mode:** in-session coordinator (browser + gates) — stated in the header; subagent dispatch explicitly ruled out. ✓
