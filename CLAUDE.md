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
    patterns.tsx              # Correction pattern review/approval admin
    tia-console.tsx           # TIA bridge status + job history table
  components/
    pac-st/                   # Pac-ST workspace sub-components (14 files)
    ui/                       # shadcn/ui primitives
    auth-guard.tsx            # Route protection via Supabase session
    session-start-dialog.tsx  # Agent selection + session creation modal
    project-card.tsx, project-form.tsx, pattern-review-card.tsx, io-list-editor.tsx
  hooks/                      # TanStack Query hooks (all server state)
    use-generation.ts         # Full pipeline: prompt → Edge Function → parse → analyze → manifest
    use-agent-reservation.ts  # Lease-based agent locking with auto-renewal
    use-sessions.ts           # Session CRUD + active session lookup
    use-conversation.ts       # Chat history persistence
    use-patterns.ts           # Correction pattern CRUD + approval workflow
    use-snapshots.ts          # Artifact version snapshots + rollback
    use-tia-jobs.ts           # TIA job submission + polling + bridge status
    use-audit-log.ts          # Fire-and-forget audit log insertion
    use-projects.ts, use-agents.ts, use-auth.ts
  lib/                        # Pure logic libraries (no React)
    prompt-builder.ts         # Builds system prompts from platform rules + project context + patterns
    artifact-parser.ts        # Parses ```scl fenced blocks from Claude responses
    manifest-builder.ts       # Topological sort (Kahn's algorithm) for TIA import ordering
    safety-analyzer.ts        # 6 rule-based safety checks on generated PLC code
    diff-engine.ts            # LCS-based line-level diff
    correction-classifier.ts  # Maps diff hunks to correction types for pattern learning
    tia-export.ts             # JSZip bundle generator for TIA Portal import
    tia-bridge-contract.ts    # TypeScript API contract types for .NET TIA Openness bridge
    monaco-scl.ts             # Monaco Editor SCL language definition (Monarch tokenizer)
    supabase.ts               # Supabase client singleton
    auth.ts                   # Auth helpers
    utils.ts                  # cn() helper (clsx + tailwind-merge)
  stores/                     # Zustand stores (UI-only state)
    pac-st-store.ts           # Generated/approved artifacts, active tabs
    session-store.ts, ui-store.ts
  types/                      # TypeScript type definitions (one file per domain)
  providers/
    query-provider.tsx        # TanStack Query client setup
supabase/
  migrations/001_initial_schema.sql  # Full DB schema (projects, agents, sessions, artifacts, etc.)
  functions/
    generate/                 # Claude API proxy Edge Function (streaming support)
    renew-lease/              # Agent lease renewal
    cleanup-expired/          # Expired lease cleanup
ai/
  PLATFORM_RULES_SIEMENS_TIA.md  # PLC generation rules (injected into Claude prompts)
  TIA_MANIFEST_SCHEMA.md         # tia_manifest.json schema
Docs/
  PAC_ST_MASTER_SPEC.md          # Full Pac-ST specification
  AGENT_POOL_ARCHITECTURE.md     # Agent reservation system design
  TIA_OPENNESS_INTEGRATION.md    # TIA Portal bridge integration spec
UI_STYLE_GUIDE.md                # Visual design rules
```

### Routing

React Router v7 (`react-router`) with `createBrowserRouter`. All authenticated routes are children of `AuthGuard` → `DashboardLayout`. Sidebar nav: Projects, Agents, Pac-ST, Patterns, TIA Console.

### State Management

- **Server state**: TanStack Query (`@tanstack/react-query`) — all hooks in `src/hooks/`
- **UI state**: Zustand stores in `src/stores/` — artifact selections, tab state
- **Optimistic updates**: Chat messages use local optimistic state merged with DB history

### Backend

Supabase (hosted Postgres + Edge Functions + Auth + RLS). No custom backend server.

- **Edge Functions** proxy Claude API calls (keeps API key server-side)
- **Agent leases**: 30-minute leases with auto-renewal every 10 minutes via `useAutoRenewLeases`
- **All mutations** go through TanStack Query `useMutation` with `queryClient.invalidateQueries`

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

## MUST READ Before Domain Work

1. `UI_STYLE_GUIDE.md`
2. `Docs/PAC_ST_MASTER_SPEC.md`
3. `Docs/AGENT_POOL_ARCHITECTURE.md`
4. `Docs/TIA_OPENNESS_INTEGRATION.md`
5. `ai/PLATFORM_RULES_SIEMENS_TIA.md`
6. `ai/TIA_MANIFEST_SCHEMA.md`

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
