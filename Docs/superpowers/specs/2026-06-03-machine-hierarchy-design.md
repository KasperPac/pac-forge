# Machine Hierarchy & FB-Assignment Model — Design

**Date:** 2026-06-03
**Status:** Approved (design); pending spec review → implementation plan
**Author:** Kasper Simonsen (with Claude)

---

## 1. Context & Problem

While validating the FDS builder end-to-end with a real client spec (Herrenknecht
Segment Wagon), the machine hierarchy came out wrong. Two distinct defects surfaced:

1. **Over-elevation.** The instrument register's grouping column held *assembly*-level
   names ("Carriage", "Rotator"), and `buildHierarchyFromTags` promoted each directly
   to a **subsystem**. A compact single-machine job ended up with 4 subsystems and ~28
   over-fragmented assemblies instead of 1 subsystem with ~4 assemblies.

2. **Wrong definitions.** Working through it revealed that the project's
   `CLAUDE.md` "Non-negotiable" hierarchy rules are themselves incorrect for how Pac
   actually builds machines — specifically the FB-assignment rules
   (*"Assembly — Has NO FB"* and *"Only devices get FBs"*).

The fix is not a one-off data correction; it is a correction to the **hierarchy model
and the FB-assignment model**, applied generically to all projects.

### Root insight

The four-level decomposition is real and useful, but its levels must be **defined by an
industry standard rather than invented**, and the tool must **extract** structure from
the spec document rather than infer it from tag names.

---

## 2. Decision: House Standard

Pac-Forge adopts a single house standard for **all** projects (no per-project standard
switching — YAGNI for a discrete-machine shop):

- **ISA-88 (IEC 61512)** — equipment decomposition (physical model) **and** sequencing
  (procedural model).
- **PackML (ISA-TR88.00.02 / OMAC)** — machine state model, modes, and PackTags
  interface. *Already in use* in the spec-builder (`state-machine.ts`,
  `OperatingStateV2`, `CANONICAL_STATES`) — this design formally documents it.

These are **complementary layers**, not competing choices: ISA-88 decomposes the
machine; PackML governs how it behaves and communicates. PackML is built on ISA-88.

Per-project standard selection is explicitly **out of scope**. It would only earn its
keep if projects spanned genuinely different paradigms (continuous process → MTP; pure
batch → full S88 recipe model). Pac's work is discrete machines, where ISA-88 + PackML
is the applicable pair.

### Naming: map, don't rename

The codebase already uses `System / Subsystem / Assembly / Device` pervasively
(`SubsystemConfig`/`AssemblyConfig`/`DeviceConfig` types, the `confirmed_subsystems`
DB column, prompts, UI, ~68 files). We **keep these labels** and define them *as* their
ISA-88 equivalents in `CLAUDE.md`. No DB migration, no mass rename. (Approach A.)

---

## 3. The Four-Level Model

| Label (kept) | ISA-88 equivalent | Definition | Code artifact |
|---|---|---|---|
| **System** | Process Cell | The whole machine / production line | **Sequence logic** (top orchestration) |
| **Subsystem** | Unit | The set of assemblies governed by **one** coordinated operating sequence. Carries out major processing relatively independently. | **Sequence logic** (step sequencer) that calls the assembly FBs |
| **Assembly** | Equipment Module | A coordinated group of devices that run together (a conveyor, an elevator). | Its **own FB** with named signal I/O |
| **Device** | Control Module | A single physical thing with IO signals (motor, sensor, valve, push button). | **FB instance** in a per-type device layer |

### Subsystem boundary rule

A machine has **one subsystem by default**. Multiple subsystems appear **only** when the
spec describes assemblies running under **independent operating sequences** (e.g. an
infeed area vs. an outfeed area), or replicated identical systems. **A lone assembly is
never its own subsystem.** The structure is **extracted from the spec document — never
invented** by the tool.

### FB-assignment model (corrects current CLAUDE.md)

- **Devices** each get their own FB instance, organised **by type** in a dedicated
  device layer — typically arrays (`SEN[4]`, `MOT[2]`, `PB[]`) exposing members such as
  `SEN[4].Ctrl.OutDelayOnOff`.
- **Assemblies** get their **own FB** with **named signal inputs/outputs**
  (e.g. inputs `Sensor_A`, `Sensor_B`, `Flt_Rst`, `Run`; outputs `Run_Fwd`, `Run_Rev`,
  `Flt_Code`). The assembly FB **does not instantiate device FBs**. Its inputs are
  **wired** externally to device-FB members (`Sensor_A ← SEN[4].Ctrl.OutDelayOnOff`).
- **Subsystem** and **System** levels are **sequence logic** that call/drive the
  assembly FBs (set `Run`, read `Flt_Code`), not wrapper FBs that contain them.
- **Consequence:** devices and assemblies are *peers in code*, coupled by wiring. A
  shared device (e.g. one sensor) can feed multiple assemblies. The spec tree's
  "device under assembly" is a **logical** grouping, not code ownership.

This is the ISA-88 split: Control Modules (devices) → Equipment Modules (assemblies) →
Unit/Procedure sequences (subsystem/system).

---

## 4. Sourcing Rules — where each level comes from

1. **Document-defined (the normal case).** The uploaded spec document already states the
   subsystem/assembly/device breakdown. The app **extracts it verbatim — never invents.**
   - Our own exported docs: deterministic via the hierarchy-table parser
     (`docx-ingest-hierarchy.ts`).
   - Foreign docs: AI extraction via `ai-ingest.ts` → `SpecContractV2`.
2. **Register.** Supplies **devices** (grouping signal suffixes onto one device) and
   **IO wiring**, plus **assemblies** when the document does not enumerate them.
3. **Register-only, no document (the HK exception).** Default to **one subsystem**
   containing all assemblies; the engineer splits subsystems manually in the wizard. The
   tool must **never** elevate a register grouping column to "subsystem."

---

## 5. Changes

### 5.1 Documentation — `CLAUDE.md`

- Rewrite the **"Machine Hierarchy (Non-negotiable)"** section:
  - State the house standard (ISA-88 + PackML), with the label↔ISA-88 mapping table.
  - Replace the four definitions with §3 above.
  - **Correct the FB-assignment rules:** remove *"Assembly — Has NO FB"* and *"Only
    devices get FBs"*. State the device-layer / assembly-FB-wiring / subsystem-sequence
    model from §3.
  - State the subsystem boundary rule (one by default; split only on independent
    operating sequences; extract-don't-invent).
  - Fix the examples (a single conveyor / Safety / Operator Interface is an **assembly**,
    not a subsystem).
- Add a short **"Standards"** note documenting **PackML** as the state/mode/interface
  standard (states, modes, PackTags) already used by the spec-builder.

### 5.2 Spec-builder — extraction & parser (the actual bug fix)

- **`buildHierarchyFromTags` (`src/lib/spec-builder/instrument-parser.ts`):**
  - Produce **one subsystem** (the system) containing assemblies grouped from device
    prefixes. Stop turning the register's `subsystem` column into subsystems.
  - Reinterpret the register grouping column as **assembly**-level.
  - Fix the device-split bug where suffixes not in `SIGNAL_SUFFIXES` (e.g. `_THERM`)
    split one physical device into multiple devices.
- **`inferHierarchy` prompt (`src/components/spec-builder/spec-skeleton-wizard.tsx`):**
  - Replace "Subsystem = functional station" with the §3 definition + ISA-88 framing.
  - Instruct: **extract** subsystems as stated in provided spec text; **default to one**
    subsystem; **never invent** splits.
- **Wizard input:** give the hierarchy step access to **spec-document text** so the
  extract step has a source (upload/paste, or reuse existing ingest output).
- **Register column semantics:** `subsystem` → `assembly`, with a backward-compatible
  alias in `CANONICAL_COLUMN_NAMES`.

### 5.3 Phasing

- **Phase 1 (core — unblocks everything):** §5.1 docs + §5.2 parser/prompt/default-one-
  subsystem + device-split fix. This alone makes the register path correct.
- **Phase 2 (extraction step):** wire spec-document text into the wizard + the
  extract-subsystems action over that text.

---

## 6. Scope

**In scope:** the hierarchy **model + definitions** (`CLAUDE.md`, incl. PackML
documentation) and the **spec-builder extraction/parser/prompt** that builds the tree.

**Documented but NOT rebuilt here:** the **FB-layer code generation** (device-layer
arrays, assembly-FB signal wiring, subsystem/system sequencers) lives in the forge
pipeline — a separate, much larger effort. We record the correct model in `CLAUDE.md`
so downstream generation is consistent, but do not re-architect forge codegen in this
design.

**Separate / out of scope:**
- The **V1-badge cosmetic bug** (`spec-builder.tsx` `isUnconfirmed`) — trivial, tracked
  separately.
- Fixing the **HK spec data itself** (set to 1 subsystem + 4 assemblies) — can be done
  manually now, independent of this design.
- **Per-project standard switching** — explicitly rejected (§2).
- **Approach B** (full spec-doc-first re-architecture) — possible future direction.

---

## 7. Success Criteria

- `CLAUDE.md` defines the hierarchy via ISA-88 (+ PackML for states), with the corrected
  FB-assignment model and label↔standard mapping.
- A register-only upload of the HK CSV yields **1 subsystem** ("Segment Wagon") with
  ~4 assemblies (Carriage, Rotator, Safety, Operator Interface), each device intact
  (no `_THERM` split), all 43 signals preserved.
- A spec document that states its own subsystem breakdown is **extracted** to match,
  with no invented subsystems.
- The change is generic: re-running the reasoning on a different machine type
  (conveyor line, stamping cell, filling station) produces a sensible tree under the
  same rules.

---

## 8. Open Questions / Risks

- **Spec-text availability at Phase 2:** the wizard currently sees only the register.
  Phase 2 of this design depends on a spec-text source; confirm whether to reuse the
  existing ingest output or add an upload/paste in the wizard.
- **Backward compatibility:** existing specs already saved with the old (over-elevated)
  hierarchy. Decide whether to migrate them or leave as-is (the migrate flow already
  exists — `/migrate`).
- **Assembly grouping heuristics** (register-only path): grouping devices into the right
  assemblies from tag prefixes alone is imperfect; the AI "Suggest" step and engineer
  edits remain the safety net.
