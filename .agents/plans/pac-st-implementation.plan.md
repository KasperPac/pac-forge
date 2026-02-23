# Plan: PAC-ST Full Implementation

## Summary

Implement the complete PAC-ST system as specified in `Docs/PAC_ST_MASTER_SPEC.md` and `Docs/PAC_ST_SPEC.md` (union of both). The system is a deterministic PLC engineering tool with a three-pane UI (chat / generated code / approved code), Claude-powered code generation via Supabase Edge Functions, Supabase backend for persistence, agent reservation system, controlled pattern library, versioning/snapshots, and TIA Portal integration (Mode A export + Mode B API contract).

Six phases, each producing a working increment.

## Decisions Locked

| Decision | Choice |
|----------|--------|
| Backend | Supabase (hosted Postgres) |
| Claude API | Thin proxy via Supabase Edge Functions |
| Auth | Simple email/password via Supabase Auth |
| Router | React Router v7 |
| State management | Zustand (UI state) + TanStack Query (server state) |
| Monaco | @monaco-editor/react wrapper |
| TIA bridge | Define API contract only; .NET bridge out of scope |
| Spec authority | Both specs, union of requirements |
| CSS variables | Fix in Phase 1 |

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY |
| Complexity | HIGH |
| Systems Affected | Frontend (entire), Backend (Supabase), Edge Functions, Type system |

---

## Patterns to Follow

### Imports — use @/ alias
```ts
// SOURCE: src/App.tsx:1-2
import { DashboardLayout } from "@/app/DashboardLayout";
import { Card } from "@/components/ui/card";
```

### Components — shadcn/ui primitives + Tailwind utilities
```tsx
// SOURCE: src/app/DashboardLayout.tsx:5-29
// Dense spacing, font-mono for technical labels, bg-background, border-r, etc.
<aside className="w-64 border-r bg-background">
  <div className="p-4">
    <div className="font-mono text-xs text-muted-foreground">PAC-FORGE</div>
  </div>
</aside>
```

### TypeScript — strict mode constraints
```ts
// SOURCE: tsconfig.app.json
// verbatimModuleSyntax → must use `import type` for type-only imports
// noUnusedLocals / noUnusedParameters → build fails on unused vars
// erasableSyntaxOnly → no enums; use `as const` objects
```

### shadcn/ui — add new components via CLI
```bash
npx shadcn@latest add <component>
```

---

# PHASE 1: Foundation + Cleanup

**Goal**: Clean slate with routing, auth, Supabase client, state management, CSS fix, and all domain types defined. App builds and runs with navigable routes and login.

## Files to Change

| File | Action | Purpose |
|------|--------|---------|
| `src/App2.tsx` | DELETE | Stale Vite boilerplate |
| `src/App.css` | DELETE | Stale Vite boilerplate |
| `vite.config.ts` | UPDATE | Fix import ordering (move `import path` to top) |
| `src/index.css` | UPDATE | Add shadcn CSS variable definitions for dark theme |
| `package.json` | UPDATE | Add react-router, zustand, @tanstack/react-query, @supabase/supabase-js |
| `.env.example` | CREATE | Template for VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY |
| `.env.local` | CREATE | Local env values (gitignored) |
| `.gitignore` | UPDATE | Add .env.local |
| `src/lib/supabase.ts` | CREATE | Supabase client singleton |
| `src/types/index.ts` | CREATE | Re-export barrel for all domain types |
| `src/types/project.ts` | CREATE | Project, ProjectCreate, ProjectUpdate types |
| `src/types/session.ts` | CREATE | Session, SessionCreate types |
| `src/types/agent.ts` | CREATE | Agent, AgentReservation types |
| `src/types/artifact.ts` | CREATE | Artifact, ArtifactBundle, TiaManifest types |
| `src/types/pattern.ts` | CREATE | PatternCandidate, PatternStatus types |
| `src/types/snapshot.ts` | CREATE | Snapshot, SnapshotDiff types |
| `src/types/tia.ts` | CREATE | TiaJob, TiaJobType, CompileResult, CompileError types |
| `src/types/conversation.ts` | CREATE | Message, ConversationTurn, SafetyWarning types |
| `src/types/auth.ts` | CREATE | User, AuthState types |
| `src/stores/ui-store.ts` | CREATE | Zustand store: active panel, sidebar collapsed, selected project, etc. |
| `src/stores/session-store.ts` | CREATE | Zustand store: active session state, selected agents |
| `src/App.tsx` | UPDATE | Replace with RouterProvider setup |
| `src/routes/root.tsx` | CREATE | Root layout route wrapping DashboardLayout |
| `src/routes/login.tsx` | CREATE | Login page |
| `src/routes/projects.tsx` | CREATE | Projects list page (placeholder) |
| `src/routes/project-detail.tsx` | CREATE | Single project page (placeholder) |
| `src/routes/pac-st.tsx` | CREATE | Pac-ST three-pane page (placeholder) |
| `src/routes/agents.tsx` | CREATE | Agents page (placeholder) |
| `src/routes/tia-console.tsx` | CREATE | TIA Console page (placeholder) |
| `src/app/DashboardLayout.tsx` | UPDATE | Integrate React Router Outlet, NavLink, auth guard |
| `src/lib/auth.ts` | CREATE | Auth helpers: signIn, signUp, signOut, getUser |
| `src/hooks/use-auth.ts` | CREATE | Auth hook wrapping Supabase auth state |
| `src/components/auth-guard.tsx` | CREATE | Redirect to login if not authenticated |
| `src/providers/query-provider.tsx` | CREATE | TanStack QueryClientProvider wrapper |

## Tasks

### Task 1.1: Delete stale files
- **Files**: `src/App2.tsx`, `src/App.css`
- **Action**: DELETE
- **Validate**: `npm run build`

### Task 1.2: Fix vite.config.ts
- **File**: `vite.config.ts`
- **Action**: UPDATE — move `import path from "path"` above `defineConfig`
- **Validate**: `npm run build`

### Task 1.3: Fix CSS variables
- **File**: `src/index.css`
- **Action**: UPDATE — add `:root` / `.dark` CSS variable definitions for all shadcn semantic tokens (--background, --foreground, --card, --card-foreground, --popover, --popover-foreground, --primary, --primary-foreground, --secondary, --secondary-foreground, --muted, --muted-foreground, --accent, --accent-foreground, --destructive, --destructive-foreground, --border, --input, --ring, --radius, --chart-1 through --chart-5). Use neutral palette values matching the current bg-neutral-950 / text-neutral-200 dark theme.
- **Validate**: `npm run dev` — verify shadcn components render with correct colors

### Task 1.4: Install dependencies
- **Action**: npm install
- **Packages (dependencies)**: `react-router`, `zustand`, `@tanstack/react-query`, `@supabase/supabase-js`
- **Validate**: `npm run build`

### Task 1.5: Environment setup
- **Files**: `.env.example`, `.env.local`, `.gitignore`
- **Action**: CREATE `.env.example` with `VITE_SUPABASE_URL=` and `VITE_SUPABASE_ANON_KEY=`. CREATE `.env.local` with placeholder values. UPDATE `.gitignore` to include `.env.local`.
- **Validate**: File exists, gitignore blocks it

### Task 1.6: Supabase client
- **File**: `src/lib/supabase.ts`
- **Action**: CREATE — initialize Supabase client from `import.meta.env.VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Export typed client.
- **Validate**: `npm run build`

### Task 1.7: Domain types
- **Files**: `src/types/project.ts`, `session.ts`, `agent.ts`, `artifact.ts`, `pattern.ts`, `snapshot.ts`, `tia.ts`, `conversation.ts`, `auth.ts`, `index.ts`
- **Action**: CREATE all domain types as specified in both spec documents.
- **Key types**:
  - `Project`: id, client_name, plc_brand, tia_version, cpu_type, rack_slot_layout, io_lists, tag_db_definitions, uploaded_docs, safety_level, safety_notes, revision_log, created_at, updated_at
  - `Session`: id, user_id, project_id, selected_agent_ids, status (ACTIVE | CLOSED | EXPIRED), created_at, updated_at
  - `Agent`: id, display_name, specialties (tag array), is_enabled, status (AVAILABLE | RESERVED | OFFLINE | DISABLED), max_concurrency
  - `AgentReservation`: id, agent_id, session_id, user_id, reserved_at, lease_expires_at, released_at, release_reason
  - `Artifact`: name, type (UDT | FB | FC | DB | OB | SCL_SOURCE | TAG_TABLE), filename, content, destination_folder, dependencies, compile_after_import, overwrite_strategy, notes, safety_warnings
  - `TiaManifest`: manifest_version, project_id, platform, tia_version, cpu_type, created_at, created_by_user_id, generation_session_id, artifacts
  - `PatternCandidate`: id, plc_brand, device_type, context, original_snippet, corrected_snippet, explanation_tag, correction_type (NAMING | IO_MAPPING | STATE_LOGIC | ALARM | SAFETY | TIMING), status (PENDING | APPROVED | REJECTED), created_by, created_at
  - `Snapshot`: id, project_id, artifact_id, content, trigger (GENERATION | APPROVAL | EXPORT), version_number, created_by, created_at
  - `ConversationTurn`: id, session_id, role (USER | AGENT), agent_id, content, artifacts_generated, safety_warnings, timestamp
  - `TiaJob`: id, project_id, session_id, job_type (IMPORT_ONLY | IMPORT_AND_COMPILE | COMPILE_ONLY | EXPORT_REPORT), manifest, status, compile_results, created_by, created_at
  - `CompileError`: artifact_name, line, column, error_text, severity
  - `SafetyWarning`: id, type (UNSAFE_MOTOR | MISSING_INTERLOCK | IO_MISMATCH | ALARM_RESET_VIOLATION | ARRAY_OOB | UNINITIALIZED_STATE), artifact_name, description, line, acknowledged
- **Validate**: `npm run build`

### Task 1.8: Zustand stores
- **Files**: `src/stores/ui-store.ts`, `src/stores/session-store.ts`
- **Action**: CREATE
- **ui-store**: sidebarCollapsed, activePanelTab (for bottom panel: compile | logs | warnings), bottomPanelOpen
- **session-store**: activeSessionId, selectedAgentIds, sessionStatus
- **Validate**: `npm run build`

### Task 1.9: TanStack Query provider
- **File**: `src/providers/query-provider.tsx`
- **Action**: CREATE — export `QueryProvider` wrapping `QueryClientProvider` with sensible defaults (staleTime, retry)
- **Validate**: `npm run build`

### Task 1.10: Auth layer
- **Files**: `src/lib/auth.ts`, `src/hooks/use-auth.ts`, `src/components/auth-guard.tsx`
- **Action**: CREATE
- `auth.ts`: `signIn(email, password)`, `signUp(email, password)`, `signOut()`, `getUser()` — all wrapping Supabase Auth
- `use-auth.ts`: hook that subscribes to `supabase.auth.onAuthStateChange`, returns `{ user, loading, signIn, signUp, signOut }`
- `auth-guard.tsx`: component that checks auth state and redirects to `/login` if unauthenticated; wraps `<Outlet />`
- **Validate**: `npm run build`

### Task 1.11: React Router setup
- **Files**: `src/App.tsx`, `src/routes/root.tsx`, `src/routes/login.tsx`, `src/routes/projects.tsx`, `src/routes/project-detail.tsx`, `src/routes/pac-st.tsx`, `src/routes/agents.tsx`, `src/routes/tia-console.tsx`
- **Action**: UPDATE App.tsx, CREATE route files
- **Route structure**:
  ```
  /login                → LoginPage (public)
  / (root)              → AuthGuard → DashboardLayout → Outlet
    /projects           → ProjectsPage
    /projects/:id       → ProjectDetailPage
    /pac-st             → PacStPage (three-pane — placeholder)
    /agents             → AgentsPage
    /tia-console        → TiaConsolePage
    index redirect      → /projects
  ```
- **App.tsx**: Replace with `createBrowserRouter` + `RouterProvider`, wrapped in `QueryProvider`
- **root.tsx**: DashboardLayout + AuthGuard + Outlet
- **All route pages**: Minimal placeholder with Card + page title in font-mono
- **Validate**: `npm run dev` — navigate all routes, verify auth redirect

### Task 1.12: Update DashboardLayout for routing
- **File**: `src/app/DashboardLayout.tsx`
- **Action**: UPDATE
- Replace Button nav items with React Router `NavLink` components
- Add active state styling (e.g., `bg-accent` when route matches)
- Replace `{children}` with `<Outlet />` (or accept children, depending on root.tsx design)
- Show current user email in TopBar
- Add sign-out button
- **Validate**: `npm run dev` — sidebar navigation works, active states visible

---

# PHASE 2: Supabase Schema + Project CRUD

**Goal**: Supabase tables created, project CRUD fully working (create, list, edit, delete), project detail page populated with all spec-required fields. TanStack Query hooks for data fetching.

## Files to Change

| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/001_initial_schema.sql` | CREATE | All database tables |
| `src/hooks/use-projects.ts` | CREATE | TanStack Query hooks for project CRUD |
| `src/hooks/use-agents.ts` | CREATE | TanStack Query hooks for agents |
| `src/routes/projects.tsx` | UPDATE | Full project list with create button |
| `src/routes/project-detail.tsx` | UPDATE | Full project detail/edit form |
| `src/components/project-card.tsx` | CREATE | Project summary card for list view |
| `src/components/project-form.tsx` | CREATE | Create/edit project form |
| `src/components/io-list-editor.tsx` | CREATE | IO list structured editor |
| Additional shadcn components | ADD | dialog, input, label, textarea, select, tabs, badge, dropdown-menu, toast, tooltip |

## Tasks

### Task 2.1: Supabase migration — full schema
- **File**: `supabase/migrations/001_initial_schema.sql`
- **Action**: CREATE
- **Tables** (with RLS policies):
  - `profiles` — user_id (FK auth.users), display_name, role (ENGINEER | ADMIN), created_at
  - `projects` — all fields from spec Section 3: id, client_name, plc_brand, tia_version, cpu_type, rack_slot_layout (jsonb), io_lists (jsonb), tag_db_definitions (jsonb), safety_level, safety_notes, revision_log (jsonb), created_by, created_at, updated_at
  - `agents` — id, display_name, specialties (text[]), is_enabled, status, max_concurrency, system_prompt, created_at
  - `sessions` — id, user_id, project_id, selected_agent_ids (text[]), status, created_at, updated_at
  - `agent_reservations` — id, agent_id, session_id, user_id, reserved_at, lease_expires_at, released_at, release_reason
  - `conversation_turns` — id, session_id, role, agent_id, content, artifacts_generated (jsonb), safety_warnings (jsonb), created_at
  - `artifacts` — id, project_id, session_id, name, type, filename, content, destination_folder, dependencies (text[]), compile_after_import, overwrite_strategy, safety_warnings (jsonb), created_at
  - `snapshots` — id, project_id, artifact_id, content, trigger, version_number, created_by, created_at
  - `pattern_candidates` — id, plc_brand, device_type, context, original_snippet, corrected_snippet, correction_type, explanation_tag, status, created_by, reviewed_by, created_at, reviewed_at
  - `tia_jobs` — id, project_id, session_id, job_type, manifest (jsonb), status, compile_results (jsonb), created_by, created_at, completed_at
  - `audit_logs` — id, user_id, project_id, action, details (jsonb), created_at
- **Seed data**: 5 default agents (Code Architect, PLC Standards Enforcer, IO Validator, Safety Auditor, Pattern Librarian) with display_name, specialties, system_prompt sketches
- **RLS**: Users can only access their own projects and sessions. Admins can access all patterns.
- **Validate**: Apply migration via Supabase dashboard or CLI

### Task 2.2: Install additional shadcn components
- **Action**: `npx shadcn@latest add dialog input label textarea select tabs badge dropdown-menu toast tooltip`
- **Validate**: `npm run build`

### Task 2.3: TanStack Query hooks — projects
- **File**: `src/hooks/use-projects.ts`
- **Action**: CREATE
- Hooks: `useProjects()` (list), `useProject(id)` (single), `useCreateProject()`, `useUpdateProject()`, `useDeleteProject()`
- All use Supabase client for queries/mutations
- Invalidate query cache on mutations
- **Validate**: `npm run build`

### Task 2.4: TanStack Query hooks — agents
- **File**: `src/hooks/use-agents.ts`
- **Action**: CREATE
- Hooks: `useAgents()` (list all), `useAvailableAgents()` (only AVAILABLE status)
- **Validate**: `npm run build`

### Task 2.5: Project list page
- **Files**: `src/routes/projects.tsx`, `src/components/project-card.tsx`
- **Action**: UPDATE projects.tsx, CREATE project-card.tsx
- Grid/list of project cards showing: client_name, plc_brand, cpu_type, tia_version, last updated
- "New Project" button opening dialog or navigating to create form
- **Validate**: `npm run dev` — projects page renders, shows data from Supabase

### Task 2.6: Project form (create/edit)
- **File**: `src/components/project-form.tsx`
- **Action**: CREATE
- All project fields from spec: client_name, plc_brand (select: Siemens TIA for Phase 1), tia_version (select), cpu_type (select: S7-1200 / S7-1500), rack_slot_layout, safety_level, safety_notes
- Dense layout matching UI_STYLE_GUIDE.md
- Used in both create dialog and project-detail edit mode
- **Validate**: `npm run dev` — can create and edit projects

### Task 2.7: Project detail page
- **File**: `src/routes/project-detail.tsx`
- **Action**: UPDATE
- Tabs: Overview, IO Lists, Tag DB, Documents, Revision Log
- Overview: project metadata display + edit
- IO Lists tab: placeholder for structured editor (Phase 2 stretch or Phase 3)
- Tag DB tab: placeholder
- Documents tab: placeholder (file upload later)
- Revision Log tab: display revision_log entries
- "Open Pac-ST Session" button → navigates to `/pac-st?project={id}`
- **Validate**: `npm run dev` — full project detail page functional

### Task 2.8: IO list editor
- **File**: `src/components/io-list-editor.tsx`
- **Action**: CREATE
- Table-based editor for structured IO lists (address, tag name, data type, description, module/slot)
- Add/remove/reorder rows
- Validates deterministic IO indexing per PLATFORM_RULES
- **Validate**: `npm run dev` — can add/edit/delete IO entries within project detail

---

# PHASE 3: Three-Pane UI + Monaco Editor

**Goal**: The core Pac-ST page with three resizable panes (chat, generated code, approved code), Monaco editors with SCL syntax highlighting, and the optional bottom panel for logs/compile output.

## Files to Change

| File | Action | Purpose |
|------|--------|---------|
| `package.json` | UPDATE | Add @monaco-editor/react |
| `src/routes/pac-st.tsx` | UPDATE | Full three-pane layout |
| `src/components/pac-st/chat-pane.tsx` | CREATE | Left pane: chat, agent status, project summary |
| `src/components/pac-st/generated-code-pane.tsx` | CREATE | Center pane: read-only Monaco |
| `src/components/pac-st/approved-code-pane.tsx` | CREATE | Right pane: editable Monaco |
| `src/components/pac-st/bottom-panel.tsx` | CREATE | Bottom panel: compile output, logs, warnings |
| `src/components/pac-st/pane-resizer.tsx` | CREATE | Draggable divider between panes |
| `src/components/pac-st/artifact-tabs.tsx` | CREATE | Tab bar above Monaco for multi-artifact switching |
| `src/components/pac-st/safety-banner.tsx` | CREATE | Safety warnings banner in left pane |
| `src/components/pac-st/agent-status-bar.tsx` | CREATE | Agent selection status in left pane |
| `src/lib/monaco-scl.ts` | CREATE | SCL/ST language definition for Monaco (tokenizer, keywords, comments) |
| `src/components/pac-st/diff-view.tsx` | CREATE | Diff view toggle in right pane (generated vs approved) |
| `src/stores/pac-st-store.ts` | CREATE | Zustand store for Pac-ST pane state |
| Additional shadcn components | ADD | resizable, switch, toggle |

## Tasks

### Task 3.1: Install Monaco + shadcn additions
- **Action**: `npm install @monaco-editor/react` + `npx shadcn@latest add resizable switch toggle`
- **Validate**: `npm run build`

### Task 3.2: SCL language definition for Monaco
- **File**: `src/lib/monaco-scl.ts`
- **Action**: CREATE
- Register custom language `scl` with Monaco
- Keywords: FUNCTION_BLOCK, END_FUNCTION_BLOCK, FUNCTION, END_FUNCTION, DATA_BLOCK, TYPE, END_TYPE, VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT, VAR, VAR_TEMP, END_VAR, IF, THEN, ELSE, ELSIF, END_IF, CASE, OF, END_CASE, FOR, TO, BY, DO, END_FOR, WHILE, END_WHILE, REPEAT, UNTIL, END_REPEAT, RETURN, REGION, END_REGION, etc.
- Types: BOOL, BYTE, WORD, DWORD, INT, DINT, REAL, LREAL, TIME, STRING, ARRAY, STRUCT, END_STRUCT
- Comments: `//` line comments, `(* *)` block comments
- Operators, number literals, string literals
- Dark theme colors matching app's neutral palette
- **Validate**: `npm run dev` — SCL keywords highlight in Monaco

### Task 3.3: Pac-ST Zustand store
- **File**: `src/stores/pac-st-store.ts`
- **Action**: CREATE
- State: leftPaneWidth, rightPaneWidth, bottomPanelHeight, bottomPanelOpen, bottomPanelTab (compile | logs | warnings), activeArtifactIndex (center), activeApprovedArtifactIndex (right), showDiff
- **Validate**: `npm run build`

### Task 3.4: Pane resizer component
- **File**: `src/components/pac-st/pane-resizer.tsx`
- **Action**: CREATE
- Draggable vertical/horizontal divider
- Uses shadcn resizable or custom implementation
- Persists sizes to Zustand store
- **Validate**: `npm run dev` — panes resize smoothly

### Task 3.5: Three-pane layout
- **File**: `src/routes/pac-st.tsx`
- **Action**: UPDATE — full three-pane layout
- Reads `?project={id}` from URL search params
- If no project, redirect to /projects
- Layout: flex row with left pane (min 280px), resizer, center pane (flex-1), resizer, right pane (min 280px)
- Below: optional collapsible bottom panel
- Full height (fill remaining space below TopBar)
- **Validate**: `npm run dev` — three panes render with resizers

### Task 3.6: Chat pane (left)
- **File**: `src/components/pac-st/chat-pane.tsx`
- **Action**: CREATE
- Sections:
  1. Project metadata summary (client, PLC, CPU) — compact, font-mono
  2. Agent status bar (which agents are selected, their status)
  3. Safety warnings banner (if any active warnings)
  4. Chat message list (ScrollArea)
  5. Message input (textarea + send button)
- Supports Mode 1 (guided), Mode 2 (free-form), Mode 3 (hybrid) — mode selector toggle
- **Validate**: `npm run dev` — chat pane renders, messages can be typed

### Task 3.7: Generated code pane (center)
- **File**: `src/components/pac-st/generated-code-pane.tsx`
- **Action**: CREATE
- Artifact tabs at top (one tab per artifact in the bundle)
- Monaco editor below, read-only, language=scl
- Header showing artifact metadata (name, type, patterns applied)
- "Approve" button → copies content to right pane
- "Approve All" button for entire bundle
- **Validate**: `npm run dev` — Monaco renders with SCL highlighting, tabs switch

### Task 3.8: Approved code pane (right)
- **File**: `src/components/pac-st/approved-code-pane.tsx`
- **Action**: CREATE
- Artifact tabs at top (matching approved artifacts)
- Monaco editor, editable, language=scl
- Toolbar: Save Snapshot, Rollback dropdown, Version select, Diff toggle
- When diff toggle active, switch to Monaco DiffEditor (generated vs approved)
- **Validate**: `npm run dev` — editable Monaco, diff toggle works

### Task 3.9: Diff view component
- **File**: `src/components/pac-st/diff-view.tsx`
- **Action**: CREATE
- Wraps Monaco DiffEditor
- Left: generated (original), Right: approved (modified)
- Side-by-side or inline toggle
- **Validate**: `npm run dev` — diff view shows differences

### Task 3.10: Bottom panel
- **File**: `src/components/pac-st/bottom-panel.tsx`
- **Action**: CREATE
- Collapsible (toggle from Zustand store)
- Tabs: Compile Output, TIA Logs, Warnings/Errors
- Compile Output: list of CompileError items with artifact_name, line, error_text
- Clicking an error navigates Monaco to that line in the relevant artifact
- TIA Logs: scrollable text log
- Warnings: list of SafetyWarning items with type, description, acknowledged toggle
- **Validate**: `npm run dev` — bottom panel toggles, tabs switch

### Task 3.11: Artifact tabs component
- **File**: `src/components/pac-st/artifact-tabs.tsx`
- **Action**: CREATE
- Horizontal tab bar showing artifact names with type badge (UDT, FB, FC, DB, OB)
- Active tab indicator
- Clicking tab switches Monaco content
- Shared between generated and approved panes
- **Validate**: `npm run dev` — tabs render and switch

### Task 3.12: Safety banner
- **File**: `src/components/pac-st/safety-banner.tsx`
- **Action**: CREATE
- Renders active SafetyWarning items
- Types from spec Section 6: UNSAFE_MOTOR, MISSING_INTERLOCK, IO_MISMATCH, ALARM_RESET_VIOLATION, ARRAY_OOB, UNINITIALIZED_STATE
- Destructive color styling for unacknowledged warnings
- Acknowledge button per warning
- **Validate**: `npm run dev` — banner renders with mock warnings

---

# PHASE 4: Session + Agent Reservation System

**Goal**: Full session lifecycle — start session against a project, select and reserve agents (with lease-based locking), agent status display, session timeout/cleanup, release on close.

## Files to Change

| File | Action | Purpose |
|------|--------|---------|
| `src/hooks/use-sessions.ts` | CREATE | TanStack Query hooks for sessions |
| `src/hooks/use-agent-reservation.ts` | CREATE | Reserve/release/renew agent leases |
| `src/components/session-start-dialog.tsx` | CREATE | Agent selection dialog at session start |
| `src/components/pac-st/agent-status-bar.tsx` | UPDATE | Live agent status display |
| `src/routes/pac-st.tsx` | UPDATE | Session lifecycle integration |
| `supabase/functions/renew-lease/index.ts` | CREATE | Edge Function: renew agent lease |
| `supabase/functions/cleanup-expired/index.ts` | CREATE | Edge Function: release expired leases (cron) |

## Tasks

### Task 4.1: Session hooks
- **File**: `src/hooks/use-sessions.ts`
- **Action**: CREATE
- `useCreateSession(projectId, agentIds)` — creates session, reserves agents
- `useEndSession(sessionId)` — closes session, releases all agent reservations
- `useActiveSession(projectId)` — get active session for a project
- **Validate**: `npm run build`

### Task 4.2: Agent reservation hooks
- **File**: `src/hooks/use-agent-reservation.ts`
- **Action**: CREATE
- `useReserveAgents(sessionId, agentIds)` — atomically reserve all selected agents; fail if any busy
- `useReleaseAgent(reservationId, reason)` — release single agent
- `useRenewLeases(sessionId)` — renew all leases for active session (call on activity)
- Auto-renew: set up interval that calls renew on message send/receive
- **Validate**: `npm run build`

### Task 4.3: Session start dialog
- **File**: `src/components/session-start-dialog.tsx`
- **Action**: CREATE
- Shown when entering Pac-ST page without active session
- Lists available agents with display_name, specialties badges, status (AVAILABLE/RESERVED/OFFLINE)
- User selects agents (checkboxes)
- Reserved agents shown as disabled with "In use" label
- "Start Session" button — calls useCreateSession
- Error handling for concurrent reservation conflicts
- **Validate**: `npm run dev` — dialog opens, agents selectable, session creates

### Task 4.4: Agent status bar (update)
- **File**: `src/components/pac-st/agent-status-bar.tsx`
- **Action**: UPDATE (or CREATE if placeholder from Phase 3)
- Shows selected agents for current session
- Each agent: display_name, specialty tags, lease countdown
- Release button per agent
- **Validate**: `npm run dev` — agents display with live status

### Task 4.5: Lease renewal Edge Function
- **File**: `supabase/functions/renew-lease/index.ts`
- **Action**: CREATE
- Input: session_id
- Finds all active reservations for session
- Extends lease_expires_at by configured duration (30 min)
- Returns updated leases
- **Validate**: Deploy to Supabase, test via curl

### Task 4.6: Expired lease cleanup Edge Function
- **File**: `supabase/functions/cleanup-expired/index.ts`
- **Action**: CREATE
- Runs on schedule (every 5 min) or on-demand
- Finds all reservations where lease_expires_at < now() and released_at IS NULL
- Sets released_at = now(), release_reason = LEASE_TIMEOUT
- Updates agent status back to AVAILABLE
- Optionally closes sessions with all agents expired
- **Validate**: Deploy, test with expired reservation

### Task 4.7: Pac-ST session lifecycle integration
- **File**: `src/routes/pac-st.tsx`
- **Action**: UPDATE
- On mount: check for active session for the project
- If no session: show SessionStartDialog
- If session exists: load it, display agent status, enable chat
- On unmount / navigate away: prompt to end session or keep active
- Auto-renew leases on user activity (message send)
- **Validate**: `npm run dev` — full session start → use → end flow

---

# PHASE 5: Code Generation + Chat + Claude Integration

**Goal**: Working chat interface calling Claude via Supabase Edge Function, generating PLC artifacts, displaying in Monaco, approve/edit flow, artifact bundle + tia_manifest.json generation. Safety warnings detection.

## Files to Change

| File | Action | Purpose |
|------|--------|---------|
| `supabase/functions/generate/index.ts` | CREATE | Edge Function: Claude API proxy for code generation |
| `src/hooks/use-generation.ts` | CREATE | TanStack Query mutation for generation |
| `src/hooks/use-conversation.ts` | CREATE | TanStack Query hooks for conversation history |
| `src/lib/prompt-builder.ts` | CREATE | Builds Claude system prompt from project context + agent roles + platform rules + patterns |
| `src/lib/artifact-parser.ts` | CREATE | Parses Claude response into separate artifact objects |
| `src/lib/manifest-builder.ts` | CREATE | Builds tia_manifest.json from artifact bundle |
| `src/lib/safety-analyzer.ts` | CREATE | Analyzes generated code for safety warnings |
| `src/components/pac-st/chat-pane.tsx` | UPDATE | Wire up to real generation, show conversation history |
| `src/components/pac-st/generated-code-pane.tsx` | UPDATE | Wire up to real generated artifacts |
| `src/components/pac-st/approved-code-pane.tsx` | UPDATE | Wire up approve flow, save to DB |
| `src/components/pac-st/prompt-builder.tsx` | CREATE | Guided question flow UI for Mode 1 |
| `src/components/pac-st/mode-selector.tsx` | CREATE | Toggle between Guided / Free-form / Hybrid modes |

## Tasks

### Task 5.1: Claude proxy Edge Function
- **File**: `supabase/functions/generate/index.ts`
- **Action**: CREATE
- Accepts: system_prompt, messages[], project_context, generation_mode (FB_PER_DEVICE | PROJECT_LEVEL)
- Calls Claude API with structured prompt
- Returns: generated text content
- ANTHROPIC_API_KEY stored as Supabase secret (not in frontend)
- Streaming response support (SSE) for real-time display
- **Validate**: Deploy, test with curl

### Task 5.2: Prompt builder
- **File**: `src/lib/prompt-builder.ts`
- **Action**: CREATE
- Builds system prompt incorporating:
  - Platform rules (from PLATFORM_RULES_SIEMENS_TIA.md content, hardcoded or fetched)
  - Project context (PLC brand, TIA version, CPU type, IO lists, tag DBs)
  - Active agent role(s) and their system prompts
  - Approved patterns for this PLC brand (fetched from DB)
  - Generation mode instructions
  - FB template structure requirements (from PAC_ST_SPEC.md Section 4.2)
  - Naming conventions (from PAC_ST_SPEC.md Section 11)
  - Output format instructions (separate artifacts, include manifest)
- **Validate**: Unit test — generate a prompt and verify all sections present

### Task 5.3: Artifact parser
- **File**: `src/lib/artifact-parser.ts`
- **Action**: CREATE
- Parses Claude's text response into individual Artifact objects
- Expects Claude to output artifacts in delimited blocks (e.g., ```scl filename="FB_ConveyorZone.scl" type="FB"```)
- Extracts: name, type, filename, content, dependencies
- Validates: all referenced dependencies exist in the bundle
- **Validate**: `npm run build` + test with sample Claude output

### Task 5.4: Manifest builder
- **File**: `src/lib/manifest-builder.ts`
- **Action**: CREATE
- Input: Artifact[], project metadata
- Output: TiaManifest object conforming to ai/TIA_MANIFEST_SCHEMA.md
- Performs topological sort on dependencies
- Validates: no circular dependencies, UDTs before FBs, DBs after UDTs
- **Validate**: `npm run build` + test with sample artifacts

### Task 5.5: Safety analyzer
- **File**: `src/lib/safety-analyzer.ts`
- **Action**: CREATE
- Static analysis of generated SCL code for:
  - Missing interlocks (motor outputs without interlock checks)
  - IO index mismatches (array index vs declared size)
  - Alarm reset violations (auto-reset patterns)
  - Array out-of-bounds risk
  - Uninitialized state machine states
  - Unsafe motor logic (direct output without safety checks)
- Returns SafetyWarning[] per artifact
- Deterministic, rule-based (not AI-based)
- **Validate**: `npm run build` + test with known unsafe code samples

### Task 5.6: Generation hook
- **File**: `src/hooks/use-generation.ts`
- **Action**: CREATE
- `useGenerate()` — mutation that:
  1. Builds prompt via prompt-builder
  2. Calls Edge Function
  3. Parses artifacts
  4. Runs safety analyzer
  5. Builds manifest
  6. Saves artifacts + snapshots to DB
  7. Saves conversation turn
  8. Returns artifacts + warnings to UI
- Supports streaming (update UI as tokens arrive)
- **Validate**: `npm run build`

### Task 5.7: Conversation hooks
- **File**: `src/hooks/use-conversation.ts`
- **Action**: CREATE
- `useConversationHistory(sessionId)` — paginated query of conversation_turns
- `useSaveConversationTurn()` — mutation to persist user/agent messages
- **Validate**: `npm run build`

### Task 5.8: Prompt builder UI (guided mode)
- **File**: `src/components/pac-st/prompt-builder.tsx`
- **Action**: CREATE
- Step-by-step guided question flow for Mode 1:
  1. What device type? (Motor, Conveyor Zone, Valve, Auto/Manual, Custom)
  2. How many instances?
  3. IO mapping approach? (Array-indexed, Individual tags)
  4. State machine states? (Default set: INIT/IDLE/RUN/FAULT/RESET + custom)
  5. Alarm requirements? (Default latch + custom)
  6. Special requirements? (Free text)
- Produces structured prompt object
- **Validate**: `npm run dev` — guided flow produces prompt

### Task 5.9: Mode selector
- **File**: `src/components/pac-st/mode-selector.tsx`
- **Action**: CREATE
- Toggle between Mode 1 (Guided), Mode 2 (Free-form), Mode 3 (Hybrid)
- Mode 1: shows prompt builder, hides free text
- Mode 2: shows free text only
- Mode 3: shows prompt builder + free text addition
- **Validate**: `npm run dev` — modes toggle correctly

### Task 5.10: Wire up chat pane
- **File**: `src/components/pac-st/chat-pane.tsx`
- **Action**: UPDATE
- Display conversation history from useConversationHistory
- Send messages via useGenerate (for generation requests) or free chat
- Show loading/streaming state during generation
- Display agent name/icon per response
- Show safety warnings inline in chat
- **Validate**: `npm run dev` — send prompt → receive generated code → see in chat

### Task 5.11: Wire up generated code pane
- **File**: `src/components/pac-st/generated-code-pane.tsx`
- **Action**: UPDATE
- Populate artifact tabs from generation result
- Show which patterns were applied (from prompt builder metadata)
- "Approve" copies artifact content to approved pane
- "Approve All" copies entire bundle
- Snapshot saved on generation (trigger: GENERATION)
- **Validate**: `npm run dev` — generated artifacts appear in Monaco with tabs

### Task 5.12: Wire up approved code pane
- **File**: `src/components/pac-st/approved-code-pane.tsx`
- **Action**: UPDATE
- On approve: populate with generated content
- User edits are tracked
- Save Snapshot button → trigger: APPROVAL
- Content persisted to artifacts table (approved version)
- **Validate**: `npm run dev` — approve → edit → save snapshot works

---

# PHASE 6: Learning System + Versioning + TIA Integration

**Goal**: Pattern library (correction detection, classification, admin approval), full versioning (snapshots, diff, rollback), TIA Mode A export, TIA Mode B API contract, compile feedback loop UI. System complete per spec.

## Files to Change

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/diff-engine.ts` | CREATE | Compute diff between generated and approved code |
| `src/lib/correction-classifier.ts` | CREATE | Classify corrections into pattern types |
| `src/hooks/use-patterns.ts` | CREATE | TanStack Query hooks for pattern CRUD |
| `src/hooks/use-snapshots.ts` | CREATE | TanStack Query hooks for snapshots + rollback |
| `src/routes/patterns.tsx` | CREATE | Pattern library admin page |
| `src/components/pattern-review-card.tsx` | CREATE | Pattern candidate review card |
| `src/components/pac-st/version-selector.tsx` | CREATE | Snapshot version dropdown in approved pane |
| `src/components/pac-st/rollback-dialog.tsx` | CREATE | Confirm rollback dialog |
| `src/lib/tia-export.ts` | CREATE | Generate downloadable artifact bundle (zip) |
| `src/lib/tia-bridge-contract.ts` | CREATE | TypeScript types for TIA bridge API contract |
| `src/components/pac-st/export-dialog.tsx` | CREATE | Export/download dialog with safety confirmation |
| `src/components/pac-st/tia-job-panel.tsx` | CREATE | TIA job submission + status in bottom panel |
| `src/hooks/use-tia-jobs.ts` | CREATE | TanStack Query hooks for TIA jobs |
| `src/hooks/use-audit-log.ts` | CREATE | TanStack Query hook for audit logging |
| `src/routes/tia-console.tsx` | UPDATE | Full TIA console with job history |
| `src/app/DashboardLayout.tsx` | UPDATE | Add Patterns nav item in sidebar |
| Additional shadcn components | ADD | alert-dialog, progress, table |

## Tasks

### Task 6.1: Diff engine
- **File**: `src/lib/diff-engine.ts`
- **Action**: CREATE
- Compute line-level diff between two code strings
- Output: array of change hunks (added, removed, modified, context)
- Used for: generated vs approved comparison, snapshot vs snapshot comparison
- **Validate**: `npm run build` + test with sample code pairs

### Task 6.2: Correction classifier
- **File**: `src/lib/correction-classifier.ts`
- **Action**: CREATE
- Input: diff hunks between generated and approved
- Classifies each correction into: NAMING, IO_MAPPING, STATE_LOGIC, ALARM, SAFETY, TIMING
- Heuristic-based (keyword/pattern matching on diff content)
- Output: PatternCandidate[] ready for storage
- **Validate**: `npm run build`

### Task 6.3: Pattern hooks
- **File**: `src/hooks/use-patterns.ts`
- **Action**: CREATE
- `usePatternCandidates(status?)` — list pending/approved/rejected
- `useCreatePatternCandidate()` — from diff
- `useApprovePattern(id)` — admin action
- `useRejectPattern(id)` — admin action
- `useActivePatterns(plcBrand)` — approved patterns for generation prompt
- **Validate**: `npm run build`

### Task 6.4: Pattern library page
- **Files**: `src/routes/patterns.tsx`, `src/components/pattern-review-card.tsx`
- **Action**: CREATE
- List all pattern candidates with filters (status, correction_type, plc_brand)
- Each card shows: original snippet, corrected snippet, diff highlight, correction type, created_by, timestamp
- Admin actions: Approve, Reject
- Approved patterns shown separately with "Active Patterns" section
- **Validate**: `npm run dev` — pattern review flow works

### Task 6.5: Snapshot hooks
- **File**: `src/hooks/use-snapshots.ts`
- **Action**: CREATE
- `useSnapshots(artifactId)` — list all snapshots for an artifact
- `useSaveSnapshot(artifactId, trigger)` — create snapshot
- `useRollback(snapshotId)` — restore artifact to snapshot content
- `useCompareSnapshots(snapshotId1, snapshotId2)` — diff two snapshots
- **Validate**: `npm run build`

### Task 6.6: Version selector + rollback
- **Files**: `src/components/pac-st/version-selector.tsx`, `src/components/pac-st/rollback-dialog.tsx`
- **Action**: CREATE
- Dropdown listing snapshots (version number, trigger, timestamp, user)
- Selecting a version shows it in a read-only Monaco preview
- "Rollback to this version" opens confirmation dialog
- On confirm: restores content and creates new snapshot (trigger: APPROVAL)
- **Validate**: `npm run dev` — version select, preview, rollback

### Task 6.7: Auto-detect corrections on save
- **File**: `src/components/pac-st/approved-code-pane.tsx`
- **Action**: UPDATE
- On "Save Snapshot" in approved pane:
  1. Save snapshot
  2. Compute diff (generated vs new approved)
  3. If diff exists, run correction classifier
  4. Create PatternCandidate(s) with status PENDING
  5. Show notification: "N corrections detected — queued for pattern review"
- **Validate**: `npm run dev` — edit approved code → save → pattern candidates created

### Task 6.8: TIA export (Mode A)
- **File**: `src/lib/tia-export.ts`
- **Action**: CREATE
- Input: Artifact[], TiaManifest
- Generates a zip file containing:
  - One file per artifact (e.g., `udt/UDT_ZoneIO.scl`, `fb/FB_ConveyorZone.scl`)
  - `tia_manifest.json`
- Uses browser-side zip library (e.g., JSZip)
- Triggers browser download
- **Validate**: `npm run build`

### Task 6.9: Export dialog with safety confirmation
- **File**: `src/components/pac-st/export-dialog.tsx`
- **Action**: CREATE
- Shows manifest summary: artifact list, dependency order, compile flags
- If any SafetyWarnings exist:
  - Show prominent warning banner
  - List all unacknowledged warnings
  - Require explicit checkbox confirmation: "I acknowledge these safety warnings and take responsibility for this export"
- Export button → calls tia-export → downloads zip
- Logs export to audit_logs
- **Validate**: `npm run dev` — export with and without safety warnings

### Task 6.10: TIA bridge API contract
- **File**: `src/lib/tia-bridge-contract.ts`
- **Action**: CREATE
- TypeScript types defining the REST API contract that the Windows .NET bridge must implement:
  - `POST /tia/jobs` — submit a TIA job (IMPORT_ONLY, IMPORT_AND_COMPILE, COMPILE_ONLY, EXPORT_REPORT)
  - `GET /tia/jobs/:id` — get job status
  - `GET /tia/jobs/:id/results` — get compile results
  - `POST /tia/jobs/:id/cancel` — cancel running job
  - Request/response types for each endpoint
  - WebSocket event types for real-time job progress
- This is the contract only — implementation is out of scope
- **Validate**: `npm run build`

### Task 6.11: TIA job panel
- **File**: `src/components/pac-st/tia-job-panel.tsx`
- **Action**: CREATE
- Submit TIA job (preview planned changes → confirm → submit)
- Show job status (pending, running, completed, failed)
- Display compile results (errors with artifact_name, line, error_text)
- Clicking an error navigates to the artifact + line in Monaco
- "Regenerate Affected" button → regenerates only artifacts with compile errors
- **Validate**: `npm run dev` — UI renders (actual bridge calls will fail gracefully without bridge)

### Task 6.12: TIA job hooks
- **File**: `src/hooks/use-tia-jobs.ts`
- **Action**: CREATE
- `useSubmitTiaJob()` — creates job record in Supabase, optionally calls bridge
- `useTiaJobs(projectId)` — list jobs for project
- `useTiaJob(jobId)` — single job with compile results
- Bridge connection: attempts to connect to configured bridge URL; if unavailable, shows "Bridge offline" status
- **Validate**: `npm run build`

### Task 6.13: TIA console page
- **File**: `src/routes/tia-console.tsx`
- **Action**: UPDATE
- Full job history table: job_type, status, artifact count, timestamp, user
- Click to expand: manifest details, compile results
- Bridge connection status indicator
- Export button (Mode A) for any completed job's artifacts
- **Validate**: `npm run dev` — console page renders with job history

### Task 6.14: Audit log hook
- **File**: `src/hooks/use-audit-log.ts`
- **Action**: CREATE
- `useLogAction(action, details)` — insert audit log entry
- Called on: generation, approval, export, TIA job submission, pattern approval, rollback, session start/end
- **Validate**: `npm run build`

### Task 6.15: Sidebar nav update
- **File**: `src/app/DashboardLayout.tsx`
- **Action**: UPDATE
- Add "Patterns" nav item (route: `/patterns`)
- Only visible to admin role users
- **Validate**: `npm run dev` — nav item appears for admin

### Task 6.16: Install remaining shadcn components
- **Action**: `npx shadcn@latest add alert-dialog progress table`
- **Validate**: `npm run build`

---

## Validation (per phase)

```bash
# Type check
npm run build

# Lint
npm run lint

# Dev server smoke test
npm run dev
```

---

## Acceptance Criteria

### Phase 1
- [ ] Stale files deleted, vite.config.ts fixed
- [ ] CSS variables defined, shadcn semantic colors work
- [ ] React Router navigates between all routes
- [ ] Supabase client initialized
- [ ] Auth: login, signup, logout, auth guard
- [ ] All domain types compile
- [ ] Zustand stores created
- [ ] `npm run build` passes

### Phase 2
- [ ] Supabase schema applied with all tables
- [ ] Project CRUD: create, list, edit, delete
- [ ] Project detail page with all spec fields
- [ ] IO list editor functional
- [ ] Default agents seeded
- [ ] `npm run build` passes

### Phase 3
- [ ] Three-pane layout with resizable panes
- [ ] Monaco editors with SCL syntax highlighting
- [ ] Artifact tabs switch content
- [ ] Diff view (generated vs approved)
- [ ] Bottom panel with compile/logs/warnings tabs
- [ ] Safety warnings banner
- [ ] `npm run build` passes

### Phase 4
- [ ] Session start with agent selection dialog
- [ ] Agent reservation with lease-based locking
- [ ] Lease renewal on activity
- [ ] Expired lease cleanup
- [ ] Agent status bar shows live state
- [ ] Session end releases all agents
- [ ] `npm run build` passes

### Phase 5
- [ ] Claude proxy Edge Function deployed
- [ ] Chat sends prompts, receives generated code
- [ ] Artifacts parsed and displayed in Monaco
- [ ] Manifest generated with correct dependency order
- [ ] Safety analyzer flags unsafe patterns
- [ ] Guided question flow (Mode 1) produces structured prompts
- [ ] Approve flow copies to right pane
- [ ] Conversation history persisted
- [ ] `npm run build` passes

### Phase 6
- [ ] Diff engine computes generated vs approved changes
- [ ] Corrections auto-classified and stored as pattern candidates
- [ ] Pattern library page with admin approve/reject
- [ ] Approved patterns injected into generation prompts
- [ ] Snapshots saved on generation, approval, export
- [ ] Version selector + rollback works
- [ ] TIA Mode A export downloads zip with manifest
- [ ] Safety confirmation required before export
- [ ] TIA bridge API contract defined as TypeScript types
- [ ] TIA job panel renders (graceful offline when no bridge)
- [ ] TIA console shows job history
- [ ] Audit log captures all key actions
- [ ] `npm run build` passes
