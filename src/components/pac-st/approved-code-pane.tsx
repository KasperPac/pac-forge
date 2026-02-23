import { Save, GitCompare, Download } from "lucide-react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { Button } from "@/components/ui/button";
import { ArtifactTabs } from "./artifact-tabs";
import { DiffView } from "./diff-view";
import { VersionSelector } from "./version-selector";
import { registerSclLanguage, SCL_LANGUAGE_ID } from "@/lib/monaco-scl";
import { usePacStStore } from "@/stores/pac-st-store";

interface ApprovedCodePaneProps {
  projectId?: string;
  onSaveSnapshot?: () => void;
  onExport?: () => void;
}

export function ApprovedCodePane({ projectId, onSaveSnapshot, onExport }: ApprovedCodePaneProps) {
  const {
    generatedArtifacts,
    approvedArtifacts,
    activeApprovedIndex,
    activeGeneratedIndex,
    setActiveApprovedIndex,
    updateApprovedContent,
    showDiff,
    toggleDiff,
  } = usePacStStore();

  const activeApproved = approvedArtifacts[activeApprovedIndex];
  const matchingGenerated = activeApproved
    ? generatedArtifacts.find((a) => a.name === activeApproved.artifact.name)
    : generatedArtifacts[activeGeneratedIndex];

  const handleEditorMount: OnMount = (_editor, monaco) => {
    registerSclLanguage(monaco);
  };

  function handleRollback(content: string) {
    if (activeApproved) {
      updateApprovedContent(activeApprovedIndex, content);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <div className="font-mono text-[10px] font-medium text-muted-foreground">
          APPROVED CODE
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={showDiff ? "secondary" : "ghost"}
            size="sm"
            className="h-6 px-2 font-mono text-[10px]"
            onClick={toggleDiff}
            disabled={!activeApproved || !matchingGenerated}
            title="Toggle diff view"
          >
            <GitCompare className="mr-1 h-3 w-3" />
            Diff
          </Button>
          <VersionSelector
            artifactId={activeApproved?.artifact.id ?? null}
            projectId={projectId ?? ""}
            onRollback={handleRollback}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 font-mono text-[10px]"
            onClick={onSaveSnapshot}
            disabled={!activeApproved}
            title="Save snapshot"
          >
            <Save className="mr-1 h-3 w-3" />
            Save
          </Button>
          {onExport && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 font-mono text-[10px]"
              onClick={onExport}
              disabled={approvedArtifacts.length === 0}
              title="Export bundle"
            >
              <Download className="mr-1 h-3 w-3" />
              Export
            </Button>
          )}
        </div>
      </div>

      {/* Artifact tabs */}
      <ArtifactTabs
        artifacts={approvedArtifacts.map((a) => ({ name: a.artifact.name, type: a.artifact.type }))}
        activeIndex={activeApprovedIndex}
        onSelect={setActiveApprovedIndex}
      />

      {/* Editor / Diff */}
      <div className="flex-1">
        {activeApproved ? (
          showDiff && matchingGenerated ? (
            <DiffView
              original={matchingGenerated.content}
              modified={activeApproved.content}
            />
          ) : (
            <Editor
              language={SCL_LANGUAGE_ID}
              theme="pac-dark"
              value={activeApproved.content}
              onChange={(value) => {
                if (value !== undefined) {
                  updateApprovedContent(activeApprovedIndex, value);
                }
              }}
              onMount={handleEditorMount}
              options={{
                readOnly: false,
                minimap: { enabled: false },
                fontSize: 12,
                fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                wordWrap: "off",
                renderLineHighlight: "line",
                padding: { top: 8 },
                scrollbar: {
                  verticalScrollbarSize: 8,
                  horizontalScrollbarSize: 8,
                },
              }}
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center font-mono text-xs text-muted-foreground">
              <div>No approved code yet.</div>
              <div className="mt-1 text-[10px]">
                Approve generated artifacts to edit them here.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
