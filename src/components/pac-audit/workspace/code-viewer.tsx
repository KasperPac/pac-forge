import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Edit3, X, Upload, Code2, AlertTriangle, CheckCircle2 } from "lucide-react";
import Editor, { type Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { useAuditStore } from "@/stores/audit-store";
import { getBridgeConfigForVersion } from "@/lib/tia-bridge-contract";
import type { ReimportMigrationBlocksRequest, ReimportMigrationBlocksResponse } from "@/lib/tia-bridge-contract";
import type { AuditProject } from "@/types/audit";
import { cn } from "@/lib/utils";

interface CodeViewerProps {
  sessionId: string;
  session: AuditProject;
}

interface BlockData {
  id: string;
  name: string;
  block_type: string;
  programming_language: string;
  source_code: string | null;
  source_format: string;
  line_count: number | null;
}

const LANG_MAP: Record<string, string> = {
  SCL: "pascal",   // closest Monaco lang for SCL highlighting
  STL: "plaintext",
  LAD: "xml",
  FBD: "xml",
  GRAPH: "xml",
  DB: "plaintext",
  UDT: "plaintext",
};

const TYPE_COLORS: Record<string, string> = {
  FB:  "text-blue-400",
  FC:  "text-cyan-400",
  OB:  "text-amber-400",
  DB:  "text-zinc-400",
  UDT: "text-green-400",
};

export function CodeViewer({ sessionId, session }: CodeViewerProps) {
  const store = useAuditStore();
  const { activeBlockId, openBlockIds, openBlock, closeBlock, modificationMode, setModificationMode, pendingEdits, setPendingEdit } = store;
  const queryClient = useQueryClient();

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [reimportError, setReimportError] = useState<string | null>(null);
  const [reimportSuccess, setReimportSuccess] = useState<string | null>(null);

  const bridgeCfg = getBridgeConfigForVersion(session.tia_version);

  // Fetch all open blocks' metadata + source
  const { data: openBlocks, isLoading } = useQuery({
    queryKey: ["workspace-open-blocks", sessionId, openBlockIds],
    queryFn: async (): Promise<BlockData[]> => {
      if (openBlockIds.length === 0) return [];
      const { data, error } = await supabase
        .from("audit_blocks")
        .select("id, name, block_type, programming_language, source_code, source_format, line_count")
        .in("id", openBlockIds);
      if (error) throw error;
      return (data ?? []) as BlockData[];
    },
    enabled: openBlockIds.length > 0,
    staleTime: 60_000,
  });

  const activeBlock = openBlocks?.find((b) => b.id === activeBlockId) ?? null;
  const isLad = activeBlock?.programming_language === "LAD" || activeBlock?.programming_language === "FBD";
  const monacoLang = LANG_MAP[activeBlock?.programming_language ?? "SCL"] ?? "plaintext";

  const currentEditContent = activeBlockId
    ? (pendingEdits[activeBlockId] ?? activeBlock?.source_code ?? "")
    : "";

  function handleEditorMount(ed: editor.IStandaloneCodeEditor) {
    editorRef.current = ed;
  }

  function handleEditorChange(value: string | undefined) {
    if (activeBlockId && value !== undefined) {
      setPendingEdit(activeBlockId, value);
    }
  }

  // Re-import mutation
  const reimportMutation = useMutation({
    mutationFn: async (blocks: Record<string, string>): Promise<ReimportMigrationBlocksResponse> => {
      const body: ReimportMigrationBlocksRequest = { blocks, compile: true };
      const res = await fetch(`${bridgeCfg.baseUrl}/tia/migration/reimport-blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ message: "Re-import failed" }))) as { message?: string };
        throw new Error(err.message ?? "Re-import failed");
      }
      return (await res.json()) as ReimportMigrationBlocksResponse;
    },
    onSuccess: async (data) => {
      setReimportError(null);
      setReimportSuccess(
        data.errors.length > 0
          ? `Imported ${data.imported.length} block(s) with ${data.errors.length} error(s)`
          : `Successfully imported ${data.imported.length} block(s)`
      );
      // Update source_code in DB for imported blocks
      if (activeBlockId && activeBlock && pendingEdits[activeBlockId]) {
        await supabase
          .from("audit_blocks")
          .update({ source_code: pendingEdits[activeBlockId], analysis_status: "modified" })
          .eq("id", activeBlockId);
        await queryClient.invalidateQueries({ queryKey: ["workspace-open-blocks", sessionId] });
        await queryClient.invalidateQueries({ queryKey: ["workspace-blocks", sessionId] });
      }
    },
    onError: (err) => {
      setReimportError(err instanceof Error ? err.message : String(err));
      setReimportSuccess(null);
    },
  });

  function handleReimport() {
    if (!activeBlock) return;
    setReimportError(null);
    setReimportSuccess(null);
    const content = pendingEdits[activeBlockId!] ?? activeBlock.source_code ?? "";
    reimportMutation.mutate({ [activeBlock.name]: content });
  }

  if (openBlockIds.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Code2 className="h-8 w-8 text-muted-foreground/30" />
        <p className="font-mono text-sm text-muted-foreground">Select a block from the tree to view its source</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border/40 bg-muted/5 px-1 pt-1">
        {openBlockIds.map((blockId) => {
          const b = openBlocks?.find((x) => x.id === blockId);
          const isActive = blockId === activeBlockId;
          const hasEdit = !!pendingEdits[blockId];
          return (
            <div
              key={blockId}
              className={cn(
                "group flex shrink-0 items-center gap-1.5 rounded-t-md border px-2.5 py-1 font-mono text-[11px] transition-colors cursor-pointer",
                isActive
                  ? "border-border/60 border-b-transparent bg-background text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
              onClick={() => openBlock(blockId)}
            >
              {b && (
                <span className={cn("text-[10px] font-semibold", TYPE_COLORS[b.block_type] ?? "text-muted-foreground")}>
                  {b.block_type}
                </span>
              )}
              <span>{b?.name ?? blockId.slice(0, 8)}</span>
              {hasEdit && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); closeBlock(blockId); }}
                className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Toolbar */}
      {activeBlock && (
        <div className="flex items-center gap-2 border-b border-border/40 px-3 py-1.5">
          <span className={cn("font-mono text-xs font-semibold", TYPE_COLORS[activeBlock.block_type] ?? "text-muted-foreground")}>
            {activeBlock.block_type}
          </span>
          <span className="font-mono text-xs">{activeBlock.name}</span>
          <Badge variant="outline" className="font-mono text-[9px] px-1 py-0">
            {activeBlock.programming_language}
          </Badge>
          {activeBlock.line_count && (
            <span className="font-mono text-[10px] text-muted-foreground">{activeBlock.line_count}L</span>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            {reimportSuccess && (
              <div className="flex items-center gap-1 font-mono text-[10px] text-green-400">
                <CheckCircle2 className="h-3 w-3" />
                {reimportSuccess}
              </div>
            )}
            {reimportError && (
              <div className="flex items-center gap-1 font-mono text-[10px] text-red-400">
                <AlertTriangle className="h-3 w-3" />
                {reimportError}
              </div>
            )}

            {!isLad && (
              <>
                <Button
                  size="sm"
                  variant={modificationMode ? "default" : "outline"}
                  onClick={() => setModificationMode(!modificationMode)}
                  className="h-6 gap-1 px-2 font-mono text-[10px]"
                >
                  <Edit3 className="h-3 w-3" />
                  {modificationMode ? "Editing" : "Edit"}
                </Button>
                {modificationMode && pendingEdits[activeBlockId!] && (
                  <Button
                    size="sm"
                    onClick={handleReimport}
                    disabled={reimportMutation.isPending}
                    className="h-6 gap-1 bg-blue-600 px-2 font-mono text-[10px] hover:bg-blue-700"
                  >
                    {reimportMutation.isPending
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <Upload className="h-3 w-3" />
                    }
                    Re-import
                  </Button>
                )}
              </>
            )}
            {isLad && (
              <Badge variant="outline" className="font-mono text-[9px] px-1.5 py-0 text-amber-400 border-amber-500/40">
                LAD — Edit via AI Chat
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* Editor */}
      <div className="relative flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : activeBlock ? (
          activeBlock.source_code ? (
            <Editor
              height="100%"
              language={monacoLang}
              value={currentEditContent}
              onChange={handleEditorChange}
              onMount={handleEditorMount}
              options={{
                readOnly: !modificationMode || isLad,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 12,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                lineNumbers: "on",
                renderLineHighlight: "line",
                theme: "vs-dark",
                wordWrap: "off",
                folding: true,
                renderWhitespace: "selection",
              }}
              theme="vs-dark"
            />
          ) : (
            <NoSourceView language={activeBlock.programming_language} />
          )
        ) : null}
      </div>
    </div>
  );
}

function NoSourceView({ language }: { language: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
      <Code2 className="h-8 w-8 text-muted-foreground/30" />
      <div className="text-center">
        <p className="font-mono text-sm text-muted-foreground">No source available</p>
        {(language === "LAD" || language === "FBD") && (
          <p className="mt-1 font-mono text-[11px] text-muted-foreground/60">
            LAD/FBD blocks are stored as XML. Use the AI chat to describe modifications.
          </p>
        )}
        {language === "DB" && (
          <p className="mt-1 font-mono text-[11px] text-muted-foreground/60">
            Data block — structure shown in analysis panel.
          </p>
        )}
      </div>
    </div>
  );
}
