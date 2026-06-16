/**
 * System prompts + JSON schema for the AI-driven HMI Builder wizard.
 *
 * Two AI calls:
 *   1. Plan — user describes the screen, AI returns a structured JSON plan
 *      (title, nav pages, control_modules, controls, status fields).
 *   2. Custom SVG — user asks for a custom graphic, AI returns a single
 *      Siemens-style dynamic SVG string that the runtime can animate.
 */

import type { HmiUnifiedTheme } from "@/types/hmi-panel";
import type { HmiPanelConfig } from "@/types/hmi-panel";
import type { HmiNavLevel } from "./hmi-unified-structure";
import { HMI_TEMPLATE_DESIGN } from "./hmi-unified-structure";

// ---------------------------------------------------------------------------
// Plan schema — what the AI must return
// ---------------------------------------------------------------------------

export interface HmiWizardPlanDevice {
  id: string;
  label: string;
  deviceType: string;
  faceplateHint: string;
  positionHint: "grid" | "top" | "bottom" | "left" | "right" | "center";
  orientation?: "horizontal" | "vertical";
}

export interface HmiWizardPlanControl {
  type: "button" | "mode-select" | "indicator";
  label: string;
  action?: string;
  variant?: "primary" | "success" | "danger" | "warning" | "neutral";
}

export interface HmiWizardPlanStatusField {
  label: string;
  tag?: string;
  unit?: string;
  format?: "string" | "decimal" | "binary" | "datetime";
}

export interface HmiWizardPlan {
  screenTitle: string;
  description: string;
  useTemplateFrame: boolean;
  visibleNavLevels: HmiNavLevel[];
  navItems: string[];
  control_modules: HmiWizardPlanDevice[];
  controls: HmiWizardPlanControl[];
  statusFields: HmiWizardPlanStatusField[];
  /** Optional notes the AI returns — design rationale, warnings, TODOs. */
  notes?: string;
}

// ---------------------------------------------------------------------------
// System prompt — plan generation
// ---------------------------------------------------------------------------

export interface BuildPlanPromptInput {
  panel: HmiPanelConfig;
  theme: HmiUnifiedTheme;
  useTemplateFrame: boolean;
  /** Short list of Open Library faceplate keyword groups the AI can target. */
  faceplateKeywordHints: string[];
}

export function buildHmiWizardPlanSystemPrompt(input: BuildPlanPromptInput): string {
  const { panel, theme, useTemplateFrame, faceplateKeywordHints } = input;
  const frameSection = useTemplateFrame
    ? `- Layout mode: **Siemens HMI Template Suite frame** (REQUIRED).
- Template Suite layout zones: titleBar (top 6%), statusBar (next 4%), mainWindow (center 84%), mainNavigation (right overlay), subNavigation (bottom bar).
- Pac-Forge will place your returned items inside the mainWindow area — you do NOT need to emit the frame, only the content.
- Set "useTemplateFrame": true in the output.
- Populate "navItems" with 3–6 placeholder nav page labels ("Overview", "Alarms", "Trends", "Settings", etc.).
- Include "sub" in "visibleNavLevels" so the bottom nav bar is reserved.`
    : `- Layout mode: **Blank canvas, no frame** (REQUIRED).
- There is NO title bar, status bar, or navigation. Items span the full ${panel.screenWidth}×${panel.screenHeight} screen.
- Set "useTemplateFrame": false in the output.
- Leave "navItems" empty and "visibleNavLevels" empty.
- Use the full screen for content. Good for popup dialogs or custom screens not inside the Template Suite.`;

  return `You are the Pac-Forge HMI Builder planning agent. You design WinCC Unified screens that follow the Siemens HMI Template Suite V6.0 design system.

## Target context

- Panel: ${panel.screenWidth}×${panel.screenHeight} px, ${theme} theme
- Grid: ${HMI_TEMPLATE_DESIGN.GRID_PX}px (all positions snap to this grid)
${frameSection}

## Design rules

1. Follow the Siemens HMI Template Suite V6.0 look: flat, engineering-grade, minimal rounding, dense spacing.
2. Use Siemens terminology: "machine state", "production", "startup", "paused", "shutdown", "stopped".
3. Device symbols come from the Siemens Open Library V19. Match control_modules to these keyword groups when possible: ${faceplateKeywordHints.join(", ")}.
4. Always include a current-state indicator when the user asks for a state machine or status display.
5. Standard button variants:
   - START / RUN → "success"
   - STOP / ESTOP → "danger"
   - PAUSE / HOLD → "warning"
   - RESET / CLEAR / ACK → "neutral"
   - other → "primary"
6. Nav items are PLACEHOLDERS — just the labels the user might navigate to, not real screen references.

## Required output

Return EXACTLY one JSON object (no prose before or after, no \`\`\` fences). Schema:

{
  "screenTitle": "Short title shown in the header",
  "description": "One-sentence purpose of the screen",
  "useTemplateFrame": true,
  "visibleNavLevels": ["main","sub"],        // subset of: "main","sub","third","tab"
  "navItems": ["Overview","Trends","Alarms"],// placeholder page labels
  "control_modules": [
    {
      "id": "conv1",                          // short kebab/snake id
      "label": "Main Conveyor",
      "deviceType": "motor",                  // simple type keyword
      "faceplateHint": "motor horizontal",    // lowercase keywords matching Open Library
      "positionHint": "center",                // grid|top|bottom|left|right|center
      "orientation": "horizontal"              // horizontal|vertical (optional)
    }
  ],
  "controls": [
    { "type": "button", "label": "Start", "action": "start", "variant": "success" },
    { "type": "button", "label": "Stop",  "action": "stop",  "variant": "danger"  },
    { "type": "mode-select", "label": "Mode" }
  ],
  "statusFields": [
    { "label": "Current State", "format": "string" },
    { "label": "Production Count", "unit": "units", "format": "decimal" }
  ],
  "notes": "optional design rationale"
}

Rules:
- Every field listed above is REQUIRED except "notes" and device "orientation".
- Arrays may be empty but must be present.
- "control_modules" should have at least one entry unless the user is explicitly asking for a dashboard-only screen.
- "controls" must include start/stop when the user mentions state machines, control, or running equipment.
- "statusFields" must include a state display when the user mentions a state machine.
- Keep labels short (max 24 chars).
- Do NOT invent PLC tag names — leave "tag" out unless the user specified one.
- Do NOT output JavaScript, markdown, or commentary. JSON only.`;
}

// ---------------------------------------------------------------------------
// User message — plan generation
// ---------------------------------------------------------------------------

export interface BuildPlanUserMessageInput {
  userPrompt: string;
  screenRole: "overview" | "detail" | "dashboard" | "alarm" | "trend";
}

export function buildHmiWizardPlanUserMessage(input: BuildPlanUserMessageInput): string {
  return `Screen role: ${input.screenRole}

User request:
${input.userPrompt}

Return the JSON plan only.`;
}

// ---------------------------------------------------------------------------
// Plan parser
// ---------------------------------------------------------------------------

export function parseHmiWizardPlan(raw: string): HmiWizardPlan {
  const jsonText = extractJsonObject(raw);
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;

  const plan: HmiWizardPlan = {
    screenTitle: String(parsed.screenTitle ?? "New Screen"),
    description: String(parsed.description ?? ""),
    useTemplateFrame: parsed.useTemplateFrame !== false,
    visibleNavLevels: Array.isArray(parsed.visibleNavLevels)
      ? (parsed.visibleNavLevels as string[]).filter(isNavLevel)
      : ["main", "sub"],
    navItems: Array.isArray(parsed.navItems) ? (parsed.navItems as string[]).map(String) : [],
    control_modules: Array.isArray(parsed.control_modules)
      ? (parsed.control_modules as Record<string, unknown>[]).map((d, i) => ({
          id: String(d.id ?? `dev_${i + 1}`),
          label: String(d.label ?? `Device ${i + 1}`),
          deviceType: String(d.deviceType ?? "generic"),
          faceplateHint: String(d.faceplateHint ?? d.deviceType ?? ""),
          positionHint:
            typeof d.positionHint === "string" && isPositionHint(d.positionHint)
              ? d.positionHint
              : "grid",
          orientation:
            d.orientation === "horizontal" || d.orientation === "vertical"
              ? d.orientation
              : undefined,
        }))
      : [],
    controls: Array.isArray(parsed.controls)
      ? (parsed.controls as Record<string, unknown>[]).map((c) => ({
          type:
            c.type === "mode-select" || c.type === "indicator" ? c.type : "button",
          label: String(c.label ?? "Button"),
          action: c.action ? String(c.action) : undefined,
          variant: isVariant(c.variant) ? (c.variant as HmiWizardPlanControl["variant"]) : "primary",
        }))
      : [],
    statusFields: Array.isArray(parsed.statusFields)
      ? (parsed.statusFields as Record<string, unknown>[]).map((f) => ({
          label: String(f.label ?? "Status"),
          tag: f.tag ? String(f.tag) : undefined,
          unit: f.unit ? String(f.unit) : undefined,
          format: isFormat(f.format) ? (f.format as HmiWizardPlanStatusField["format"]) : "string",
        }))
      : [],
    notes: parsed.notes ? String(parsed.notes) : undefined,
  };

  return plan;
}

function isNavLevel(v: unknown): v is HmiNavLevel {
  return v === "main" || v === "sub" || v === "third" || v === "tab";
}

function isPositionHint(v: string): v is HmiWizardPlanDevice["positionHint"] {
  return ["grid", "top", "bottom", "left", "right", "center"].includes(v);
}

function isVariant(v: unknown): boolean {
  return typeof v === "string" && ["primary", "success", "danger", "warning", "neutral"].includes(v);
}

function isFormat(v: unknown): boolean {
  return typeof v === "string" && ["string", "decimal", "binary", "datetime"].includes(v);
}

/** Extract the first top-level JSON object from a raw AI response. */
function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  // Strip ``` fences if present
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
  // Find the first { ... } balanced pair
  const start = candidate.indexOf("{");
  if (start === -1) throw new Error("AI response did not contain a JSON object");
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  throw new Error("AI response JSON object was not balanced");
}

// ---------------------------------------------------------------------------
// Custom SVG generation — system prompt
// ---------------------------------------------------------------------------

export interface BuildCustomSvgPromptInput {
  theme: HmiUnifiedTheme;
}

export function buildHmiCustomSvgSystemPrompt(input: BuildCustomSvgPromptInput): string {
  const accent = input.theme === "SiemensDark" ? "#e5e5e5" : "#1a1a1a";
  return `You are a Pac-Forge HMI symbol designer. You generate static SVG graphics in the Siemens WinCC Unified dynamic-SVG style.

## Style rules

- Viewbox: always \`0 0 100 100\` (square, engineering units).
- Line weight: 2 (default), 1.5 for detail strokes.
- Colors: desaturated engineering palette. Use pure "${accent}" for outlines, "#888" for neutral fills, "#4ade80" for running/on indicator, "#f87171" for fault indicator, "#fbbf24" for warning. No gradients unless essential.
- Flat and schematic. NO 3D effects, drop shadows, blurs, or photorealism.
- Stroke linecap="round" and linejoin="round" where appropriate.

## Dynamic binding conventions (Siemens SVG widget)

- Place static body elements inside \`<g id="background">\`.
- Place state-dependent elements inside \`<g id="dynamic">\`, each with a descriptive id that a HMI runtime can target, e.g.:
  \`<circle id="state-running" ... />\`, \`<path id="state-fault" .../>\`, \`<rect id="fill-level" ... />\`.
- Use \`data-bind="…"\` on elements that should animate (fill-color, opacity, transform, fill-level). Example: \`<rect data-bind="fill-level" .../>\`.

## Output rules

- Return EXACTLY one \`<svg>\` element. No markdown, no prose, no XML declaration.
- The svg must render correctly as-is when dropped into an HTML page.
- Keep total size under 2 KB.`;
}

export function buildHmiCustomSvgUserMessage(description: string): string {
  return `Generate a Siemens-style dynamic SVG for: ${description}

Return the SVG element only.`;
}

/** Extract the first <svg>…</svg> from a raw response. */
export function parseCustomSvg(raw: string): string {
  const match = raw.match(/<svg[\s\S]*?<\/svg>/i);
  if (!match) throw new Error("AI response did not contain an <svg> element");
  return match[0];
}
