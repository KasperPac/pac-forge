# CODEX TASKS — Project Wizard UI

**Role:** UI components, route shell, Zustand store, visual components, types integration.
**Reference:** Read `MASTER_PLAN.md` first for full context.
**Rule:** Do NOT edit files owned by Claude Code (see FILE_OWNERSHIP in master plan). You build the UI shell and components; Claude Code builds the hooks and logic that power them.

---

## CONTEXT: Existing UI Patterns

Follow these conventions from the existing codebase:

- **Styling:** Tailwind CSS v3, utility classes only, no inline styles. Dark-first theme.
- **UI primitives:** shadcn/ui (`src/components/ui/`). Components: Button, Card, Input, Label, Select, Dialog, Tabs, Badge, ScrollArea, Separator, Tooltip, Progress, Switch, etc.
- **Icons:** `lucide-react` — import individually (e.g., `import { Upload, ChevronRight } from "lucide-react"`)
- **Resizable panels:** `react-resizable-panels` v4 — imported via `src/components/ui/resizable.tsx` as `ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle`
- **Code editors:** `@monaco-editor/react` — see existing usage in `src/components/pac-st/generated-code-pane.tsx`
- **Path aliases:** `@/` maps to `src/`. Always use `@/` prefix.
- **TypeScript:** `verbatimModuleSyntax` — must use `import type { Foo }` for type-only imports. No enums — use `as const` objects.
- **Component pattern:** Functional components with hooks. No class components.
- **Dense spacing:** This is an engineering tool, not consumer SaaS. Compact layouts, smaller text, tighter padding.
- **Font:** `font-mono` for code, labels, technical metadata. System sans for normal UI text.
- **Rounding:** `rounded-md` / `rounded-lg` max. No heavy shadows. Subtle borders.

### UI Style Reference
Read `UI_STYLE_GUIDE.md` in the repo root for the full style guide. Key points:
- Background: `bg-background` (near-black in dark mode)
- Cards: `bg-card` with `border` — no shadows
- Accent: Muted blues/teals for interactive elements
- Status colors: green (success/complete), amber (in-progress/warning), red (error), zinc (pending/disabled)

---

## TASK 1: Forge Types File
**Priority:** Highest — Claude Code will also work on this. Coordinate.
**File:** `src/types/forge.ts`

**NOTE:** Claude Code is responsible for the full type definitions (Task 2 in their doc). However, if you need to start building UI before they've created this file, create a minimal stub with just the step types:

```typescript
export const FORGE_STEPS = {
  SPEC_UPLOAD: "spec_upload",
  PROJECT_SETUP: "project_setup", 
  HARDWARE_IO: "hardware_io",
  DEVICE_CODE: "device_code",
  PROCESS_CODE: "process_code",
  HMI: "hmi",
  TIA_EXPORT: "tia_export",
} as const;

export type ForgeStep = (typeof FORGE_STEPS)[keyof typeof FORGE_STEPS];

export const FORGE_STEP_LABELS: Record<ForgeStep, string> = {
  spec_upload: "Functional Spec",
  project_setup: "Project Setup",
  hardware_io: "Hardware & IO",
  device_code: "Device Code",
  process_code: "Process Code",
  hmi: "HMI Screens",
  tia_export: "TIA Export",
};

export const FORGE_STEP_ORDER: ForgeStep[] = [
  "spec_upload",
  "project_setup",
  "hardware_io",
  "device_code",
  "process_code",
  "hmi",
  "tia_export",
];
```

Claude Code will extend this with `ForgeSession`, `ForgeArtifact`, `SpecAnalysis`, etc. Don't duplicate those — import them once they exist.

---

## TASK 2: Forge Zustand Store
**Priority:** Highest — the wizard UI needs this immediately.
**File:** `src/stores/forge-store.ts`

Manages UI state for the wizard. NOT the session data (that's in Supabase via hooks) — just the local UI state:

```typescript
import { create } from "zustand";
import type { ForgeStep, ForgeArtifact } from "@/types/forge";

interface ForgeStoreState {
  // Current wizard step
  currentStep: ForgeStep;
  setCurrentStep: (step: ForgeStep) => void;
  
  // Step completion status (local tracking, mirrored to DB)
  stepStatuses: Record<ForgeStep, "pending" | "active" | "completed" | "failed">;
  setStepStatus: (step: ForgeStep, status: "pending" | "active" | "completed" | "failed") => void;
  
  // Currently selected artifact for preview
  selectedArtifactId: string | null;
  setSelectedArtifactId: (id: string | null) => void;
  
  // Spec upload state
  specText: string | null;
  setSpecText: (text: string | null) => void;
  specFilename: string | null;
  setSpecFilename: (name: string | null) => void;
  
  // Navigation helpers
  canProceedToNext: () => boolean;
  goToNextStep: () => void;
  goToPreviousStep: () => void;
  
  // Reset
  reset: () => void;
}
```

Follow the pattern in `src/stores/pac-st-store.ts`.

---

## TASK 3: Main Wizard Route
**Priority:** Highest — the shell that everything lives in.
**File:** `src/routes/forge.tsx`

The main wizard page. Layout:

```
┌──────────────────────────────────────────────────────────────┐
│  Step Progress Bar (horizontal stepper)                       │
│  [Spec Upload] → [Project Setup] → [Hardware] → [Device] →  │
│  [Process] → [HMI] → [TIA Export]                            │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  Active Step Content (switches based on currentStep)          │
│                                                               │
│  Each step renders its own component from                     │
│  src/components/forge/                                        │
│                                                               │
├──────────────────────────────────────────────────────────────┤
│  Bottom Bar: [← Previous] [Next →] / [Generate] / [Export]   │
│  Right side: step-specific action buttons                     │
└──────────────────────────────────────────────────────────────┘
```

**Key behaviors:**
- Step progress bar shows all 7 steps with status indicators (pending=gray, active=blue, completed=green, failed=red)
- Clicking a completed step navigates back to it for review
- Cannot click ahead to uncompleted steps
- Bottom bar has Previous/Next navigation + step-specific action buttons
- Must accept a `projectId` (from URL query param or route param)
- On mount: check for existing forge session, resume if found, or create new

**Route registration:** Add to `src/App.tsx`:
```typescript
{ path: "forge", element: <LazyRoute><ForgePage /></LazyRoute> }
```

Add to sidebar in `src/app/DashboardLayout.tsx` — add a nav item:
```typescript
{ to: "/forge", label: "Project Wizard", icon: Wand2 }  // or Rocket or Workflow
```
Place it prominently — second item after Projects, or even first.

---

## TASK 4: Step Progress Bar Component
**Priority:** High — core navigation element.
**File:** `src/components/forge/forge-step-bar.tsx`

Horizontal stepper showing all 7 wizard steps.

**For each step, show:**
- Step number (1-7)
- Step label (from `FORGE_STEP_LABELS`)
- Status icon: checkmark (completed), spinner (active/loading), circle (pending), X (failed)
- Connecting lines between steps
- Current step highlighted

**Styling:**
- Compact — this sits at the top and shouldn't take much vertical space
- Use status colors: `text-green-500` completed, `text-blue-500` active, `text-muted-foreground` pending, `text-red-500` failed
- Active step has a subtle background highlight
- Clickable on completed steps (navigate back for review)

**Props:**
```typescript
interface ForgeStepBarProps {
  steps: ForgeStep[];
  currentStep: ForgeStep;
  stepStatuses: Record<ForgeStep, "pending" | "active" | "completed" | "failed">;
  onStepClick: (step: ForgeStep) => void;
}
```

---

## TASK 5: Spec Upload Step Component
**Priority:** High — first thing the user sees.
**File:** `src/components/forge/steps/forge-spec-upload.tsx`

**Layout (two modes):**

**Mode A — No spec uploaded yet:**
- Large dropzone area (dashed border, upload icon)
- Accepts .docx and .pdf files
- "Or start from scratch" link/button below the dropzone
- File drag-and-drop support

**Mode B — Spec uploaded, analysis in progress or complete:**
- Left panel (40%): File info (name, size, page count) + "Replace" button
- Right panel (60%): Analysis results in structured view:
  - Project overview card (name, PLC type, description)
  - Devices table (editable — engineer can add/remove/edit devices)
  - IO signals summary
  - Process sequences list (collapsible, each showing steps)
  - Alarms summary (count by severity)

**When analysis is loading:** Show a loading state with progress indicator and "Analyzing functional specification..." message.

**Key interactions:**
- Upload triggers text extraction (mammoth/pdfjs-dist — use existing `document-extractor.ts`)
- Extracted text passed to the spec analysis hook (Claude Code builds the hook)
- Results populate the right panel
- Engineer can edit anything in the analysis before proceeding
- "Confirm & Continue" button enables once analysis is complete

**Props:**
```typescript
interface ForgeSpecUploadProps {
  specText: string | null;
  specFilename: string | null;
  specAnalysis: SpecAnalysis | null;
  analyzing: boolean;
  onFileUpload: (file: File) => void;
  onSkip: () => void;
  onAnalysisEdit: (analysis: SpecAnalysis) => void;
  onConfirm: () => void;
}
```

---

## TASK 6: Project Setup Step Component
**Priority:** High.
**File:** `src/components/forge/steps/forge-project-setup.tsx`

Form for project metadata. Pre-filled from spec analysis if available.

**Fields:**
- Project name (text input)
- Project number (text input)
- Client name (text input)
- Design profile (select dropdown — fetched from `useDesignProfiles()`)
- Code language: SCL / LAD / Mixed (select — auto-set from profile, but overridable)
- Process code language: SCL / LAD / Mixed (select — auto-set from profile, but overridable)
- TIA Portal version (select: V17, V18, V19, V20)
- CPU type (select from `CPU_TYPES` in `src/types/project.ts`)
- Safety level / notes (textarea, optional)

**When profile is selected:** Code language fields update to match the profile's defaults. Show the profile's rules in a collapsible "Profile Rules" section below the form.

**Props:**
```typescript
interface ForgeProjectSetupProps {
  initialData: Partial<ForgeProjectSetup>;  // Pre-filled from spec analysis
  profiles: DesignProfile[];
  onSave: (data: ForgeProjectSetup) => void;
}
```

---

## TASK 7: Hardware & IO Step Component
**Priority:** Medium — can reuse existing components.
**File:** `src/components/forge/steps/forge-hardware-io.tsx`

**Tabbed view with 3 tabs:**

**Tab 1: Hardware Config**
- Reuse `src/components/hardware-config-editor.tsx` (already exists)
- CPU type (inherited from project setup)
- Rack/slot layout editor

**Tab 2: IO List**
- Reuse `src/components/io-list-editor.tsx` (already exists)
- Pre-populated from spec analysis devices
- Editable table: address, tag, data type, description, module, slot

**Tab 3: Device List**
- NEW component: table of devices with their FB template assignments
- Columns: Device Name | Type | Tag | FB Template (dropdown) | IO Count | Actions
- FB Template column: dropdown showing matched template name, or "AI Generate" if no match
- Engineer can override any assignment
- "Auto-match" button to re-run device matcher

**Props:**
```typescript
interface ForgeHardwareIoProps {
  hardwareConfig: ForgeHardwareConfig;
  ioList: ForgeIoEntry[];
  deviceList: ForgeDeviceEntry[];
  fbTemplates: FbTemplate[];
  onHardwareUpdate: (config: ForgeHardwareConfig) => void;
  onIoListUpdate: (ioList: ForgeIoEntry[]) => void;
  onDeviceListUpdate: (devices: ForgeDeviceEntry[]) => void;
}
```

---

## TASK 8: Device Code Step Component
**Priority:** High — core demo step.
**File:** `src/components/forge/steps/forge-device-code.tsx`

**Layout:**
```
┌─────────────────────┬───────────────────────────────────────┐
│ Device List (left)   │ Code Preview (right)                  │
│                      │                                       │
│ ✅ FB_Motor_DOL      │ Monaco Editor (read-only until edit)  │
│ ✅ FB_Motor_VFD      │                                       │
│ ⏳ FB_Solenoid_2pos  │ Shows selected artifact's code        │
│ ○  DB_M101           │                                       │
│ ○  DB_M102           │ Language badge: [SCL] or [LAD]        │
│ ○  FC_IO_Linking     │                                       │
│                      │                                       │
│ [Generate All]       │ [Approve] [Regenerate] [Edit]         │
└─────────────────────┴───────────────────────────────────────┘
```

**Left panel:** List of artifacts to generate, grouped by type:
- Function Blocks (one per device type)
- Data Blocks (one per device instance)
- IO Linking FC

Each item shows: name, status (pending/generating/generated/approved), language badge.
Click to select and preview in right panel.

**Right panel:** Monaco editor showing selected artifact's code.
- Read-only by default
- "Edit" button switches to editable mode
- SCL syntax highlighting for SCL, or JSON/XML view for LAD
- "Approve" button marks artifact as reviewed
- "Regenerate" button re-generates just this artifact

**Bottom:** "Generate All" button to kick off generation, progress bar during generation.

**Props:**
```typescript
interface ForgeDeviceCodeProps {
  artifacts: ForgeArtifact[];
  selectedArtifactId: string | null;
  generating: boolean;
  progress: { current: number; total: number; currentDevice: string };
  onSelectArtifact: (id: string) => void;
  onGenerateAll: () => void;
  onRegenerateSingle: (artifactId: string) => void;
  onApproveArtifact: (artifactId: string) => void;
  onApproveAll: () => void;
  onEditArtifact: (artifactId: string, newContent: string) => void;
}
```

---

## TASK 9: Process Code Step Component
**Priority:** High — core demo step.
**File:** `src/components/forge/steps/forge-process-code.tsx`

Very similar layout to Device Code step, but organized by process sequence:

**Left panel:** List of process sequences/FCs:
- Process FC per sequence (e.g., "FC_Conveyor_Sequence")
- OB1 Main
- Each shows status and language badge

**Right panel:** Same Monaco editor setup.

**Additional feature:** Above the code editor, show the process sequence summary:
- Sequence name
- Steps list (number, action, completion criteria)
- This gives context for what the generated code should do

**Props:** Same pattern as device code step, adapted for process artifacts.

---

## TASK 10: HMI Step Component
**Priority:** Medium — can be simpler for demo.
**File:** `src/components/forge/steps/forge-hmi.tsx`

**Layout:**
- Left: list of HMI screens to generate (Overview, Motor Faceplate, Valve Faceplate, etc.)
- Right: screen preview (either rendered SVG preview or raw XML in Monaco)
- For demo: XML view in Monaco is acceptable

---

## TASK 11: TIA Export Step Component
**Priority:** High — the climax of the demo.
**File:** `src/components/forge/steps/forge-tia-export.tsx`

**Layout:**
```
┌──────────────────────────────────────────────────────────────┐
│  TIA Project Path: [________________________] [Browse]       │
│  Bridge Status: 🟢 Connected | TIA: 🟢 Project Open         │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  Import Progress:                                             │
│  ████████████████░░░░░░░░ 67%  Importing FB_Motor_VFD...     │
│                                                               │
│  ✅ FB_Motor_DOL          imported                            │
│  ✅ DB_M101               imported                            │
│  ⏳ FB_Motor_VFD          importing...                        │
│  ○  DB_M102               pending                             │
│  ○  FC_IO_Linking         pending                             │
│  ○  FC_Conveyor_Seq       pending                             │
│  ○  OB1_Main              pending                             │
│                                                               │
├──────────────────────────────────────────────────────────────┤
│  Compile Results:                                             │
│  ✅ 0 errors, 2 warnings                                     │
│  ⚠️ Line 45: Unused variable 'tempVar'                       │
│  ⚠️ Line 89: Implicit type conversion                        │
└──────────────────────────────────────────────────────────────┘
```

**States:**
1. **Ready:** TIA path input, bridge status, "Export to TIA" button
2. **Exporting:** Progress bar + artifact-by-artifact status list
3. **Compiling:** Compile progress indicator
4. **Complete:** Compile results summary (errors, warnings)
5. **Error:** Error display with "Retry" option

**Bridge status:** Reuse `useBridgeStatus()` hook from `src/hooks/use-tia-jobs.ts`.

**Props:**
```typescript
interface ForgeTiaExportProps {
  artifacts: ForgeArtifact[];
  bridgeConnected: boolean;
  tiaConnected: boolean;
  projectOpen: boolean;
  exporting: boolean;
  progress: { phase: string; current: number; total: number };
  compileResult: CompileResult | null;
  onExport: (tiaProjectPath: string) => void;
  onRetry: () => void;
}
```

---

## TASK 12: Wire Up Route and Navigation
**Priority:** Do early — needed for testing.

### `src/App.tsx`
Add the forge route:
```typescript
const ForgePage = lazy(() => import("@/routes/forge"));
// In router children:
{ path: "forge", element: <LazyRoute><ForgePage /></LazyRoute> }
```

### `src/app/DashboardLayout.tsx`
Add nav item. Place it prominently — after Projects:
```typescript
{ to: "/forge", label: "Project Wizard", icon: Wand2 }
```
Import `Wand2` from `lucide-react`.

---

## TASK ORDER SUMMARY

Work in this order:

1. **Task 2** — Forge store (unblocks all UI work)
2. **Task 3** — Main wizard route shell (the container)
3. **Task 4** — Step progress bar (navigation)
4. **Task 12** — Wire up route + nav (so you can see it in the app)
5. **Task 1** — Types stub (or wait for Claude Code's full types)
6. **Task 5** — Spec upload step (first demo impression)
7. **Task 6** — Project setup step (quick form)
8. **Task 7** — Hardware & IO step (reuses existing components)
9. **Task 8** — Device code step (core demo UI)
10. **Task 9** — Process code step (similar to device code)
11. **Task 11** — TIA export step (demo climax)
12. **Task 10** — HMI step (can be basic)
