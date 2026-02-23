# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Is This

Pac-Forge is an internal productivity web app (React + Vite + TypeScript) for industrial automation engineers at Pac Technologies. The primary module in scope is **Pac-ST** — PLC code generation and Siemens TIA Portal integration. Pac-FD and Pac-IO are future modules; do not scaffold them unless asked.

## Commands

```bash
npm run dev       # Start Vite dev server with HMR
npm run build     # TypeScript check + Vite production build (tsc -b && vite build)
npm run lint      # ESLint across the project
npm run preview   # Preview production build locally
```

No test runner is configured yet. No backend server exists yet. No router installed yet — all content renders inline in `App.tsx`.

## Architecture

### Project Layout

```
src/
  main.tsx                  # Entry point, renders <App /> in StrictMode
  App.tsx                   # Root component — wraps content in DashboardLayout
  index.css                 # Tailwind directives + dark-mode base styles
  app/
    DashboardLayout.tsx     # Shell: Sidebar + TopBar + main content area
  components/ui/            # shadcn/ui primitives (button, card, separator, sheet, scroll-area)
  lib/utils.ts              # cn() helper (clsx + tailwind-merge)
ai/
  PLATFORM_RULES_SIEMENS_TIA.md   # PLC generation rules (alarm philosophy, IO indexing, artifact structure)
  TIA_MANIFEST_SCHEMA.md          # tia_manifest.json schema for TIA import/compile ordering
docs/                              # Referenced by MUST READ but not yet populated:
                                   #   PAC_ST_MASTER_SPEC.md, AGENT_POOL_ARCHITECTURE.md, TIA_OPENNESS_INTEGRATION.md
UI_STYLE_GUIDE.md                  # Visual design rules (dark-first, dense, engineering IDE feel)
```

Stale Vite template files (`App2.tsx`, `App.css`) still exist — safe to delete.

### Path Aliases

`@/` is mapped to `src/` via both Vite (`vite.config.ts` resolve.alias) and TypeScript (`tsconfig.json` paths). Always import with `@/` prefix:
```ts
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
```

### TypeScript Strictness

Strict mode is on in `tsconfig.app.json` with notable flags:
- `verbatimModuleSyntax` — **must** use `import type { Foo }` for type-only imports
- `noUnusedLocals` / `noUnusedParameters` — build fails on unused variables
- `erasableSyntaxOnly` — no enums or parameter properties; use `as const` objects instead

### shadcn/ui Configuration

- Style: `new-york` / Base color: `neutral` / Icons: `lucide-react`
- CSS variables enabled (referenced in `tailwind.config.js` theme extension)
- Add new components via: `npx shadcn@latest add <component>`

**Known gap:** `tailwind.config.js` references CSS custom properties (`--background`, `--foreground`, `--card`, etc.) via `hsl(var(...))`, but these variables are **not yet defined** in `index.css`. The dark theme currently works via direct Tailwind classes (`bg-neutral-950`, `text-neutral-200`). Before using shadcn semantic color classes like `bg-background` or `text-foreground`, the CSS variable definitions must be added to `index.css`.

### Dark Mode

Dark mode is forced globally in `index.css` via `:root { color-scheme: dark }` and `body { @apply bg-neutral-950 text-neutral-200 }`. The `darkMode: ["class"]` in tailwind.config exists for shadcn compatibility but the app does not toggle themes — it is always dark.

### Dashboard Shell

`DashboardLayout` (`src/app/DashboardLayout.tsx`) provides a fixed sidebar (w-64) + top bar (h-14) + scrollable main area. All Pac-ST pages render inside this shell. The sidebar nav includes: Projects, Agents, Pac-ST, TIA Console.

## MUST READ (in order) Before Domain Work

1. `UI_STYLE_GUIDE.md`
2. `docs/PAC_ST_MASTER_SPEC.md` *(not yet created)*
3. `docs/AGENT_POOL_ARCHITECTURE.md` *(not yet created)*
4. `docs/TIA_OPENNESS_INTEGRATION.md` *(not yet created)*
5. `ai/PLATFORM_RULES_SIEMENS_TIA.md`
6. `ai/TIA_MANIFEST_SCHEMA.md`

## Tech Constraints (Non-negotiable)

- Frontend: React 19 + Vite 7 + TypeScript 5.9
- Styling: Tailwind CSS v3 — utility classes only, no inline styles
- UI primitives: shadcn/ui (already initialized)
- Editors: Monaco Editor for code panes (generated, approved, diff)
- Backend: use a backend DB for persistence (projects, sessions, history, patterns, audit logs)
- Windows-only for TIA Openness bridge
- Do NOT introduce additional UI frameworks or styling systems without explicit instruction

## UI Rules

- Dark-first, no light mode required initially
- Dense spacing (engineering tool, not airy SaaS)
- Minimal rounding (`rounded-md` / `rounded-lg`), subtle borders (1px), avoid heavy shadows
- `font-mono` for code, labels, and technical metadata; system sans for normal UI
- Use `Card` for panels, `Separator` for dividers, `Sheet` for slide-overs
- Pac-ST pages use a 3-pane split: left (chat), middle (generated code / Monaco), right (approved code / Monaco)

## Behavior Constraints

- No invented or speculative APIs (especially TIA Openness)
- No "stub-by-handwave" safety logic
- Prefer deterministic, auditable implementations over cleverness
- Ask for missing requirements only when truly required; otherwise make conservative defaults aligned with the specs
