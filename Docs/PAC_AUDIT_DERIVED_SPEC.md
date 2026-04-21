# Pac-Audit Derived Spec — Design Plan

**Status:** DRAFT
**Owner:** Kasper
**Created:** 2026-04-21

## 1. Goal

Pac-Audit extracts an existing TIA Portal project and analyses every block. Today it stops at block-level facts (purpose, interface, state machine, call graph). This plan adds a **second layer** — a machine-centric "derived spec" — assembled from the extraction + AI + engineer verification.

The derived spec shares its shape with the FDS Builder's output (`SpecContractV2`). Both modules converge on the same kind of structured machine understanding; they just get there from different starting points:

| Module | Input | Process | Output |
|---|---|---|---|
| FDS Builder | customer requirements | AI interviews engineer → builds spec from scratch | `SpecContractV2` + DOCX for customer approval |
| Pac-Audit | existing TIA code | extract + AI analyse + engineer verifies | `SpecContractV2`-shaped derived spec, internal-only |

The derived spec is editable, internal, not exported. Engineers use it as a lens when modifying or upgrading an older codebase.

## 2. Architectural approach

**Light + medium** depth:

- **Light (types):** the derived spec is a `SpecContractV2`. Audit imports the types directly. No new `core/` type layer for v1 — if we see genuine divergence later, lift then.
- **Medium (DB):** one new jsonb column on `audit_projects` to hold the derived spec as it's built up. Three new tables for FB classification, IO-FB linking, and reference doc ingest.
- **Cross-reference graph bulk-extracted at audit time:** the existing `audit_cross_references` table (schema-only today) gets populated during Extract by pulling TIA Openness' cross-reference provider. All trace / link / walk logic becomes **SQL queries against local data** — no AI for trace, no source parsing, no per-interaction bridge roundtrips. Stale-snapshot detection via a modified-timestamp on `audit_projects`; refresh is an explicit engineer action.

No spec-builder table changes. No attempt to share storage between projects. Each Pac-Audit session owns its own derived spec.

### 2.1 Deterministic-first principle

A strict rule-vs-AI boundary applies everywhere:

1. **If a fact is computable from structured data** (cross-references, HW config, tag tables, VAR declarations) — extract it deterministically. No AI.
2. **If a fact is in structured source** (SCL declarations, SimaticML for LAD/FBD, GRAPH step definitions) — convert deterministically to a canonical form before any reasoning.
3. **If a fact requires inference from prose or ambiguous structure** (intent, meaning, non-standard patterns) — only then use AI, and require evidence citations and explicit confidence flags.
4. **Ambiguous outputs go to the engineer**, not to the AI as tiebreaker, wherever practical.

The intended bound on AI usage — everything else is deterministic:
- Purpose / one-sentence intent summary
- Detailed notes / prose observations about invariants
- Fault handling description (detection is deterministic; prose isn't)
- Verify interview clarifying questions
- FDS prose prior extraction
- Non-standard state machine transitions (seal-in chains, custom step counters)
- Classification tiebreakers where heuristics produce ambiguous output

This matters because: the existing Analyze step AI-extracts everything at once (interface, data flow, state machine, timing, fault handling, code quality). Large prompt, slow, probabilistic. Refactoring toward deterministic-first cuts AI per-block load by roughly 70% and improves reliability. See §7 (existing-Analyze refactor) and §8 (LAD/FBD linear-form converter).

## 3. Data model changes

One migration: `073_pac_audit_derivation.sql`.

### 3.1 Columns added to `audit_projects`

```sql
ALTER TABLE audit_projects
  ADD COLUMN derived_spec jsonb NOT NULL DEFAULT '{}',        -- SpecContractV2-shaped
  ADD COLUMN derived_spec_version int NOT NULL DEFAULT 0,     -- increments on every patch
  ADD COLUMN spec_provenance jsonb NOT NULL DEFAULT '{}',     -- field-level source tracking
  ADD COLUMN tia_project_modified_at timestamptz,             -- captured at Extract; used for stale detection
  ADD COLUMN cross_refs_extracted_at timestamptz;             -- when audit_cross_references was populated
```

`spec_provenance` tracks which fields came from which source, e.g.:
```json
{
  "hierarchy.subsystems.0.assemblies.0.devices.0": "extracted",
  "hierarchy.subsystems.0.assemblies.0.devices.0.description": "doc_ingest",
  "assemblies.ASM01.sequential_states.AUTO.steps.3": "interview"
}
```
Values: `extracted | classified | traced | doc_ingest | interview | engineer_edit`.

### 3.2 Existing tables with new population paths

#### `audit_cross_references` — now populated during Extract

Schema exists (migration 070) but was never wired up. Needs to become the **primary data source for Trace**. Current shape assumes target is always a block; extend to support tag/address targets via `reference_details` jsonb.

New indexes needed for trace query patterns:

```sql
-- Fast "who writes this tag" / "who reads this tag"
CREATE INDEX idx_audit_xref_tag_writers
  ON audit_cross_references (audit_project_id, reference_type, (reference_details->>'tag'))
  WHERE reference_type = 'writes';
CREATE INDEX idx_audit_xref_tag_readers
  ON audit_cross_references (audit_project_id, reference_type, (reference_details->>'tag'))
  WHERE reference_type = 'reads';
-- Fast "who writes this absolute address"
CREATE INDEX idx_audit_xref_address
  ON audit_cross_references (audit_project_id, (reference_details->>'address'));
-- Fast call-graph traversal
CREATE INDEX idx_audit_xref_calls
  ON audit_cross_references (audit_project_id, source_block_id, reference_type)
  WHERE reference_type IN ('calls', 'instantiates');
```

See §12 for bridge work required to populate this table.

### 3.3 New tables

#### `audit_fb_classifications`
Per-FB role assignment in the machine hierarchy.

```sql
CREATE TABLE audit_fb_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_project_id uuid NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,
  block_id uuid NOT NULL REFERENCES audit_blocks(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN (
    'device_fb', 'assembly_fb', 'subsystem_fb', 'sequence_fb',
    'utility_fb', 'safety_fb', 'comms_fb', 'ob', 'unknown'
  )),
  auto_confidence numeric CHECK (auto_confidence BETWEEN 0 AND 1),
  auto_reason text,
  engineer_confirmed boolean NOT NULL DEFAULT false,
  engineer_override_role text,
  hierarchy_assignment jsonb,  -- { subsystem_id?, assembly_id?, device_id? } after linkage
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (block_id)
);
CREATE INDEX idx_audit_fb_class_project ON audit_fb_classifications(audit_project_id);
CREATE INDEX idx_audit_fb_class_role ON audit_fb_classifications(audit_project_id, role);
```

#### `audit_io_fb_links`
Materialised result of the IO-to-device-FB walk. Populated by the Trace step via a SQL function that runs the recursive graph walk over `audit_cross_references`. One row per physical IO address.

The table exists as a **cache for UI speed** — without it, the recursive CTE runs every time the Trace review panel opens. Engineer confirmations / overrides also live here.

```sql
CREATE TABLE audit_io_fb_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_project_id uuid NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,

  -- IO side (known from HW config)
  io_address text NOT NULL,                   -- "%Q0.5"
  io_module_ref text,                         -- MLFB / slot reference from audit_hardware_config
  symbolic_tag text,                          -- "M03_CMD" (from tag table join) — may be null
  direction text NOT NULL CHECK (direction IN ('input', 'output')),

  -- Walk result (populated by Trace; engineer-editable)
  device_fb_block_id uuid REFERENCES audit_blocks(id) ON DELETE SET NULL,
  device_fb_instance_path text,               -- "PROGRAM.FB_LIFT_COORD.LIFT01_MOT_INST"
  walk_path jsonb,                            -- ordered list of hops [{block_id, kind, via}]
  walk_status text NOT NULL CHECK (walk_status IN (
    'resolved', 'multiple_writers', 'indirect', 'unclassified', 'unresolved'
  )),
  walk_notes text,                            -- human-readable description of why it's not resolved

  -- Physical device attribution (defaults from HW config naming, overridable)
  physical_device_guess text,                 -- "M03"
  physical_device_source text CHECK (physical_device_source IN (
    'hw_config', 'doc_ingest', 'engineer'
  )),

  -- Engineer confirmation
  engineer_verified boolean NOT NULL DEFAULT false,
  engineer_override_device_fb_block_id uuid REFERENCES audit_blocks(id) ON DELETE SET NULL,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (audit_project_id, io_address)
);
CREATE INDEX idx_audit_iofb_project ON audit_io_fb_links(audit_project_id);
CREATE INDEX idx_audit_iofb_device_fb ON audit_io_fb_links(device_fb_block_id);
CREATE INDEX idx_audit_iofb_status ON audit_io_fb_links(audit_project_id, walk_status);
```

#### `audit_reference_docs`
Uploaded reference material (old FDS, IO list, P&ID, commissioning notes). Used as priors during Verify.

```sql
CREATE TABLE audit_reference_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_project_id uuid NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN (
    'fds', 'io_list', 'p_and_id', 'electrical_schematic',
    'commissioning_notes', 'hmi_export', 'other'
  )),
  filename text NOT NULL,
  storage_path text,                          -- Supabase Storage bucket path (optional)
  raw_text text,                              -- extracted prose (mammoth/pdfjs-dist)
  parsed_priors jsonb NOT NULL DEFAULT '{}',  -- { devices?, tags?, states?, alarms? ... }
  parse_status text NOT NULL DEFAULT 'pending'
    CHECK (parse_status IN ('pending', 'parsed', 'failed')),
  parse_error text,
  uploaded_at timestamptz DEFAULT now(),
  uploaded_by uuid REFERENCES auth.users(id)
);
CREATE INDEX idx_audit_refdocs_project ON audit_reference_docs(audit_project_id);
```

All three tables get RLS policies mirroring `audit_blocks` (scoped through `audit_project_id → audit_projects.user_id`).

## 4. Pipeline changes

### 4.1 Step flow

**Current:** Connect → Extract → Select → Analyze → Review → Ready

**Proposed:** Connect → Extract → Select → Analyze → **Classify** → **Trace** → **Verify** → Ready

Reference-doc ingest is not a discrete step — it's a side action available from the Verify step (or any time after Connect). Uploaded docs feed the Verify agent's priors.

### 4.2 New step specs

#### Classify
**Input:** `audit_blocks` with `analysis_status='understood'` and their `audit_block_understanding` rows.
**Process:**
1. Deterministic heuristic pass — see §5 for rules.
2. AI refinement pass — for each block, send source + understanding + heuristic guess to Claude; ask for role + reason + confidence. Capped at ~50 blocks per batch to manage tokens.
3. Persist to `audit_fb_classifications`.
4. Build a **candidate hierarchy**: group device_fbs by their callers' assembly_fbs, group assembly_fbs by subsystem patterns (folder structure, naming prefix). Write to `audit_projects.derived_spec.hierarchy`.

**Output:** classified FBs + candidate hierarchy skeleton.
**Engineer can:** override any auto-classification before continuing.

#### Trace
**Input:** populated `audit_cross_references` graph + `audit_hardware_config.io_modules` + `audit_tag_tables` + `audit_fb_classifications` (Classify must run first).
**Process:** entirely deterministic graph walk — no AI, no source parsing, no role inference.

1. For each IO address in HW config (`%Q0.5`, `%I0.0`, etc.), look up the symbolic tag via `audit_tag_tables` join and the module channel via `audit_module_channels`.
2. Run a recursive SQL walk over `audit_cross_references`, joined with `audit_fb_classifications`. The walk uses classifications — set by §5 — as its **termination contract**, not something it infers:
   - **Outputs** (walk backward): seed with `writes` of the symbolic tag → for each writer, check its classification:
     - classified as `device_fb` → **terminal, walk ends**
     - classified as `assembly_fb`, `sequence_fb`, or `comms_fb` → continue walking back (what data feeds this block's write?)
     - classified as `utility_fb` or `ob` writing directly to IO → unusual, flag but treat as terminal
     - no classification row → `walk_status='unclassified'`; engineer must classify in §5 review, then re-run Trace
   - **Inputs** (walk forward): seed with `reads` of the symbolic tag → filter readers to the one(s) classified as `device_fb` (multiple allowed — an input can feed several device FBs). Non-`device_fb` readers are consumers of the device's logical output, not the device itself.
3. Persist one row per IO address in `audit_io_fb_links` with the walk result and a `walk_status`:
   - `resolved` — single clear terminal device FB
   - `multiple_writers` — >1 `device_fb` writer of the same output (code smell; flag for engineer)
   - `indirect` — terminates at a UDT slice or a param binding that can't be statically resolved (e.g., `MOT[i]` where `i` is HMI-driven)
   - `unclassified` — walk hit a block with no classification row; blocks resolution until Classify rerun
   - `unresolved` — no writer/reader found at all (orphan IO — real issue in the code, or extraction gap)
4. Physical device guess: from HW config device naming (`%Q0.5` on "Motor 3 VFD" → `M03`). If uploaded reference docs include an IO list with tag→device mapping, that wins over HW config.

**Output:** materialised `audit_io_fb_links` table.
**Engineer handles:** `indirect`, `multiple_writers`, `unresolved` rows in the Trace review panel (§11.3). `resolved` rows usually pass without scrutiny; engineer can still override physical device attribution.

No confidence scoring: the walk is either resolved (deterministic) or flagged (explicit reason). No middle ground.

#### Verify (replaces Review)
**Input:** derived_spec + classifications + IO-FB links + uploaded docs.
**Process:**
1. Streaming AI interview, pattern mirrors `use-fds-conversation.ts`.
2. Walk per-assembly, per-state. For each, the agent presents: "I found assembly X with devices A, B, C, sourced from FBs F1/F2/F3. Device A's IO `MOT[5]` maps to M03 based on HW config. Operating state AUTO has a sequence extracted from F3's CASE logic — can you confirm the transitions?"
3. Reference doc priors surface when relevant: "Old FDS mentions 'fault recovery state' — I don't see this in the code. Should I add it to the spec?"
4. AI emits JSON deltas against `derived_spec`. `extractJsonFromResponse` parses, patch is applied server-side via RPC, `derived_spec_version` increments.
5. Conversation persists to `audit_conversations` (existing table, context_type='verification').

**Output:** confirmed / corrected derived_spec.
**Engineer can:** edit the spec directly through the existing FDS table-pane components — not only through the interview.

## 5. FB classification

Rules first, AI only for genuine tiebreakers. Run in three deterministic passes; fall back to AI (or engineer) only on residual ambiguity.

### 5.1 Deterministic rules (primary path)

Run in order; first rule to match wins.

| Rule | Signal source | Role |
|---|---|---|
| `block_type = 'OB'` | `audit_blocks.block_type` | `ob` |
| FB in folder path `/Library/`, `/Utilities/`, `/Utility/` | `audit_folders.path` | `utility_fb` |
| Name matches standardised utility patterns (`PID_`, `Scale_`, `Ramp_`, `Norm_`, `Lim_`, `Avg_`) | `audit_blocks.name` regex | `utility_fb` |
| Reads safety-named tags (regex: `ESTOP\|E_STOP\|DOOR_\|LIGHT_CURTAIN\|GUARD_\|SAFETY_`) | `audit_cross_references` + `audit_tag_tables` | `safety_fb` |
| Has state variable + CASE statement | `audit_block_understanding.state_machine.mechanism='case_on_variable'` | `sequence_fb` |
| Has `step_counter` or `seal_in_latch_chain` mechanism | `audit_block_understanding.state_machine.mechanism` | `sequence_fb` |
| Has IO-direct interface params (reads/writes `%I`/`%Q` directly) | `audit_cross_references` with `target='absolute_address'` | `device_fb` |
| Instantiates ≥2 FBs that have already been classified as `device_fb` (second pass) | `audit_cross_references` `reference_type='instantiates'` | `assembly_fb` |
| Name matches comms/HMI patterns (`HMI_`, `DATA_EXCH_`, `COMMS_`) | `audit_blocks.name` regex | `comms_fb` |
| Called once, only from an OB, and instantiates ≥1 `assembly_fb` | call graph from cross-refs | `subsystem_fb` |
| Called once, only from an OB, no assembly_fb children | call graph | `sequence_fb` (tentative — flag for review) |

Every deterministic match is 100% confident in the attribution — no fractional confidence scoring. The rule either fires or it doesn't. The **engineer review panel** (§11.2) surfaces the rule that matched, so the engineer sees why.

### 5.2 Two-pass ordering

- **Pass 1**: OB, utility, safety, comms, device, sequence (all leaves based on intrinsic properties)
- **Pass 2**: assembly, subsystem (depend on what their children were classified as)

### 5.3 Residual ambiguity

What slips through after both passes:
- Blocks that instantiate nothing and have no obvious role signals → `unknown`
- Custom patterns the rules don't catch (company-specific FB templates)

Two paths to resolve, in order of preference:
1. **Engineer resolves directly in the review panel** — cheapest, most reliable. Engineer picks the role from a dropdown; populates the table.
2. **Optional AI tiebreaker** — only if the engineer doesn't want to classify manually and the `unknown` bucket is large. AI gets FB source + call graph + heuristic misses, returns `{ role, reason }` with a "not certain — needs confirmation" flag. Engineer reviews anyway.

No AI in the common path. The deterministic rules should handle >90% of blocks in well-structured projects. Spaghetti projects shift ambiguity to the engineer, not to the AI.

### 5.4 Edge: blocks with mixed responsibilities

Occasionally a block is "a device FB that also implements its own sequence logic." Real but uncommon. Deterministic rules will match whichever signal fires first (probably `sequence_fb` because of CASE detection). Engineer can add a secondary role in the review panel — schema supports `primary_role` + `secondary_role` if we need it, otherwise engineer notes in `walk_notes`-equivalent field. Don't over-design for rarity.

## 6. IO-to-FB tracing

The whole subsystem reduces to **one recursive SQL walk** against `audit_cross_references`, seeded from HW config IO addresses and terminating on classifications already set by §5. No source parsing, no AI, no heuristics — and no role inference inside the walk. Classifications are an input, not an output.

### 6.1 The walk, conceptually

Given `%Q0.5` → symbolic tag `M03_CMD` (from tag table), with classifications from Classify step already in `audit_fb_classifications`:

1. Find the direct writer(s) of `M03_CMD` in `audit_cross_references`. Usually one FB does `M03_CMD := ...`.
2. Look up the writer's classification:
   - **`device_fb`** → terminal, done. This block is the device.
   - **`assembly_fb` / `sequence_fb` / `comms_fb`** → this is a dispatcher / coordinator / data-movement block. Continue the walk: what data feeds the RHS of its write? Typically a UDT field like `gDB_Motors.MOT[5].CTRL.RunFwd`, or another intermediate tag.
   - **`utility_fb` / `ob` writing IO** → unusual pattern; stop but flag for review.
3. Find writers of `gDB_Motors.MOT[5].CTRL.RunFwd` (or `MOT[<x>]` where cross-refs captured the literal 5). Cross-refs resolve this to an FB instance writing its output pin; the instance's type block is the terminal — check its classification confirms `device_fb`.

Same pattern in reverse for inputs — walk forward from `%I0.0` through readers, keep only those classified `device_fb` as the device-identification answer. Other readers are just consumers of the device's logical state, not the device itself.

### 6.2 The SQL shape

Implementation-sketch (refined during build):

```sql
CREATE FUNCTION trace_io_to_device_fb(
  p_audit_project_id uuid,
  p_io_address text
) RETURNS TABLE (
  io_address text,
  symbolic_tag text,
  device_fb_block_id uuid,
  walk_path jsonb,
  walk_status text
) AS $$
BEGIN
  -- Step 1: resolve IO address → symbolic tag via audit_tag_tables
  -- Step 2: recursive CTE walking writers backward (or readers forward)
  --         through audit_cross_references. Stop condition:
  --         current block is an FB type (not instance), and the write
  --         is on a block-interface output pin (not a UDT slice write).
  -- Step 3: return terminal FB + the ordered walk_path + status.
  RETURN QUERY WITH RECURSIVE walk AS (
    -- seed
    SELECT /* ... */ FROM audit_cross_references
    WHERE audit_project_id = p_audit_project_id
      AND reference_type = 'writes'
      AND reference_details->>'tag' = /* symbolic tag for p_io_address */
    UNION ALL
    -- recurse
    SELECT /* ... */ FROM audit_cross_references xr
    JOIN walk w ON /* ... */
    WHERE w.kind = 'dispatcher_write' /* continue walking */
  )
  SELECT /* ... */ FROM walk WHERE is_terminal;
END;
$$ LANGUAGE plpgsql;
```

Actual implementation: exact recursion depends on what shape TIA Openness returns for cross-refs. Finalise when we see real data from the bridge.

### 6.3 UDT array indices (the edge case)

**V3-confirmed behaviour** (see §12.0): cross-refs capture *both* literal and wildcard array indices, in `Location.Name`:

- **Compile-time constant index** → literal `[n]`, one `Location` per distinct element: `"DB_SENSORS".SENSOR_FB[15]._ClearDly`, `[16]`, `[22]`, etc. Walk follows the literal to a specific device-FB instance.
- **Runtime-variable index** (loop counter, HMI selector, state counter) → wildcard `[*]`: `"DB_VSD_MOTOR".MOTOR_G120C_FB[*]._OUT_Flt_Not_Run`. Walk returns `walk_status = 'indirect'` and engineer resolves in Trace review panel.
- **Array-type references** (e.g. `SENSOR_FB[*]` as a multiinstance data type, not an element access) also use `[*]` — but `Access == Multiinstance` distinguishes these from element-level reads/writes. Ignore for device-attribution purposes.

Classification for trace: if bracket content matches `\d+` → literal (follow); `*` → indirect (flag); anything else (e.g. `[V1.0]` library version suffix) → ignore as non-array.

### 6.4 Physical device attribution

After the walk determines the device FB instance, attribute the physical device name:

1. **HW config device naming** — `audit_hardware_config.io_modules[].description` often contains the physical device name for its channels. First pass.
2. **Reference doc priors** — if uploaded IO list has a tag→device mapping, overrides HW config.
3. **Engineer override** — during Trace review or Verify, engineer can correct.

No confidence scoring — source is tracked via `physical_device_source` enum; engineer either verifies or doesn't.

### 6.5 Edge cases, all statically detectable

| Situation | `walk_status` | Engineer action |
|---|---|---|
| Single clean writer chain, terminates on `device_fb` | `resolved` | Usually just verify |
| >1 `device_fb` writer of same output | `multiple_writers` | Flag as code smell; pick primary or fix |
| Terminal writer is via `MOT[*]` with runtime index | `indirect` | Provide index-to-device mapping manually |
| Walk hit a block with no classification row | `unclassified` | Classify the block in §5 review panel, re-run Trace |
| No writer found | `unresolved` | Orphan output — real issue in the code, or extraction gap |
| POKE / BLKMOV indirect writes | `indirect` | Rare; engineer describes binding |

## 7. Deterministic refactor of the existing Analyze step

Pac-Audit's existing `audit-analyze.tsx` flow sends each block's source to Claude with a single prompt, asking the AI to return `purpose`, `category`, `interface_contract`, `data_flow`, `state_machine`, `timing`, `fault_handling`, and `code_quality` all at once. Most of those are computable without AI. This section proposes the refactor.

### 7.1 Current AI fields → deterministic equivalents

| Field | Current source | Proposed source |
|---|---|---|
| `interface_contract.inputs/outputs/in_out/members` | AI | **Deterministic** — parse FB interface declarations (VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT, VAR, VAR_STAT). SCL/STL/LAD all expose the same interface grammar via Openness. |
| `data_flow.called_blocks` | AI | **Deterministic** — query `audit_cross_references` where `reference_type='calls' OR 'instantiates'` and `source_block_id = this block`. Enriched with call_context (instance_db / static_call / parameter_call) via cross-ref details. |
| `data_flow.reads_from` / `writes_to` | AI | **Deterministic** — query `audit_cross_references` where `reference_type='reads'/'writes'`. Classify `kind` from target type (project_db, global_memory, io_input, etc.) deterministically. |
| `data_flow.key_static_vars` | AI | **Deterministic** — parse VAR (STAT) declarations + usage frequency from cross-refs. "Role" inference (e.g., "retentive" flag) is from declaration. |
| `timing_analysis.timers_used` | AI | **Deterministic** — grep VAR declarations for timer types (`TON`, `TOF`, `TP`, `IEC_TIMER`, `TIMER`). Preset source classification (static / parameter / constant / db_field) from parser. |
| `state_machine.mechanism` detection | AI | **Deterministic** — pattern match source for `CASE <var> OF`, sealed-coil chains, step-counter patterns (e.g., `IF STEP = 10 THEN STEP := 20;`). |
| `state_machine.states` (CASE-based) | AI | **Deterministic** — enumerate CASE arms. |
| `state_machine.transitions` (CASE-based) | AI | **Deterministic** — parse the assignments to state variable inside each arm; emit `{from, to, condition}`. |
| `fault_handling` detection (present / absent) | AI | **Deterministic** — check for writes to fault-tag-named symbols or to a fault DB. |
| `category` | AI | **Deterministic via classification rules** (§5.1) — replaces this field in favour of `audit_fb_classifications.role`. |

### 7.2 AI-only residue

After the refactor, the AI prompt per block is **much smaller** and covers only:

- **`purpose`** — one-sentence intent summary
- **`detailed_notes`** — invariants / observations
- **`state_machine.transitions`** for non-standard mechanisms (`step_counter`, `seal_in_latch_chain`, `other`)
- **`fault_handling.description`** — prose about failure modes (when detection fires)
- **`code_quality.risks`** — judgments that need engineering context
- **`code_quality.analysis_confidence`** + `confidence_notes` — AI's self-assessment

Typical token drop: 2k → ~400 tokens per block. Faster, cheaper, more reliable.

### 7.3 What to do with blocks already analyzed

Existing `audit_block_understanding` rows were written by the old AI-only path. Options:

- **Leave them** — `is_current` flag stays true; new audits use the new path. Old audits stay on old data.
- **Backfill** — for current-is_current understandings on blocks whose source hasn't changed, run the deterministic extractors and merge fields (overwrite interface/data_flow/timing; preserve purpose/notes). Optional; nice-to-have.

No production data exists yet, so we can just delete `audit_block_understanding` rows and re-analyze under the new pipeline.

### 7.4 Implementation shape

New libs:

```
src/lib/audit-analysis/
  interface-extractor.ts       # FB interface parsing
  data-flow-extractor.ts       # cross-ref joiner + kind classifier
  timing-extractor.ts          # timer grep
  state-machine-detector.ts    # pattern matching for mechanism + CASE states
  fault-handling-detector.ts   # fault write detection
  analysis-orchestrator.ts     # runs all deterministic passes, then calls AI only for residue
```

The existing `audit-analyze.tsx` becomes a caller of `analysis-orchestrator.ts` which bundles deterministic + AI together. Engineer sees the same end-result; the difference is internal.

## 8. LAD / FBD linear form converter

The deterministic-first principle applies to LAD/FBD reading too: convert SimaticML to a linear SCL-like text before AI touches it.

### 8.1 Why

LAD SimaticML XML is verbose and topology-heavy (wires referencing UIds). Claude reads it but mistakes on complex rungs are common. A linear form converter produces text Claude reads reliably, at ~10× lower token cost.

### 8.2 Conversion target

Example:

**SimaticML (abbreviated):**
```xml
<Parts>
  <Access UId="21"><Symbol>Start_Btn</Symbol></Access>
  <Access UId="22"><Symbol>Stop_Btn</Symbol></Access>
  <Access UId="23"><Symbol>Motor_Running</Symbol></Access>
  <Part Name="Contact" UId="24"/>
  <Part Name="Contact" UId="25" Negated="true"/>
  <Part Name="O" UId="26"/>
  <Part Name="Coil" UId="27"/>
</Parts>
<Wires>...UId references...</Wires>
```

**Linear form (the converter's output):**
```
RUNG 1 [Motor start/stop seal-in]:
  (Start_Btn OR Motor_Running) AND NOT Stop_Btn  ->  Motor_Running := TRUE
```

All operand names preserved verbatim. Comments preserved as `[bracketed]` annotations. Timer/counter/FB calls emit as function-call syntax.

### 8.3 Pipeline

```
SimaticML XML
    │
    ▼  (deterministic parse)
Pac-LAD internal data model (LadProgram, LadRung, LadNode, LadSeriesChain, LadElement)
    │
    ▼  (deterministic walk + format)
Linear SCL-like text
    │
    ▼
AI analyzer reads this instead of raw XML
```

The intermediate representation already exists — `src/types/lad.ts` defines the Pac-LAD data model used for rendering. We get a dual-use parser: **feed it into linear-text renderer + existing SVG renderer**, pick which view the AI or engineer needs.

Converting SimaticML → `LadProgram` is the reverse of the existing `lad-xml-builder.ts` (which does `LadProgram → SimaticML` for TIA import). A lot of the logic is mirrorable.

### 8.4 When this converter is needed

Not required for day one. Build-triggered by the pilot:

- If the pilot shows AI analysis of LAD blocks is unreliable → build the converter
- If the project is mostly SCL + GRAPH with minor LAD → defer

Default: SCL/STL go to AI as raw source. LAD/FBD go to AI as raw SimaticML initially. Measure, then decide.

### 8.5 SVG rendering stays

Pac-LAD's SVG rendering is kept as **engineer-facing verification**, not as AI input. When the Verify step says "rung 3 of FB_LIFT controls the motor start seal-in", the engineer can click to see the rendered rung and confirm visually. Free value — the render pipeline is already built.

### 8.6 FBD and GRAPH

- **FBD** uses the same SimaticML dialect as LAD but with function blocks instead of contacts/coils. Same converter, with FB-call emission instead of boolean expressions. Same decision: build triggered by pilot.
- **GRAPH** (SFC) is already step/transition-structured in its XML. AI reads the XML form directly. No linear conversion needed — the XML itself is close to a linear form already.

## 9. Document ingest

Deterministic-first also applies here. AI is only used for extracting priors from genuine prose; everything else is engineer-selected or structured parsing.

### 9.1 Upload + extract

Reuse `src/lib/document-extractor.ts` (mammoth for DOCX, pdfjs-dist for PDF, both client-side).

```ts
// src/lib/audit-doc-ingest.ts
export async function ingestReferenceDoc(
  file: File,
  docType: ReferenceDocType,   // engineer selects on upload — no AI classification
  auditProjectId: string,
): Promise<AuditReferenceDoc> {
  const raw = await extractText(file);
  const structured = await extractTables(raw);        // deterministic — mammoth preserves table structure
  const priors = await extractPriors(raw, structured, docType);  // deterministic OR AI per doc_type
  return persistReferenceDoc({ ... });
}
```

**No AI doc-type classification.** Engineer selects the type in the upload dialog. File dropdown: FDS / IO list / P&ID / Electrical schematic / Commissioning notes / HMI export / Other. Faster and more reliable than any AI classifier.

### 9.2 Prior extraction per doc type (deterministic vs AI split)

| Doc type | Extraction | Why |
|---|---|---|
| `io_list` | **Deterministic** — parse extracted tables, match columns by header name (regex: `tag\|symbol`, `address\|io\|%`, `device\|location\|equipment`, `description`). Each row → `{ tag, address?, physical_device?, description? }`. | IO lists are always tabular. Prose-free. |
| `hmi_export` | **Deterministic** if XML/TIA export (structured). AI if free-form text (rare). | XML is parseable. Mammoth handles the rest. |
| `p_and_id` | **Deterministic** — regex for tag patterns (`[A-Z]{1,3}-?\d+\|\d{3,4}[A-Z]+`). Flat list of found tags; topology not extracted in v1. | Keep simple. |
| `fds` | **AI** with strict schema — device_names[], assembly_names[], operating_states[], sequence_intent{ state_id → prose }. Cite evidence (paragraph references). | Genuine prose; no reliable structural signal. |
| `commissioning_notes` | **AI** with free-text retention — extract named entities (tags, device IDs, operating modes) to flat list; full text retained for injection into Verify agent context. | Semi-structured but highly variable. |
| `electrical_schematic` (PDFs from ePLAN, etc.) | **Deterministic** text-layer tag extraction (regex same as p_and_id). No topology. | Vector PDFs have searchable text; images don't — those fall to engineer notes. |

**Priors are hints, not ground truth.** Verify agent frames them as "old FDS says X — do you want to keep this?" — engineer always has the final say.

### 9.3 When priors apply

- **Classify:** name-based hints only ("old FDS names this FB as a motor wrapper" → nudge toward `device_fb` — still runs through deterministic rules as primary)
- **Trace:** tag → physical device mapping via `io_list` priors (direct resolution path when HW config naming is ambiguous)
- **Verify:** injected into system prompt as priors; agent cross-checks against extracted facts ("code says X, old FDS says Y — please confirm")

## 10. Verification interview

### 10.1 Shape

Mirrors `use-fds-conversation.ts` + `use-fds-orchestration-conversation.ts`:

```ts
// src/hooks/use-audit-verify-conversation.ts
export function useAuditVerifyConversation(auditProjectId: string) {
  const { derivedSpec, classifications, ioFbLinks, refDocs, ... } = useAuditContext(auditProjectId);

  const buildSystemPrompt = useCallback(() => buildVerifyPrompt({
    derivedSpec,
    classifications,
    ioFbLinks,
    refDocPriors: refDocs.flatMap(d => d.parsed_priors),
    hierarchyScope: currentScope, // subsystem / assembly / state narrowing
  }), [...]);

  const processAiResponse = useCallback((fullText: string) => {
    const deltas = extractJsonFromResponse(fullText);
    // each delta is a JSON Patch-style mutation against derived_spec
    return deltas.map(d => ({ scope, patch: d }));
  }, []);

  // ... streaming logic ...
}
```

### 10.2 Conversation scoping

The Verify agent walks the hierarchy top-down, one assembly at a time. Scope is stored in conversation state:
- `{ subsystem_id, assembly_id, state_id? }` — narrows what the agent discusses in each turn

Engineer can jump scope manually via the UI (click an assembly in the derived_spec tree → agent refocuses).

### 10.3 Delta shape

AI emits JSON Patch-ish blocks:
```json
{
  "scope": { "assembly_id": "ASM01" },
  "patches": [
    { "op": "set", "path": "devices.0.device_name", "value": "M03 — Pump Motor" },
    { "op": "set", "path": "sequential_states.AUTO.steps.3.action", "value": "Ramp pump to 80%" },
    { "op": "add", "path": "sequential_states.AUTO.monitors", "value": { ... } }
  ]
}
```

Patches apply via RPC `apply_derived_spec_patch(audit_project_id, scope, patches)` — server validates, bumps `derived_spec_version`, updates `spec_provenance` entries to `interview`.

### 10.4 System prompt structure

```
You are a senior automation engineer helping a colleague understand an existing TIA Portal PLC program.
The colleague has extracted every block and you have AI analysis of each.
Your job is to produce a verified, correct spec of what this machine actually does — structured like an FDS.

Current derived spec (scope: {scope}):
{json}

FB classifications in scope:
- FB_LIFT_MOTOR: device_fb (auto, 0.9 confidence — has IO params + single motor UDT)
- FB_LIFT_COORD: assembly_fb (auto, 0.7 — instantiates two device_fbs)
- FB_LIFT_SEQ: sequence_fb (auto, 0.8 — CASE on LIFT_STATE)

IO-to-FB links in scope:
- gDB_Motors.MOT[5] → FB_LIFT_MOTOR instance LIFT01_MOT_INST → physical device M03 (HW config, 0.9)
- gDB_Motors.MOT[6] → FB_LIFT_MOTOR instance LIFT01_MOT2_INST → physical device M04 (HW config, 0.9)
- Unresolved: gDB_Valves.VLV[2] → referenced in FB_LIFT_COORD, no HW config match

Reference doc priors:
- Old FDS: "Lift Table LIFT01 has two motors and one hydraulic valve. Operating states: IDLE, RAISING, LOWERING, FAULT."

Walk the engineer through the assembly one thing at a time. Confirm what's extracted; ask about what's unclear; flag conflicts between code and docs.

When confirming a fact, emit a JSON block:
```json
{ "scope": ..., "patches": [ ... ] }
```

Keep replies short. One focus per turn.
```

### 10.5 Freeform editing

Engineer isn't locked into the interview. The derived_spec UI (see §9) allows direct editing at any time — that's why `spec_provenance` tracks `engineer_edit` separately. Engineer edits take precedence over AI patches until overwritten.

## 11. UI touchpoints

### 11.1 Pac-Audit wizard — extended step bar

`src/routes/pac-audit.tsx`: add three step cards (Classify, Trace, Verify) with same visual pattern as existing steps. Step bar shows status per step.

### 11.2 Classify review panel

`src/components/pac-audit/steps/audit-classify.tsx` (new):
- Table: FB name | folder | role (auto) | confidence | reason | engineer override
- Bulk-select rows to confirm at once
- Click a row → inspector showing source + AI analysis + heuristic trace

### 11.3 Trace review panel

`src/components/pac-audit/steps/audit-trace.tsx` (new):
- Table: element_path | index resolution | FB | direction | physical device guess | confidence | engineer verify
- Filters: unresolved only / low confidence only / per-FB
- Engineer can provide array index → device mapping in bulk via simple form (e.g., enter MOT 1→M01, 2→M02, ...)

### 11.4 Reference docs panel

`src/components/pac-audit/reference-docs.tsx` (new):
- Sidebar or tab within Verify
- Upload zone (drag-drop), accepts DOCX/PDF
- List of uploaded docs with doc_type + parsed priors summary
- Click doc → modal with raw text + structured priors preview

### 11.5 Verify workspace

`src/components/pac-audit/steps/audit-verify.tsx` (new):
- Left pane: hierarchy tree of derived_spec (subsystem → assembly → device / sequence)
- Center pane: AI chat (streams responses, shows JSON deltas as they apply)
- Right pane: current scope's detail — reuses `fds-table-pane.tsx` for sequential-state editing, new component for static-state editing

### 11.6 Reuse from spec-builder

These components get imported into Pac-Audit verify with minimal changes:
- `src/components/spec-builder/fds-table-pane.tsx` — sequential state step/transition editor
- `src/components/spec-builder/machine-hierarchy-table.tsx` — device/assembly/subsystem editor
- `src/components/spec-builder/pickers/*` — tag picker, fault picker

If deep divergence emerges later, extract shared components to `src/components/machine-spec/`. Not now.

## 12. Bridge work required

The entire Trace approach depends on populating `audit_cross_references` during Extract. Today that table is schema-only. All other changes in this plan are downstream of this.

### 12.0 Step 0 spike findings (V18, 2026-04-21)

Exploratory spike (`TiaPortalService.AuditSpike.cs` + `GET /tia/audit-spike`) ran against a real V18 project — 338 blocks (79 LAD, 39 SCL, 204 DB, 16 safety), 43 devices, 82 Sinamics G120C drives, one Comfort HMI. V1+V2+V3 complete; V20 parity still pending (§16 step 0c).

**Cross-reference API — confirmed shape** (`Siemens.Engineering.CrossReference` namespace):

```
CrossReferenceService                                          // acquired via block.GetService<T>()
  .GetCrossReferences(CrossReferenceFilter filterType)         // single overload
    → CrossReferenceResult
        .Sources : SourceObjectComposition
          SourceObject { Name, Path, Address, TypeName, Device, UnderlyingObject, Children, References }
            .References : ReferenceObjectComposition
              ReferenceObject { Name, Path, Address, TypeName, Device, Locations }
                .Locations : LocationComposition
                  Location {
                    Access,            // enum, 38 values
                    Address,
                    Name,
                    ReferenceLocation, // human-readable, e.g. "@CALL_SENSORS ▶ NW4 (Function Block SENSOR_FB)"
                    ReferenceType,     // enum, 13 values — relationship metadata
                    ReferencedAs,      // IEngineeringObject — live pointer to referenced thing
                    ReferencedAsName,
                    TypeName
                  }
```

Key observations from real cross-ref data:
- `Access` is the **kind of memory access** — `Read`, `Write`, `RW`, `Call`, `InstanceDB`, `Multiinstance`, `Interface`, `Definition`, `Jump`, `Modify`, `Force`, `Monitor`, `Interlock`, plus `*AndSymbol` variants.
- `ReferenceType` is the **relationship direction** — `Uses`, `UsedBy`, `TypeInstance`, `InstanceType`, `Assigns`, `Defines`, `DefinedBy`, `OverlapsWith`, `Scope`, etc. Store both separately in `audit_cross_references`.
- `ReferenceLocation` gives rich text like `"@CALL_SENSORS ▶ NW4 (Function Block SENSOR_FB)"` — save verbatim; no further parsing needed for display.
- `ReferencedAs` returns a **live `IEngineeringObject`** — Trace can follow it to the actual target object instead of re-resolving by string.
- **Service scope:** `block.GetService<>()` returns a service enumerating *that block's* outbound refs. Per-block call ~71ms; 338 blocks × per-block = ~24s worst-case. **Bulk path NOT supported on V18** — V3 confirmed `GetService<CrossReferenceService>()` returns null on `PlcSoftware`, `BlockGroup`, `TypeGroup`, `TagTableGroup`, and `Project`. Per-block iteration is the only V18 path.
- **Array-index resolution** (V3, §6.3 now concrete): both literal and wildcard forms appear in `Location.Name`, context-driven:
  - Compile-time constant index → literal: `"DB_SENSORS".SENSOR_FB[15]._ClearDly`, `[16]`, `[22]`, each a separate `Location`. Trace walk follows directly.
  - Runtime-variable index (loops, HMI-driven) → `[*]`: `"DB_VSD_MOTOR".MOTOR_G120C_FB[*]._OUT_Flt_Not_Run`. Single `Location` represents all possible elements; Trace flags as `walk_status='indirect'`.
  - Distinguishable deterministically: integer inside brackets → literal; `*` → wildcard. Filter out `[V\d+\.\d+]` library version suffixes (e.g. `TON [V1.0]`) to avoid false positives.
  - Also: array-TYPE references (multiinstance FB arrays like `SENSOR_FB[*]` as a data type) use `[*]` in the `ReferenceObject.Name` — different from per-element access. Classify via `Access` enum: `Multiinstance` → type reference, `Read`/`Write` → element access.

Other confirmed facts:
- `_project.LastModified` (DateTime) — the stale-snapshot timestamp. Not `ModifiedDate` or `LastModifiedAt`.
- `_project.HmiTargets` property **absent on V18** — must use the existing `GetHmiTarget()` device-walk. Real project exposed a Comfort HMI (`ScreenFolder`, `TagFolder`, `GraphicLists`, `TextLists`, `VBScriptFolder`).
- **GSDML is project-local**, at `<project_dir>/AdditionalFiles/GSD/` — not a shared AppData cache. The GSDML parser loads from there.
- `IEngineeringObject.GetAttributeInfos()` exposes **all supported attributes** per object — discovery-friendly; use it instead of hard-coded attribute-name lists.
- **Drive-device `Comment` attribute is the physical-device label**: e.g. `"FREEZER Pallet Chain conveyor 1500L-01A Ground Level"`. This should be the primary signal for §12.6 physical-device attribution, outranking name-string heuristics.

**Drive-parameter access — V3 confirmed path:**

Raw `drive.GetAttribute("P304")` etc. returns "not supported" — plain Openness attributes don't expose Sinamics parameters. The working walk (V3 validated on real G120C):

```csharp
var container = driveItem.GetService<Siemens.Engineering.MC.Drives.DriveObjectContainer>();
foreach (DriveObject driveObj in container.DriveObjects) {
    foreach (DriveParameter param in driveObj.Parameters) {
        // param.Name ("p304", "r18", "p922"), .Number (int), .ParameterText (human label),
        // .Value (object), .Unit ("rpm"/"V"/"Arms"/""),
        // .ArrayIndex, .ArrayLength, .EnumValueList, .MinValue, .MaxValue, .Bits
    }
    foreach (Telegram telegram in driveObj.Telegrams) {
        // telegram.TelegramNumber (30 = PROFIsafe, 352 = G120 Standard, ...),
        // .Type ("SafetyTelegram" / "MainTelegram"),
        // .Addresses (input/output address range), .PKW
    }
}
```

Spike F_PCC_01A yielded 2 telegrams (PROFIsafe #30 + Main #352) and dozens of parameters including `r18` ("Control Unit firmware version"), `r20-r27` (speed/voltage/current monitoring), `p10` (commissioning parameter filter). Motor nameplate (P304/P305/P311) and ramps (P1120/P1121/P1135) are in this collection, keyed by `Number`. Telegram selection (P922) is redundant with the `Telegrams` collection's `TelegramNumber` — prefer the latter.

### 12.1 New Openness surface to exercise

~~The exact API surface depends on Openness version~~ — V18 surface now known (§12.0). V20 differences still TBD. Bulk-extract path for `audit_cross_references`: iterate blocks, acquire `CrossReferenceService` per block, flatten `SourceObject.References[].Locations[]` → one row per `(source, referenced_object, location)` triple. If V3 confirms the `PlcSoftware`-level service returns project-wide data, swap to that in a single pass.

### 12.2 Bridge changes

**`TiaPortalService.cs`** — new method `ExtractCrossReferences()`:

```csharp
public List<ExtractedCrossReferenceDto> ExtractCrossReferences()
{
    // 1. Get the cross-reference provider from the project / program service
    // 2. Iterate all source objects (blocks, tags, UDTs)
    // 3. For each, enumerate references → flatten into DTOs
    // 4. Batch-return; caller persists in chunks
}
```

**`Models.cs`** — add `ExtractedCrossReferenceDto` (revised per §12.0 findings):

```csharp
public class ExtractedCrossReferenceDto {
    // Source side — mirrors SourceObject
    public string SourceName { get; set; }           // e.g. "SENSOR_FB"
    public string SourcePath { get; set; }           // e.g. "CVL_2129_5002_PLC_1\Program blocks\DEVICE\FB"
    public string SourceAddress { get; set; }        // e.g. "%FB2" (blocks) — nullable for variables
    public string SourceTypeName { get; set; }       // e.g. "LAD-Function block"
    public string SourceDevice { get; set; }         // e.g. "CVL_2129_5002_PLC_1"

    // Reference target side — mirrors ReferenceObject
    public string TargetName { get; set; }
    public string TargetPath { get; set; }
    public string TargetAddress { get; set; }
    public string TargetTypeName { get; set; }

    // Location — per-occurrence inside source
    public string Access { get; set; }               // Access enum as string (Read/Write/Call/…)
    public string ReferenceType { get; set; }        // ReferenceType enum as string (Uses/UsedBy/…)
    public string ReferenceLocation { get; set; }    // e.g. "@CALL_SENSORS ▶ NW4 (Function Block SENSOR_FB)"
    public string ReferencedAsName { get; set; }
    public string LocationAddress { get; set; }      // absolute/symbolic address at the location (when applicable)

    public Dictionary<string, object> Details { get; set; }  // future-proofing → reference_details jsonb
}
```

One row per `(Source → Reference → Location)` triple. Typical project: 10k–50k rows expected; persisted in batches of 500.

**`BridgeServer.cs`** — extend `/tia/extract-project`:

Add `CrossReferences: ExtractedCrossReferenceDto[]` to `ExtractProjectResponse`. Fold extraction into the existing flow; don't make it a separate endpoint — audit extraction should be one atomic operation from the user's POV.

**`TiaPortalService.GetProjectInfo()`** — return project-last-modified timestamp:

```csharp
public ProjectInfoResponse GetProjectInfo() {
    // existing fields...
    LastModifiedAt = _project.LastModified,  // confirmed V18; DateTime
}
```

Persisted to `audit_projects.tia_project_modified_at` at extraction; compared on audit re-open for stale detection.

### 12.3 Frontend persistence

**`audit-extract.tsx` `persistExtraction()`** — add cross-ref insertion:

```ts
// After blocks/tags/hardware persist:
if (response.crossReferences?.length) {
  await persistCrossReferences(response.crossReferences, blockIdMap);
  await supabase.from("audit_projects").update({
    cross_refs_extracted_at: new Date().toISOString(),
    tia_project_modified_at: response.projectModifiedAt,
  }).eq("id", auditProjectId);
}
```

Batch inserts in chunks of 500 rows — typical projects hit 10k–50k refs.

### 12.4 Openness API verification

**Status after Step 0 V1+V2+V3 (2026-04-21, V18):**

| # | Question | Status |
|---|---|---|
| 1 | What cross-ref provider returns for different block types — UDT array indices resolved as `MOT[5]` or `MOT[*]`? | **Resolved.** Both forms appear, context-driven: literal `[5]` when index is a compile-time constant (separate Location per element), `[*]` when index is runtime-variable. Distinguishable by parsing the bracket content. Deterministic trace is feasible for the literal-index case (common); `[*]` case handled as `walk_status='indirect'` (§6.3). |
| 2 | Performance — full-project enumeration time | **Resolved.** Per-block: ~71ms × 338 blocks ≈ 24s. **Bulk path via container parents is NOT supported on V18** — `GetService<CrossReferenceService>()` returns null on `PlcSoftware`, `BlockGroup`, `TypeGroup`, `TagTableGroup`, and `Project`. Per-block iteration is the only path. 24s is acceptable for Extract. |
| 3 | Coverage — reads/writes to global DBs through UDT paths, ANY/pointer types | **Partial (UDT path confirmed).** Real refs traversed UDT paths cleanly — e.g. `"DB_VSD_MOTOR".MOTOR_G120C_FB[31].VSD_Raw_Min` captured as a single `Location.Name` with full symbolic path. ANY/pointer coverage not exercised in the V18 test project. |
| 4 | V18 vs V20 differences | **V18 done. V20 untested.** Queued as §16 step 0c (requires a V20 project). |

Spike code lives in `bridge/PacForgeBridge/TiaPortalService.AuditSpike.cs` (18 probes total — V1/V2/V3 — all green). Output dumps stashed at `%TEMP%\PacForge\audit_spike_<stamp>\`.

### 12.5 Stale-snapshot detection

Simple flow:
- On `GetProjectInfo()`: capture `LastModifiedAt`
- On audit open: fetch current `LastModifiedAt` from bridge (if TIA Portal is connected)
- If `current > audit_projects.tia_project_modified_at`: banner — "TIA project modified since last extraction — refresh?"
- Refresh action: re-run cross-ref extraction only (don't re-extract all blocks unless source also changed)

### 12.6 Hardware extraction — gaps

The current `ExtractedHardwareDto` from the bridge covers CPU identity, IO module MLFB/slot, and basic network structure. That's not enough for the derived spec — understanding a motor FB requires knowing the VFD's telegram layout; understanding a conveyor FB requires knowing which roller card it's driving; understanding alarm paths requires knowing safety and IO-Link topology.

**Strategy:** most devices in scope (Siemens drives, Interroll / Pulse Roller / Itoh Denki roller cards, SIWAREX load cells, IO-Link masters, HMI panels) describe themselves via **GSDML files** shipped with the vendor. One bridge-side GSDML parser serves the whole ecosystem; vendor-specific labelling sits on top. IO-Link attached devices use **IODD** (different XML schema, also shipped by vendor). Non-PN devices (partner PLCs) use TIA Openness directly.

#### IO module channels

Openness path: `IDeviceItem.Items` for each IO module → enumerate sub-items, each a channel. Capture per channel: address, signal type (DI/DO/AI/AO), safety-channel flag, associated symbolic tag name.

A 32-channel analog card has ~32 rows; typical project has hundreds of channels total. Store in new `audit_module_channels` table (queryable for Trace joins).

#### Siemens drives — Sinamics-only scope

Projects are Sinamics-exclusive, so scope tight. Covers G120, G120C, S120, S210, V90. All PROFIdrive over PROFINET.

Extract per drive:
- Drive family + order number (MLFB) — from `DeviceItem.TypeIdentifier` (e.g. `OrderNumber:6SL3210-1KE18-8AF1/4.7.13`) and `TypeName` attribute (e.g. `G120C PN`).
- **Physical device label** — from `DeviceItem.GetAttribute("Comment")` — real projects use this field for the engineer's human label (e.g. `"FREEZER Pallet Chain conveyor 1500L-01A Ground Level"`). **Primary** attribution source (see §12.0 + revised rule below).
- Motor nameplate (kW, A, rpm, V) — parameters P304/P305/P311, via `DriveObjectContainer` (see path below).
- Ramp times — P1120 (up), P1121 (down), P1135 (OFF3).
- Telegram selection — P922 + derived word structure from GSDML.
- IP + PROFINET station name — from the `PROFINET interface` child `DeviceItem`; attributes include `InterfaceOperatingMode`, `MediaRedundancyRole`, `Label` (e.g. `X150`).

**Parameter access — V3 confirmed:**

Plain `IDeviceItem.GetAttribute("P304")` **fails** — those P-numbers aren't surfaced at the hardware-item attribute layer. V3 walked the full `DriveObject` shape (see §12.0 for the structural dump). Concrete extraction:

```csharp
var container = driveItem.GetService<Siemens.Engineering.MC.Drives.DriveObjectContainer>();
foreach (DriveObject driveObj in container.DriveObjects) {
    var byNumber = driveObj.Parameters.ToDictionary(p => p.Number);
    // Motor nameplate
    double? kw   = (byNumber.TryGetValue(304, out var p304) ? p304.Value as double? : null);
    double? amps = (byNumber.TryGetValue(305, out var p305) ? p305.Value as double? : null);
    double? rpm  = (byNumber.TryGetValue(311, out var p311) ? p311.Value as double? : null);
    // Ramps
    double? rampUp    = (byNumber.TryGetValue(1120, out var p1120) ? p1120.Value as double? : null);
    double? rampDown  = (byNumber.TryGetValue(1121, out var p1121) ? p1121.Value as double? : null);
    // Telegram (prefer Telegrams collection over P922)
    var mainTelegram = driveObj.Telegrams.FirstOrDefault(t => t.Type == "MainTelegram");
    int? telegramNumber = mainTelegram?.TelegramNumber;  // 352 = G120 Standard etc.
}
```

Some params only available if the project was downloaded with Startdrive integration — detect absence gracefully (`byNumber.TryGetValue`). Spike output `UsedProducts` confirmed Startdrive is present for the test project, and all probed parameters returned non-null values.

**Mapping to motor tag** — revised heuristic:

1. **First:** `Comment` attribute on the drive `DeviceItem`. Parse the engineer's label to extract the device tag (e.g. `"1500L-01A"` from `"FREEZER Pallet Chain conveyor 1500L-01A Ground Level"`). Project-configurable regex; default extracts alphanumeric tag-like tokens.
2. **Fallback:** station name pattern match — look for `VFD` (case-insensitive) anywhere in the station name as a token or substring; remove it plus surrounding separators (`_`, `-`); match the remainder against motor tag naming in IO.
3. **Last resort:** engineer confirmation during Verify.

Matches the `VfdParams` + `MotorNameplate` shapes already defined in `spec-contract-v2.ts`.

#### HMI linkage (integrated projects)

Since HMI is linked, walk `_project.HmiTargets` → list of Comfort / Basic / Unified panels. Per panel: model, resolution, IP, firmware. Screen enumeration via `HmiScreenComposition` populates the existing `audit_hmi_screens` table (previously stub).

#### IO-Link — masters and attached devices

IO-Link masters are PN devices from the CPU's POV (e.g., SM1278). The devices on each port are described by IODD, not GSDML.

Per master: MLFB + per-port config (IO-Link mode vs standard DI/DO).
Per attached device: Vendor ID, Device ID, product name, IODD SHA, process-data IN/OUT byte map, parameter set reference.

New `audit_io_link_devices` table (parent-child fits poorly in flat jsonb). New IODD parser (separate from GSDML parser — different schema).

#### Conveyor roller controllers — Interroll, Pulse Roller, Itoh Denki

All three are GSDML-described PROFINET cards (generic PN device ecosystem). Generic extraction via GSDML parser; add a `card_family` label (`interroll_multicontrol` / `pulse_roller_ec` / `itoh_denki_cb016`) based on GSDML `DeviceIdentity.VendorName` match.

Per card extract:
- Vendor + model
- Number of connected roller drives, per-drive ID
- Drive → motor-tag mapping (same heuristic as VFDs)
- Sensor inputs routed through the card (photoeyes, zone detect)

Itoh Denki has IO-Link variants — route those through the IO-Link path.

#### Load cells — SIWAREX + generic

SIWAREX (FTA, FTC, WP241) is the common case, PN-described via GSDML. Extract weighing mode (single / batching / level), load cell count, calibration state.

Non-SIWAREX load cells (Mettler, HBM) also PN via GSDML — capture what GSDML provides; engineer fills behavioural gaps during Verify.

#### Partner PLCs (iDevice shared configs)

A PLC can act as iDevice-provider or iDevice-consumer with another PLC. Openness: `IDeviceItem.IsIDevice` flag + `ProvidedInterfaces` / `ConsumedInterfaces` services.

Capture per partner PLC:
- Station name + IP
- Role (provider / consumer / both)
- Shared signals: direction, local address, partner address, data type

Store within the existing `audit_hardware_config.devices[]` array with `device_kind: 'partner_plc'` and a `partner_plc_details` sub-object carrying the shared-signal inventory. Avoid creating a new table for a relatively narrow case.

#### GSDML parser — shared infrastructure

One bridge-side (C#) GSDML parser serves drives, roller cards, load cells, IO-Link masters, and partner PN devices. GSDML schema is public (PROFINET consortium); library scope ~500–800 lines.

**Source location** — confirmed in Step 0 spike: GSDML files are **project-local at `<project_dir>/AdditionalFiles/GSD/`**, not in a shared AppData cache. The real test project carried 7 GSDML files there (G120C, Beckhoff EL6631 variants, Murrelektronik Impact67). `%AppData%\Siemens\Automation\` contained none; `%ProgramData%\Siemens\Automation\` returned access-denied.

Parser load strategy: iterate `<project_dir>/AdditionalFiles/GSD/GSDML-*.xml` on Extract. Also check `<project_dir>/AdditionalFiles/IODD/*.xml` for IO-Link IODDs (the test project had zero — IO-Link not in scope for the CVL-2129 machine).

Extract per GSDML:
- `DeviceIdentity` (vendor, product, order number, category hint)
- Available modules + IO data sizes
- Parameter blocks (configurable settings, semantic labels)
- Telegram / submodule structure (drive-specific)

Cache by GSDML SHA — a project has 5–20 unique GSDML files; parse once each.

#### Data model additions required

Three changes to the pac-audit schema (folded into migration 073 or a sibling):

```sql
-- Per-channel IO detail — queryable for Trace joins
CREATE TABLE audit_module_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_project_id uuid NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,
  module_name text NOT NULL,              -- the IO module reference (matches audit_hardware_config.io_modules)
  channel_number int NOT NULL,
  io_address text NOT NULL,               -- "%I0.0" / "%Q0.5" / "%IW256" etc.
  signal_type text CHECK (signal_type IN ('DI', 'DO', 'AI', 'AO', 'DIQ', 'RS485', 'other')),
  symbolic_tag text,                      -- from PLC tag table if bound
  is_safety boolean NOT NULL DEFAULT false,
  channel_comment text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (audit_project_id, io_address)
);
CREATE INDEX idx_audit_mod_ch_address ON audit_module_channels(audit_project_id, io_address);
CREATE INDEX idx_audit_mod_ch_tag ON audit_module_channels(audit_project_id, symbolic_tag);

-- IO-Link attached devices (hierarchy — master → port → device)
CREATE TABLE audit_io_link_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_project_id uuid NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,
  master_module_name text NOT NULL,       -- master in audit_hardware_config
  port_number int NOT NULL,
  vendor_id text NOT NULL,                -- IODD vendor ID
  product_id text NOT NULL,               -- IODD device ID
  product_name text,
  iodd_sha text,                          -- parse cache key
  process_data_in jsonb,                  -- byte map
  process_data_out jsonb,
  parameters jsonb,                       -- configured value set if available
  created_at timestamptz DEFAULT now(),
  UNIQUE (audit_project_id, master_module_name, port_number)
);

-- HwDrive shape widening — add to audit_hardware_config.drives[] jsonb objects (schema-free)
-- Fields: { drive_family, mlfb, motor_nameplate: {kw, a, rpm, v}, ramp_up_s, ramp_down_s,
--          telegram_standard, telegram_words, ip_address, station_name, mapped_motor_tag?,
--          parameter_source: 'starter' | 'gsdml' | 'partial' }
```

The `audit_hardware_config.devices[]` and `.drives[]` jsonb arrays stay as-is but carry richer shapes documented in §17. Partner PLCs land in `devices[]` with `device_kind: 'partner_plc'`.

## 13. File layout summary

### New files (20-ish)

```
supabase/migrations/
  073_pac_audit_derivation.sql                     # columns + 3 new tables + xref indexes + RLS + trace RPC

src/types/
  (no new files — extend existing audit.ts and re-use spec-contract-v2.ts)

src/lib/
  audit-classify.ts                                # deterministic rule engine (§5.1)
  audit-classify-prompt.ts                         # tiebreaker AI prompt (only for unknown bucket)
  audit-trace.ts                                   # invokes trace RPC; handles walk_status filtering
  audit-doc-ingest.ts                              # doc upload + prior extraction
  audit-doc-ingest-prompt.ts                       # AI prior extractor for FDS/commissioning prose only
  audit-doc-table-parser.ts                        # deterministic table extraction for IO lists
  audit-verify-prompt.ts                           # verification interview system prompt
  audit-spec-derivation.ts                         # build candidate hierarchy from classifications

src/lib/audit-analysis/                            # §7 — refactor of existing Analyze step
  interface-extractor.ts                           # parse FB interface declarations (VAR_INPUT/OUTPUT/IN_OUT/STAT)
  data-flow-extractor.ts                           # derive from audit_cross_references
  timing-extractor.ts                              # timer type + preset source
  state-machine-detector.ts                        # pattern-match CASE/step-counter/seal-in
  state-machine-case-parser.ts                     # extract states + transitions from CASE arms
  fault-handling-detector.ts                       # detect fault-write patterns
  analysis-orchestrator.ts                         # runs deterministic passes, calls AI only for residue

src/lib/lad-to-linear/                             # §8 — optional, pilot-triggered
  simatic-to-ladprogram.ts                         # reverse of lad-xml-builder.ts
  ladprogram-to-linear.ts                          # walk data model → linear SCL-like text
  fbd-to-linear.ts                                 # same pattern for FBD

src/hooks/
  use-audit-cross-references.ts                    # query + batch insert during extract
  use-audit-classifications.ts                     # CRUD + mutation
  use-audit-io-fb-links.ts                         # query materialised walk results + override
  use-audit-reference-docs.ts                      # upload + query
  use-audit-verify-conversation.ts                 # streaming AI interview
  use-derived-spec.ts                              # read / patch derived_spec via RPC

src/components/pac-audit/steps/
  audit-classify.tsx
  audit-trace.tsx
  audit-verify.tsx

src/components/pac-audit/
  reference-docs.tsx
  derived-spec-tree.tsx                            # left-pane hierarchy in Verify
  stale-snapshot-banner.tsx                        # surfaces on audit re-open if TIA modified since extract

bridge/PacForgeBridge/                             # .NET-side additions
  TiaPortalService.cs                              # + ExtractCrossReferences(), ExtractModuleChannels(), ExtractDriveDetails(),
                                                   #   ExtractIoLinkDevices(), ExtractPartnerPlcs(), ExtractHmiTargets();
                                                   #   extend GetProjectInfo() with modified_at
  Models.cs                                        # + ExtractedCrossReferenceDto, ExtractedModuleChannelDto,
                                                   #   ExtractedDriveDetailDto, ExtractedIoLinkDeviceDto, ExtractedPartnerPlcDto
  BridgeServer.cs                                  # extend ExtractProjectResponse
  HardwareExtractors/                              # organized extraction logic
    GsdmlParser.cs                                 # shared GSDML schema parser (500-800 lines)
    IoddParser.cs                                  # IO-Link IODD parser
    DriveExtractor.cs                              # Sinamics family — param access via DataProvider
    RollerCardClassifier.cs                        # Interroll / Pulse Roller / Itoh Denki identification via GSDML
    IoLinkMasterWalker.cs                          # master → port → attached device enumeration
    PartnerPlcExtractor.cs                         # iDevice provider/consumer + shared signal inventory
```

### Modified files

```
src/routes/pac-audit.tsx                           # step bar adds 3 steps; stale-snapshot banner
src/stores/audit-store.ts                          # add AUDIT_STEPS.CLASSIFY/TRACE/VERIFY
src/types/audit.ts                                 # re-export DerivedSpec = SpecContractV2; add new row types
src/components/pac-audit/steps/audit-extract.tsx   # persist cross-references + modified timestamp
src/lib/tia-bridge-contract.ts                     # add ExtractedCrossReferenceDto + extend ExtractProjectResponse
```

## 14. Non-goals (v1)

- DOCX export of the derived spec
- Bidirectional sync with spec-builder for the same project
- Migration of existing audit data (no production data exists yet)
- Full compiler-grade call-graph symbolic propagation in Trace
- Automated HMI-to-spec alarm list extraction (priors only)
- Shared `core/` type layer (defer until divergence emerges)
- Shared DB tables between audit and spec (deferred indefinitely — jsonb columns are enough)

## 15. Open questions

1. **FB role taxonomy** — the enum in §3.2 has 9 values. Is this the full set? Common additions might include `diagnostic_fb`, `recipe_fb`, `alarm_fb`. Add as needed.
2. **Verify granularity** — per-assembly walk is the default. Should the engineer be able to tell the agent "just go through the IO mappings" (vertical slice) vs "walk me through LIFT01" (horizontal slice)? Probably yes, via scope selector in UI.
3. **Reference doc storage** — Supabase Storage bucket, or just `raw_text` in DB? PDFs can be 5–20 MB; DB bloat concern. Recommend Storage, keep only raw_text + parsed_priors in DB row.
4. **Provenance display** — do we want to surface field-level provenance in the UI (coloured badges: "from code", "from docs", "from interview", "engineer edit")? Useful but adds noise. Defer or prototype.
5. **Interview resumability** — conversations persist, but does the agent know where it left off? `audit_conversations.messages` gives history; agent re-reads on resume. Should be automatic.
6. **PLCSIM / test hook-up** — out of scope for this plan, but the schema already has `audit_test_runs`. Verify step could flag "recommend running test X against state Y" as output — revisit later.

## 16. Implementation sequence (proposed)

Deterministic foundation first. AI layers land on top once the deterministic outputs are verified against a pilot project. T-shirt sizes attached.

0. **Openness API spike — V1+V2+V3 (DONE, V18 only; see §12.0)** — cross-ref API fully mapped (per-block only, bulk unsupported on V18, per-block ~71ms × 338 blocks ≈ 24s); UDT array-index resolution confirmed (literal when index is compile-time constant, `[*]` when runtime-variable, distinguishable); Sinamics drive parameters + telegrams accessible via `DriveObjectContainer → DriveObjects → Parameters/Telegrams`; `Comment`-as-physical-label pattern confirmed; GSDML project-local at `<project>/AdditionalFiles/GSD/`; `_project.LastModified` = stale-snapshot timestamp. Real project: 338 blocks / 43 devices / 82 drives / one Comfort HMI.
0c. **V20 Openness spike** (S) — re-run the V1+V2+V3 probes against a V20 project to catch API drift. Separate session; requires a V20 project open. The bulk-enum negative result especially should be re-verified on V20 — it may differ.
1. **Bridge: cross-ref extraction** (M) — `ExtractCrossReferences()` per-block loop + modified-at timestamp in `GetProjectInfo`. Both V18 and V20 csprojs. DTO shape per §12.2 revised.
2. **Bridge: GSDML + IODD parsers** (M) — standalone parsers (`GsdmlParser.cs`, `IoddParser.cs`). Cache by SHA. Essential infrastructure for all hardware extraction beyond CPU/IO-module basics.
3. **Bridge: hardware extraction expansion — Phase 1** (M) — `ExtractModuleChannels()`, `ExtractHmiTargets()`. Covers the "easy wins" (channel detail + HMI linkage) that don't need GSDML interpretation.
4. **Bridge: hardware extraction expansion — Phase 2** (M) — `ExtractDriveDetails()` (Sinamics), `RollerCardClassifier`, load cell categorisation via GSDML parser. Vendor-specific interpretation on top of generic GSDML.
5. **Bridge: hardware extraction expansion — Phase 3** (M) — `IoLinkMasterWalker()`, `PartnerPlcExtractor()`. IO-Link hierarchy + iDevice partner inventory.
6. **Migration + types + basic CRUD hooks** (M) — DB foundation (including new `audit_module_channels` + `audit_io_link_devices` tables), xref indexes, audit-store step enum, hooks scaffolded.
7. **Extract step: persist cross-refs + hardware expansion** (S) — extend `persistExtraction()` to batch-insert cross-references, module channels, IO-Link devices; widen drive/partner jsonb shapes.
8. **Deterministic Analyze refactor — Phase 1** (M) — `interface-extractor`, `data-flow-extractor`, `timing-extractor`, `fault-handling-detector`.
9. **Deterministic Analyze refactor — Phase 2** (M) — `state-machine-detector` + `state-machine-case-parser`.
10. **Analysis orchestrator** (S) — wires deterministic passes + minimal AI call.
11. **Classify: deterministic rules + UI** (M) — rule engine + engineer review panel. No AI in common path. **Must land before Trace** — Trace walks terminate on classifications.
12. **Trace: RPC + SQL walk** (M) — `trace_io_to_device_fb()` recursive CTE; reads `audit_fb_classifications` as termination contract.
13. **Trace: materialise to audit_io_fb_links + review UI** (M).
14. **Candidate hierarchy derivation** (M) — roll classifications + IO links up into `derived_spec.hierarchy`. Drive/partner-PLC details carry through as device context.
15. **Document ingest — deterministic path** (S) — table parser for IO lists, XML parsers for HMI exports.
16. **Document ingest — AI path** (S) — FDS / commissioning prose with strict schema.
17. **Pilot checkpoint** — run full extract → analyze → classify → trace on a real TIA project. Evaluate: AI analysis quality, LAD reading reliability, classification accuracy, hardware extraction coverage (do drives/roller cards/IO-Link come through correctly?). **Gate: decide whether LAD linear-form converter is needed.**
18. **[Conditional] LAD / FBD linear-form converter** (M–L) — only if pilot showed LAD analysis unreliable.
19. **Verify: system prompt + conversation hook** (M).
20. **Verify: JSON delta patch RPC** (S).
21. **Verify: UI (chat + hierarchy + scope editor)** (L).
22. **Stale-snapshot banner + refresh path** (S).
23. **Polish, provenance surfacing, edge cases** (M).

Rough total (without §18): L+M·12+S·8 ≈ 7–9 focused weeks if one person, faster with agents. Steps 0–5 are bridge-heavy (.NET work); steps 6+ are frontend/DB. Pilot checkpoint (step 17) is the key de-risk gate before the expensive Verify UI work.

## 17. Appendix: TS type sketches

```ts
// src/types/audit.ts — additions

import type { SpecContractV2 } from "@/types/spec-contract-v2";

export type DerivedSpec = SpecContractV2;  // alias for intent

export type FbRole =
  | "device_fb"
  | "assembly_fb"
  | "subsystem_fb"
  | "sequence_fb"
  | "utility_fb"
  | "safety_fb"
  | "comms_fb"
  | "ob"
  | "unknown";

export interface AuditFbClassification {
  id: string;
  audit_project_id: string;
  block_id: string;
  role: FbRole;
  auto_confidence: number | null;
  auto_reason: string | null;
  engineer_confirmed: boolean;
  engineer_override_role: FbRole | null;
  hierarchy_assignment: {
    subsystem_id?: string;
    assembly_id?: string;
    device_id?: string;
  } | null;
  created_at: string;
  updated_at: string;
}

export type IoDirection = "input" | "output";
export type WalkStatus = "resolved" | "multiple_writers" | "indirect" | "unclassified" | "unresolved";
export type PhysicalDeviceSource = "hw_config" | "doc_ingest" | "engineer";

export interface WalkHop {
  block_id: string;
  kind: "writer" | "dispatcher" | "udt_owner" | "fb_instance";
  via: string;  // e.g. "M03_CMD := MOT[5].CTRL.RunFwd"
}

export interface AuditIoFbLink {
  id: string;
  audit_project_id: string;
  io_address: string;
  io_module_ref: string | null;
  symbolic_tag: string | null;
  direction: IoDirection;
  device_fb_block_id: string | null;
  device_fb_instance_path: string | null;
  walk_path: WalkHop[] | null;
  walk_status: WalkStatus;
  walk_notes: string | null;
  physical_device_guess: string | null;
  physical_device_source: PhysicalDeviceSource | null;
  engineer_verified: boolean;
  engineer_override_device_fb_block_id: string | null;
  created_at: string;
  updated_at: string;
}

export type ReferenceDocType =
  | "fds"
  | "io_list"
  | "p_and_id"
  | "electrical_schematic"
  | "commissioning_notes"
  | "hmi_export"
  | "other";

export interface AuditReferenceDoc {
  id: string;
  audit_project_id: string;
  doc_type: ReferenceDocType;
  filename: string;
  storage_path: string | null;
  raw_text: string | null;
  parsed_priors: {
    devices?: Array<{ name: string; tag?: string; description?: string }>;
    tags?: Array<{ tag: string; address?: string; physical_device?: string; description?: string }>;
    states?: Array<{ state_id?: string; state_name: string; description?: string }>;
    alarms?: Array<{ tag: string; description: string; tier?: string }>;
    prose?: string;
  };
  parse_status: "pending" | "parsed" | "failed";
  parse_error: string | null;
  uploaded_at: string;
  uploaded_by: string | null;
}

export type SpecProvenanceValue =
  | "extracted"
  | "classified"
  | "traced"
  | "doc_ingest"
  | "interview"
  | "engineer_edit";

export type SpecProvenanceMap = Record<string, SpecProvenanceValue>;  // path → source
```
