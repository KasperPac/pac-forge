# Pac-Forge UI Style Guide (Codey / Engineering)

This repo uses:
- React + Vite + TypeScript
- Tailwind CSS
- shadcn/ui components

## Visual style
Goal: feel like an engineering IDE / tools platform (dark, minimal, structured).

### Default look
- Dark-first UI (no light mode required initially)
- Background: neutral/graphite
- Thin 1px borders, subtle contrast
- Minimal rounding (rounded-md / rounded-lg only)
- Avoid heavy shadows (use subtle shadow-sm at most)
- Typography:
  - Normal UI: system sans
  - Code + labels + technical metadata: monospace (`font-mono`)
- Prefer dense spacing (engineering tool), not airy SaaS spacing.

## Components
- Prefer shadcn/ui primitives for buttons, cards, dialogs, dropdowns, tabs, etc.
- Use `Card` for panels.
- Use `Separator` for dividers.
- Use `Sheet` for slide-over panels (agent picker, settings).

## Layout patterns
- Dashboard shell already exists: sidebar + top bar.
- Pac-ST pages use split panels:
  - Left: chat + questions
  - Middle: generated code (Monaco)
  - Right: approved code (Monaco)
- Use scroll areas in panels; do not let the page scroll wildly.

## Do / Don’t
DO:
- Use Tailwind utility classes.
- Keep UI consistent with existing dashboard shell.
- Keep it readable and human-friendly (engineers will read it for hours).

DON’T:
- Introduce new UI libraries without approval.
- Use random component styles that don’t match shadcn/ui.
- Use bright neon cyberpunk visuals.