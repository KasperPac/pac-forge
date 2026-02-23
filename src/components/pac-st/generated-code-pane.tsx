import { useRef, useEffect } from "react";
import { CheckCheck, Check, Loader2 } from "lucide-react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
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
    pendingEditorNavigation,
    clearPendingNavigation,
    streamingContent,
  } = usePacStStore();

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const activeArtifact = generatedArtifacts[activeGeneratedIndex];

  const handleEditorMount: OnMount = (_editor, monaco) => {
    editorRef.current = _editor;
    registerSclLanguage(monaco);
  };

  // Navigate to artifact + line when pendingEditorNavigation matches
  useEffect(() => {
    if (!pendingEditorNavigation || !editorRef.current || !activeArtifact) return;
    if (pendingEditorNavigation.artifactName !== activeArtifact.name) return;

    const ed = editorRef.current;
    const line = pendingEditorNavigation.line;
    ed.revealLineInCenter(line);
    ed.setPosition({ lineNumber: line, column: 1 });
    ed.focus();
    clearPendingNavigation();
  }, [pendingEditorNavigation, activeArtifact, clearPendingNavigation]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <div className="font-mono text-xs font-medium text-muted-foreground">
          GENERATED CODE
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 font-mono text-xs"
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
            className="h-6 px-2 font-mono text-xs"
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

      {/* Monaco editor or streaming view */}
      <div className="flex-1">
        {streamingContent != null ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b px-3 py-1.5">
              <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
              <span className="font-mono text-xs text-blue-400">Streaming response...</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-[#1e1e1e] p-4">
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-[#d4d4d4]">
                {streamingContent}
                <span className="animate-pulse">|</span>
              </pre>
            </div>
          </div>
        ) : activeArtifact ? (
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
            <div className="text-center font-mono text-sm text-muted-foreground">
              <div>No generated code yet.</div>
              <div className="mt-1 text-xs">
                Use the chat to generate PLC artifacts.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
