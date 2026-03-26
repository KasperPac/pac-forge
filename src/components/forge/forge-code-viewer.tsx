import { useState } from "react";
import Editor from "@monaco-editor/react";
import { Edit, Eye, GitBranch } from "lucide-react";
import { LadCanvas } from "@/components/lad-editor/lad-canvas";
import { Button } from "@/components/ui/button";
import { FbFlowRenderer } from "@/components/forge/fb-flow-renderer";
import { parseFbFlow } from "@/lib/fb-flow-diagram";
import type { ForgeArtifact } from "@/types/forge";
import type { LadProgram } from "@/types/lad";

interface ForgeCodeViewerProps {
  artifact: ForgeArtifact | null;
  editable: boolean;
  onToggleEditable: () => void;
  onContentChange: (content: string) => void;
}

type ViewMode = "code" | "flow";

function canShowFlow(artifact: ForgeArtifact): boolean {
  return (
    artifact.language === "SCL" &&
    (artifact.type === "FB" || artifact.type === "FC")
  );
}

export function ForgeCodeViewer({
  artifact,
  editable,
  onToggleEditable,
  onContentChange,
}: ForgeCodeViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("code");

  if (!artifact) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select an artifact to preview
      </div>
    );
  }

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
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: "JetBrains Mono, Consolas, monospace",
              automaticLayout: true,
            }}
            onChange={(value) => {
              if (value != null) {
                onContentChange(value);
              }
            }}
          />
        </div>
      );
    }

    let program: LadProgram | null = null;
    try {
      const parsed = JSON.parse(artifact.content) as LadProgram;
      // Validate that the structure has rungs — layout engine handles missing fields defensively
      if (Array.isArray(parsed.rungs) && parsed.rungs.length > 0) {
        program = parsed;
      }
    } catch {
      program = null;
    }

    if (!program) {
      return (
        <Editor
          height="100%"
          language="json"
          value={artifact.content}
          theme="vs-dark"
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 13,
            automaticLayout: true,
          }}
        />
      );
    }

    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
          <Button variant="outline" size="sm" onClick={onToggleEditable}>
            <Edit className="mr-1.5 h-3.5 w-3.5" />
            Edit JSON
          </Button>
          <span className="font-mono text-[10px] text-muted-foreground">Ladder Diagram</span>
        </div>
        <div className="min-h-0 flex-1">
          <LadCanvas
            program={program}
            selectedId={null}
            onSelectElement={() => {}}
          />
        </div>
      </div>
    );
  }

  // SCL artifact — show code + optional Flow tab
  const showFlowButton = canShowFlow(artifact);

  if (viewMode === "flow" && showFlowButton) {
    const diagrams = parseFbFlow(artifact.content);
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setViewMode("code")}
          >
            <Eye className="mr-1.5 h-3.5 w-3.5" />
            Code
          </Button>
          <Button variant="secondary" size="sm" disabled>
            <GitBranch className="mr-1.5 h-3.5 w-3.5" />
            Flow
          </Button>
          <span className="font-mono text-[10px] text-muted-foreground">
            Signal Flow Diagram
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {diagrams.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No signal flow detected — try a more complex FB with VAR_OUTPUT assignments
            </div>
          ) : (
            <FbFlowRenderer diagrams={diagrams} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <Button variant="outline" size="sm" onClick={onToggleEditable}>
          {editable ? (
            <>
              <Eye className="mr-1.5 h-3.5 w-3.5" />
              Read-only
            </>
          ) : (
            <>
              <Edit className="mr-1.5 h-3.5 w-3.5" />
              Edit
            </>
          )}
        </Button>
        {showFlowButton && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setViewMode("flow")}
          >
            <GitBranch className="mr-1.5 h-3.5 w-3.5" />
            Flow
          </Button>
        )}
        <span className="font-mono text-[10px] text-muted-foreground">
          {editable ? "Editing" : "Read-only"}
        </span>
      </div>
      <Editor
        height="100%"
        language="plaintext"
        value={artifact.content}
        theme="vs-dark"
        options={{
          readOnly: !editable,
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: "JetBrains Mono, Consolas, monospace",
          lineNumbers: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
        }}
        onChange={(value) => {
          if (editable && value != null) {
            onContentChange(value);
          }
        }}
      />
    </div>
  );
}
