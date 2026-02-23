# PAC-ST MASTER SYSTEM SPECIFICATION
Version: 1.0
Product: Pac-Forge – Pac-ST
Owner: Pac Technologies
Primary PLC Target (Phase 1): Siemens TIA Portal
TIA Integration: TIA Portal Openness (Windows only) + optional XML export

---

## 0. Purpose

Pac-ST is a deterministic PLC engineering system for senior automation engineers.
It generates build-ready PLC code and integrates with Siemens TIA Portal through Openness.

Correctness > speed.
Deterministic output > creative output.
Auditability is mandatory.

---

## 1. System Architecture

### 1.1 Frontend
- React + Vite + TypeScript
- Tailwind v3 + shadcn/ui
- Monaco editor for code panes
- Dark, code-focused UI (see UI_STYLE_GUIDE.md)
- Calls Claude API from the frontend (no backend proxy required for LLM calls)

### 1.2 Backend
Backend persists:
- Projects
- Conversation history (per project)
- Session + agent locks
- Generated artifacts + snapshots
- Approved code + snapshots
- Diffs/corrections
- Pattern library + approvals
- TIA job logs + compile results
- Audit trails

### 1.3 Boundaries
- Claude Code (developer tool) is separate from the in-app “agents”.
- In-app “agents” are a product feature to implement.

---

## 2. Project Model

A project is the top-level context binding all work.

Project fields (minimum):
- Project ID
- Client name
- PLC brand (Siemens TIA for Phase 1)
- TIA version
- CPU type (S7-1200 / S7-1500 etc.)
- Hardware layout (rack/slot)
- IO lists (structured)
- Tag DB definitions (global tags / tag tables)
- Uploaded documentation (PDF/manuals/specs)
- Safety level/notes
- Revision log

All generation, learning, and logs are scoped to the active project.

---

## 3. Session + Agent Model

### 3.1 Session
- User starts a Pac-ST session against a project.
- Conversation history is stored per project.
- Session includes selected agents (exclusive lock).

### 3.2 Agents
Agents are named logical roles (configurable pool), locked per session:
- Code Architect
- PLC Standards Enforcer
- IO Validator
- Safety Auditor
- Pattern Librarian

Rules:
- User selects agents at session start.
- Agents are exclusive to that session until released/expired.
- Lease-based locking (see docs/AGENT_POOL_ARCHITECTURE.md).

---

## 4. Generation Modes

Pac-ST supports two primary modes:

### 4.1 Function Block per device
- Typically one FB per device (motor, sensor, conveyor zone, auto/manual, valve, etc.)
- Deterministic state machine logic.
- Human-readable commissioning-friendly code.
- Clear IO mapping.

### 4.2 Project-level generation
- Generates multiple artifacts:
  - UDTs
  - Global DBs
  - FBs/FCs
  - OB(s) / main entry
  - Tag tables (later phase if needed)
  - IO mapping scaffolding
- Must output a manifest for deterministic import/compile order.

---

## 5. PLC Coding Standards (Core)

### 5.1 Mandatory architectural patterns
- Deterministic CASE-based state machines.
- Array-first architecture where applicable (avoid copy/paste per zone).
- Global variables allowed (project-level conventions).
- Alarm philosophy:
  - alarms latch
  - no auto reset
  - operator reset required
  - timestamps when possible

### 5.2 Non-negotiable quality constraints
Generated code must be:
- Build-ready (compilable)
- Human readable
- Commented (concise, technical)
- Correct device linking (avoid wrong motors running due to mapping mistakes)
- Safe by default; unsafe patterns must be flagged

### 5.3 Risk controls
- Alert on unsafe code generation but still generate (user decides).
- Safety-affecting exports require explicit confirmation.
- IO indexing mismatches flagged aggressively.

---

## 6. TIA Portal Integration

Pac-ST must support both:

### 6.1 Mode A — Export for import
- Generate importable artifacts (XML or SCL sources as appropriate).
- Provide download/export.

### 6.2 Mode B — Direct Openness write (Windows)
- Execute via Windows Openness bridge (see docs/TIA_OPENNESS_INTEGRATION.md).
- Must preview changes and require user confirmation.
- Must compile after write and return compile results.
- Must support compile-error feedback loop:
  - show error
  - regenerate affected artifact(s)
  - recompile

---

## 7. UI Requirements

Three-pane Pac-ST view:

LEFT
- Chat + guided questions
- Agent selection/status
- Project metadata summary
- Safety warnings summary

CENTER
- Generated code (Monaco)
- Read-only until approved
- Syntax highlighting (Siemens ST/SCL first)
- Shows which patterns were applied

RIGHT
- Approved/working code (Monaco)
- Editable
- Diff view vs generated
- Save snapshot, rollback

Optional Bottom Panel
- TIA job logs
- Compile output
- Warnings/errors list with line numbers

---

## 8. Learning System (Controlled Pattern Library)

### 8.1 What gets learned
Only explicit human-approved corrections, stored as “Pattern Candidates”.

### 8.2 Scope
- Patterns are applied per PLC brand.
- Promotion to global/shared patterns requires admin approval.

### 8.3 Flow
1) Generate code → snapshot
2) Engineer edits approved code → snapshot
3) Compute diff (generated vs approved)
4) Classify correction (naming / IO / alarm / safety / state machine / etc.)
5) Store as Pattern Candidate (Pending)
6) Admin approves → becomes Active Pattern for that PLC brand
7) Future generations retrieve and apply relevant patterns deterministically
8) Log pattern usage

No uncontrolled self-learning.

---

## 9. Versioning

Required:
- Save snapshots on:
  - generation
  - approval save
  - export/write
- Diff compare:
  - generated vs approved
  - snapshot vs snapshot
- Rollback
- “Git integration ready” (structure code to allow future Git hooks)

---

## 10. Deliverables & Output Format

Pac-ST output should be treated as an “artifact bundle”:
- Multiple files (UDT/FB/FC/DB/OB as needed)
- A manifest describing ordering and dependencies:
  - ai/TIA_MANIFEST_SCHEMA.md

Artifacts must be exportable (download) and/or writable into TIA via Openness.