# PAC-ST MASTER SYSTEM SPECIFICATION
Version: 1.0
Owner: Pac Technologies
Product: Pac-Forge – Pac-ST
Environment: Windows (for TIA Openness)
UI Stack: React + Vite + TypeScript + Tailwind v3 + shadcn/ui
Editor: Monaco
Primary PLC Target: Siemens TIA Portal (Phase 1)

---

# 0. DESIGN PHILOSOPHY

PAC-ST is not a chatbot.

PAC-ST is a deterministic PLC engineering system.

It must behave like a senior automation engineer:
- Structured
- Conservative
- Safe
- Deterministic
- Commented
- Build-ready

Correctness > Creativity.

No speculative logic.
No hallucinated APIs.
No unsafe silent behavior.

---

# 1. SYSTEM ARCHITECTURE

## 1.1 High-Level Components

1. React Frontend
2. Backend API (project + memory + audit)
3. Claude API access (frontend-triggered)
4. Pattern Library engine
5. TIA Openness Windows bridge
6. Version control subsystem

All interactions are project-scoped.

---

# 2. SESSION + AGENT MODEL

## 2.1 Agent Locking

Agents are named logical AI roles:

- Code Architect
- PLC Standards Enforcer
- IO Validator
- Safety Auditor
- Pattern Librarian

Session Rules:
- User selects agents at session start.
- Agents lock per session.
- Locked agents cannot be used in other sessions.
- Session timeout releases agents.
- Agent usage logged.

Agents operate cooperatively but deterministically.

---

## 2.2 Conversation Persistence

Conversation is stored per project.

Stored data:
- Prompt history
- Agent responses
- Generated artifacts
- Diff corrections
- Safety warnings

No cross-project memory leakage.

---

# 3. PROJECT DATA MODEL

Project includes:

- Project ID
- PLC Brand (Phase 1: Siemens TIA)
- TIA Version
- CPU Type
- Rack/Slot Layout
- Client Name
- IO Lists
- Global Tag DB
- Safety Level
- Uploaded Documentation
- Revision Log

All generation references project metadata.

---

# 4. CODE GENERATION REQUIREMENTS

## 4.1 General Rules

All generated code must:

- Be fully compilable.
- Include header block.
- Include revision history.
- Use state-machine architecture.
- Use global variables correctly.
- Use indexed IO arrays where appropriate.
- Follow deterministic naming conventions.
- Latch alarms.
- Require operator reset.
- Never auto-reset safety alarms.
- Avoid incomplete scaffolding.

Engineers are senior.
Comments must be concise and technical.
No over-explaining logic.

---

## 4.2 Function Block Template Requirements

Each FB must include:

1. Header section:
   - Name
   - Description
   - Author
   - Date
   - Revision history

2. Interface declaration:
   - Inputs
   - Outputs
   - InOut (if required)
   - Static vars
   - Temp vars

3. State machine structure:
   - INIT
   - IDLE
   - RUN
   - FAULT
   - RESET

4. Alarm block:
   - Latched
   - Manual reset
   - Timeout detection

5. IO validation:
   - Bounds checking
   - Index alignment
   - Mapping comments

6. Motor interlock logic (if applicable)

---

## 4.3 Project-Level Generation

Must support:

- OB generation
- FB generation
- FC generation
- UDT generation
- Global DB generation
- Tag table generation
- Device instantiation
- IO mapping arrays
- tia_manifest.json creation

---

# 5. TIA PORTAL OPENNESS INTEGRATION

Platform: Windows only.

Two integration modes:

## Mode A – XML Export
- Generate valid TIA importable XML.
- Validate schema.
- Allow preview.

## Mode B – Direct Openness Write
- Use .NET bridge service.
- Preview changes before write.
- Require user confirmation.
- Log write.
- Compile automatically.
- Capture compile errors.
- Return diagnostics.

No silent writes.
No auto-deploy to live PLC.

---

# 6. SAFETY CONTROLS

System must:

- Detect unsafe motor logic.
- Detect missing interlocks.
- Detect IO index mismatch.
- Detect alarm reset violations.
- Detect array out-of-bounds risk.
- Detect uninitialized states.

If unsafe:
- Flag prominently.
- Allow generation.
- Require explicit confirmation before export.

All safety warnings logged.

---

# 7. LEARNING SYSTEM (CONTROLLED)

## 7.1 Correction Detection

When user modifies approved code:

1. Compute diff vs generated version.
2. Classify correction type:
   - Naming
   - IO mapping
   - State logic
   - Alarm handling
   - Safety logic
   - Timing logic
3. Store as Pattern Candidate.

---

## 7.2 Pattern Library Structure

Pattern Candidate includes:

- PLC Brand
- Device Type
- Context
- Original snippet
- Corrected snippet
- Explanation tag
- Created by
- Timestamp

Status:
- Pending
- Approved
- Rejected

---

## 7.3 Admin Approval

Only approved patterns become Global Patterns.

Patterns apply:
- First brand-specific
- Then global
- Logged when applied

No uncontrolled self-learning.

---

# 8. VERSIONING SYSTEM

Must support:

- Snapshot save on every generation.
- Snapshot save on approval.
- Snapshot save on export.
- Diff view (generated vs approved).
- Rollback capability.
- Git integration ready (optional).

All versions timestamped and user-tagged.

---

# 9. UI REQUIREMENTS

Three-panel layout:

LEFT:
- Structured prompt builder
- Chat
- Agent status
- Session metadata

CENTER:
- Generated Code (Monaco)
- Read-only
- Syntax highlighting (Siemens ST initially)
- Brand-aware formatting

RIGHT:
- Approved Code (Monaco)
- Editable
- Diff compare
- Version select
- Snapshot history

Optional bottom panel:
- TIA compile output
- Openness logs

---

# 10. INTERACTION MODES

System must support:

Mode 1 – Guided Question Flow  
Mode 2 – Free-form Chat  
Mode 3 – Hybrid

AI must:
- Ask clarifying questions until confident.
- Never silently assume missing hardware details.
- Never produce partial scaffolding without warning.

---

# 11. NAMING CONVENTIONS

AI must enforce deterministic naming conventions.

Conventions must be:

- Device-specific FB naming
- Clear tag prefixes
- State enum naming
- Alarm naming standard
- IO array indexing standard

Naming must be consistent across project.

---

# 12. NON-NEGOTIABLE RULES

- No hallucinated Siemens APIs.
- No invented Openness methods.
- No speculative compile success.
- No unsafe silent behavior.
- Always respect UI_STYLE_GUIDE.md.
- Always use shadcn/ui components.
- Always produce build-ready output.

---

# 13. FUTURE EXPANSION (Reserved)

- Logix 5000
- Sysmac Studio
- Cross-brand abstraction layer
- Safety PLC specialization
- Auto IO import parsing
- Automated tag DB reconciliation