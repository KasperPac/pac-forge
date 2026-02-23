import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import { registerSclLanguage, SCL_LANGUAGE_ID } from "@/lib/monaco-scl";

interface DiffViewProps {
  original: string;
  modified: string;
}

export function DiffView({ original, modified }: DiffViewProps) {
  const handleMount: DiffOnMount = (_editor, monaco) => {
    registerSclLanguage(monaco);
  };

  return (
    <DiffEditor
      language={SCL_LANGUAGE_ID}
      theme="pac-dark"
      original={original}
      modified={modified}
      onMount={handleMount}
      options={{
        readOnly: true,
        minimap: { enabled: false },
        fontSize: 12,
        fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
        renderSideBySide: true,
        scrollBeyondLastLine: false,
        padding: { top: 8 },
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
        },
      }}
    />
  );
}
