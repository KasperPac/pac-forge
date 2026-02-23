import { CheckCheck, Check } from "lucide-react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { Button } from "@/components/ui/button";
import { ArtifactTabs } from "./artifact-tabs";
import { registerSclLanguage, SCL_LANGUAGE_ID } from "@/lib/monaco-scl";
import { usePacStStore } from "@/stores/pac-st-store";

export function GeneratedCodePane() {
  const {
    generatedArtifacts,
    activeGeneratedIndex,
    setActiveGeneratedIndex,
    approveArtifact,
    approveAllArtifacts,
  } = usePacStStore();

  const activeArtifact = generatedArtifacts[activeGeneratedIndex];

  const handleEditorMount: OnMount = (_editor, monaco) => {
    registerSclLanguage(monaco);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <div className="font-mono text-[10px] font-medium text-muted-foreground">
          GENERATED CODE
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 font-mono text-[10px]"
            onClick={() => approveArtifact(activeGeneratedIndex)}
            disabled={!activeArtifact}
            title="Approve current artifact"
          >
            <Check className="mr-1 h-3 w-3" />
            Approve
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 font-mono text-[10px]"
            onClick={approveAllArtifacts}
            disabled={generatedArtifacts.length === 0}
            title="Approve all artifacts"
          >
            <CheckCheck className="mr-1 h-3 w-3" />
            All
          </Button>
        </div>
      </div>

      {/* Artifact tabs */}
      <ArtifactTabs
        artifacts={generatedArtifacts.map((a) => ({ name: a.name, type: a.type }))}
        activeIndex={activeGeneratedIndex}
        onSelect={setActiveGeneratedIndex}
      />

      {/* Monaco editor */}
      <div className="flex-1">
        {activeArtifact ? (
          <Editor
            language={SCL_LANGUAGE_ID}
            theme="pac-dark"
            value={activeArtifact.content}
            onMount={handleEditorMount}
            options={{
              readOnly: true,
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
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center font-mono text-xs text-muted-foreground">
              <div>No generated code yet.</div>
              <div className="mt-1 text-[10px]">
                Use the chat to generate PLC artifacts.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
