# Pipeline Audit Fixes — Codex

These fixes are UI and schema alignment issues. Do NOT modify any hooks or prompt builder files — those are being fixed by Claude Code in parallel.

---

## FIX 1 (CRITICAL): Align HMI prompt schema with existing HmiScreenSpec types

The forge HMI generation uses a different schema than the existing HMI system. The `hmi-xml-builder.ts` expects `HmiScreenSpec` from `src/types/hmi-screen.ts`, but the forge prompt asks for a simplified schema with different element type names.

### What to do:

**A) Read `src/types/hmi-screen.ts` to understand the existing HmiScreenSpec type.**

The existing type uses element types like: "text", "io_field", "button", "rectangle", "circle", "ellipse", "line", "polygon", "graphic_view", "graphic_io_field", "symbolic_io_field", "gauge", "bar", "slider", "switch_toggle", "trend_view", "alarm_view", "date_time_field", "faceplate"

The forge prompt currently uses: "text_field", "io_field", "button", "indicator_light", "rectangle", "ellipse", "image", "bar_graph", "trend_view"

These don't match. The XML builder will fail or produce invalid output.

**B) Update `buildHmiPrompt()` in `src/lib/forge-prompts.ts`:**

Replace the simplified JSON schema in the prompt with one that matches `HmiScreenSpec` exactly. The prompt should reference the actual element types from the existing type system.

Read the existing HMI Screen Designer prompt below and align the forge prompt with it:

The element types should be:
```
"RECTANGLE" | "BUTTON" | "TEXT" | "IO_FIELD" | "SYMBOLIC_IO_FIELD" | "GRAPHIC_VIEW" | "GRAPHIC_IO_FIELD" | "LINE" | "CIRCLE" | "ELLIPSE" | "POLYGON" | "GAUGE" | "BAR" | "SLIDER" | "SWITCH" | "TREND_VIEW" | "ALARM_VIEW" | "DATE_TIME" | "FACEPLATE"
```

The element properties should include:
- name (string, unique)
- type (from the list above)
- x, y, width, height (numbers)
- text (for TEXT/BUTTON)
- tagBinding (for IO_FIELD/GAUGE/BAR/SLIDER/SWITCH)
- navigateTo (for BUTTON — screen navigation)
- graphicName (for GRAPHIC_VIEW/GRAPHIC_IO_FIELD)
- imageList (for GRAPHIC_IO_FIELD — value-to-graphic mappings)
- style: { backgroundColor, borderColor, borderWidth, textColor, fontSize, fontWeight, textAlign, borderRadius }

**C) Update the HMI artifact parser in `src/hooks/use-forge-hmi-generate.ts`:**

The `parseHmiArtifacts()` function currently stores the raw JSON as artifact content. Verify that the stored JSON matches `HmiScreenSpec` so that `buildScreenXml()` from `hmi-xml-builder.ts` can convert it correctly.

If the existing parser just stores the JSON as-is, and the prompt now produces the correct schema, this should work. But verify that the `hmi-xml-builder.ts` `buildScreenXml()` function receives the data in the format it expects.

**D) Update the HMI step component `src/components/forge/steps/forge-hmi.tsx`:**

The right panel currently shows raw JSON in Monaco. Consider adding a basic visual preview — even just a coloured rectangle layout showing element positions. This makes the demo much more impressive than looking at JSON.

However, if this is too complex, just ensure the Monaco view correctly displays the HmiScreenSpec JSON and the "Approve" flow works.

---

## FIX 2 (RECOMMENDATION): Add "Launch Wizard" button to project pages

If not already done by Claude Code, add navigation buttons:

**A) `src/routes/project-detail.tsx`:**
Add a prominent button near the top of the page:
```tsx
<Button onClick={() => navigate(`/forge?projectId=${project.id}`)}>
  <Wand2 className="mr-2 h-4 w-4" />
  Launch Wizard
</Button>
```

**B) `src/routes/projects.tsx`:**
On each project card, add a small wizard link/button that navigates to `/forge?projectId={project.id}`.

Import `Wand2` from `lucide-react`.

---

## FIX 3 (RECOMMENDATION): Restructure sidebar navigation

If not already done, restructure the sidebar navigation in `src/app/DashboardLayout.tsx`:

```
Top level (no header):
  Projects (/projects, FolderOpen)
  Project Wizard (/forge, Wand2)

Code Tools:
  HMI Editor (/hmi-editor, Monitor)
  Pac-LAD (/pac-lad, GitBranchPlus)
  FB Builder (/pac-st/fb-builder, Blocks)
  Pac-ST Chat (/pac-st/chat, MessageSquare)

Configuration:
  Profiles (/profiles, SlidersHorizontal)
  FB Library (/fb-library, Layers)
  Agents (/agents, Bot)

Training:
  Knowledge (/knowledge, GraduationCap)
  Reference Library (/reference-library, Library)
  Patterns (/patterns, BookOpen) — keep pending count badge
  Prompts (/prompts, FileText)

System:
  TIA Console (/tia-console, Terminal)
```

Each group header: small uppercase label with font-mono text-[10px] uppercase tracking-wider text-muted-foreground, thin separator above.
Remove Process Builder from nav. Remove the Pac-ST parent group.
When sidebar collapsed, hide group headers and show icons only.

---

Commit with: "forge-ui: HMI schema alignment + navigation improvements"
