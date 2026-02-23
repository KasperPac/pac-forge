# TIA Portal Openness Integration (Pac-ST)
Version: 1.0
Platform: Windows only

## Goal
Allow Pac-ST to write generated Siemens artifacts into a TIA Portal project and compile them, returning errors and logs.

Pac-Forge web app must NOT call Openness directly.

Openness must run through a Windows bridge/agent or service on a machine with TIA installed.

---

## Integration Modes

### Mode A — Export for Import
- Generate artifact bundle and optionally TIA import XML.
- User imports manually into TIA.

### Mode B — Direct Openness Write
- Pac-Forge triggers a “TIA job”.
- Windows Openness bridge performs:
  - open project
  - import/create/update artifacts (SCL, blocks, DBs, UDTs)
  - compile
  - return compile results and diagnostics

---

## TIA Job Types (minimum)
- IMPORT_ONLY
- IMPORT_AND_COMPILE
- COMPILE_ONLY (selected/all)
- EXPORT_REPORT

---

## Required Safety Behavior
- Always preview planned changes before executing.
- Require explicit user confirmation to write.
- Log:
  - user_id, project_id
  - job parameters
  - artifacts list and manifest
  - before/after evidence where feasible
  - compile results

---

## Compile Feedback Loop
If compile fails:
- return structured errors:
  - artifact name
  - line/column if available
  - error text
- UI displays errors and links to the relevant Monaco editor location
- user can regenerate only impacted artifacts
- re-run compile job

---

## Artifact Bundle + Manifest
Pac-ST must output:
- one file per artifact (FB/FC/UDT/DB/OB etc.)
- tia_manifest.json describing:
  - ordering
  - dependencies
  - destinations/folders
  - compile flags

Manifest schema is defined in ai/TIA_MANIFEST_SCHEMA.md.