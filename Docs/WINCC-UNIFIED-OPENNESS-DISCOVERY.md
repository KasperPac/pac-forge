# WinCC Unified via Openness — Option Discovery & Capability Map

How to find, inspect, and programmatically set ANY WinCC Unified element option
(dynamizations, animations, events, custom scripting), plus the capability map
of what the PacForge bridge can drive today. Written 2026-07-07 during Segment
Wagon commissioning; the method and API facts are generic to every project.

**Purpose:** source material for gap analysis — "what the app generates today"
vs "what had to be hand-built through the bridge during commissioning."

---

## 1. The three-layer discovery stack

### Layer 1 — the local API catalogue (complete, offline, greppable)

`C:\Program Files\Siemens\Automation\Portal V20\PublicAPI\V20\Siemens.Engineering.xml`
(8.7 MB IntelliSense doc shipped with the Openness DLL) documents **every
public type, property, method, and enum value** — 487 HmiUnified types in V20.
Plain XML: grep for `"T:Siemens.Engineering.HmiUnified...` (types),
`"P:..."` (properties), `"F:..."` (enum values). This answers "what options
exist" for any element without opening TIA.

### Layer 2 — live inspection of real objects

Bridge endpoint `GET /tia/hmi/screen?name=<screen>&props=1` does a recursive
property-graph dump of every item on a screen — every option **and its current
value**, including nested structures the editor hides (e.g. a dynamization's
`ValueConverter.MappingTable`). This answers "what is actually set."

**The proven workflow for any new capability:**
1. Grep the XML to find the type/property (what exists).
2. Configure ONE example by hand in the TIA editor.
3. Deep-dump it (`props=1`) and diff against an unconfigured element.
4. Add a bridge spec option that replicates the delta via Openness.
5. Batch it across all elements.

This exact loop cracked the bool→colour lamps: the editor's "Single bit"
selection turned out to be `TagDynamization.ValueConverter.MappingTable`
(`ConditionType = Singlebit` + two `MappingTableEntryBitmask` rows).

### Layer 3 — official Siemens documentation

- **TIA Portal Information System** — https://docs.tia.siemens.cloud (V20):
  WinCC Unified engineering manuals (screen objects, dynamizations,
  animations) and the **WinCC Unified JavaScript object model (RT Unified)**
  — the reference for everything callable inside event scripts
  (`HMIRuntime.Tags / UI / Alarming / Timers`, popups, screen changes).
- **SIOS (support.industry.siemens.com)** — search *"WinCC Unified scripting
  tips and tricks"* and *"TIA Portal Openness application example"*; the
  downloadable demo projects are the best worked examples.

## 2. Feature landscape (from the V20 API catalogue)

Per-property **dynamizations** (`<element>.Dynamizations.Create<T>(propertyName)`):

| Type | What it does | Key structure |
|---|---|---|
| `TagDynamization` | property follows a tag | `Tag`, `ReadOnly`, `ValueConverter.MappingTable` — `ConditionType`: `Singlebit` / multiple-bit (`MappingTableEntryBitmask`), value (`...Simple`), range (`...Range`); each entry: `Condition`, `Value`, `Flashing`, `FlashingRate`, `AlternateValue` |
| `ScriptDynamization` | property computed by JS | `ScriptCode`, `Trigger` (`Tags`, `AutomaticTags`, `T100ms`…`T10s`, `CustomCycle`, `Disabled`), `Async`, `GlobalDefinitionAreaScriptCode` |
| `ResourceListDynamization` | property from a text/graphic list by tag value | the proper mechanism for **state texts** (int → "Idle"/"Execute") |
| `ExpressionDynamization` | property from an expression | |
| `FlashingDynamization` | flashing driven by a condition | `FlashingCondition`, `FlashingRate` |

**Events** (per control, each carrying a JS script): buttons expose `Tapped`,
`Down`, `Up`, `KeyDown`, `KeyUp`, `Activated`, `Deactivated`, `ContextTapped`;
every control type has its own `Hmi<Type>EventType` enum in the catalogue.

**Global script modules** (`HmiScriptModule`): shared JS function libraries
callable from any event or script dynamization.

## 3. Hard-won rules (cost real commissioning time)

1. **Value binding = dynamization, never static.** A static `ProcessValue`
   renders the tag NAME as text. IOFields need a Tag dynamization on
   `ProcessValue`; toggles on `IsAlternateState`.
2. **Bool→colour lamps need the mapping table.** The dynamization alone is
   wiring; without `ConditionType = Singlebit` + the two entry rows the colour
   never changes. (`AlternateBackColor` plays no role.)
3. **Tags must ride the partnered connection.** Orphan placeholder connections
   (no partner, often undeletable) strand tags → names/blanks on the glass.
4. **Screen-window paths are relative to the script's screen.** Navigation from
   a hosted content screen must address the container as `"../<window>"`;
   the bare window name only resolves from the layout screen that owns it.
5. **Fresh event handlers need `GlobalDefinitionAreaScriptCode = "//"`** —
   the default carries template imports that fail compile.
6. **PLC↔panel trust is certificate-based and time-checked.** Wrong device
   clocks or a stale panel download after a PLC config change → "General
   Certificate Error", every tag dark. Fix clocks; reload the panel after PLC
   changes.
7. **Openness is slow per item** (~5–10 s/edit). Batches of ~90 items run
   >10 min — run long batches asynchronously and verify by re-inspection; a
   client timeout does NOT mean the batch failed.
8. **Editing requires TIA offline.** Compile/save via Openness fail with
   "operation not permitted in online mode."

## 4. Bridge capability map (what exists today, `/tia/hmi/*`)

Build/edit spec (`POST /tia/hmi/build`, JSON-driven, idempotent upserts):
- **Tags**: create/rebind (connection, PLC tag, linear scaling).
- **Screens**: create/find (top level or in groups), size, background; delete.
- **Items**: Text, Rectangle, IOField (mode/format), Button, ToggleSwitch,
  Circle — geometry, colors, font; `dynamizations` (with `singleBit` mapping);
  `events` (JS + async + global-definition override).
- **Edit existing items**: set any scalar/Color attribute, add/remove
  dynamizations, set event scripts.
- **Alarms**: discrete alarms (trigger, class, priority, text); delete.
- **Inspection**: structure (`/inspect` incl. per-tag connection+PLC tag),
  per-screen item dump with full recursive property graphs (`?props=1`).

**Not yet scriptable through the bridge** (identified gaps):
- `ResourceListDynamization` + text-list authoring → EM state fields still
  show raw numbers instead of state names.
- `ScriptDynamization` / `FlashingDynamization` / animations (movement) —
  API located, no bridge spec support yet.
- Global script modules; graphic lists; faceplate instances; parameter sets;
  recipe/UserArchive; trend/f(x) controls; access-level assignment on items.

## 5. Gap-analysis seed — hand-built today vs app generation

Everything below was built **manually through the bridge** during
commissioning; none of it is produced by the app's HMI generation path today:

- Operator diagnostic screens: drive (VSD) diagnostics, full machine state,
  motor/pendant detail, **full IO status page (address + description + lamp)**
  driven from the FDS IO register.
- **Permissives pages (added 2026-07-08):** per-motion condition lists (fwd /
  fwd-fast / rev / rev-fast / rotate L+R slow+fast / straighten), one green/red
  lamp per gate term, bound to the real UC gate tags (safety chain, maint mode,
  drive enabled/fault, conditioned buttons `IO_Cond.*`, end-stop + fast-zone
  gates `Rail_Status.*`, horn permit, travel limit). Needed a PLC readback
  addition (`Rail_Status.fwd_allowed/rev_allowed` — the UC computed them as
  temps only). Generic derivation: every term of an FDS coordination-model
  `ilk_` expression becomes a lamp row → natural output of the G0-3 model.
- Correctly-bound value fields (ProcessValue dynamizations), single-bit lamp
  colour mapping, working cross-screen navigation buttons.
- Retentivity classification of DB fields (settings retentive; modes/commands
  volatile) — generated DBs shipped with everything volatile.
- Command-driven auto functions authored post-hoc in the PLC: pre-travel horn
  warning (TON + permit gating), closed-loop "straighten up" positioning
  (shortest direction, proportional ramp to a minimum-speed floor, tolerance
  band, self-clearing HMI request) — no FDS/codegen vocabulary for these yet.
- Status/readback DBs for HMI consumption (`Rail_Status`-style envelope
  telemetry computed in the coordinator).
