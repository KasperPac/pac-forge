# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Is This

Pac-Forge is an internal productivity web app (React + Vite + TypeScript) for industrial automation engineers at Pac Technologies. The primary module is **Pac-ST** — PLC code generation with Claude AI and Siemens TIA Portal integration. Pac-FD and Pac-IO are future modules; do not scaffold them unless asked.

## Commands

```bash
npm run dev       # Start Vite dev server with HMR
npm run build     # TypeScript check + Vite production build (tsc -b && vite build)
npm run lint      # ESLint across the project
npm run preview   # Preview production build locally
```

No test runner is configured yet.

### .NET TIA Bridge

```bash
dotnet build bridge/PacForgeBridge.sln                # Build bridge (requires .NET Framework 4.8 SDK)
dotnet run --project bridge/PacForgeBridge             # Run bridge (default port 5102)
dotnet run --project bridge/PacForgeBridge -- --port 5200  # Run on custom port
```

Requires TIA Portal Openness DLL — update `HintPath` in `.csproj` for your TIA Portal version (V17–V20).

### Supabase

```bash
npx supabase start                          # Start local Supabase (Docker required)
npx supabase db push                        # Apply migrations to remote
npx supabase functions deploy generate      # Deploy Claude proxy Edge Function
npx supabase functions deploy renew-lease   # Deploy lease renewal Edge Function
npx supabase functions deploy cleanup-expired # Deploy expired lease cleanup
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...  # Set Claude API key (cloud)
```

## Architecture

### Project Layout

```
src/
  main.tsx                    # Entry point, renders <App /> in StrictMode
  App.tsx                     # Router setup: react-router with AuthGuard + DashboardLayout
  index.css                   # Tailwind directives + dark-mode base styles + CSS variables
  app/
    DashboardLayout.tsx       # Shell: Sidebar (w-64) + TopBar (h-14) + scrollable main area
  routes/                     # Page components (one per route)
    login.tsx                 # Supabase auth (email/password)
    projects.tsx              # Project list with create dialog
    project-detail.tsx        # Single project view with IO list editor
    pac-st.tsx                # Main 3-pane workspace (chat + generated + approved)
    agents.tsx                # Agent pool status display
    agent-profile.tsx         # Individual agent detail page with learnings
    knowledge.tsx             # Centralized knowledge upload + PM distribution
    profiles.tsx              # Design profile management
    fb-library.tsx            # FB template library (company-standard FBs)
    patterns.tsx              # Correction pattern review/approval admin
    prompt-editor.tsx         # Editable system prompt sections per agent role
    reference-library.tsx     # Reference doc upload + section browsing with topic tags
    tia-console.tsx           # TIA bridge status + demo generate + compile-fix
  components/
    pac-st/                   # Pac-ST workspace sub-components
    tia-console/              # compile-fix-chat, tia-manual-fix-panel, learned-corrections-log
    ui/                       # shadcn/ui primitives
    auth-guard.tsx            # Route protection via Supabase session
    session-start-dialog.tsx  # PM-centric session creation with pipeline step toggles
  hooks/                      # TanStack Query hooks (all server state)
    use-generation.ts         # Shared helpers: streamFromEdgeFunction(), callNonStreaming(), processRawResponse(), getAuthToken()
    use-pipeline-generate.ts  # Multi-agent pipeline orchestration (PM → Generator → Reviewers → Pattern Librarian)
    use-process-generate.ts   # Process code generation from functional description documents
    use-demo-pipeline.ts      # TIA Console demo generation via full multi-agent pipeline
    use-compile-fix.ts        # Compile error → AI fix generation
    use-reimport-compile.ts   # Re-import fixed code + recompile via bridge
    use-export-from-tia.ts    # Export current sources from TIA Portal via bridge
    use-pattern-librarian-analysis.ts  # AI-powered correction analysis (with regex fallback)
    use-knowledge-distribute.ts  # Knowledge upload → PM analysis → agent distribution
    use-knowledge-conflicts.ts   # Knowledge conflict detection across sources
    use-knowledge-priority.ts    # Knowledge priority override management
    use-design-profiles.ts    # Design profile CRUD
    use-fb-templates.ts       # FB template library CRUD
    use-agent-knowledge.ts    # Per-agent knowledge document management
    use-patterns.ts           # Correction pattern CRUD + approval workflow
    use-prompt-sections.ts    # Editable prompt section CRUD + version management
    use-reference-library.ts  # Reference library doc + section CRUD
    use-tia-jobs.ts           # TIA job submission + polling + bridge status
    use-tia-bridge-ws.ts      # WebSocket connection to .NET bridge
    use-agent-reservation.ts  # Lease-based agent locking with auto-renewal
    use-lease-check.ts        # Agent lease validation checks
    use-keyboard-shortcuts.ts # Keyboard shortcut management
    use-sessions.ts, use-conversation.ts, use-snapshots.ts
    use-projects.ts, use-agents.ts, use-auth.ts, use-audit-log.ts
  lib/                        # Pure logic libraries (no React)
    prompt-builder.ts         # System prompts: project context + patterns + FB templates + design profiles + knowledge
    prompt-defaults.ts        # Hardcoded prompt defaults + resolveSection() fallback (DB → shared → code)
    process-prompt-builder.ts # System prompt for process code generation path
    compile-fix-prompt.ts     # System prompt for compile-fix generation path
    pattern-librarian-prompt.ts  # System prompt for Pattern Librarian AI analysis
    review-prompt-builder.ts  # System prompt for Standards Review agent
    rewrite-prompt-builder.ts # System prompt for Rewrite agent (review fix flow)
    review-response-parser.ts # Parse Standards Review agent response
    pm-prompt-builder.ts      # System prompts for PM orchestration (plan + summary)
    pipeline.ts               # Pipeline step config, agent type checks, step ordering
    artifact-parser.ts        # Parses ```scl fenced blocks from Claude responses
    manifest-builder.ts       # Topological sort (Kahn's algorithm) for TIA import ordering
    safety-analyzer.ts        # 6 rule-based safety checks on generated PLC code
    diff-engine.ts            # LCS-based line-level diff (normalizes \r\n line endings)
    correction-classifier.ts  # Regex-based diff → correction type classification (fallback for AI)
    conflict-detector.ts      # Deterministic conflict detection across prescriptive knowledge sources
    knowledge-priority.ts     # Knowledge source priority hierarchy + override resolution
    reference-lookup.ts       # Two-pass AI reference retrieval (extract topics → FTS + tag search)
    document-sections.ts      # Document splitting/sectioning for knowledge distribution
    document-extractor.ts     # Client-side .docx/.pdf text extraction (mammoth + pdfjs-dist)
    tia-export.ts             # JSZip bundle generator for TIA Portal import
    tia-bridge-contract.ts    # TypeScript API contract types for .NET TIA Openness bridge
    simatic-xml-builder.ts    # SimaticML XML generation for TIA import
    compile-fix-parser.ts     # Parse TIA compile errors from bridge output
    demo-programs.ts          # Demo program definitions for TIA Console quick start
    io-address-validator.ts   # IO address validation logic
    io-csv-parser.ts          # CSV parsing for IO lists
    agent-profiles.ts         # Agent specialization configuration (identity, skills, color)
    platform-rules.ts         # Load platform rules from markdown
    suggested-prompts.ts      # Pre-suggested prompts for chat
    monaco-scl.ts             # Monaco Editor SCL language definition (Monarch tokenizer)
    supabase.ts               # Supabase client singleton
    utils.ts                  # cn() helper (clsx + tailwind-merge)
  stores/                     # Zustand stores (UI-only state)
    pac-st-store.ts           # Generated/approved artifacts, active tabs, pipeline steps
    tia-console-store.ts      # TIA Console state (pipeline steps, compile results, compile-fix messages)
    session-store.ts, ui-store.ts
  types/                      # TypeScript type definitions (one file per domain)
  providers/
    query-provider.tsx        # TanStack Query client setup
supabase/
  migrations/                 # DB schema migrations (003–007+)
  functions/
    generate/                 # Claude API proxy Edge Function (streaming + non-streaming)
    renew-lease/              # Agent lease renewal
    cleanup-expired/          # Expired lease cleanup
ai/
  PLATFORM_RULES_SIEMENS_TIA.md  # PLC generation rules (injected into Claude prompts)
  SCL_LANGUAGE_REFERENCE.md      # SCL syntax & built-in function reference
  TIA_MANIFEST_SCHEMA.md         # tia_manifest.json schema
Docs/
  PAC_ST_MASTER_SPEC.md          # Full Pac-ST specification
  AGENT_POOL_ARCHITECTURE.md     # Agent reservation system design
  TIA_OPENNESS_INTEGRATION.md    # TIA Portal bridge integration spec
  agent-flow.mmd                 # Mermaid diagram of agent pipeline + data flows
UI_STYLE_GUIDE.md                # Visual design rules
```

### Routing

React Router v7 (`react-router`) with `createBrowserRouter`. All authenticated routes are children of `AuthGuard` → `DashboardLayout`. Sidebar nav (in order): Projects, Agents, Knowledge, Reference Library, Pac-ST, Patterns, Profiles, FB Library, Prompts, TIA Console.

### State Management

- **Server state**: TanStack Query (`@tanstack/react-query`) — all hooks in `src/hooks/`
- **UI state**: Zustand stores in `src/stores/` — artifact selections, tab state, pipeline steps
- **Optimistic updates**: Chat messages use local optimistic state merged with DB history

### Backend

Supabase (hosted Postgres + Edge Functions + Auth + RLS). No custom backend server.

- **Edge Functions** proxy Claude API calls (keeps API key server-side). Single endpoint `POST /functions/v1/generate` handles all agent calls — streaming and non-streaming, with configurable `max_tokens` (default 8192, cap 32768)
- **Agent leases**: 30-minute leases with auto-renewal every 10 minutes via `useAutoRenewLeases`
- **All mutations** go through TanStack Query `useMutation` with `queryClient.invalidateQueries`

### Multi-Agent Pipeline (Pac-ST Main Path)

The main code generation path (`usePipelineGenerate`) orchestrates multiple agents in sequence:

1. **Project Manager** — Plans the generation approach (`buildPlanPrompt()`)
2. **Code Architect** — Generates SCL code (`buildPrompt()`)
3. **Standards Reviewer** — Reviews code against rules (`buildReviewPrompt()`)
4. **IO Validator** — Validates IO mappings (optional)
5. **Safety Auditor** — Runs safety checks (optional)
6. **Pattern Librarian** — Analyzes diffs between stages, persists correction patterns (`buildPatternLibrarianPrompt()`)
7. **Project Manager** — Summarizes results (`buildSummaryPrompt()`)

Steps 3–6 are toggleable via the session start dialog. The pipeline config lives in `src/lib/pipeline.ts`.

### Four Generation Paths (CRITICAL)

There are 4 separate AI code-generation paths, each with its own hook and system prompt builder. When adding rules, patterns, or context to "all generation prompts", **all four must be updated**:

| Path | Hook | Prompt Builder | Entry Point |
|------|------|---------------|-------------|
| Pac-ST pipeline | `use-pipeline-generate.ts` | `buildPrompt()` in `prompt-builder.ts` | `pac-st.tsx` |
| Process code | `use-process-generate.ts` | `buildProcessPrompt()` in `process-prompt-builder.ts` | `pac-st.tsx` (Process tab) |
| TIA Console demo | `use-demo-pipeline.ts` | Full pipeline: `buildPlanPrompt` → `buildPrompt` → `buildReviewPrompt` → `buildPatternLibrarianPrompt` → `buildSummaryPrompt` | `tia-console.tsx` |
| Compile fix | `use-compile-fix.ts` | `buildCompileFixSystemPrompt()` in `compile-fix-prompt.ts` | `compile-fix-chat.tsx` |

The TIA Console demo path uses the **full multi-agent pipeline** (same as Pac-ST), not a standalone system prompt. It reuses all prompt builders.

**Shared helpers** in `use-generation.ts`: `streamFromEdgeFunction()` (SSE reading), `callNonStreaming()` (non-streaming Edge Function call), `processRawResponse()` (parse → safety → manifest → save), `getAuthToken()`. Streaming paths use `streamFromEdgeFunction`; pipeline paths use `callNonStreaming`.

### Three Knowledge/Learning Systems

1. **Correction patterns** (`pattern_candidates` table) — Structured WRONG/CORRECT code pairs with correction type. Created via compile-fix auto-learn, manual fix panel, or pipeline pattern step. Injected into ALL generation prompts via `formatPatterns()`. Status workflow: PENDING → APPROVED/REJECTED.

2. **Agent knowledge docs** (`agent_knowledge_docs` table) — Free-form reference documents per agent. Created via Knowledge page (PM distributes uploaded docs to relevant agents) or direct teaching. Injected into generation prompts for the agent that owns them.

3. **Reference library** (`reference_library_docs` + `reference_library_sections` tables) — Large Siemens reference documents uploaded and auto-split into searchable sections with topic tags. Two-pass AI lookup at generation time: (1) extract relevant topics from user message via AI, (2) Postgres FTS + tag search via `searchReferenceSections()`. Results injected as `## SCL Reference Documentation` section. See `src/lib/reference-lookup.ts`.

### Knowledge Priority & Conflict Detection

When multiple knowledge sources give contradictory guidance, the system resolves conflicts using a priority hierarchy defined in `src/lib/knowledge-priority.ts`:

**Priority (highest → lowest):** Platform Rules > Design Profile > Correction Patterns > FB Templates > Agent Knowledge > Reference Library > Prompt Sections

- `src/lib/conflict-detector.ts` — Stance-based conflict detection across prescriptive sources (Design Profiles, Agent Knowledge)
- `src/hooks/use-knowledge-conflicts.ts` — Fetches and surfaces active conflicts
- `src/hooks/use-knowledge-priority.ts` — Per-project priority overrides (stored in `knowledge_priority_overrides` table, migration 007)

### Editable Prompt Sections

System prompts are split into editable sections stored in `prompt_sections` table (migration 006). Each section has a role + key + versioned content. The system falls back gracefully: DB override → shared default → hardcoded default via `resolveSection()` in `prompt-defaults.ts`.

- **Roles**: `shared`, `generate`, `process`, `review`, `rewrite`, `compile_fix`, `plan`, `summary`, `patterns`
- **Editable sections per role**: identity, instructions, platform_rules (varies — see `ROLE_SECTIONS` map in `types/prompt-section.ts`)
- **Output formats stay hardcoded** — artifact parsing (` ```scl ` blocks, JSON arrays, review findings) is NOT exposed for editing
- **Route**: `/prompts` → `src/routes/prompt-editor.tsx`
- **`interpolateAgent()`** in `prompt-defaults.ts` replaces `{agent_name}`, `{agent_tagline}`, `{agent_description}`, `{agent_personality}` tokens in identity templates for review/rewrite/patterns roles

### Pattern Learning Flow

When code corrections happen (compile-fix, manual TIA fix, or pipeline review), the system:
1. Computes diffs with `\r\n` normalization (TIA Portal exports `\r\n`, generated code uses `\n`)
2. Filters out whitespace-only changes via `hasFunctionalChanges()`
3. Extracts focused WRONG/CORRECT snippets with context via `extractFocusedSnippets()`
4. Tries AI analysis (Pattern Librarian agent) → falls back to regex (`classifyCorrections()`)
5. Saves to `pattern_candidates` with status APPROVED (auto-learn, manual) or PENDING (pipeline)
6. Approved patterns are fetched by `useActivePatterns("SIEMENS_TIA")` and injected into all future generation prompts

### .NET TIA Bridge

The bridge (`bridge/PacForgeBridge/`) is a .NET Framework 4.8 console app that wraps TIA Portal Openness for the frontend.

- **Target**: .NET Framework 4.8 (not .NET Core) — required by TIA Openness
- **Language version**: C# 7.3
- **Default port**: 5102 (HTTP + WebSocket)
- **WebSocket**: `ws://localhost:5102/tia/ws` — real-time job status + compile output
- **Key services**: `BridgeServer` (HTTP/WS), `TiaPortalService` (Openness wrapper), `JobExecutor` (async job queue), `WebSocketHandler` (real-time updates)
- **Frontend contract**: `src/lib/tia-bridge-contract.ts` defines all request/response types
- **Key endpoints**: `/tia/status`, `/tia/import-compile`, `/tia/export-sources`, `/tia/create-project`, `/tia/import-lad`, `/tia/export-block-xml`
- **TIA Openness `GenerateSource`** requires 3 params: `(IEnumerable<IGenerateSource>, FileInfo, GenerateOptions)`. File extension must match block type (`.scl` for SCL, `.awl` for STL, `.db` for DBs)
- **LAD import**: Uses `PlcBlockGroup.Blocks.Import(FileInfo, ImportOptions.Override)` — different from SCL path. Returns `IList<PlcBlock>` (not `IEngineeringObject`)
- **Stale project fix**: `Connect()` always refreshes `_project` from `_tiaPortal.Projects[0]` — handles user switching projects in TIA Portal without restarting bridge

### Path Aliases

`@/` maps to `src/` via Vite and TypeScript. Always use `@/` prefix for imports.

### TypeScript Strictness

- `verbatimModuleSyntax` — must use `import type { Foo }` for type-only imports
- `noUnusedLocals` / `noUnusedParameters` — build fails on unused variables
- `erasableSyntaxOnly` — no enums; use `as const` objects instead

### shadcn/ui

Style: `new-york` / Base color: `neutral` / Icons: `lucide-react`. Add components via `npx shadcn@latest add <component>`.

### Key Libraries

- `react-resizable-panels` v4 — exports `Group`, `Panel`, `Separator` (NOT v3 names). Wrapped in `src/components/ui/resizable.tsx`
- `@monaco-editor/react` — code editors with custom SCL language via `monaco-scl.ts`
- `jszip` — TIA export bundle generation
- `zustand` — lightweight UI state stores
- `mammoth` — .docx text extraction for process code / knowledge uploads
- `pdfjs-dist` — PDF text extraction for knowledge uploads (runs client-side; uploads abort if browser suspends)

### Pac-LAD Module

LAD (Ladder Logic) editor at `/pac-lad` → `src/routes/pac-lad.tsx`. Key files:

- `src/types/lad.ts` — data model: `LadProgram`, `LadRung`, `LadNode` (element | parallel), `LadSeriesChain`, `LadElement`
- `src/lib/lad-xml-builder.ts` — generates SimaticML FlgNet v4 XML for TIA V18 import. **Critical rules**:
  - All `<Access>` nodes must appear BEFORE `<Part>` nodes within `<Parts>`
  - Parallel (OR) branches use `<Part Name="O">` with `in1/in2/...` and `out` — NOT separate wires
  - Powerrail wire must fan to ALL parallel branch starts in a single `<Wire>` element
  - Timer instances: `Scope="LocalVariable"`, capital pin names (`IN`, `PT`, `Q`, `ET`), `TypedConstant` scope for `T#...` values
  - Compare boxes: `pre` is the rung-flow input pin (not `in`), `out` is output
  - `<Interface>` must be inline with `<Sections>` (no newline between); `<NetworkSource>` inline with `<FlgNet>`
- `src/lib/lad-layout.ts` — SVG coordinate engine for the visual canvas
- `src/lib/lad-prompt-builder.ts` — AI generation prompt with TIA LAD validation rules
- `src/hooks/use-lad-import.ts` — POSTs to `/tia/import-lad` with 60s timeout
- `src/components/lad-editor/` — canvas (zoom/pan SVG), element renderer, properties panel

## MUST READ Before Domain Work

1. `UI_STYLE_GUIDE.md`
2. `Docs/PAC_ST_MASTER_SPEC.md`
3. `Docs/AGENT_POOL_ARCHITECTURE.md`
4. `Docs/TIA_OPENNESS_INTEGRATION.md`
5. `ai/PLATFORM_RULES_SIEMENS_TIA.md`
6. `ai/SCL_LANGUAGE_REFERENCE.md`
7. `ai/TIA_MANIFEST_SCHEMA.md`

## Tech Constraints (Non-negotiable)

- Frontend: React 19 + Vite 7 + TypeScript 5.9
- Styling: Tailwind CSS v3 — utility classes only, no inline styles
- UI primitives: shadcn/ui
- Editors: Monaco Editor for code panes
- Backend: Supabase (Postgres + Edge Functions + Auth)
- Windows-only for TIA Openness bridge
- Do NOT introduce additional UI frameworks or styling systems

## UI Rules

- Dark-first, no light mode required
- Dense spacing (engineering tool, not airy SaaS)
- Minimal rounding (`rounded-md` / `rounded-lg`), subtle borders, no heavy shadows
- `font-mono` for code, labels, technical metadata; system sans for normal UI
- Pac-ST uses 3-pane resizable split: left (chat 25%), middle (generated 37.5%), right (approved 37.5%)

## Behavior Constraints

- No invented or speculative APIs (especially TIA Openness)
- No stub safety logic — safety-analyzer.ts has real rule-based checks
- Prefer deterministic, auditable implementations over cleverness
- Ask for missing requirements only when truly required

## Machine Hierarchy (Non-negotiable)

The forge wizard uses a 4-level hierarchy for machine decomposition. The functional spec defines this structure — the AI extracts it, never invents it.

- **System** — the full machine / production line
- **Subsystem** — a functional station (e.g. "Infeed Conveyor Station", "Hydraulic Lift Station", "Safety")
- **Assembly** — a coordinated group of devices working together (e.g. "Lift Table LFT01", "Conveyor CV01"). Has NO FB — orchestrated by process sequence logic.
- **Device** — a single physical thing with IO signals (e.g. motor M01, limit switch LS_TOP, solenoid SOL_UP). Gets an FB, instance DB, and IO wiring.

**Rules:**
- Only **devices** appear in the device list and get FBs
- **Assemblies** appear in process sequences as the coordination logic
- **Subsystems** are organisational grouping — each typically has its own process sequence(s)
- A system with 3 conveyors and 2 lift tables = 5 assemblies across however many subsystems
- The spec builder outputs this hierarchy — the wizard extracts it directly

## Critical: All Changes Must Be Generic (Non-negotiable)

The functional specs in `Docs/Functional Specs/` are **example projects only**. Any fix, improvement, or new logic added to prompts, matrix generation, sequence building, fault handling, device matching, or any other pipeline step **MUST apply generically to ALL projects**, not just the current spec being tested.

- Never hardcode project-specific device names, sequences, or fault conditions
- Never fix a problem "just for this spec" — always solve the general pattern
- Prompt improvements must work for conveyors, stamping cells, filling stations, etc. — not just lift tables
- When testing with one spec, mentally verify the fix would also work for a completely different machine type
- Training data, correction patterns, and learned behaviors are reused across all future projects — anything project-specific will pollute other generations

## Post-Task Hooks

After every code change that touches files matching these patterns:
- `src/hooks/use-forge-*.ts`
- `src/hooks/use-pipeline-*.ts`  
- `src/lib/*-prompt*.ts`
- `src/lib/forge-*.ts`
- `src/lib/pipeline.ts`

Automatically run: Read `.claude/agents/pipeline-auditor.md` and execute the audit 
against the current codebase. Report findings. Block if FAIL.

## Monday Integration

See `CLAUDE.monday.md` for monday.com task sync rules.

**MANDATORY — follow this exact order for EVERY task (no exceptions, even small fixes):**
1. **BEFORE writing any code**: Create the Monday task (or find existing) with `--status "Working on it"` and a description of what you're about to do
2. **Do the work**: Implement the fix/feature
3. **AFTER the work is done**: Update the Monday task to `--status "Awaiting Testing"` with a summary of what was changed in `--comments`
4. **Ask the user to test**: Ask if the fix works. If yes → update to `--status "Done"`. If no → update back to `--status "Fixing"` and continue working on it.

This applies to bug fixes, features, improvements — everything. Never skip step 1. The task must exist in Monday BEFORE the first line of code is written.

**Monday tooling**: Monday MCP is configured at `https://mcp.monday.com/mcp` — use MCP tools directly when available. Fallback: `python scripts/task_create.py --title "..." --status "Working on it" --group "..."` and `python scripts/task_update.py --task-id <id> --status "..."`. Board ID: `5092432355`. Status column: `status_cdbba809`.
## Pipeline Integrity (MANDATORY)

After completing ANY task that modifies hooks, prompt builders, or pipeline logic, 
run the pipeline auditor agent at `.claude/agents/pipeline-auditor.md`.

Do NOT proceed to the next task if the audit fails. Fix violations first.