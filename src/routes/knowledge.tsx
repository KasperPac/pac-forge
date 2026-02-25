import { useState, useRef, useCallback } from "react";
import {
  Upload,
  FileText,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  Bot,
  Send,
  AlertTriangle,
  Check,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { KnowledgeUpload, KnowledgeDistributionEntry } from "@/types";
import { PLC_BRANDS, CPU_TYPES } from "@/types";

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
    // Delete the upload record since user rejected
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
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Knowledge Base</h1>
        <p className="font-mono text-xs text-muted-foreground">
          Upload documents or teach agents directly. The Project Manager analyzes content and proposes distributions — you review and confirm before anything is saved.
        </p>
      </div>

      {/* Platform & CPU Selection */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Platform &amp; CPU Compatibility
        </h2>
        <div className="mt-3 flex flex-wrap items-start gap-4">
          <div className="space-y-1.5">
            <label className="font-mono text-xs text-muted-foreground">Platform</label>
            <Select value={uploadPlcBrand} onValueChange={setUploadPlcBrand}>
              <SelectTrigger className="w-[180px]">
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
          <div className="space-y-1.5">
            <label className="font-mono text-xs text-muted-foreground">Compatible CPUs</label>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5">
                <Checkbox
                  checked={uploadCpus.includes("ALL")}
                  onCheckedChange={(checked) => {
                    if (checked) setUploadCpus(["ALL"]);
                    else setUploadCpus([]);
                  }}
                />
                <span className="font-mono text-xs">All CPUs</span>
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
            <p className="font-mono text-[10px] text-muted-foreground/60">
              PM will auto-detect per-section CPU compatibility from document content
            </p>
          </div>
        </div>
      </Card>

      {/* Upload + Teach side by side */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Document Upload */}
        <Card className="p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Upload Document
          </h2>
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => !isProcessing && fileInputRef.current?.click()}
            className="mt-3 cursor-pointer rounded-md border-2 border-dashed border-muted-foreground/25 px-4 py-8 text-center transition-colors hover:border-muted-foreground/50 hover:bg-accent/30"
          >
            {isProcessing && !pendingReview ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <div className="font-mono text-sm text-muted-foreground">
                  {progressMsg ?? "Processing..."}
                </div>
              </div>
            ) : (
              <>
                <Upload className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
                <div className="font-mono text-sm text-muted-foreground">
                  Drop files here or click to browse
                </div>
                <div className="mt-1 font-mono text-xs text-muted-foreground/60">
                  .md, .txt, .docx, .scl, .pdf
                </div>
              </>
            )}
          </div>
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
        </Card>

        {/* Manual Teach */}
        <Card className="flex flex-col p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Teach Agents
          </h2>
          <Textarea
            value={teachText}
            onChange={(e) => setTeachText(e.target.value)}
            placeholder="Type knowledge for the agents to learn. For example: 'All conveyor FBs must include a ZPA interlock region with upstream/downstream handshake signals...'"
            className="mt-3 min-h-[120px] flex-1 resize-none font-mono text-xs leading-relaxed"
            disabled={isProcessing}
          />
          <Button
            className="mt-3 gap-1.5 self-end"
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

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Pending Review — user must confirm/reject each proposal */}
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

      {/* Final Distribution Summary (after confirmation) */}
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
                  <p className="mt-1 pl-6 font-mono text-xs leading-relaxed text-muted-foreground">
                    {entry.reasoning}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Separator />

      {/* Upload History */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Upload History
        </h2>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !uploads || uploads.length === 0 ? (
          <div className="mt-3 rounded-md border border-dashed px-4 py-8 text-center font-mono text-sm text-muted-foreground">
            No documents uploaded yet.
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {uploads.map((upload) => (
              <UploadRow
                key={upload.id}
                upload={upload}
                expanded={expandedUploads.has(upload.id)}
                onToggle={() => toggleUpload(upload.id)}
                onDelete={() => deleteUpload.mutate(upload.id)}
                deleting={deleteUpload.isPending}
              />
            ))}
          </div>
        )}
      </div>
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
          <p className="mt-0.5 font-mono text-[10px] italic leading-relaxed text-muted-foreground">
            {item.reasoning}
          </p>
          <button
            type="button"
            className="mt-1 flex items-center gap-1 font-mono text-[10px] text-primary hover:underline"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <ChevronDown className="h-2.5 w-2.5" />
            ) : (
              <ChevronRight className="h-2.5 w-2.5" />
            )}
            {expanded ? "Hide content" : "Preview content"}
          </button>
          {expanded && (
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted/50 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
              {item.content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Upload History Row ----

function UploadRow({
  upload,
  expanded,
  onToggle,
  onDelete,
  deleting,
}: {
  upload: KnowledgeUpload;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const dist = upload.distribution ?? [];

  return (
    <div className="rounded-md border">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onToggle}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {upload.source_filename}
          </div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
            <span>{upload.word_count.toLocaleString()} words</span>
            <span>&middot;</span>
            <span>{upload.file_type.toUpperCase()}</span>
            <span>&middot;</span>
            <span>
              {dist.length} agent{dist.length !== 1 ? "s" : ""}
            </span>
            <span>&middot;</span>
            <span>{new Date(upload.created_at).toLocaleDateString()}</span>
            <Badge variant="secondary" className="px-1 py-0 text-[9px]">
              {upload.plc_brand.replace(/_/g, " ")}
            </Badge>
            {upload.compatible_cpus.length > 0 && !upload.compatible_cpus.includes("ALL") && (
              <Badge variant="outline" className="px-1 py-0 text-[9px]">
                {upload.compatible_cpus.join(", ")}
              </Badge>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          disabled={deleting}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {expanded && dist.length > 0 && (
        <div className="space-y-1.5 border-t px-3 py-2">
          {dist.map((entry, i) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded bg-accent/30 px-2 py-1.5"
            >
              <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">{entry.agent_name}</span>
                  <Badge variant="outline" className="px-1 py-0 text-[9px]">
                    {entry.title}
                  </Badge>
                </div>
                <p className="mt-0.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  {entry.reasoning}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {expanded && dist.length === 0 && (
        <div className="border-t px-3 py-2 text-center font-mono text-xs text-muted-foreground">
          No distributions recorded
        </div>
      )}
    </div>
  );
}
