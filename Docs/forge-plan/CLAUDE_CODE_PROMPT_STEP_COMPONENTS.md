# Task: Build all Forge Wizard step components + wire into route

Read these files first for context:
- `Docs/forge-plan/MASTER_PLAN.md` — overall architecture
- `src/types/forge.ts` — all type definitions
- `src/stores/forge-store.ts` — step navigation store
- `src/routes/forge.tsx` — current wizard route (has placeholder content)
- `src/hooks/use-forge-spec-analysis.ts` — spec analysis hook
- `src/hooks/use-forge-device-generate.ts` — device code generation hook
- `src/hooks/use-forge-process-generate.ts` — process code generation hook
- `src/hooks/use-forge-hmi-generate.ts` — HMI generation hook
- `src/hooks/use-forge-tia-export.ts` — TIA export hook
- `src/hooks/use-forge-session.ts` — session CRUD hook
- `src/lib/forge-device-matcher.ts` — device-to-FB template matcher
- `UI_STYLE_GUIDE.md` — visual design rules

## What exists now

The forge wizard route works but shows placeholder cards for each step. All backend hooks exist with real implementations. The forge store handles step navigation. Types are fully defined. The step bar component works.

## What you need to build

Create 7 step components in `src/components/forge/steps/` and update `src/routes/forge.tsx` to render them instead of `ForgeStepPlaceholder`.

### Styling rules (IMPORTANT)
- Tailwind CSS utility classes only, no inline styles
- Dark-first theme. `bg-background`, `bg-card`, `border-border`
- Dense spacing — this is an engineering tool. Compact.
- `font-mono` for code, labels, technical metadata
- `rounded-md` max rounding. Subtle borders, no heavy shadows.
- Use shadcn/ui components from `@/components/ui/`
- Monaco Editor from `@monaco-editor/react` for code panes
- Icons from `lucide-react`

---

## Component 1: `src/components/forge/steps/forge-spec-upload.tsx`

The first step. Two modes:

**Mode A — no spec yet:**
- Large dropzone (dashed border, `Upload` icon from lucide-react)
- Accept `.docx` and `.pdf` files
- "Start from scratch" button below that skips to next step
- On file drop/select: extract text using `extractDocxText()` from `@/lib/document-extractor.ts` (for .docx) or handle PDF similarly
- After extraction: call `useForgeSpecAnalysis().analyze(specText)` to get `SpecAnalysis`

**Mode B — spec uploaded, analysis complete:**
- Left side (40%): file info card (filename, "Replace" button)
- Right side (60%): analysis results displayed as:
  - Project overview card (name, PLC type, HMI type, description)
  - Devices table — columns: Name, Tag, Type, Subsystem, IO Count. Editable — rows can be deleted.
  - Process sequences — collapsible list, each showing step count
  - Alarms summary — count by severity
  - Interlocks count
- "Confirm & Continue" button at bottom

**While analyzing:** Show loading spinner with "Analyzing specification..."

Props to accept from parent:
```typescript
interface ForgeSpecUploadProps {
  onComplete: (specText: string, specFilename: string, analysis: SpecAnalysis) => void;
  onSkip: () => void;
}
```

---

## Component 2: `src/components/forge/steps/forge-project-setup.tsx`

Simple form. Pre-populate fields from spec analysis if available (read from forge store or pass as prop).

Fields:
- Project name (Input)
- Project number (Input)
- Client name (Input)
- Design profile (Select dropdown — use `useDesignProfiles()` from `@/hooks/use-design-profiles`)
- Code language: SCL / LAD / Mixed (Select — updates when profile changes)
- Process code language: SCL / LAD / Mixed (Select — updates when profile changes)
- TIA Portal version: V17, V18, V19, V20 (Select)
- CPU type (Select — use `CPU_TYPES` from `@/types/project`)
- Safety level (Input, optional)
- Safety notes (Textarea, optional)

When profile is selected, auto-fill code_language and process_code_language from profile defaults (if the profile has the new fields — fall back to "SCL" if not).

Props:
```typescript
interface ForgeProjectSetupProps {
  specAnalysis: SpecAnalysis | null;
  onComplete: (setup: ForgeProjectSetup) => void;
}

interface ForgeProjectSetup {
  project_name: string;
  project_number: string;
  client_name: string;
  design_profile_id: string | null;
  code_language: "SCL" | "LAD" | "MIXED";
  process_code_language: "SCL" | "LAD" | "MIXED";
  tia_version: string;
  cpu_type: string;
  safety_level: string;
  safety_notes: string;
}
```

---

## Component 3: `src/components/forge/steps/forge-hardware-io.tsx`

Tabbed view with 3 tabs using shadcn Tabs component:

**Tab 1 — Hardware:**
- CPU type display (from project setup, read-only here)
- Simple rack/slot table — editable. Columns: Rack, Slot, Module Type, Description
- "Add Module" button

**Tab 2 — IO List:**
- Editable table pre-populated from spec analysis devices' IO signals
- Columns: Address, Tag Name, Signal Type (DI/DQ/AI/AQ), Data Type, Description, Module, Slot
- Add/delete rows
- Import from CSV button (use existing `@/lib/io-csv-parser.ts` if applicable)

**Tab 3 — Device List:**
- Table showing all devices from spec analysis
- Columns: Name, Tag, Device Type, Description, Subsystem, FB Template (Select dropdown), IO Count
- FB Template column: dropdown populated from `useFbTemplates()` — show matched template name, or "AI Generate" for unmatched
- Run `matchDevicesToTemplates()` from `@/lib/forge-device-matcher` on mount to auto-assign templates

Props:
```typescript
interface ForgeHardwareIoProps {
  specAnalysis: SpecAnalysis | null;
  fbTemplates: FbTemplate[];
  onComplete: (hardware: ForgeHardwareConfig, ioList: ForgeIoEntry[], devices: ForgeDeviceEntry[]) => void;
}
```

---

## Component 4: `src/components/forge/steps/forge-device-code.tsx`

Two-panel resizable layout (use `ResizablePanelGroup` from `@/components/ui/resizable`):

**Left panel (35%):** Artifact list
- Grouped: Function Blocks, Data Blocks, IO Linking
- Each item shows: name, type badge, language badge (SCL/LAD), status (pending/generating/generated/approved)
- Click to select and preview
- Checkmark toggle to approve

**Right panel (65%):** Monaco Editor
- Shows selected artifact content
- SCL syntax highlighting (language="plaintext" is fine, or use the existing Monaco SCL setup from `@/lib/monaco-scl.ts`)
- Read-only by default, "Edit" button to toggle editable
- For LAD artifacts: show the JSON content (it gets converted to XML at export time)

**Bottom toolbar:**
- "Generate All" button — calls `useForgeDeviceGenerate().generateAll(session, profile, templates, patterns)`
- Progress bar during generation (use the hook's `progress` state)
- "Approve All" button — marks all artifacts as approved
- "Regenerate" button — regenerates selected artifact

**Important:** After generation, save artifacts to the forge session via `useUpdateForgeSession()`.

Props:
```typescript
interface ForgeDeviceCodeProps {
  session: ForgeSession;
  profile: DesignProfile;
  onArtifactsUpdate: (artifacts: ForgeArtifact[]) => void;
  onComplete: () => void;
}
```

---

## Component 5: `src/components/forge/steps/forge-process-code.tsx`

Very similar layout to device code step. Same resizable two-panel approach.

**Left panel:** List of process sequences from spec analysis, plus OB1 Main
- Each shows: sequence name, step count, status, language badge

**Right panel:** Monaco editor for selected artifact

**Above editor:** Summary card showing the selected sequence's steps (step number, action, completion criteria) for reference while reviewing code.

**Bottom toolbar:** Same pattern — "Generate All", progress bar, "Approve All"
- Calls `useForgeProcessGenerate().generateAll(session, profile, patterns)`

Props:
```typescript
interface ForgeProcessCodeProps {
  session: ForgeSession;
  profile: DesignProfile;
  onArtifactsUpdate: (artifacts: ForgeArtifact[]) => void;
  onComplete: () => void;
}
```

---

## Component 6: `src/components/forge/steps/forge-hmi.tsx`

Simpler layout for the demo:

**Left panel:** List of HMI screens to generate (Overview, Motor Faceplate, etc.)
**Right panel:** Monaco editor showing the generated HmiScreenSpec JSON (or XML once converted)

**Bottom:** "Generate HMI Screens" button — calls `useForgeHmiGenerate().generateAll(session, profile)`

For demo purposes this can be simpler than device/process code steps. The key thing is it generates something and allows approval.

Props:
```typescript
interface ForgeHmiProps {
  session: ForgeSession;
  profile: DesignProfile;
  onArtifactsUpdate: (artifacts: ForgeArtifact[]) => void;
  onComplete: () => void;
}
```

---

## Component 7: `src/components/forge/steps/forge-tia-export.tsx`

The final step.

**Before export:**
- TIA project path input (text field, saved to session)
- Bridge status indicator (use `useBridgeStatus()` from `@/hooks/use-tia-jobs`)
- Summary of what will be exported: X SCL blocks, Y LAD blocks, Z HMI screens
- "Export to TIA Portal" button (disabled if bridge not connected)

**During export:**
- Progress bar with phase indicator (SCL → LAD → HMI → Compile)
- Artifact-by-artifact status list (checkmark/spinner/pending for each)

**After export:**
- Success/failure summary
- Compile results: error count, warning count
- Individual error/warning messages with artifact names
- "Retry" button if failed

Props:
```typescript
interface ForgeTiaExportProps {
  session: ForgeSession;
  onComplete: (result: TiaForgeExportResult) => void;
}
```

---

## Updating forge.tsx

After creating all step components, update `src/routes/forge.tsx`:

1. Remove the `ForgeStepPlaceholder` component
2. Import all 7 step components
3. Render the correct step component based on `currentStep` using a switch/map
4. Wire up the props — the route should:
   - Load/create a forge session via `useActiveForgeSession(projectId)` and `useCreateForgeSession()`
   - Load the design profile via `useDesignProfile(session?.design_profile_id)`
   - Load FB templates via `useFbTemplates()` or equivalent
   - Load active patterns via `useActivePatterns("SIEMENS_TIA")` if that hook exists
   - Pass session data and callbacks to each step component
   - When a step calls `onComplete`, update the forge session and advance to next step

The route becomes the orchestrator — it holds the session state and passes slices to each step.

---

## File creation order

1. `src/components/forge/steps/forge-spec-upload.tsx`
2. `src/components/forge/steps/forge-project-setup.tsx`
3. `src/components/forge/steps/forge-hardware-io.tsx`
4. `src/components/forge/steps/forge-device-code.tsx`
5. `src/components/forge/steps/forge-process-code.tsx`
6. `src/components/forge/steps/forge-hmi.tsx`
7. `src/components/forge/steps/forge-tia-export.tsx`
8. Update `src/routes/forge.tsx`

Commit with prefix `forge-ui:` after completing all components. Test that the route renders each step without errors.
