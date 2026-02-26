import { useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Cpu,
  Power,
  Zap,
  Quote,
  Upload,
  FileText,
  Trash2,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AgentAvatar } from "@/components/agent-avatar";
import {
  getAgentProfile,
  COLOR_CLASSES,
  type ProfileColor,
} from "@/lib/agent-profiles";
import { useAgents } from "@/hooks/use-agents";
import {
  useAgentKnowledgeDocs,
  useCreateAgentKnowledgeDoc,
  useDeleteAgentKnowledgeDoc,
} from "@/hooks/use-agent-knowledge";
import { useActivePromptSections } from "@/hooks/use-prompt-sections";
import { useActivePatterns } from "@/hooks/use-patterns";
import { SECTION_LABELS } from "@/types/prompt-section";
import { readFileAsText, getFileType, countWords } from "@/lib/document-reader";

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  AVAILABLE: { dot: "bg-green-500", label: "Available" },
  RESERVED: { dot: "bg-amber-500", label: "Reserved" },
  OFFLINE: { dot: "bg-neutral-500", label: "Offline" },
  DISABLED: { dot: "bg-neutral-600", label: "Disabled" },
};

const ACCEPTED_EXTENSIONS = ".md,.txt,.docx,.scl,.pdf";
const WORD_COUNT_WARNING = 40_000;

export default function AgentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: agents, isLoading, error } = useAgents();
  const { data: knowledgeDocs } = useAgentKnowledgeDocs(id);
  const createDoc = useCreateAgentKnowledgeDoc();
  const deleteDoc = useDeleteAgentKnowledgeDoc();

  const { data: sharedSections } = useActivePromptSections();
  const { data: activePatterns } = useActivePatterns("SIEMENS_TIA");

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const agent = agents?.find((a) => a.id === id);

  const totalWordCount = knowledgeDocs?.reduce((sum, d) => sum + d.word_count, 0) ?? 0;

  const handleFileUpload = useCallback(
    async (file: File) => {
      if (!id) return;
      setUploadError(null);
      setUploading(true);

      try {
        const content = await readFileAsText(file);
        if (!content.trim()) {
          setUploadError("The document appears to be empty.");
          setUploading(false);
          return;
        }

        const words = countWords(content);
        await createDoc.mutateAsync({
          agent_id: id,
          title: file.name.replace(/\.[^.]+$/, ""),
          content,
          source_filename: file.name,
          file_type: getFileType(file.name),
          word_count: words,
          plc_brand: "SIEMENS_TIA",
          compatible_cpus: ["ALL"],
        });
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : "Failed to upload document"
        );
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [id, createDoc]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFileUpload(file);
    },
    [handleFileUpload]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  if (isLoading) {
    return (
      <div className="py-12 text-center text-base text-muted-foreground">
        Loading agent...
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error ? `Failed to load agent: ${error.message}` : "Agent not found"}
        </div>
        <Button variant="ghost" onClick={() => navigate("/agents")}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Agents
        </Button>
      </div>
    );
  }

  const profile = getAgentProfile(agent.display_name);
  const status = STATUS_STYLES[agent.status] ?? STATUS_STYLES.OFFLINE;
  const colors =
    COLOR_CLASSES[profile.color as ProfileColor] ?? COLOR_CLASSES.neutral;

  return (
    <div className="space-y-6">
      {/* Back */}
      <Button
        variant="ghost"
        className="-ml-2"
        onClick={() => navigate("/agents")}
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        Agents
      </Button>

      {/* Hero section */}
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start sm:gap-8">
        <AgentAvatar
          displayName={agent.display_name}
          size="xl"
          status={agent.status}
        />
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <h1 className="text-3xl font-semibold tracking-tight">
            {agent.display_name}
          </h1>
          <p className="mt-1 text-base text-muted-foreground">
            {profile.tagline}
          </p>

          {/* Catchphrase */}
          <div className="mt-4 flex items-start gap-2">
            <Quote className={`mt-0.5 h-5 w-5 shrink-0 ${colors.text} opacity-60`} />
            <p className={`text-lg italic ${colors.text}`}>
              &ldquo;{profile.catchphrase}&rdquo;
            </p>
          </div>

          {/* Status + specialties */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <div className="flex items-center gap-1.5">
              <div className={`h-2.5 w-2.5 rounded-full ${status.dot}`} />
              <span className="text-sm text-muted-foreground">
                {status.label}
              </span>
            </div>
            {agent.specialties.map((s) => (
              <Badge
                key={s}
                variant="secondary"
                className="px-2 py-0.5 text-xs"
              >
                {s}
              </Badge>
            ))}
            {!agent.is_enabled && (
              <Badge
                variant="outline"
                className="text-xs text-muted-foreground"
              >
                Disabled
              </Badge>
            )}
          </div>
        </div>
      </div>

      <Separator />

      {/* Content grid */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Personality */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Personality
          </h2>
          <p className="mt-3 text-base leading-relaxed">{profile.personality}</p>
        </Card>

        {/* About */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            About
          </h2>
          <p className="mt-3 text-base leading-relaxed">{profile.description}</p>
        </Card>

        {/* Skills */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Skills
          </h2>
          <ul className="mt-3 space-y-2">
            {profile.skills.map((skill) => (
              <li key={skill} className="flex items-start gap-2.5">
                <Zap className={`mt-0.5 h-4 w-4 shrink-0 ${colors.text} opacity-70`} />
                <span className="text-base">{skill}</span>
              </li>
            ))}
          </ul>
        </Card>

        {/* When to Use */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            When to Use
          </h2>
          <ul className="mt-3 space-y-2">
            {profile.whenToUse.map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <span
                  className={`mt-2 h-2 w-2 shrink-0 rounded-full ${colors.text} opacity-50`}
                  style={{ backgroundColor: "currentColor" }}
                />
                <span className="text-base">{item}</span>
              </li>
            ))}
          </ul>
        </Card>

        {/* Why Useful */}
        <Card className="col-span-full p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Why Useful
          </h2>
          <p className="mt-3 text-base leading-relaxed">{profile.whyUseful}</p>
        </Card>
      </div>

      {/* Configuration */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Configuration
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-4">
          <div className="flex items-center gap-3">
            <Cpu className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">
                Max Concurrency
              </div>
              <div className="text-base font-medium">{agent.max_concurrency}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Power className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">
                Enabled
              </div>
              <div className="text-base font-medium">
                {agent.is_enabled ? "Yes" : "No"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className={`h-3.5 w-3.5 rounded-full ${status.dot}`} />
            <div>
              <div className="text-xs text-muted-foreground">
                Status
              </div>
              <div className="text-base font-medium">{status.label}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <CalendarDays className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">
                Created
              </div>
              <div className="text-base font-medium">
                {new Date(agent.created_at).toLocaleDateString()}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* System Prompt */}
      {agent.system_prompt && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            System Prompt
          </h2>
          <div className="mt-3 max-h-72 overflow-y-auto rounded-md bg-muted/50 p-4">
            <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed">
              {agent.system_prompt}
            </pre>
          </div>
        </Card>
      )}

      {/* Learnings & Knowledge */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Learnings
            </h2>
            {knowledgeDocs && knowledgeDocs.length > 0 && (
              <Badge variant="secondary" className="font-mono text-xs">
                {knowledgeDocs.length} doc{knowledgeDocs.length !== 1 ? "s" : ""}
                {" \u00B7 "}
                {totalWordCount.toLocaleString()} words
              </Badge>
            )}
            {totalWordCount > WORD_COUNT_WARNING && (
              <Badge variant="destructive" className="gap-1 text-xs">
                <AlertTriangle className="h-3 w-3" />
                Large KB — may impact prompt size
              </Badge>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
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

        {uploadError && (
          <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
            {uploadError}
          </div>
        )}

        {/* Document list */}
        {knowledgeDocs && knowledgeDocs.length > 0 && (
          <div className="mt-4 space-y-2">
            {knowledgeDocs.map((doc) => {
              const isExpanded = expandedDocs.has(doc.id);

              return (
                <div
                  key={doc.id}
                  className="rounded-md border"
                >
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/30"
                    onClick={() =>
                      setExpandedDocs((prev) => {
                        const next = new Set(prev);
                        if (next.has(doc.id)) next.delete(doc.id);
                        else next.add(doc.id);
                        return next;
                      })
                    }
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{doc.title}</span>
                        <Badge
                          variant="outline"
                          className="shrink-0 px-1.5 py-0 text-[9px]"
                        >
                          {doc.source_upload_id ? "PM Distribution" : "Direct Upload"}
                        </Badge>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteDoc.mutate({ id: doc.id, agentId: agent.id });
                      }}
                      disabled={deleteDoc.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </button>

                  {/* Content — always visible */}
                  <div className="border-t px-3 py-2">
                    {!isExpanded ? (
                      <p className="line-clamp-3 font-mono text-xs leading-relaxed text-foreground/80">
                        {doc.content}
                      </p>
                    ) : (
                      <div className="max-h-48 overflow-y-auto rounded-md bg-muted/50 p-3">
                        <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
                          {doc.content}
                        </pre>
                      </div>
                    )}
                    <div className="mt-1.5 flex items-center gap-2 font-mono text-[10px] text-muted-foreground/60">
                      {doc.source_filename && (
                        <>
                          <span>{doc.source_filename}</span>
                          <span>&middot;</span>
                        </>
                      )}
                      <span>{doc.word_count.toLocaleString()} words</span>
                      <span>&middot;</span>
                      <span>{doc.file_type.toUpperCase()}</span>
                      {doc.distribution_reasoning && (
                        <>
                          <span>&middot;</span>
                          <span className="italic">PM: {doc.distribution_reasoning}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Shared knowledge: prompt sections + correction patterns */}
        {(() => {
          const sharedKeys = ["code_examples", "platform_rules"] as const;
          const activeSections = sharedKeys
            .filter((key) => sharedSections?.[`shared:${key}`])
            .map((key) => ({
              key,
              label: SECTION_LABELS[key] ?? key,
              content: sharedSections![`shared:${key}`],
            }));
          const patternCount = activePatterns?.length ?? 0;

          if (activeSections.length === 0 && patternCount === 0) return null;

          return (
            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-2">
                <Separator className="flex-1" />
                <span className="shrink-0 font-mono text-[10px] uppercase text-muted-foreground/60">
                  Shared across all agents
                </span>
                <Separator className="flex-1" />
              </div>

              {activeSections.map(({ key, label, content }) => {
                const isExpanded = expandedDocs.has(`shared:${key}`);
                const wordCount = content.split(/\s+/).length;
                const snippet =
                  content.length > 200 ? content.slice(0, 200) + "..." : content;

                return (
                  <div key={`shared:${key}`} className="rounded-md border">
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <button
                        type="button"
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          setExpandedDocs((prev) => {
                            const next = new Set(prev);
                            const id = `shared:${key}`;
                            if (next.has(id)) next.delete(id);
                            else next.add(id);
                            return next;
                          })
                        }
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {label}
                          </span>
                          <Badge
                            variant="outline"
                            className="shrink-0 border-blue-500/30 bg-blue-500/10 px-1.5 py-0 text-[9px] text-blue-400"
                          >
                            Shared Prompt Section
                          </Badge>
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">
                          ~{wordCount.toLocaleString()} words
                        </div>
                      </div>
                    </div>
                    {!isExpanded && (
                      <div className="border-t px-3 py-2">
                        <p className="line-clamp-3 font-mono text-xs leading-relaxed text-muted-foreground">
                          {snippet}
                        </p>
                      </div>
                    )}
                    {isExpanded && (
                      <div className="border-t px-3 py-2">
                        <div className="max-h-48 overflow-y-auto rounded-md bg-muted/50 p-3">
                          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
                            {content}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {patternCount > 0 && (
                <div className="rounded-md border">
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <Zap className="h-4 w-4 shrink-0 text-amber-400 opacity-70" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          Learned Corrections
                        </span>
                        <Badge
                          variant="outline"
                          className="shrink-0 border-amber-500/30 bg-amber-500/10 px-1.5 py-0 text-[9px] text-amber-400"
                        >
                          Correction Patterns
                        </Badge>
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {patternCount} approved pattern{patternCount !== 1 ? "s" : ""}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Drop zone (when empty or as additional upload area) */}
        {(!knowledgeDocs || knowledgeDocs.length === 0) && !uploading && (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
            className="mt-4 cursor-pointer rounded-md border-2 border-dashed border-muted-foreground/25 px-4 py-8 text-center transition-colors hover:border-muted-foreground/50 hover:bg-accent/30"
          >
            <Upload className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
            <div className="font-mono text-sm text-muted-foreground">
              Drop files here or click to browse
            </div>
            <div className="mt-1 font-mono text-xs text-muted-foreground/60">
              Supports .md, .txt, .docx, .scl, .pdf
            </div>
          </div>
        )}

        {knowledgeDocs && knowledgeDocs.length > 0 && (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            className="mt-3 rounded-md border border-dashed border-muted-foreground/20 px-3 py-2 text-center font-mono text-xs text-muted-foreground/50 transition-colors hover:border-muted-foreground/40"
          >
            Drop more files here to add to knowledge base
          </div>
        )}
      </Card>
    </div>
  );
}
