import { useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { cn } from "@/lib/utils";
import { parseFbFlow } from "@/lib/fb-flow-diagram";
import { FbFlowRenderer } from "@/components/forge/fb-flow-renderer";
import type { CodeBuilderArtifactView } from "@/types/code-builder";

type Tab = "code" | "flow" | "udt" | "instdb";

export function ArtifactViewer({
  artifact, related, editable, onContentChange,
}: {
  artifact: CodeBuilderArtifactView | null;
  /** Other device artifacts owned by the same module (for UDT / Inst DB tabs). */
  related: CodeBuilderArtifactView[];
  editable: boolean;
  onContentChange: (content: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("code");
  const content = artifact ? (artifact.edited_content ?? artifact.generated_content) : "";

  const canFlow = !!artifact && (artifact.type === "FB" || artifact.type === "FC");
  const diagrams = useMemo(() => (canFlow ? parseFbFlow(content) : []), [canFlow, content]);
  const instDb = related.find((r) => r.type === "DB");
  const udt = related.find((r) => r.type === "UDT");

  if (!artifact) {
    return <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">Select an artifact.</div>;
  }

  const TABS: { id: Tab; label: string; show: boolean }[] = [
    { id: "code", label: "Code", show: true },
    { id: "flow", label: "Flow", show: canFlow },
    { id: "udt", label: "UDT", show: !!udt },
    { id: "instdb", label: "Inst DB", show: !!instDb },
  ];

  return (
    <div className="flex h-full flex-col" data-testid="artifact-viewer">
      <div role="tablist" className="flex gap-1 border-b px-2 py-1.5">
        {TABS.filter((t) => t.show).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn("rounded px-2 py-0.5 text-[10px]", tab === t.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === "code" && (
          <Editor
            height="100%"
            language="scl"
            theme="vs-dark"
            value={content}
            options={{ readOnly: !editable, minimap: { enabled: false }, fontSize: 12 }}
            onChange={(v) => onContentChange(v ?? "")}
          />
        )}
        {tab === "flow" && <div className="h-full overflow-auto"><FbFlowRenderer diagrams={diagrams} /></div>}
        {tab === "udt" && <pre className="h-full overflow-auto p-3 text-[11px] font-mono">{udt ? (udt.edited_content ?? udt.generated_content) : ""}</pre>}
        {tab === "instdb" && <pre className="h-full overflow-auto p-3 text-[11px] font-mono">{instDb ? (instDb.edited_content ?? instDb.generated_content) : ""}</pre>}
      </div>
    </div>
  );
}
