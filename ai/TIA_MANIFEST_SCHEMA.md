# TIA Manifest Schema (tia_manifest.json)
Version: 1.0

## Purpose
A deterministic manifest that describes the artifact bundle and the correct import/compile order for TIA.

This manifest is required for:
- exporting bundles
- Openness write jobs
- compile orchestration
- audit logs

---

## File: tia_manifest.json (shape)

### Top-level fields (minimum)
- manifest_version: string (e.g. "1.0")
- project_id: string
- platform: "SIEMENS_TIA"
- tia_version: string (e.g. "V17")
- cpu_type: string (e.g. "S7-1500")
- created_at: ISO string
- created_by_user_id: string
- generation_session_id: string
- artifacts: array of Artifact

### Artifact object
- name: string (block name)
- type: "UDT" | "FB" | "FC" | "DB" | "OB" | "SCL_SOURCE" | "TAG_TABLE"
- filename: string (relative path in bundle)
- destination_folder: string (TIA folder path or logical folder)
- dependencies: string[] (names of artifacts)
- compile_after_import: boolean
- overwrite_strategy: "CREATE_OR_UPDATE" | "FAIL_IF_EXISTS" | "CREATE_NEW_VERSION"
- notes?: string

---

## Rules
- All dependencies must exist in the same manifest.
- Import order is dependency order (topological sort).
- UDTs must be imported before FBs that reference them.
- DBs referencing UDTs must be after UDTs.
- Compilation order follows import order unless otherwise specified.

---

## Example (minimal)

{
  "manifest_version": "1.0",
  "project_id": "proj_123",
  "platform": "SIEMENS_TIA",
  "tia_version": "V17",
  "cpu_type": "S7-1500",
  "created_at": "2026-02-23T10:40:00+11:00",
  "created_by_user_id": "user_1",
  "generation_session_id": "sess_abc",
  "artifacts": [
    {
      "name": "UDT_ZoneIO",
      "type": "UDT",
      "filename": "udt/UDT_ZoneIO.scl",
      "destination_folder": "Types",
      "dependencies": [],
      "compile_after_import": true,
      "overwrite_strategy": "CREATE_OR_UPDATE"
    },
    {
      "name": "FB_ConveyorZone",
      "type": "FB",
      "filename": "fb/FB_ConveyorZone.scl",
      "destination_folder": "Program blocks/Pac-ST",
      "dependencies": ["UDT_ZoneIO"],
      "compile_after_import": true,
      "overwrite_strategy": "CREATE_OR_UPDATE"
    }
  ]
}