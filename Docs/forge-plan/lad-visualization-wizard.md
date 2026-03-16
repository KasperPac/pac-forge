# Fix: Render LAD artifacts as visual ladder diagrams in the wizard

## Problem

The wizard currently shows LAD artifacts as raw JSON in Monaco editor. The existing Pac-LAD page renders them as proper visual ladder diagrams using `LadCanvas`. The wizard should do the same.

## What exists

- `src/components/lad-editor/lad-canvas.tsx` — SVG canvas that renders a `LadProgram` as visual ladder logic with zoom/pan
- `src/components/lad-editor/lad-element-renderer.tsx` — renders individual ladder elements (contacts, coils, timers, etc.)
- `src/lib/lad-layout.ts` — layout engine that calculates SVG coordinates
- LAD artifacts in the wizard store `LadProgram` JSON in the `content` field (parsed and validated during generation)

## Changes needed

### 1. `src/components/forge/steps/forge-device-code.tsx`

Replace the Monaco editor with conditional rendering based on artifact language:

```tsx
import { LadCanvas } from "@/components/lad-editor/lad-canvas";
import type { LadProgram } from "@/types/lad";
```

In the right panel where Monaco is rendered, replace with:

```tsx
{selected?.language === "LAD" ? (
  // Visual ladder diagram
  (() => {
    try {
      const program = JSON.parse(selected.content) as LadProgram;
      return (
        <div className="h-full">
          <LadCanvas
            program={program}
            selectedId={null}
            onSelectElement={() => {}}
          />
        </div>
      );
    } catch {
      // Fallback to JSON view if parse fails
      return (
        <Editor
          height="100%"
          language="json"
          value={selected.content}
          theme="vs-dark"
          options={{ readOnly: !editable, minimap: { enabled: false }, fontSize: 13, fontFamily: "monospace" }}
          onChange={(val) => { if (editable && val && selected) updateContent(selected.id, val); }}
        />
      );
    }
  })()
) : (
  // SCL code in Monaco
  <Editor
    height="100%"
    language="plaintext"
    value={selected?.content ?? ""}
    theme="vs-dark"
    options={{ readOnly: !editable, minimap: { enabled: false }, fontSize: 13, fontFamily: "monospace" }}
    onChange={(val) => { if (editable && val && selected) updateContent(selected.id, val); }}
  />
)}
```

Keep the "Edit" toggle button — when editing a LAD artifact, switch to the JSON Monaco view so the engineer can manually edit the JSON if needed. When not editing, show the visual diagram.

Add a toggle button for LAD artifacts:
```tsx
{selected?.language === "LAD" && (
  <Button
    variant="outline"
    size="sm"
    onClick={() => setEditable(!editable)}
  >
    {editable ? <Eye className="mr-1.5 h-3.5 w-3.5" /> : <Edit className="mr-1.5 h-3.5 w-3.5" />}
    {editable ? "Visual View" : "Edit JSON"}
  </Button>
)}
```

### 2. `src/components/forge/steps/forge-process-code.tsx`

Same change — conditional rendering for LAD process artifacts. The process code step might have a mix of SCL and LAD artifacts depending on the profile's `process_code_language` setting.

Apply the same pattern: LAD → LadCanvas, SCL → Monaco.

### 3. Consider a shared component

Since both device-code and process-code steps need the same conditional rendering, extract it into a shared component:

Create `src/components/forge/forge-code-viewer.tsx`:

```tsx
import { useState } from "react";
import Editor from "@monaco-editor/react";
import { Eye, Edit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LadCanvas } from "@/components/lad-editor/lad-canvas";
import type { LadProgram } from "@/types/lad";
import type { ForgeArtifact } from "@/types/forge";

interface ForgeCodeViewerProps {
  artifact: ForgeArtifact | null;
  editable: boolean;
  onToggleEditable: () => void;
  onContentChange: (content: string) => void;
}

export function ForgeCodeViewer({ artifact, editable, onToggleEditable, onContentChange }: ForgeCodeViewerProps) {
  if (!artifact) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select an artifact to preview
      </div>
    );
  }

  // LAD artifact — show visual diagram or JSON editor
  if (artifact.language === "LAD") {
    if (editable) {
      return (
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
            <Button variant="outline" size="sm" onClick={onToggleEditable}>
              <Eye className="mr-1.5 h-3.5 w-3.5" />
              Visual View
            </Button>
            <span className="font-mono text-[10px] text-muted-foreground">Editing JSON</span>
          </div>
          <Editor
            height="100%"
            language="json"
            value={artifact.content}
            theme="vs-dark"
            options={{ minimap: { enabled: false }, fontSize: 13, fontFamily: "monospace" }}
            onChange={(val) => { if (val) onContentChange(val); }}
          />
        </div>
      );
    }

    try {
      const program = JSON.parse(artifact.content) as LadProgram;
      return (
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
            <Button variant="outline" size="sm" onClick={onToggleEditable}>
              <Edit className="mr-1.5 h-3.5 w-3.5" />
              Edit JSON
            </Button>
            <span className="font-mono text-[10px] text-muted-foreground">Ladder Diagram</span>
          </div>
          <div className="flex-1">
            <LadCanvas
              program={program}
              selectedId={null}
              onSelectElement={() => {}}
            />
          </div>
        </div>
      );
    } catch {
      // Parse failed — fall through to Monaco JSON view
      return (
        <Editor
          height="100%"
          language="json"
          value={artifact.content}
          theme="vs-dark"
          options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13 }}
        />
      );
    }
  }

  // SCL artifact — Monaco with SCL-ish highlighting
  return (
    <div className="flex h-full flex-col">
      {!editable ? (
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
          <Button variant="outline" size="sm" onClick={onToggleEditable}>
            <Edit className="mr-1.5 h-3.5 w-3.5" />
            Edit
          </Button>
          <span className="font-mono text-[10px] text-muted-foreground">Read-only</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
          <Button variant="outline" size="sm" onClick={onToggleEditable}>
            <Eye className="mr-1.5 h-3.5 w-3.5" />
            Read-only
          </Button>
          <span className="font-mono text-[10px] text-muted-foreground">Editing</span>
        </div>
      )}
      <Editor
        height="100%"
        language="plaintext"
        value={artifact.content}
        theme="vs-dark"
        options={{ readOnly: !editable, minimap: { enabled: false }, fontSize: 13, fontFamily: "monospace" }}
        onChange={(val) => { if (val) onContentChange(val); }}
      />
    </div>
  );
}
```

Then use it in both step components:
```tsx
<ForgeCodeViewer
  artifact={selected}
  editable={editable}
  onToggleEditable={() => setEditable(!editable)}
  onContentChange={(content) => { if (selected) updateContent(selected.id, content); }}
/>
```

Commit with: "forge-ui: render LAD artifacts as visual ladder diagrams in wizard"
