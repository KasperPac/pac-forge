# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

> ## 🎯 PRIMARY FOCUS (temporary) — Runnable Code + HMI Roadmap
>
> **Until this roadmap is complete, `Docs/ROADMAP-RUNNABLE-CODE-HMI.md` is the single primary focus of all work.** Unless a request explicitly says otherwise, assume everything we discuss is in service of *completing this roadmap*: getting the app to generate PLC code **and** operator HMI that compiles, downloads and runs on a new/unseen project with ~zero hand-authoring, at the fidelity that was hand-commissioned on the HRE Segment Wagon project over the last few days (the `exports/SRL-1427-500802-PACKML/` golden master is the quality bar, not the thing to reproduce — see G9).
>
> Work is split into per-stream git worktrees under `.claude/worktrees/` — **Foundation** (`foundation`, G0), **PLC Codegen** (`plc-codegen`, G1–G6), **HMI** (`hmi`, G7–G8), **Integration & Run** (`integration-run`, G9). See `WORKTREES.md` at the repo root for the live stream→branch→status map.
>
> _Remove this banner (and restore normal multi-module priorities) once the roadmap reaches G9 acceptance._

---

## Model Selection (suggest per task)

**At the start of any non-trivial task, suggest the model tier that fits it** (one line — e.g. _"This is codegen-writer work; recommend Opus 4.8"_), then proceed. Claude Code can't switch models itself — the user toggles with `/model`, so this is a recommendation, not an automatic switch. Default is **Opus 4.8**; only suggest another tier when the task clearly fits it.

| Model (`id`) | $/1M in·out | Use for |
|---|---|---|
| **Opus 4.8** (`claude-opus-4-8`) — default | $5 · $25 | Deterministic SCL/HMI writers (G1–G6), FDS contract (G0), safety-gate & compile-correctness logic, the .NET TIA bridge, multi-file debugging — anything correctness-critical or cross-file. |
| **Sonnet 5** (`claude-sonnet-5`) | $3 · $15 | Well-scoped, lower-risk work: UI wiring, tests, mechanical refactors, docs/tracking, prompt-text edits. Near-Opus quality, faster/cheaper. |
| **Fable 5** (`claude-fable-5`) | $10 · $50 | Only the hardest long-horizon, cross-cutting efforts where Opus stalls. 2× Opus cost + different API surface (always-on thinking, 30-day data-retention requirement) — never a default. |
| **Haiku 4.5** (`claude-haiku-4-5`) | $1 · $5 | Trivial mechanical sweeps — renames, lint, find/replace. |

Rule of thumb for this roadmap: **correctness-critical or multi-file → Opus 4.8; scoped/mechanical → Sonnet 5 (or Haiku for trivial); reserve Fable 5 for the genuinely hard.**

---

## What Is This

Pac-Forge ("Forja") is an internal productivity web app (React 19 + Vite + TypeScript) for industrial automation engineers at Pac Technologies. It spans the full delivery lifecycle: quoting, functional spec authoring, PLC code generation with Claude AI, HMI generation, and Siemens TIA Portal integration.

The center of gravity is the **Spec Builder → Forge Wizard → Code Builder** pipeline that turns a functional design spec (FDS) into ISA-88/PackML-structured PLC code. **Pac-ST** is the original chat-driven codegen workspace and still ships, but is no longer the only or primary entry point. See the Modules section below for the full surface.

## Commands

```bash
npm run dev       # Start Vite dev server with HMR
npm run build     # TypeScript check + Vite production build (tsc -b && vite build)
npm run lint      # ESLint across the project
npm run preview   # Preview production build locally
npm test          # Run vitest (watch mode)
npm run test:coverage  # Run vitest once with coverage
```

`npm run dev` runs `node scripts/dev.mjs` (wraps Vite with HMR). Vitest IS configured — there are 70+ test files (`src/**/__tests__/*.test.ts`). Run a single suite with `npx vitest run <path>`. `npx tsc -b` is the fast typecheck without bundling.

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

Edge functions (`supabase/functions/`): `generate` (Claude proxy), `renew-lease`, `cleanup-expired`, `dropbox`, `extract-pdf`, `github-proxy`, `monday-dashboard`, `quote-render-pdf`. Migrations directory holds 90+ migrations; the remote DB has at times been updated out-of-band via the SQL editor, so `db push` can report history drift — investigate before running `migration repair`.

## Modules

Pac-Forge has grown well beyond Pac-ST. The major modules:

- **Spec Builder / FDS** (`/specs/...`, `components/spec-builder/`, `lib/spec-builder/`) — AI co-author that produces an ISA-88/PackML Functional Design Spec. Stage A defines per-EM state machines; Stage B defines per-state behavior. Outputs the machine hierarchy the wizard consumes, plus DOCX export. **This is the primary authoring surface.**
- **Forge Wizard** (`components/forge/`, `use-forge-*.ts`, `forge-prompts.ts`) — 15-step project wizard that turns the FDS into a control-module matrix, operating sequences, device FBs, assembly FBs, OB1, HMI, and PLC-SIM tests.
- **Code Builder** (`components/code-builder/`, `use-code-builder.ts`, `use-spec-codegen.ts`) — Phase 4 deterministic FDS→SCL compiler (non-AI).
- **Quote Builder** (`components/quote-builder/`, `quote-builder-store.ts`) — quoting with PDF render via the `quote-render-pdf` edge function.
- **Variations** — change/variation tracking on projects.
- **HMI Builder/Editor** (`components/hmi/`, `use-hmi-wizard.ts`) — HMI screen/faceplate generation.
- **Pac-Audit** (`components/audit/`, `audit-store.ts`) — code/spec auditing.
- **Pac-ST** (`pac-st.tsx`, `components/pac-st/`) — original 3-pane chat codegen workspace (legacy but live).
- **Pac-LAD** (`pac-lad.tsx`, `components/lad-editor/`) — visual ladder logic editor (see Pac-LAD section).
- **FB Library / FB Builder** (`fb-library.tsx`, `components/fb-library/`) — company-standard FB templates + interface contracts.
- **Config & Training** — Clients, Profiles, Test Templates, Library Import, Instructions, Agents, Knowledge, Reference Library, Patterns, Prompts.
- **TIA Console** (`tia-console.tsx`) — .NET bridge status, demo generate, compile-fix.

## Architecture

### Project Layout

The tree below is a high-level map, not exhaustive — `src/hooks/` has 130+ hooks, `src/lib/spec-builder/` has 100+ modules. Use Glob/Grep to find specifics.

```
src/
  main.tsx                    # Entry point, renders <App /> in StrictMode
  App.tsx                     # Router setup: react-router with AuthGuard + DashboardLayout
  app/
    DashboardLayout.tsx       # Shell: grouped Sidebar + TopBar + scrollable main area
  routes/                     # ~40 page components (one per route) — see Routing below
  components/                 # Feature-grouped UI
    spec-builder/             # FDS co-author + structured spec editor
    forge/                    # 15-step project wizard panels
    code-builder/             # Phase 4 code builder shell
    quote-builder/            # Quoting UI
    hmi/                      # HMI editor/builder
    audit/                    # Pac-Audit UI
    pac-st/, tia-console/     # Legacy chat workspace + TIA console
    fb-library/, lad-editor/  # FB authoring + ladder editor
    ui/                       # shadcn/ui primitives
    auth-guard.tsx            # Route protection via Supabase session
  hooks/                      # 130+ TanStack Query hooks (all server state + AI calls)
    use-generation.ts         # SHARED helpers: streamFromEdgeFunction(), callNonStreaming(), processRawResponse(), getAuthToken()
    use-fds-conversation.ts   # Spec Builder FDS co-author (Stage A state machine + Stage B behavior)
    use-forge-*.ts            # ~15 Forge wizard generation hooks (spec analysis, matrix, sequences, device SCL, FB assembly, HMI, ...)
    use-pipeline-generate.ts  # Pac-ST multi-agent pipeline orchestration
    use-spec-codegen.ts       # Deterministic (non-AI) FDS → SCL compile
    use-compile-fix.ts        # Compile error → AI fix generation
    ...                       # quotes, variations, clients, knowledge, patterns, leases, etc.
  lib/                        # Pure logic libraries (no React)
    spec-builder/             # FDS engine: state machines, sequences, SCL codegen, DOCX export, prompts (100+ files)
    forge-*.ts, forge-prompts.ts  # Forge wizard logic + 50+ prompt builders
    prompt-builder.ts, prompt-defaults.ts  # Pac-ST system prompts + resolveSection() fallback
    pipeline.ts               # Pac-ST pipeline step config + ordering
    artifact-parser.ts        # Parses ```scl fenced blocks from Claude responses
    safety-analyzer.ts        # Rule-based safety checks on generated PLC code
    diff-engine.ts            # LCS line-level diff (normalizes \r\n)
    reference-lookup.ts       # Two-pass AI reference retrieval (topics → FTS + tag search)
    tia-bridge-contract.ts    # API contract types for .NET TIA Openness bridge
    simatic-xml-builder.ts, lad-xml-builder.ts  # SimaticML XML generation for TIA import
    monaco-scl.ts             # Monaco SCL language definition
    supabase.ts               # Supabase client singleton
    utils.ts                  # cn() helper (clsx + tailwind-merge)
  stores/                     # Zustand stores (UI-only state): forge, quote-builder, process-builder,
                              #   migrate, agent-chat, audit, flags, pac-st, tia-console, session, ui
  types/                      # TypeScript type definitions (one file per domain, 45+ files)
  providers/                  # query-provider.tsx (TanStack Query client)
supabase/
  migrations/                 # 90+ DB schema migrations
  functions/                  # 8 edge functions (generate, renew-lease, cleanup-expired, dropbox,
                              #   extract-pdf, github-proxy, monday-dashboard, quote-render-pdf)
ai/                           # PLATFORM_RULES_SIEMENS_TIA.md, SCL_LANGUAGE_REFERENCE.md, TIA_MANIFEST_SCHEMA.md
bridge/PacForgeBridge/        # .NET Framework 4.8 TIA Openness bridge
Docs/                         # Specs, architecture docs, Functional Specs/ (example projects), superpowers/plans/
UI_STYLE_GUIDE.md             # Visual design rules
```

### Routing

React Router v7 (`react-router`) with `createBrowserRouter`. All authenticated routes are children of `AuthGuard` → `DashboardLayout`. The sidebar groups routes into four sections (defined in `src/app/DashboardLayout.tsx`):

- **Main**: Dashboard, Projects, Quotes, Variations, T&Cs, Project Wizard (Forge), Pac-Audit, Spec Builder, HMI Editor
- **Configuration**: Clients, Profiles, FB Library, Test Templates, Library Import, Instructions, Agents
- **Training**: Knowledge, Reference Library, Patterns, Prompts
- **System**: TIA Console

Some routes (project detail, spec co-author, FB builder, Pac-ST, Pac-LAD, agent profile) are reached by navigation/deep-link rather than a top-level sidebar item. `DashboardLayout.tsx` is the source of truth for the live nav.

### State Management

- **Server state**: TanStack Query (`@tanstack/react-query`) — all hooks in `src/hooks/`
- **UI state**: Zustand stores in `src/stores/` — artifact selections, tab state, pipeline steps
- **Optimistic updates**: Chat messages use local optimistic state merged with DB history

### Backend

Supabase (hosted Postgres + Edge Functions + Auth + RLS). No custom backend server.

- **Edge Functions** proxy Claude API calls (keeps API key server-side). Single endpoint `POST /functions/v1/generate` handles all agent calls — streaming and non-streaming, with configurable `max_tokens` (default 8192, cap 32768)
- **Agent leases**: 30-minute leases with auto-renewal every 10 minutes via `useAutoRenewLeases`
- **All mutations** go through TanStack Query `useMutation` with `queryClient.invalidateQueries`

### Multi-Agent Pipeline (Pac-ST Path)

The Pac-ST code generation path (`usePipelineGenerate`) orchestrates multiple agents in sequence:

1. **Project Manager** — Plans the generation approach (`buildPlanPrompt()`)
2. **Code Architect** — Generates SCL code (`buildPrompt()`)
3. **Standards Reviewer** — Reviews code against rules (`buildReviewPrompt()`)
4. **IO Validator** — Validates IO mappings (optional)
5. **Safety Auditor** — Runs safety checks (optional)
6. **Pattern Librarian** — Analyzes diffs between stages, persists correction patterns (`buildPatternLibrarianPrompt()`)
7. **Project Manager** — Summarizes results (`buildSummaryPrompt()`)

Steps 3–6 are toggleable via the session start dialog. The pipeline config lives in `src/lib/pipeline.ts`.

### AI Generation Paths (CRITICAL)

There are now **30+ distinct AI generation paths**, each a hook + system-prompt builder pair, all calling the single `generate` edge function. There is NO single chokepoint for prompt content — when you add a rule/pattern/context that must apply to "all generation," you have to update every relevant builder. The Knowledge/Pattern systems below are the closest thing to a shared injection point, but not every path uses them. **When changing generation behavior, search broadly** (`Grep` for the builder family) rather than assuming the old "four paths."

Path families (representative, not exhaustive):

| Family | Hook(s) | Prompt Builder(s) | Notes |
|--------|---------|-------------------|-------|
| **Spec Builder FDS** | `use-fds-conversation.ts` | `em-state-machine-prompts.ts` (Stage A), `fds-prompts.ts` (Stage B) | Co-author flow; the current center of gravity |
| **Forge wizard** | `use-forge-*.ts` (~15) | `forge-prompts.ts` (50+ builders) | spec analysis, matrix, sequences, device SCL, FB assembly, OB1, interface contract, HMI, device-match, PLC-SIM tests |
| **Pac-ST pipeline** | `use-pipeline-generate.ts` | `buildPrompt()` (`prompt-builder.ts`) + PM/review/pattern builders | Original multi-agent path |
| **Process code** | `use-process-generate.ts`, `use-process-pipeline.ts` | `process-prompt-builder.ts`, `process-stage-prompts.ts` | |
| **Compile fix** | `use-compile-fix.ts` | `buildCompileFixSystemPrompt()` (`compile-fix-prompt.ts`) | |
| **FB / LAD / Migrate / Audit / HMI / Agent chat** | `use-fb-*`, `use-lad-generate`, `use-migrate-pipeline`, `use-hmi-wizard`, `use-agent-chat`, ... | various | |

**Deterministic (non-AI) codegen**: `use-spec-codegen.ts` + `src/lib/spec-builder/compile-contract.ts`, and `use-code-builder.ts` — these compile the FDS to SCL without an LLM. Prefer these where output must be auditable.

**Shared helpers** in `use-generation.ts`: `streamFromEdgeFunction()` (SSE reading), `callNonStreaming()` (non-streaming Edge Function call), `processRawResponse()` (parse → safety → manifest → save), `getAuthToken()`. Streaming paths use `streamFromEdgeFunction`; pipeline/wizard paths use `callNonStreaming`.

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
- **Versioning (MANDATORY)**: any change to the bridge must bump `BridgeVersion` in `TiaPortalService.cs` (semver: features = minor, fixes = patch) AND add an entry to `bridge/PacForgeBridge/CHANGELOG.md` describing what the version includes
- **Live commissioning workflow**: `POST /tia/reimport-compile` `{sources:{name:scl}}` deletes+reimports each block then compiles all; `POST /tia/export-sources` dumps every block. When an FB interface changes, include its instance DB in the same request (delete+recreate resets DB values on download — warn the user). TIA must be OFFLINE for any compile/save ("operation not permitted in online mode")
- **WinCC Unified HMI endpoints** (`TiaPortalService.HmiUnified.cs`): `POST /tia/hmi/build` (JSON spec: tags/screens/items/alarms/editItems, dynamizations incl. `singleBit` color mapping), `GET /tia/hmi/inspect` (structure + per-tag connection/PlcTag), `GET /tia/hmi/screen?name=X&props=1` (recursive property-graph dump — the discovery tool for any element option). See `Docs/WINCC-UNIFIED-OPENNESS-DISCOVERY.md` for the option-discovery method, binding rules, and capability map
- **Bridge rebuild quirks**: build `bridge/PacForgeBridge/PacForgeBridge.csproj` only (the solution also builds a V18 twin whose exe is often running/locked); every rebuild changes the exe checksum → TIA re-prompts the Openness whitelist on next connect (user must click Accept); the bridge attaches lazily on first endpoint call, so `/tia/status` shows `connected:false` after restart until something touches TIA
- **Openness is slow per item-edit** (~5–10 s): batches of ~90 screen-item edits run >10 min — run them in background; an HTTP client timeout does NOT mean the batch failed (verify by re-inspecting, force a save with an empty `/tia/hmi/build` call)

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

Always:
1. `UI_STYLE_GUIDE.md`
2. `ai/PLATFORM_RULES_SIEMENS_TIA.md`
3. `ai/SCL_LANGUAGE_REFERENCE.md`
4. `ai/TIA_MANIFEST_SCHEMA.md`

For Spec Builder / Forge / Code Builder work (the primary pipeline):
5. `Docs/superpowers/specs/2026-05-25-fds-engine-design.md` — FDS engine design
6. `Docs/superpowers/specs/2026-06-18-hybrid-em-state-model-design.md` + `Docs/HANDOVER-HYBRID-EM-STATE-MODEL.md` — per-EM Stage A/B state model
7. `Docs/superpowers/specs/2026-06-03-machine-hierarchy-design.md` — ISA-88 hierarchy
8. `Docs/forge-plan/MASTER_PLAN.md`, `Docs/forge-plan/ASSEMBLY_ARCHITECTURE.md` — Forge wizard architecture
9. `Docs/FDS_FORGE_ALIGNMENT.md` — how the FDS feeds the wizard

For TIA bridge / Pac-ST / agents:
10. `Docs/TIA_OPENNESS_INTEGRATION.md`, `Docs/PAC_ST_MASTER_SPEC.md`, `Docs/AGENT_POOL_ARCHITECTURE.md`
11. For WinCC Unified HMI work: `Docs/COMMISSIONING-NOTES.md` (binding/certificate/navigation rules) + `Docs/WINCC-UNIFIED-OPENNESS-DISCOVERY.md` (option discovery, bridge capability map, known generation gaps)

## Repo Tooling Gotchas

- `exports/<project>/*.db` files are TEXT (SCL DB sources) but the Read tool rejects the `.db` extension — write via a scratchpad `.txt` and copy over
- PowerShell 5.1: build JSON request bodies with `[IO.File]::ReadAllText()`, not `Get-Content -Raw` (piped strings carry PSPath metadata into `ConvertTo-Json`, corrupting the payload)
- Local Openness API catalogue: `C:\Program Files\Siemens\Automation\Portal V20\PublicAPI\V20\Siemens.Engineering.xml` documents all 487 HmiUnified types/members/enums — grep it before guessing API shapes

## Tech Constraints (Non-negotiable)

- Frontend: React 19 + Vite 7 + TypeScript 5.9
- Styling: Tailwind CSS v3 — utility classes only, no inline styles
- UI primitives: shadcn/ui
- Editors: Monaco Editor for code panes
- Backend: Supabase (Postgres + Edge Functions + Auth)
- Windows-only for TIA Openness bridge
- Do NOT introduce additional UI frameworks or styling systems

## UI Rules

- **Light-first**, following the Pac Technologies marketing design system (www.pac-technologies.com.au). Dark mode is supported via the theme toggle but is no longer the default.
- Brand anchor is Pac Blue 600 (`#3050A0`). Site accent is hi-vis orange (`#FF6A2C`). Use signal colors (green/amber/red) for state only — never decoration.
- Design tokens live in `src/styles/pac-tokens.css`. Tailwind utilities `bg-pac-*`, `text-pac-*` map directly to those tokens. Shadcn semantic tokens (`bg-background`, `text-foreground`, etc.) are also remapped to Pac equivalents so existing components light up automatically.
- Typography: **Inter** for UI/body, **JetBrains Mono** for tags, addresses, code, and technical values. Both loaded from Google Fonts via `index.html`.
- Dense spacing (engineering tool, not airy SaaS). Use the Pac 4 px grid via `--pac-space-*`.
- Restrained rounding: `--pac-radius-sm` (4px) for inputs/badges, `--pac-radius-md` (8px) for cards/panels, `--pac-radius-lg` (12px) for feature cards/modals. Pills (`--pac-radius-pill`) reserved for status chips and avatars.
- Three shadow levels (`shadow-pac-1/2/3`) used sparingly. Most panels sit on a hairline border, not a shadow.
- Focus rings: 2px Pac Blue with 2px paper offset — never removed.
- Pac-ST uses 3-pane resizable split: left (chat 25%), middle (generated 37.5%), right (approved 37.5%).

## Behavior Constraints

- No invented or speculative APIs (especially TIA Openness)
- No stub safety logic — safety-analyzer.ts has real rule-based checks
- Prefer deterministic, auditable implementations over cleverness
- Ask for missing requirements only when truly required

## Machine Hierarchy — ISA-88 Part 1 Compliant (Non-negotiable)

The forge wizard uses a 4-level hierarchy per ANSI/ISA-88.00.01 §4.4 (Physical Model):

- **Process Cell** — the full machine / production line (§4.4.3.3)
- **Unit** — a functional station carrying out a major processing activity (e.g. "Carriage Unit", "Safety Unit") (§4.4.3.4)
- **Equipment Module** — a coordinated group of control modules that carries out a finite number of specific minor processing activities (e.g. "Carriage Drive", "Rotator Brake") (§4.4.3.5). COLLAPSIBLE per §4.4.3.7 — when collapsed, Control Modules belong directly to the Unit.
- **Control Module** — a single physical device with IO signals (e.g. motor M01, limit switch LS_TOP, solenoid SOL_UP) (§4.4.3.6). Gets an FB (basic control), instance DB, and IO wiring.

**Rules:**
- Only **Control Modules** appear in the control module list and get FBs (basic control, `CM_` prefix)
- **Equipment Modules** get FBs with state machines (procedural control, `EM_` prefix)
- **Units** are coordination — each typically has its own Unit Procedure(s) (coordination control, `UC_` prefix)
- A Process Cell with 3 conveyors and 2 lift tables = 5 equipment modules across however many units
- Equipment Module layer is optional — when collapsed, Control Modules belong directly to the Unit
- Default to a single Unit; create more only when the spec describes equipment modules running under independent operating sequences. Extract boundaries from the spec — never invent them.
- The spec builder outputs this hierarchy — the wizard extracts it directly

**State/behaviour layer — PackML (ISA-TR88.00.02 / OMAC):** operating states, modes, and the machine data interface (PackTags) follow PackML. The spec-builder uses the PackML state model (`state-machine.ts`, `OperatingStateV2`, `CANONICAL_STATES`); treat PackML as the standard for the state/mode layer.

**Three Control Types (ISA-88 §5):**
- **Basic Control** (§5.2) → Control Module FBs (`CM_` prefix) — direct IO, no state machine
- **Procedural Control** (§5.3) → Equipment Module FBs (`EM_` prefix) — state machine, calls CM FBs
- **Coordination Control** (§5.4) → Unit/System FCs (`UC_`/`SC_` prefix) — coordinates EMs, manages interlocks

**Process vs Procedure (ISA-88 §4.3 vs §5.3):**
- Process Model = WHAT happens to the product (product-centric)
- Procedural Model = HOW the equipment does it (equipment-centric)
- Both are maintained in the FDS

## Critical: All Changes Must Be Generic (Non-negotiable)

The functional specs in `Docs/Functional Specs/` are **example projects only**. Any fix, improvement, or new logic added to prompts, matrix generation, sequence building, fault handling, device matching, or any other pipeline step **MUST apply generically to ALL projects**, not just the current spec being tested.

- Never hardcode project-specific device names, sequences, or fault conditions
- Never fix a problem "just for this spec" — always solve the general pattern
- Prompt improvements must work for conveyors, stamping cells, filling stations, etc. — not just lift tables
- When testing with one spec, mentally verify the fix would also work for a completely different machine type
- Training data, correction patterns, and learned behaviors are reused across all future projects — anything project-specific will pollute other generations

## Post-Task Self-Check (Pipeline / Prompt changes)

> NOTE: Earlier versions of this file referenced a `.claude/agents/pipeline-auditor.md` agent. **That file has never existed in this repo.** Until it is actually authored, perform the self-check below manually instead.

After every code change that touches files matching these patterns:
- `src/hooks/use-forge-*.ts`
- `src/hooks/use-pipeline-*.ts`
- `src/lib/*-prompt*.ts` and `src/lib/spec-builder/*-prompt*.ts`
- `src/lib/forge-*.ts`
- `src/lib/pipeline.ts`

Run this checklist before considering the task done:
1. **Generic check** — re-read "All Changes Must Be Generic" above. Confirm no project-specific device names, sequences, or fault conditions leaked into prompts/logic. Mentally test the change against a different machine type.
2. **Typecheck** — `npx tsc -b` must pass clean.
3. **Tests** — run the relevant `npx vitest run <path>` suite(s); add a regression test for any bug fixed.

## Monday Board Sync (MANDATORY, always on)

> **The rule (non-negotiable, self-enforcing):** as you produce code, keep the work tracked on Monday. While doing substantive **Forja app** delivery work — features, fixes, roadmap tasks, research spikes on the app's own capability — you MUST keep the active Monday board in sync by **calling the Monday MCP tools (`mcp__monday__*`) directly**, at every level of the board's hierarchy (group → item → subitem → sub-subitem, as deep as it goes). This instruction alone obligates the calls; no hook, reminder, or user prompt is required to trigger them. Sync in the **same turn as the work**, the moment state changes — not as an end-of-task step. Never let the board drift from reality. If `mcp__monday__*` is deferred, load it via ToolSearch (`select:mcp__monday__change_item_column_values,mcp__monday__create_update,mcp__monday__create_items,mcp__monday__all_monday_api`) and proceed.
>
> **Scope boundary (explicit):** the board tracks the **Forja app's capability ONLY**. Project-specific delivery work — HRE/SRL commissioning, anything under `exports/` (dashboards, hand-authored PLC blocks, site tooling), customer-project fixes — is **NOT tracked on Monday**, no rows, no updates. If project work surfaces a *generic app gap*, put THAT (generically phrased) on the board; the project work itself stays off.

**On every change you MUST, as applicable:**
1. Move the **Status** of the touched row when its state changes (start / done / blocked / needs-design).
2. Recompute the parent's **Progress %** when a child changes (rule of thumb: done=100, in-progress=50, blocked/needs-design/not-started=0; a parent's % = mean of its children).
3. Set/adjust **Timeline** dates when work starts, is scheduled, or slips.
4. Post an **update/comment** (`create_update`) recording what changed and why — decisions, links to commits/docs. This is the running log.
5. **Add** rows when new work is discovered; **remove** rows that are cut or merged; keep names/priority/effort tags current. Keep scope truthful.
6. **Every newly created item/subitem MUST immediately receive a `create_update` comment** — stating what it is, why it was added, and its source (decision doc / commit / conversation). A row without its origin comment is an incomplete creation, not an optional nicety.
7. **Attach every plan / spec you author to its Monday row as a native Monday Doc.** Whenever you create a plan or design spec (`Docs/superpowers/plans/*`, `Docs/superpowers/specs/*`, `Docs/forge-plan/*`), import its markdown into a Monday Doc on the matching item/phase via `create_doc` (`location: "item"`, `item_id`, `markdown` — auto-creates the board's `doc` column) so it renders **inline in the app** — no download, no external tab. Do **NOT** upload raw `.md` as a file asset (Monday won't render it) or convert to PDF (goes stale). The repo `.md` stays the source of truth; the Monday Doc is a synced copy — re-import (`update_doc` `add_markdown_content`, or recreate) when the doc materially changes. Also drop a one-line `create_update` with the repo path.

Match whatever hierarchy and columns the active board actually uses (inspect with `get_board_info` if unsure) rather than assuming a fixed shape.

### Active board (current instance)

- **Board:** "Forja" `5099871231` (workspace Software Automation) — https://pac-technologies-company.monday.com/boards/5099871231. (Old board `5092432355` is retired; ignore it.)
- **Hierarchy:** Group = delivery area · Item = phase (`G0`…`G10`) · Subitem = task (`G0-1`…; name carries `· P{0-2}/{S|M|L}`) · sub-subitems = task breakdown as you decompose while working.
- **Columns:** Status `color_mkv68q9k` (blank = not started · `Spec Created` · `Plan Created` · `Working on it` · `Awaiting Testing` · `Done` · `Stuck` · `Needs design` · `Blocker / Research`) · Priority `color_mm53skak` (`Low`/`Medium`/`High`/`Critical`) · Effort `color_mm532cy4` (`Small`/`Medium`/`Large`) · Progress % `numeric_mm51xyq6` (auto-rollup formula — do not write) · Timeline `timerange_mkypz732` · People `person` · Subitems `subtasks_mkrmtgvm` · a `doc` column holds each task's spec/plan Monday Doc (rule 7).
- **Status workflow:** blank → Spec Created → Plan Created → Working on it → Awaiting Testing → Done. Priority map: P0→Critical, P1→High, P2→Medium. Effort: S/M/L → Small/Medium/Large.
- **⚠️ Connector quirk:** this session's Monday MCP can *write* Status/Priority/Effort but does **not return those column values on read** (reads surface only People + Subitems). Verify status-type columns visually; never conclude a write failed from a blind read (writes reliably succeed).
- **Phase item IDs:** G0 `3056319948` · G1 `3056337724` · G2 `3056337764` · G3 `3056337727` · G4 `3056319949` · G5 `3056336774` · G6 `3056400706` · G7 `3056337435` · G8 `3056337434` · G9 `3056329989` · G10 `3056349330`.
- **Sources of truth** feeding it: `Docs/ROADMAP-RUNNABLE-CODE-HMI.md` (+ `.tasks.json`) and `Docs/WINCC-UNIFIED-OPENNESS-DISCOVERY.md` — change one, reflect on the board (and vice-versa).

## Pipeline Integrity (MANDATORY)

After completing ANY task that modifies hooks, prompt builders, or pipeline logic, run the **Post-Task Self-Check** above (generic check + `npx tsc -b` + relevant vitest suites). Do NOT proceed to the next task if typecheck or tests fail, or if any change is not generic across machine types. Fix violations first.

(The previously-referenced `.claude/agents/pipeline-auditor.md` does not exist — use the manual self-check until it is authored.)