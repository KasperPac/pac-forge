import { useState, useRef, useCallback } from "react";
import {
  GraduationCap,
  Upload,
  FileText,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  Bot,
  Send,
  AlertCircle,
  Check,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  useKnowledgeUploads,
  useDeleteKnowledgeUpload,
  useAnalyzeKnowledge,
  useConfirmDistribution,
  useCancelUpload,
} from "@/hooks/use-knowledge-distribute";
import type {
  ProposedDistribution,
  AnalyzeResult,
} from "@/hooks/use-knowledge-distribute";
import { readFileAsText, getFileType, countWords } from "@/lib/document-reader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { KnowledgeDistributionEntry } from "@/types";
import { PLC_BRANDS, CPU_TYPES } from "@/types";
import { cn } from "@/lib/utils";

const ACCEPTED_EXTENSIONS = ".md,.txt,.docx,.scl,.pdf";
const CPU_TYPE_KEYS = Object.keys(CPU_TYPES) as (keyof typeof CPU_TYPES)[];

export default function KnowledgePage() {
  const { data: uploads, isLoading } = useKnowledgeUploads();
  const deleteUpload = useDeleteKnowledgeUpload();
  const analyze = useAnalyzeKnowledge();
  const confirm = useConfirmDistribution();
  const cancel = useCancelUpload();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pending review state — proposals from PM awaiting user confirmation
  const [pendingReview, setPendingReview] = useState<AnalyzeResult | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [sourceFilename, setSourceFilename] = useState("");
  const [sourceFileType, setSourceFileType] = useState("");

  // Final result after confirmation
  const [lastResult, setLastResult] = useState<{
    entries: KnowledgeDistributionEntry[];
    sourceFilename: string;
  } | null>(null);

  // Platform / CPU selection
  const [uploadPlcBrand, setUploadPlcBrand] = useState<string>("SIEMENS_TIA");
  const [uploadCpus, setUploadCpus] = useState<string[]>(["ALL"]);

  // Manual teach
  const [teachText, setTeachText] = useState("");

  // Expanded uploads in history
  const [expandedUploads, setExpandedUploads] = useState<Set<string>>(new Set());

  // ---- Analyze (step 1) ----

  const handleAnalyze = useCallback(
    async (content: string, filename: string, fileType: string) => {
      setError(null);
      setLastResult(null);
      setPendingReview(null);
      setProcessing(true);
      setProgressMsg("Starting...");

      try {
        const result = await analyze.mutateAsync({
          content,
          sourceFilename: filename,
          fileType,
          wordCount: countWords(content),
          plcBrand: uploadPlcBrand,
          compatibleCpus: uploadCpus,
          onProgress: setProgressMsg,
        });

        if (result.proposals.length === 0) {
          setLastResult({ entries: [], sourceFilename: filename });
        } else {
          setPendingReview(result);
          setSelectedKeys(new Set(result.proposals.map((p) => p.key)));
          setSourceFilename(filename);
          setSourceFileType(fileType);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Analysis failed");
      } finally {
        setProcessing(false);
        setProgressMsg(null);
      }
    },
    [analyze, uploadPlcBrand, uploadCpus],
  );

  const handleFileUpload = useCallback(
    async (file: File) => {
      if (fileInputRef.current) fileInputRef.current.value = "";
      try {
        const content = await readFileAsText(file);
        if (!content.trim()) {
          setError("The document appears to be empty.");
          return;
        }
        await handleAnalyze(content, file.name, getFileType(file.name));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to read file");
      }
    },
    [handleAnalyze],
  );

  const handleTeach = useCallback(async () => {
    if (!teachText.trim()) return;
    const text = teachText;
    setTeachText("");
    await handleAnalyze(text, "Manual Teaching", "text");
  }, [teachText, handleAnalyze]);

  // ---- Confirm (step 2) ----

  const handleConfirm = useCallback(async () => {
    if (!pendingReview) return;
    setProcessing(true);
    setError(null);

    const confirmed = pendingReview.proposals.filter((p) => selectedKeys.has(p.key));

    try {
      const result = await confirm.mutateAsync({
        uploadId: pendingReview.uploadId,
        sourceFilename,
        fileType: sourceFileType,
        plcBrand: uploadPlcBrand,
        confirmed,
      });
      setLastResult({ entries: result.entries, sourceFilename });
      setPendingReview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save knowledge");
    } finally {
      setProcessing(false);
    }
  }, [pendingReview, selectedKeys, sourceFilename, sourceFileType, uploadPlcBrand, confirm]);

  const handleCancelReview = useCallback(async () => {
    if (!pendingReview) return;
    try {
      await cancel.mutateAsync(pendingReview.uploadId);
    } catch {
      // Best effort — upload without docs is harmless
    }
    setPendingReview(null);
    setSelectedKeys(new Set());
  }, [pendingReview, cancel]);

  function toggleKey(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAgent(agentId: string, proposals: ProposedDistribution[]) {
    const agentKeys = proposals.filter((p) => p.agent_id === agentId).map((p) => p.key);
    const allSelected = agentKeys.every((k) => selectedKeys.has(k));

    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const k of agentKeys) {
        if (allSelected) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  }

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFileUpload(file);
    },
    [handleFileUpload],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const toggleUpload = useCallback((id: string) => {
    setExpandedUploads((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const isProcessing = processing;

  return (
    <div className="space-y-4">
      {/* Header — matches Reference Library layout */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-muted-foreground">CONFIGURATION</div>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <GraduationCap className="h-5 w-5" />
            Knowledge Base
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload documents or teach agents directly. The Project Manager
            analyzes content and proposes role-appropriate distributions
            &mdash; you review and confirm before anything is saved.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-4 gap-1.5"
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing}
        >
          {isProcessing && !pendingReview ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Upload Document
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileUpload(f);
          }}
        />
      </div>

      <Separator />

      {/* Guidance + Teach side by side */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-primary/20 bg-primary/5 px-4 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-primary">
            What belongs here
          </h3>
          <ul className="mt-1.5 space-y-1 font-mono text-xs text-muted-foreground">
            <li>Project-specific operational rules and guidelines</li>
            <li>Naming conventions and coding standards overrides</li>
            <li>Client-specific requirements and preferences</li>
            <li>Workflow instructions for specific agent roles</li>
          </ul>
          <p className="mt-2 font-mono text-[10px] text-muted-foreground/70">
            For Siemens manuals, SCL function references, and PLC model specs,
            use the{" "}
            <a href="/reference-library" className="text-primary hover:underline">
              Reference Library
            </a>
            {" "}&mdash; agents look those up automatically.
          </p>
        </Card>

        {/* Manual Teach */}
        <Card className="flex flex-col px-4 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Teach Agents
          </h3>
          <Textarea
            value={teachText}
            onChange={(e) => setTeachText(e.target.value)}
            placeholder="Type knowledge for the agents to learn..."
            className="mt-2 min-h-[80px] flex-1 resize-none font-mono text-xs leading-relaxed"
            disabled={isProcessing}
          />
          <Button
            className="mt-2 gap-1.5 self-end"
            size="sm"
            onClick={handleTeach}
            disabled={!teachText.trim() || isProcessing}
          >
            {isProcessing && !pendingReview ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Teach
          </Button>
        </Card>
      </div>

      {/* Platform & CPU Selection — compact */}
      <Card className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="font-mono text-xs text-muted-foreground">Platform</label>
            <Select value={uploadPlcBrand} onValueChange={setUploadPlcBrand}>
              <SelectTrigger className="h-7 w-[160px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PLC_BRANDS).map(([key, val]) => (
                  <SelectItem key={key} value={val}>
                    {val.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Separator orientation="vertical" className="h-5" />
          <div className="flex items-center gap-2">
            <label className="font-mono text-xs text-muted-foreground">CPUs</label>
            <label className="flex items-center gap-1.5">
              <Checkbox
                checked={uploadCpus.includes("ALL")}
                onCheckedChange={(checked) => {
                  if (checked) setUploadCpus(["ALL"]);
                  else setUploadCpus([]);
                }}
              />
              <span className="font-mono text-xs">All</span>
            </label>
            {CPU_TYPE_KEYS.map((cpu) => (
              <label key={cpu} className="flex items-center gap-1.5">
                <Checkbox
                  checked={uploadCpus.includes("ALL") || uploadCpus.includes(cpu)}
                  disabled={uploadCpus.includes("ALL")}
                  onCheckedChange={(checked) => {
                    setUploadCpus((prev) => {
                      const without = prev.filter((c) => c !== cpu && c !== "ALL");
                      if (checked) {
                        const next = [...without, cpu];
                        if (next.length === CPU_TYPE_KEYS.length) return ["ALL"];
                        return next;
                      }
                      return without;
                    });
                  }}
                />
                <span className="font-mono text-xs">{cpu}</span>
              </label>
            ))}
          </div>
        </div>
      </Card>

      {/* Upload error */}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Processing indicator */}
      {isProcessing && !pendingReview && (
        <Card className="flex items-center gap-3 px-4 py-3">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {progressMsg ?? "Processing..."}
          </span>
        </Card>
      )}

      {/* Pending Review */}
      {pendingReview && (
        <ProposalReview
          proposals={pendingReview.proposals}
          selectedKeys={selectedKeys}
          sourceFilename={sourceFilename}
          onToggleKey={toggleKey}
          onToggleAgent={toggleAgent}
          onConfirm={handleConfirm}
          onCancel={handleCancelReview}
          confirming={confirm.isPending}
        />
      )}

      {/* Distribution Complete */}
      {lastResult && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Distribution Complete
          </h2>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            Source: {lastResult.sourceFilename}
          </p>

          {lastResult.entries.length === 0 ? (
            <div className="mt-3 rounded-md border border-dashed px-4 py-3 text-center font-mono text-xs text-muted-foreground">
              PM found no relevant content for any agent in this document.
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {lastResult.entries.map((entry, i) => (
                <div key={i} className="rounded-md border px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 shrink-0 text-primary" />
                    <span className="text-sm font-medium">{entry.agent_name}</span>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {entry.title}
                    </Badge>
                  </div>
                  {entry.content_preview && (
                    <p className="mt-1 pl-6 line-clamp-3 font-mono text-xs leading-relaxed text-foreground/80">
                      {entry.content_preview}
                    </p>
                  )}
                  <p className="mt-0.5 pl-6 font-mono text-[10px] italic text-muted-foreground/60">
                    PM: {entry.reasoning}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Document list */}
      {isLoading && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Loading uploads...
        </div>
      )}

      {uploads && uploads.length === 0 && !isLoading && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => fileInputRef.current?.click()}
          className="cursor-pointer rounded-md border-2 border-dashed border-muted-foreground/25 px-4 py-12 text-center transition-colors hover:border-muted-foreground/50 hover:bg-accent/30"
        >
          <Upload className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
          <div className="text-sm text-muted-foreground">
            Drop documents here or click to browse
          </div>
          <div className="mt-1 font-mono text-xs text-muted-foreground/60">
            Supports .md, .txt, .docx, .scl, .pdf
          </div>
          <div className="mt-3 text-xs text-muted-foreground/60">
            Documents are analyzed by the Project Manager and distributed
            to the appropriate specialist agents.
          </div>
        </div>
      )}

      {uploads && uploads.length > 0 && (
        <ScrollArea className="h-[calc(100vh-14rem)]">
          <div className="space-y-3 pr-3">
            {uploads.map((upload) => {
              const expanded = expandedUploads.has(upload.id);
              const dist = upload.distribution ?? [];

              return (
                <Card key={upload.id} className="overflow-hidden">
                  {/* Upload header */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <button
                      type="button"
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      onClick={() => toggleUpload(upload.id)}
                    >
                      {expanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {upload.source_filename}
                        </span>
                        <Badge
                          variant="outline"
                          className="shrink-0 px-1.5 py-0 font-mono text-[9px]"
                        >
                          {upload.file_type.toUpperCase()}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                        <span>
                          {dist.length} agent{dist.length !== 1 ? "s" : ""}
                        </span>
                        <span>&middot;</span>
                        <span>{upload.word_count.toLocaleString()} words</span>
                        <span>&middot;</span>
                        <span>{new Date(upload.created_at).toLocaleDateString()}</span>
                        {upload.plc_brand && (
                          <>
                            <span>&middot;</span>
                            <span>{upload.plc_brand.replace(/_/g, " ")}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Delete knowledge upload?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently remove &ldquo;
                            {upload.source_filename}&rdquo; and all{" "}
                            {dist.length} distributed documents. This action
                            cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteUpload.mutate(upload.id)}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>

                  {/* Expanded: distribution entries */}
                  {expanded && dist.length > 0 && (
                    <div className="space-y-0.5 border-t px-3 pb-3 pt-2">
                      {dist.map((entry, i) => (
                        <DistributionEntry key={i} entry={entry} />
                      ))}
                    </div>
                  )}

                  {expanded && dist.length === 0 && (
                    <div className="border-t px-3 py-3 text-center font-mono text-xs text-muted-foreground">
                      No distributions recorded
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          {/* Additional drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            className={cn(
              "mt-3 rounded-md border border-dashed border-muted-foreground/20 px-3 py-2",
              "text-center font-mono text-xs text-muted-foreground/50",
              "transition-colors hover:border-muted-foreground/40",
            )}
          >
            Drop more files here to add to knowledge base
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

// ---- Distribution Entry (inside expanded upload card) ----

function DistributionEntry({ entry }: { entry: KnowledgeDistributionEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded border">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent/30"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <Bot className="h-3 w-3 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {entry.agent_name}: {entry.title}
        </span>
      </button>
      {expanded && (
        <div className="border-t px-3 py-2">
          {entry.content_preview && (
            <div className="max-h-40 overflow-y-auto rounded bg-muted/50 p-2">
              <pre className="whitespace-pre-wrap font-mono text-[10px] leading-relaxed">
                {entry.content_preview}
              </pre>
            </div>
          )}
          <p className="mt-1.5 font-mono text-[10px] italic text-muted-foreground/60">
            PM: {entry.reasoning}
          </p>
        </div>
      )}
    </div>
  );
}

// ---- Proposal Review Card ----

function ProposalReview({
  proposals,
  selectedKeys,
  sourceFilename,
  onToggleKey,
  onToggleAgent,
  onConfirm,
  onCancel,
  confirming,
}: {
  proposals: ProposedDistribution[];
  selectedKeys: Set<string>;
  sourceFilename: string;
  onToggleKey: (key: string) => void;
  onToggleAgent: (agentId: string, proposals: ProposedDistribution[]) => void;
  onConfirm: () => void;
  onCancel: () => void;
  confirming: boolean;
}) {
  // Group proposals by agent
  const byAgent = new Map<string, { agentName: string; items: ProposedDistribution[] }>();
  for (const p of proposals) {
    const group = byAgent.get(p.agent_id) ?? { agentName: p.agent_name, items: [] };
    group.items.push(p);
    byAgent.set(p.agent_id, group);
  }

  const selectedCount = proposals.filter((p) => selectedKeys.has(p.key)).length;

  return (
    <Card className="overflow-hidden border-primary/30">
      <div className="flex items-center justify-between border-b bg-accent/30 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Review Proposed Knowledge</h2>
          <p className="font-mono text-xs text-muted-foreground">
            Source: {sourceFilename} &middot; {selectedCount}/{proposals.length} selected
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 font-mono text-xs"
            onClick={onCancel}
            disabled={confirming}
          >
            <X className="h-3.5 w-3.5" />
            Discard All
          </Button>
          <Button
            size="sm"
            className="gap-1 font-mono text-xs"
            onClick={onConfirm}
            disabled={selectedCount === 0 || confirming}
          >
            {confirming ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Confirm {selectedCount} Item{selectedCount !== 1 ? "s" : ""}
          </Button>
        </div>
      </div>

      <div className="divide-y">
        {Array.from(byAgent.entries()).map(([agentId, { agentName, items }]) => {
          const agentSelected = items.filter((p) => selectedKeys.has(p.key)).length;
          const allSelected = agentSelected === items.length;

          return (
            <div key={agentId} className="px-4 py-3">
              {/* Agent header with toggle-all */}
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={() => onToggleAgent(agentId, proposals)}
                />
                <Bot className="h-4 w-4 shrink-0 text-primary" />
                <span className="text-sm font-semibold">{agentName}</span>
                <Badge variant="outline" className="font-mono text-xs">
                  {agentSelected}/{items.length}
                </Badge>
              </div>

              {/* Individual items */}
              <div className="mt-2 space-y-1.5 pl-9">
                {items.map((item) => (
                  <ProposalItem
                    key={item.key}
                    item={item}
                    selected={selectedKeys.has(item.key)}
                    onToggle={() => onToggleKey(item.key)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ProposalItem({
  item,
  selected,
  onToggle,
}: {
  item: ProposedDistribution;
  selected: boolean;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const wordCount = item.content.split(/\s+/).filter(Boolean).length;

  return (
    <div className={`rounded-md border px-3 py-2 transition-opacity ${selected ? "" : "opacity-40"}`}>
      <div className="flex items-start gap-2">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium">{item.title}</span>
            <Badge variant="outline" className="px-1 py-0 text-[9px]">
              {wordCount} words
            </Badge>
            {item.compatible_cpus.length > 0 && !item.compatible_cpus.includes("ALL") && (
              <Badge variant="secondary" className="px-1 py-0 text-[9px]">
                {item.compatible_cpus.join(", ")}
              </Badge>
            )}
          </div>
          {/* Content always visible */}
          {!expanded ? (
            <p
              className="mt-1 cursor-pointer line-clamp-3 font-mono text-[10px] leading-relaxed text-foreground/80"
              onClick={() => setExpanded(true)}
            >
              {item.content}
            </p>
          ) : (
            <pre
              className="mt-1 max-h-40 cursor-pointer overflow-auto rounded bg-muted/50 px-2 py-1.5 font-mono text-[10px] leading-relaxed"
              onClick={() => setExpanded(false)}
            >
              {item.content}
            </pre>
          )}
          <div className="mt-1 font-mono text-[10px] text-muted-foreground/60">
            <span className="italic">PM: {item.reasoning}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
