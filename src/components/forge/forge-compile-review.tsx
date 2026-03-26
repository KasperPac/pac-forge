import { useState } from "react";
import Editor from "@monaco-editor/react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  BookMarked,
  Wrench,
  X,
  Eye,
  Edit,
  GitCompareArrows,
  Code2,
} from "lucide-react";
import { DiffView } from "@/components/pac-st/diff-view";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CompileFixProposal } from "@/hooks/use-forge-compile-check";

interface ForgeCompileReviewProps {
  /** Raw compile errors from the initial compile */
  compileErrors: string[];
  /** AI-proposed fixes per artifact */
  proposals: CompileFixProposal[];
  /** Whether the AI is currently proposing fixes */
  proposing: boolean;
  /** Whether recompile is in progress */
  recompiling: boolean;
  /** Whether recompile succeeded */
  recompileSuccess: boolean | null;
  /** Errors from recompile attempt */
  recompileErrors: string[];
  /** Update a proposal's proposed code (user editing) */
  onUpdateProposal: (artifactId: string, code: string) => void;
  /** Toggle a proposal's accepted state */
  onToggleAccepted: (artifactId: string) => void;
  /** Apply accepted fixes and recompile */
  onApplyAndRecompile: () => void;
  /** Save selected proposals to pattern library */
  onSaveToLibrary: (artifactIds: string[]) => void;
  /** Dismiss the review panel */
  onDismiss: () => void;
  /** Whether library save is in progress */
  savingToLibrary: boolean;
}

export function ForgeCompileReview({
  compileErrors,
  proposals,
  proposing,
  recompiling,
  recompileSuccess,
  recompileErrors,
  onUpdateProposal,
  onToggleAccepted,
  onApplyAndRecompile,
  onSaveToLibrary,
  onDismiss,
  savingToLibrary,
}: ForgeCompileReviewProps) {
  const [expandedProposal, setExpandedProposal] = useState<string | null>(
    proposals[0]?.artifactId ?? null,
  );
  const [selectedForLibrary, setSelectedForLibrary] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [diffViewId, setDiffViewId] = useState<string | null>(null);

  const acceptedCount = proposals.filter((p) => p.accepted).length;
  const hasValidFixes = proposals.some(
    (p) => p.accepted && p.proposedCode !== p.originalCode,
  );

  function handleSaveToLibrary() {
    const ids = [...selectedForLibrary].filter((id) => !savedIds.has(id));
    if (ids.length === 0) return;
    onSaveToLibrary(ids);
    setSavedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-amber-400" />
          <span className="font-mono text-xs uppercase tracking-wider text-amber-400">
            Compile Error Review
          </span>
          <Badge
            variant="outline"
            className="font-mono text-[10px] border-red-500/50 text-red-400"
          >
            {compileErrors.length} error{compileErrors.length !== 1 ? "s" : ""}
          </Badge>
          {proposals.length > 0 && (
            <Badge
              variant="outline"
              className="font-mono text-[10px] border-amber-500/50 text-amber-400"
            >
              {acceptedCount}/{proposals.length} fixes
            </Badge>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <ScrollArea className="max-h-[500px]">
        <div className="space-y-1 px-3 pb-2">
          {/* Raw errors list */}
          <div className="space-y-0.5 rounded border border-red-500/20 bg-red-500/5 p-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-red-400/70">
              Compile Errors
            </span>
            {compileErrors.map((e, i) => (
              <div
                key={i}
                className="flex items-start gap-2 text-xs text-red-400"
              >
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="font-mono break-all">{e}</span>
              </div>
            ))}
          </div>

          {/* Proposing spinner */}
          {proposing && (
            <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              AI is analyzing errors and proposing fixes...
            </div>
          )}

          {/* Fix proposals */}
          {proposals.length > 0 && (
            <div className="space-y-1 pt-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Proposed Fixes
              </span>

              {proposals.map((p) => {
                const isExpanded = expandedProposal === p.artifactId;
                const isEditing = editingId === p.artifactId;
                const isLad = p.originalCode === "(LAD block — edit in TIA Portal)";
                const isUnmatched = p.artifactId === "__unmatched__";
                const noFix =
                  p.explanation === "NO_SAFE_FIX_FOUND" ||
                  p.proposedCode === p.originalCode ||
                  isLad ||
                  isUnmatched;
                const isSaved = savedIds.has(p.artifactId);

                return (
                  <div
                    key={p.artifactId}
                    className={`rounded border ${
                      p.accepted
                        ? "border-green-500/30 bg-green-500/5"
                        : noFix
                        ? "border-red-500/20 bg-red-500/5"
                        : "border-border/40 bg-muted/5"
                    }`}
                  >
                    {/* Proposal header */}
                    <button
                      className="flex w-full items-center gap-2 px-3 py-2 text-left"
                      onClick={() =>
                        setExpandedProposal(isExpanded ? null : p.artifactId)
                      }
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!noFix) onToggleAccepted(p.artifactId);
                        }}
                        className="shrink-0"
                        disabled={noFix}
                      >
                        {p.accepted ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                        ) : (
                          <AlertCircle
                            className={`h-3.5 w-3.5 ${
                              noFix
                                ? "text-red-500/50"
                                : "text-muted-foreground/50"
                            }`}
                          />
                        )}
                      </button>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">
                        {p.artifactName}
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {p.errors.length > 0 && (
                          <Badge
                            variant="outline"
                            className="font-mono text-[9px] border-red-500/40 text-red-400"
                          >
                            {p.errors.length} error
                            {p.errors.length !== 1 ? "s" : ""}
                          </Badge>
                        )}
                        {isLad && (
                          <Badge
                            variant="outline"
                            className="font-mono text-[9px] border-yellow-500/40 text-yellow-400"
                          >
                            LAD
                          </Badge>
                        )}
                        {isUnmatched && (
                          <Badge
                            variant="outline"
                            className="font-mono text-[9px] border-muted-foreground/40 text-muted-foreground"
                          >
                            unassigned
                          </Badge>
                        )}
                        {noFix ? (
                          <Badge
                            variant="outline"
                            className="font-mono text-[9px] border-red-500/40 text-red-400"
                          >
                            {isLad ? "manual fix" : "no fix"}
                          </Badge>
                        ) : p.accepted ? (
                          <Badge
                            variant="outline"
                            className="font-mono text-[9px] border-green-500/40 text-green-400"
                          >
                            accepted
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="font-mono text-[9px]"
                          >
                            pending
                          </Badge>
                        )}
                        {isSaved && (
                          <Badge
                            variant="outline"
                            className="font-mono text-[9px] border-blue-500/40 text-blue-400"
                          >
                            saved
                          </Badge>
                        )}
                      </div>
                    </button>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="border-t border-border/30 px-3 py-2 space-y-2">
                        {/* Errors for this artifact */}
                        <div className="space-y-0.5">
                          {p.errors.map((err, i) => (
                            <div
                              key={i}
                              className="flex items-start gap-1.5 text-[11px] text-red-400 font-mono"
                            >
                              <span className="text-red-500/50">*</span>
                              <span className="break-all">{err}</span>
                            </div>
                          ))}
                        </div>

                        {/* AI explanation */}
                        {p.explanation && (
                          <div className="rounded bg-muted/20 px-2 py-1.5 text-[11px] text-muted-foreground">
                            {p.explanation}
                          </div>
                        )}

                        {/* Code editor with proposed fix */}
                        {!noFix && (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {diffViewId === p.artifactId ? "Original → Proposed" : "Proposed Fix"}
                              </span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDiffViewId(diffViewId === p.artifactId ? null : p.artifactId)
                                  }
                                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                                    diffViewId === p.artifactId
                                      ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                                      : "text-muted-foreground hover:text-foreground border border-transparent"
                                  }`}
                                >
                                  {diffViewId === p.artifactId ? (
                                    <><Code2 className="h-3 w-3" /> Code</>
                                  ) : (
                                    <><GitCompareArrows className="h-3 w-3" /> Diff</>
                                  )}
                                </button>
                                {diffViewId !== p.artifactId && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditingId(isEditing ? null : p.artifactId)
                                    }
                                    className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                                      isEditing
                                        ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                                        : "text-muted-foreground hover:text-foreground border border-transparent"
                                    }`}
                                  >
                                    {isEditing ? (
                                      <><Eye className="h-3 w-3" /> View</>
                                    ) : (
                                      <><Edit className="h-3 w-3" /> Edit</>
                                    )}
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="h-[250px] rounded border border-border/40 overflow-hidden">
                              {diffViewId === p.artifactId ? (
                                <DiffView original={p.originalCode} modified={p.proposedCode} />
                              ) : (
                                <Editor
                                  height="100%"
                                  language="pascal"
                                  theme="vs-dark"
                                  value={p.proposedCode}
                                  onChange={(v) => {
                                    if (v !== undefined)
                                      onUpdateProposal(p.artifactId, v);
                                  }}
                                  options={{
                                    readOnly: !isEditing,
                                    minimap: { enabled: false },
                                    lineNumbers: "on",
                                    fontSize: 12,
                                    scrollBeyondLastLine: false,
                                    wordWrap: "on",
                                    renderValidationDecorations: "on",
                                    folding: true,
                                    lineDecorationsWidth: 0,
                                    overviewRulerBorder: false,
                                    padding: { top: 4, bottom: 4 },
                                  }}
                                />
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Recompile result */}
          {recompileSuccess === true && (
            <div className="flex items-center gap-2 rounded border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-400">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              Compile successful after fixes
            </div>
          )}

          {recompileSuccess === false && recompileErrors.length > 0 && (
            <div className="space-y-0.5 rounded border border-red-500/20 bg-red-500/5 p-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-red-400/70">
                Recompile Errors
              </span>
              {recompileErrors.map((e, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-xs text-red-400"
                >
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span className="font-mono break-all">{e}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer actions */}
      <div className="flex items-center gap-2 border-t border-border/40 px-3 py-2">
        {recompileSuccess !== true && (
          <Button
            variant="outline"
            size="sm"
            onClick={onApplyAndRecompile}
            disabled={
              !hasValidFixes || recompiling || proposing
            }
            className="gap-1.5 font-mono text-xs"
          >
            {recompiling ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Wrench className="h-3 w-3" />
            )}
            Apply Fixes & Recompile ({acceptedCount})
          </Button>
        )}

        {recompileSuccess === true && (
          <>
            {proposals.filter((p) => p.accepted && p.proposedCode !== p.originalCode).length > 0 && (
              <div className="flex items-center gap-2">
                {proposals
                  .filter((p) => p.accepted && p.proposedCode !== p.originalCode)
                  .map((p) => (
                    <label
                      key={p.artifactId}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground"
                    >
                      <input
                        type="checkbox"
                        className="h-3 w-3 accent-amber-400"
                        checked={selectedForLibrary.has(p.artifactId)}
                        disabled={savedIds.has(p.artifactId)}
                        onChange={(e) => {
                          setSelectedForLibrary((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) {
                              next.add(p.artifactId);
                            } else {
                              next.delete(p.artifactId);
                            }
                            return next;
                          });
                        }}
                      />
                      <span className="font-mono text-[10px]">
                        {p.artifactName}
                        {savedIds.has(p.artifactId) && (
                          <span className="ml-1 text-green-400">saved</span>
                        )}
                      </span>
                    </label>
                  ))}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSaveToLibrary}
                  disabled={
                    selectedForLibrary.size === 0 ||
                    savingToLibrary ||
                    [...selectedForLibrary].every((id) => savedIds.has(id))
                  }
                  className="gap-1.5 font-mono text-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                >
                  {savingToLibrary ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <BookMarked className="h-3 w-3" />
                  )}
                  Save to Pattern Library
                </Button>
              </div>
            )}
          </>
        )}

        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          className="font-mono text-xs text-muted-foreground"
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}
