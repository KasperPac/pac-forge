import { useState, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  Import,
  Loader2,
  CheckCircle2,
  Plus,
  Minus,
  ClipboardPaste,
  GraduationCap,
  Brain,
  Regex,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useExportFromTia } from "@/hooks/use-export-from-tia";
import { useCreateApprovedPattern } from "@/hooks/use-patterns";
import { usePatternLibrarianAnalysis } from "@/hooks/use-pattern-librarian-analysis";
import { computeDiff, hasFunctionalChanges } from "@/lib/diff-engine";
import { CORRECTION_TYPES } from "@/types";
import type { DiffResult } from "@/lib/diff-engine";
import type { AgentKnowledgeDoc, PatternCandidate } from "@/types";

interface TiaManualFixPanelProps {
  originalSources: Record<string, string>;
  currentSources: Record<string, string>;
  isConnected: boolean;
  onLearningsSaved?: () => void;
  patternLibrarianKnowledgeDocs?: AgentKnowledgeDoc[];
  approvedPatterns?: PatternCandidate[];
}

interface BlockDiff {
  blockName: string;
  diff: DiffResult;
}

interface CorrectionEntry {
  blockName: string;
  correctionType: string;
  explanation: string;
  originalSnippet: string;
  correctedSnippet: string;
  checked: boolean;
  aiAnalyzed: boolean;
}

type PanelState = "idle" | "loading" | "analyzing" | "review" | "saving" | "done";

export function TiaManualFixPanel({
  originalSources,
  currentSources,
  isConnected,
  onLearningsSaved,
  patternLibrarianKnowledgeDocs,
  approvedPatterns,
}: TiaManualFixPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [panelState, setPanelState] = useState<PanelState>("idle");
  const [showPaste, setShowPaste] = useState(false);
  const [pastedSources, setPastedSources] = useState<Record<string, string>>({});
  const [blockDiffs, setBlockDiffs] = useState<BlockDiff[]>([]);
  const [corrections, setCorrections] = useState<CorrectionEntry[]>([]);
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());
  const [savedCount, setSavedCount] = useState(0);
  const [aiAnalyzed, setAiAnalyzed] = useState(false);

  const exportMutation = useExportFromTia();
  const createPattern = useCreateApprovedPattern();
  const librarianAnalysis = usePatternLibrarianAnalysis();

  // Track the exported sources so we can pass them to AI analysis
  const [pendingExportedSources, setPendingExportedSources] = useState<Record<string, string> | null>(null);

  // Initialize paste sources from current sources
  useEffect(() => {
    if (showPaste && Object.keys(pastedSources).length === 0) {
      setPastedSources({ ...currentSources });
    }
  }, [showPaste, currentSources, pastedSources]);

  function computeBlockDiffs(exportedSources: Record<string, string>): BlockDiff[] {
    const diffs: BlockDiff[] = [];
    for (const blockName of Object.keys(exportedSources)) {
      const original = originalSources[blockName];
      const exported = exportedSources[blockName];
      if (!original || !exported || original === exported) continue;

      // Skip blocks with only whitespace/indentation changes (e.g. TIA reformatting)
      if (!hasFunctionalChanges(original, exported)) continue;

      const diff = computeDiff(original, exported);
      if (!diff.hasChanges) continue;
      diffs.push({ blockName, diff });
    }
    return diffs;
  }

  function runAiAnalysis(exportedSources: Record<string, string>, diffs: BlockDiff[]) {
    if (diffs.length === 0) {
      setBlockDiffs([]);
      setPanelState("idle");
      return;
    }

    setBlockDiffs(diffs);
    setExpandedBlocks(new Set([diffs[0].blockName]));
    setPanelState("analyzing");

    librarianAnalysis.mutate(
      {
        originalSources,
        correctedSources: exportedSources,
        knowledgeDocs: patternLibrarianKnowledgeDocs,
        approvedPatterns,
      },
      {
        onSuccess: (result) => {
          setAiAnalyzed(result.aiAnalyzed);
          const entries: CorrectionEntry[] = result.corrections.map((c) => ({
            blockName: c.blockName,
            correctionType: c.correctionType,
            explanation: c.explanation,
            originalSnippet: c.originalSnippet,
            correctedSnippet: c.correctedSnippet,
            checked: true,
            aiAnalyzed: result.aiAnalyzed,
          }));
          setCorrections(entries);
          setPanelState("review");
        },
        onError: () => {
          // Should not happen (hook has internal fallback), but handle anyway
          setPanelState("idle");
        },
      }
    );
  }

  function handlePullFromTia() {
    setPanelState("loading");
    exportMutation.mutate(undefined, {
      onSuccess: (data) => {
        const diffs = computeBlockDiffs(data.sources);
        setPendingExportedSources(data.sources);
        runAiAnalysis(data.sources, diffs);
      },
      onError: () => {
        setPanelState("idle");
      },
    });
  }

  function handleCompareFromPaste() {
    const diffs = computeBlockDiffs(pastedSources);
    setPendingExportedSources(pastedSources);
    runAiAnalysis(pastedSources, diffs);
  }

  // Keep pendingExportedSources for potential re-analysis
  void pendingExportedSources;

  function toggleBlock(blockName: string) {
    setExpandedBlocks((prev) => {
      const next = new Set(prev);
      if (next.has(blockName)) next.delete(blockName);
      else next.add(blockName);
      return next;
    });
  }

  function toggleCorrection(index: number) {
    setCorrections((prev) =>
      prev.map((c, i) => (i === index ? { ...c, checked: !c.checked } : c))
    );
  }

  function updateCorrection(index: number, field: "explanation" | "correctionType", value: string) {
    setCorrections((prev) =>
      prev.map((c, i) => (i === index ? { ...c, [field]: value } : c))
    );
  }

  async function handleSave() {
    const toSave = corrections.filter((c) => c.checked);
    if (toSave.length === 0) return;

    setPanelState("saving");
    let saved = 0;

    for (const entry of toSave) {
      try {
        await createPattern.mutateAsync({
          plc_brand: "SIEMENS_TIA",
          device_type: "General",
          context: `tia-manual-fix: ${entry.blockName}`,
          original_snippet: entry.originalSnippet,
          corrected_snippet: entry.correctedSnippet,
          correction_type: entry.correctionType,
          explanation_tag: entry.explanation,
        });
        saved++;
      } catch (err) {
        console.error("Failed to save pattern:", err);
      }
    }

    setSavedCount(saved);
    setPanelState("done");
    onLearningsSaved?.();
  }

  const checkedCount = corrections.filter((c) => c.checked).length;

  return (
    <div className="space-y-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2">
      <button
        className="flex w-full items-center gap-1.5 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-amber-400" />
        ) : (
          <ChevronRight className="h-3 w-3 text-amber-400" />
        )}
        <Import className="h-3 w-3 text-amber-400" />
        <span className="font-mono text-xs font-medium text-amber-400">
          Fixed it in TIA Portal?
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          Pull your fixes back and teach the AI
        </span>
      </button>

      {expanded && (
        <div className="space-y-2 pt-1">
          {/* Idle: import options */}
          {panelState === "idle" && (
            <div className="space-y-2">
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  className="h-6 gap-1 px-3 font-mono text-xs"
                  onClick={handlePullFromTia}
                  disabled={!isConnected || exportMutation.isPending}
                >
                  <Import className="h-2.5 w-2.5" />
                  Pull from TIA
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 gap-1 px-2 font-mono text-xs text-muted-foreground"
                  onClick={() => setShowPaste(!showPaste)}
                >
                  <ClipboardPaste className="h-2.5 w-2.5" />
                  {showPaste ? "Hide paste" : "Or paste code"}
                </Button>
              </div>

              {!isConnected && (
                <div className="font-mono text-xs text-muted-foreground">
                  Bridge not connected. Use paste to compare manually.
                </div>
              )}

              {exportMutation.isError && (
                <div className="font-mono text-xs text-red-400">
                  Export failed: {exportMutation.error?.message}
                </div>
              )}

              {/* No diffs found message */}
              {blockDiffs.length === 0 && panelState === "idle" && exportMutation.isSuccess && (
                <div className="font-mono text-xs text-muted-foreground">
                  No differences detected between original and current TIA sources. Make sure you've saved your changes in TIA Portal.
                </div>
              )}

              {/* Paste fallback */}
              {showPaste && (
                <div className="space-y-2">
                  {Object.keys(currentSources).map((name) => (
                    <div key={name} className="space-y-0.5">
                      <label className="font-mono text-xs text-muted-foreground">
                        {name}
                      </label>
                      <Textarea
                        value={pastedSources[name] ?? currentSources[name] ?? ""}
                        onChange={(e) =>
                          setPastedSources((prev) => ({ ...prev, [name]: e.target.value }))
                        }
                        className="min-h-[80px] resize-y font-mono text-xs"
                        rows={4}
                      />
                    </div>
                  ))}
                  <Button
                    size="sm"
                    className="h-6 gap-1 px-3 font-mono text-xs"
                    onClick={handleCompareFromPaste}
                  >
                    Compare
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Loading */}
          {panelState === "loading" && (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="h-3 w-3 animate-spin text-amber-400" />
              <span className="font-mono text-xs text-muted-foreground">
                Exporting sources from TIA Portal...
              </span>
            </div>
          )}

          {/* Analyzing — Pattern Librarian AI working */}
          {panelState === "analyzing" && (
            <div className="flex items-center gap-2 py-2">
              <Brain className="h-3 w-3 animate-pulse text-violet-400" />
              <span className="font-mono text-xs text-muted-foreground">
                Pattern Librarian is analyzing your corrections...
              </span>
            </div>
          )}

          {/* Review: diffs + correction entries */}
          {panelState === "review" && (
            <div className="space-y-3">
              {/* Analysis source indicator */}
              <div className="flex items-center gap-1.5">
                {aiAnalyzed ? (
                  <Badge variant="outline" className="gap-1 px-1.5 py-0 font-mono text-xs text-violet-400 border-violet-500/30">
                    <Brain className="h-2.5 w-2.5" />
                    AI Analyzed
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 px-1.5 py-0 font-mono text-xs text-muted-foreground">
                    <Regex className="h-2.5 w-2.5" />
                    Regex Fallback
                  </Badge>
                )}
                <span className="font-mono text-xs text-muted-foreground">
                  {blockDiffs.length} block{blockDiffs.length !== 1 ? "s" : ""} changed
                </span>
              </div>

              {/* Diff summary per block */}
              <div className="space-y-1.5">
                {blockDiffs.map((bd) => (
                  <div key={bd.blockName} className="rounded border border-border/50 bg-muted/20">
                    <button
                      className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-muted/30"
                      onClick={() => toggleBlock(bd.blockName)}
                    >
                      {expandedBlocks.has(bd.blockName) ? (
                        <ChevronDown className="h-2.5 w-2.5" />
                      ) : (
                        <ChevronRight className="h-2.5 w-2.5" />
                      )}
                      <span className="font-mono text-xs font-medium">{bd.blockName}</span>
                      <div className="ml-auto flex items-center gap-1.5">
                        <Badge variant="outline" className="px-1 py-0 font-mono text-xs text-green-400">
                          +{bd.diff.addedCount}
                        </Badge>
                        <Badge variant="outline" className="px-1 py-0 font-mono text-xs text-red-400">
                          -{bd.diff.removedCount}
                        </Badge>
                      </div>
                    </button>
                    {expandedBlocks.has(bd.blockName) && (
                      <ScrollArea className="max-h-56 border-t">
                        <div className="p-1.5">
                          {bd.diff.hunks.map((hunk, hi) => (
                            <div key={hi}>
                              {hunk.lines.map((line, li) => (
                                <div
                                  key={`${hi}-${li}`}
                                  className={`flex items-start gap-1 px-1 font-mono text-xs leading-5 ${
                                    hunk.type === "added"
                                      ? "bg-green-500/10 text-green-400"
                                      : hunk.type === "removed"
                                        ? "bg-red-500/10 text-red-400"
                                        : "text-muted-foreground"
                                  }`}
                                >
                                  {hunk.type === "added" ? (
                                    <Plus className="mt-1 h-2.5 w-2.5 shrink-0 opacity-50" />
                                  ) : hunk.type === "removed" ? (
                                    <Minus className="mt-1 h-2.5 w-2.5 shrink-0 opacity-50" />
                                  ) : (
                                    <span className="mt-1 inline-block h-2.5 w-2.5 shrink-0" />
                                  )}
                                  <span className="whitespace-pre-wrap break-all">{line}</span>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </div>
                ))}
              </div>

              {/* Correction entries for saving */}
              <div className="space-y-1.5">
                <div className="font-mono text-xs text-muted-foreground">
                  LEARNINGS TO SAVE ({checkedCount} of {corrections.length})
                </div>
                {corrections.map((entry, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2 rounded border border-border/50 bg-muted/20 p-2"
                  >
                    <Checkbox
                      checked={entry.checked}
                      onCheckedChange={() => toggleCorrection(idx)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="px-1 py-0 font-mono text-xs">
                          {entry.blockName}
                        </Badge>
                        <Select
                          value={entry.correctionType}
                          onValueChange={(v) => updateCorrection(idx, "correctionType", v)}
                        >
                          <SelectTrigger className="h-5 w-32 font-mono text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.keys(CORRECTION_TYPES).map((type) => (
                              <SelectItem key={type} value={type} className="font-mono text-xs">
                                {type}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Textarea
                        value={entry.explanation}
                        onChange={(e) => updateCorrection(idx, "explanation", e.target.value)}
                        placeholder="What was wrong and what did you fix?"
                        className="min-h-[32px] resize-none font-mono text-xs"
                        rows={2}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Save button */}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="h-6 gap-1 px-3 font-mono text-xs"
                  onClick={handleSave}
                  disabled={checkedCount === 0}
                >
                  <GraduationCap className="h-2.5 w-2.5" />
                  Save {checkedCount} Learning{checkedCount !== 1 ? "s" : ""}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 font-mono text-xs text-muted-foreground"
                  onClick={() => {
                    setPanelState("idle");
                    setBlockDiffs([]);
                    setCorrections([]);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Saving */}
          {panelState === "saving" && (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="h-3 w-3 animate-spin text-amber-400" />
              <span className="font-mono text-xs text-muted-foreground">
                Saving correction patterns...
              </span>
            </div>
          )}

          {/* Done */}
          {panelState === "done" && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3 text-green-400" />
                <span className="font-mono text-xs text-green-400">
                  {savedCount} pattern{savedCount !== 1 ? "s" : ""} saved! Will be used in future fix rounds.
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-5 px-2 font-mono text-xs text-muted-foreground"
                onClick={() => {
                  setPanelState("idle");
                  setBlockDiffs([]);
                  setCorrections([]);
                  setSavedCount(0);
                }}
              >
                Done
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
