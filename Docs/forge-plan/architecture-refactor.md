# Architecture Refactor: Device Call FCs + Inputs/Outputs DBs

## Overview

The current forge wizard generates one IoLinking FC that wires everything, and a RunProcess FC that duplicates half of it by calling device FBs again. This is wrong — it creates duplicate FB calls and conflicting wiring.

Replace with a clean architecture where responsibilities are clearly separated:

```
Main (OB1)
  ├── IoLinking FC       — physical %I/%Q ↔ Inputs/Outputs DBs ONLY
  ├── SensorCall FC      — calls all MonitorSensor FB instances with config
  ├── ConveyorCall FC    — calls all ControlConveyor FB instances with config + sensor wiring
  ├── MotorCall FC       — calls all ControlMotor FB instances with config + conveyor wiring + outputs
  └── RunProcess FC      — pure process/sequence logic, no FB calls, no IO wiring
```

## The Rules

1. **IoLinking FC**: Physical IO ↔ Inputs/Outputs DBs ONLY. No DB-to-DB wiring. No config parameters. No FB calls.
2. **Device Call FCs** (SensorCall, ConveyorCall, MotorCall, etc.): Call ALL instances of their device type FB with ALL inputs wired — config from Configuration DB, sensor data from other instance DBs (DB-to-DB is OK here), HMI force signals from HmiData DB, outputs to Outputs DB.
3. **RunProcess FC**: Pure process sequence logic. Reads/writes instance DB values to coordinate the process. No FB calls. No IO wiring. No config wiring.
4. **Inputs DB**: Global DB that mirrors all physical inputs. IoLinking writes to it. Device Call FCs read from it.
5. **Outputs DB**: Global DB that mirrors all physical outputs. Device Call FCs write to it. IoLinking reads from it.

## What to Change

### 1. New artifact types in the device code generation stage

The device code stage currently generates: FBs + instance DBs + one IoLinking FC.

Change to generate: FBs + instance DBs + Inputs DB + Outputs DB + IoLinking FC + one FC per device TYPE.

Add new prompt builders to `src/lib/forge-prompts.ts`:

#### `buildInputsOutputsDbPrompt(ioList, profile)`
Generates the Inputs and Outputs global DBs from the IO list.

```
Generate two Global Data Blocks:

1. DATA_BLOCK "Inputs" — one Bool/Int/Real field per physical input signal.
   Field names match the IO tag names from the list below.

2. DATA_BLOCK "Outputs" — one Bool/Int/Real field per physical output signal.
   Field names match the IO tag names from the list below.

These DBs mirror the physical IO. IoLinking FC copies physical addresses into Inputs and physical addresses from Outputs.
```

This should be DETERMINISTIC — no AI needed. Build the SCL directly from the IO list in code:

```typescript
function generateInputsDb(ioList: ForgeIoEntry[]): string {
  const inputs = ioList.filter(io => io.signal_type === "DI" || io.signal_type === "AI");
  const fields = inputs.map(io => `    ${io.tag_name} : ${io.data_type};  // ${io.address} - ${io.description}`).join("\n");
  return `DATA_BLOCK "Inputs"\n{ S7_Optimized_Access := 'TRUE' }\nVERSION : 0.1\nNON_RETAIN\n  VAR\n${fields}\n  END_VAR\nBEGIN\nEND_DATA_BLOCK`;
}

function generateOutputsDb(ioList: ForgeIoEntry[]): string {
  const outputs = ioList.filter(io => io.signal_type === "DQ" || io.signal_type === "AQ");
  const fields = outputs.map(io => `    ${io.tag_name} : ${io.data_type};  // ${io.address} - ${io.description}`).join("\n");
  return `DATA_BLOCK "Outputs"\n{ S7_Optimized_Access := 'TRUE' }\nVERSION : 0.1\nNON_RETAIN\n  VAR\n${fields}\n  END_VAR\nBEGIN\nEND_DATA_BLOCK`;
}
```

#### `buildIoLinkingPrompt(ioList)` — REWRITE
IoLinking becomes dead simple. It should also be deterministic — generate directly from the IO list:

```typescript
function generateIoLinkingFc(ioList: ForgeIoEntry[]): string {
  const inputs = ioList.filter(io => io.signal_type === "DI" || io.signal_type === "AI");
  const outputs = ioList.filter(io => io.signal_type === "DQ" || io.signal_type === "AQ");
  
  const inputLines = inputs.map(io => `  "Inputs".${io.tag_name} := "${io.tag_name}";`).join("\n");
  const outputLines = outputs.map(io => `  "${io.tag_name}" := "Outputs".${io.tag_name};`).join("\n");
  
  return `FUNCTION "IoLinking" : Void
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
BEGIN
  REGION Map Physical Inputs to Inputs DB
${inputLines}
  END_REGION

  REGION Map Outputs DB to Physical Outputs
${outputLines}
  END_REGION
END_FUNCTION`;
}
```

No AI call needed for IoLinking, Inputs DB, or Outputs DB. These are fully deterministic from the IO list.

#### `buildDeviceCallFcPrompt(deviceType, devices, context)` — NEW
Generates one FC per device TYPE (not per device instance). For example, if the project has 3 Motor DOL devices, one MotorCall FC calls all three instances.

The AI receives:
- The FB interface (VAR_INPUT/VAR_OUTPUT/VAR_IN_OUT extracted from the FB artifact)
- The instance DB names for all devices of this type
- The Inputs DB field names (for reading sensor/feedback signals)
- The Outputs DB field names (for writing command signals)
- The Configuration DB field names relevant to this device type
- The HmiData DB field names relevant to this device type
- Instance DB names of RELATED device types (e.g. ConveyorCall needs to read sensor instance outputs)

The prompt must say:
```
Generate a single FC that calls every FB instance of this device type.
Every VAR_INPUT on the FB MUST be wired — no unwired inputs.
Physical IO comes from the Inputs DB and goes to the Outputs DB.
Config parameters come from the Configuration DB.
HMI force signals come from the HmiData DB.
Inter-device signals (e.g. sensor output → conveyor input) use instance DB references directly.
```

### 2. Update the device code generation hook

In `src/hooks/use-forge-device-generate.ts`, the `generateAll()` function should now produce:

1. FBs (from template copy or AI generation) — existing
2. Instance DBs — existing
3. Inputs DB — NEW, deterministic
4. Outputs DB — NEW, deterministic
5. IoLinking FC — REWRITTEN, deterministic
6. Configuration DB — NEW or updated, deterministic from device config params
7. HmiData DB — NEW or updated, deterministic from device HMI params
8. One device call FC per unique device type — NEW, AI-generated

Group devices by `device_type` and generate one FC per group:
- All "Motor DOL" devices → MotorCall FC
- All "Conveyor" devices → ConveyorCall FC
- All "Photoelectric Sensor" devices → SensorCall FC
- All "Push Button" devices → could be part of SensorCall if using MonitorSensor FB, or a separate PushButtonCall FC
- Etc.

### 3. Update the process code generation

In `src/hooks/use-forge-process-generate.ts`, RunProcess should:
- NOT call any device FBs (they're called in the device call FCs)
- NOT wire any IO (that's in IoLinking and device call FCs)
- Only contain process sequence logic — state machines, mode selection, coordination between devices via their instance DBs

Update `buildProcessFcPrompt()` to say:
```
Generate RunProcess FC containing ONLY process sequence logic.
Do NOT call any device FBs — they are called in separate device call FCs.
Do NOT wire any physical IO — that's in the IoLinking FC.
Do NOT wire any config parameters — that's in the device call FCs.
You CAN read and write to instance DBs to coordinate process logic.
You CAN call sequence FBs if the process has multi-step sequences.
```

### 4. Update OB1 Main generation

`buildOb1Prompt()` should generate:
```scl
ORGANIZATION_BLOCK "Main"
TITLE = 'Main Program Sweep (Cycle)'
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
  VAR_TEMP
    tempFirstScan : Bool;
  END_VAR
BEGIN
  "IoLinking"();
  "SensorCall"();
  "ConveyorCall"();
  "MotorCall"();
  "RunProcess"();
END_ORGANIZATION_BLOCK
```

The FC call order in Main matters:
1. IoLinking first — get fresh physical IO into Inputs DB
2. Sensor FCs — process raw inputs
3. Higher-level device FCs (Conveyor, etc.) — use sensor outputs
4. Actuator FCs (Motor, Solenoid, etc.) — use conveyor/process outputs
5. RunProcess last — process logic reads current states, writes commands for next scan

The OB1 prompt should receive the list of device call FC names and their correct call order.

---

## IMPORTANT: Prompts Page and Design Profile Interaction

### Current state — the forge prompts do NOT use the Prompts page at all

The forge wizard prompts in `src/lib/forge-prompts.ts` are 100% hardcoded. They do NOT call `resolveSection()` from `src/lib/prompt-defaults.ts`. The Prompts page (which stores overrides in the `prompt_sections` Supabase table) has ZERO effect on forge wizard generation.

This means: if the user edits prompts on the Prompts page, those changes are ignored by the forge wizard. Only the non-forge Pac-ST pipeline uses `resolveSection()`.

### What IS configurable (via Design Profile):

These Design Profile fields are currently injected into forge prompts:
- `profile.general_rules` → injected as "Code Design Profile" section in all generation prompts
- `profile.io_linking_rules` → injected into IoLinking prompt (BUT IoLinking is becoming deterministic, so this field will only apply if we keep an AI fallback)
- `profile.process_rules` → injected into process code generation prompt with examples
- `profile.device_fb_language` → determines SCL vs LAD for device FB generation
- `profile.io_linking_language` → determines SCL vs LAD for IoLinking (moot if deterministic)
- `profile.process_code_language` → determines SCL vs LAD for process code
- `profile.naming_prefix` → available but not currently used in forge prompts
- `profile.db_naming_prefix` → available but not currently used in forge prompts

### What SHOULD be configurable but currently ISN'T:

1. **The device call FC names** — currently hardcoded pattern (SensorCall, MotorCall, ConveyorCall). Should respect `profile.naming_prefix` if set. Example: if prefix is "CK_" then "CK_SensorCall".

2. **The Inputs/Outputs DB names** — currently hardcoded as "Inputs" and "Outputs". Should respect `profile.db_naming_prefix` if set.

3. **The call order in Main** — currently hardcoded. Some profiles might want a different order. Consider making this configurable on the Design Profile.

4. **The device call FC prompt** — this is new and will be hardcoded. If the user wants to customize how device call FCs are generated (e.g. add specific patterns), they currently have no way to do so via the Prompts page.

### Recommendation: Report to the user

After implementing this refactor, add a comment block at the top of each NEW prompt builder function documenting:

```typescript
/**
 * buildDeviceCallFcPrompt
 * 
 * HARDCODED — not configurable via Prompts page.
 * 
 * Design Profile fields used:
 *   - general_rules: injected as coding standards
 *   - naming_prefix: used for FC naming if set
 *   - fb_rules: injected as FB calling conventions (if applicable)
 * 
 * Design Profile fields NOT used (could be added):
 *   - io_linking_rules: not relevant (device call FC, not IO linking)
 * 
 * To make this configurable via Prompts page, add a section key
 * like "forge:device_call_fc" to PROMPT_DEFAULTS and use resolveSection().
 */
```

Do the same for every prompt builder function — document what's hardcoded, what comes from Design Profile, and what would need to change to make it Prompts-page-configurable.

---

## Files to modify

- `src/lib/forge-prompts.ts` — rewrite IoLinking prompt, add Inputs/Outputs DB generators, add device call FC prompt, update ProcessFc prompt, update OB1 prompt
- `src/hooks/use-forge-device-generate.ts` — add deterministic Inputs/Outputs/IoLinking generation, add device call FC generation loop
- `src/hooks/use-forge-process-generate.ts` — remove device FB calls from RunProcess, update OB1 to include device call FCs
- `src/types/forge.ts` — add new artifact stage types if needed

## Files NOT to modify (these are owned by the Prompts page / Pac-ST pipeline)

- `src/lib/prompt-defaults.ts` — this is the non-forge prompt system
- `src/hooks/use-prompt-sections.ts` — this is the non-forge prompt system

## Implementation order

1. Add deterministic generators: `generateInputsDb()`, `generateOutputsDb()`, `generateIoLinkingFc()` — no AI needed
2. Add `buildDeviceCallFcPrompt()` — AI-generated, one per device type
3. Update `use-forge-device-generate.ts` generateAll() to produce the new artifacts
4. Update `buildProcessFcPrompt()` — RunProcess is pure logic only
5. Update `buildOb1Prompt()` — correct call order with device call FCs
6. Update `use-forge-process-generate.ts` — remove device FB calls from RunProcess
7. Add documentation comments to every prompt builder

Build and test after each step.

Commit with: "forge-arch: refactor to Inputs/Outputs DBs + per-device-type call FCs"
