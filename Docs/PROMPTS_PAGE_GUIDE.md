# Prompts Page — What You Can and Can't Change

## Overview

The **Prompts page** (`/prompts`) lets you edit system prompt sections for the **Pac-ST pipeline** agents.
The **Forge Wizard** (`/forge`) uses a completely separate set of hardcoded prompts and is **not affected** by the Prompts page at all.

---

## What the Prompts Page Controls (Pac-ST Pipeline)

These are the agents that run when you use the **Pac-ST chat** or **TIA Console demo** generation:

| Role | Editable Sections | What It Affects |
|------|------------------|-----------------|
| `shared` | identity, instructions, platform_rules | Baseline injected into all agents |
| `generate` | identity, instructions, platform_rules | Code Architect — generates SCL code from your prompt |
| `process` | identity, instructions, platform_rules | Process Code agent (Process tab in Pac-ST) |
| `review` | identity, instructions | Standards Reviewer — checks generated code |
| `rewrite` | identity, instructions | Rewrite agent — fixes review findings |
| `compile_fix` | identity, instructions, platform_rules | Compile Fix agent — fixes TIA Portal errors |
| `plan` | identity, instructions | Project Manager — planning step |
| `summary` | identity, instructions | Project Manager — summary step |
| `patterns` | identity, instructions | Pattern Librarian — correction analysis |

**Output formats are always hardcoded** — you cannot edit how agents format their responses (the ` ```scl [FB:Name] ` block format, JSON schemas, review finding structure). Only the identity and instruction sections are editable.

Changes take effect immediately on the next generation. Old versions are kept — you can roll back to any previous version from the Prompts page.

---

## What the Prompts Page Does NOT Control (Forge Wizard)

Every prompt in the Forge Wizard is hardcoded in `src/lib/forge-prompts.ts`. Editing anything on the Prompts page has **zero effect** on forge generation.

| Forge Stage | Prompt Function | Configurable via Prompts Page? |
|-------------|----------------|-------------------------------|
| Spec analysis | `buildSpecAnalysisPrompt()` | ❌ No |
| Q&A review | `buildQaReviewPrompt()` | ❌ No |
| Device FB (SCL) | `buildDeviceSclPrompt()` | ❌ No |
| Device FB (LAD) | `buildDeviceLadPrompt()` | ❌ No |
| Device Call FC | `buildDeviceCallFcPrompt()` | ❌ No |
| IO Linking (SCL) | `generateIoLinkingFc()` | ❌ No — fully deterministic, no AI |
| IO Linking (LAD) | `buildIoLinkingLadPrompt()` | ❌ No |
| Inputs/Outputs DBs | `generateInputsDb/Db()` | ❌ No — fully deterministic, no AI |
| OB1 Main | `generateOb1Main()` | ❌ No — fully deterministic, no AI |
| Process sequence (SCL) | `buildProcessSclPrompt()` | ❌ No |
| Process sequence (LAD) | `buildProcessLadPrompt()` | ❌ No |
| RunProcess FC | `buildProcessFcPrompt()` | ❌ No |
| HMI screens | `buildHmiPrompt()` | ❌ No |
| Matrix: device wiring | `buildDeviceLinkagePrompt()` | ❌ No |
| Matrix: sequences | `buildSequencesPrompt()` | ❌ No |

---

## What You CAN Change for the Forge Wizard (Design Profile)

The **Design Profile** (`/profiles`) is the only way to influence forge wizard generation. These fields are injected into forge prompts:

| Profile Field | Which Forge Prompts Use It |
|--------------|---------------------------|
| `general_rules` | Device SCL/LAD, Device Call FC, IO Linking LAD, Process SCL/LAD, RunProcess FC |
| `io_linking_rules` | IO Linking LAD only (SCL IoLinking is deterministic — rules have no effect) |
| `process_rules` | Process sequence SCL, RunProcess FC |
| `device_fb_language` | Determines SCL vs LAD path for device FB generation |
| `io_linking_language` | Determines SCL (deterministic) vs LAD (AI) for IoLinking |
| `process_code_language` | Determines SCL vs LAD path for process sequence generation |
| `naming_prefix` | Device Call FC names (e.g. `CK_` → `CK_MotorDolCall`) |
| `db_naming_prefix` | Currently available but not yet applied to Inputs/Outputs DB names |

### Fields that exist but are NOT currently used by forge prompts

| Profile Field | Status |
|--------------|--------|
| `db_naming_prefix` | Declared in profile but not passed to `generateInputsDb/OutputsDb()` yet |
| `naming_prefix` applied to RunProcess / IoLinking names | Not implemented — only applied to Device Call FC names |

---

## Summary

| Where you want to change behaviour | How to do it |
|------------------------------------|-------------|
| Pac-ST chat code generation | Prompts page → `generate` role |
| Pac-ST review strictness | Prompts page → `review` role |
| Pac-ST compile fix behaviour | Prompts page → `compile_fix` role |
| Forge device FB coding style | Design Profile → `general_rules` |
| Forge IO linking rules | Design Profile → `io_linking_rules` (LAD only) |
| Forge process sequence style | Design Profile → `process_rules` |
| Forge device naming prefix | Design Profile → `naming_prefix` |
| Forge language (SCL vs LAD) | Design Profile → `device_fb_language`, `io_linking_language`, `process_code_language` |
| Forge prompt instructions themselves | Edit `src/lib/forge-prompts.ts` directly |
