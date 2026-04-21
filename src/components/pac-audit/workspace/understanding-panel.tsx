import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Brain, MessageSquare, FlaskConical, AlertTriangle, ChevronDown, ChevronRight,
  Loader2, Send, Zap, StopCircle, PlayCircle, Download, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/lib/supabase";
import { useAuditStore } from "@/stores/audit-store";
import { getBridgeConfigForVersion } from "@/lib/tia-bridge-contract";
import type {
  PlcsimStartResponse, PlcsimDownloadResponse,
  PlcsimReadTagRequest, PlcsimReadTagsResponse, PlcsimWriteTagRequest,
} from "@/lib/tia-bridge-contract";
import { callNonStreaming } from "@/hooks/use-generation";

import type { AuditProject, AuditBlockUnderstanding, DataFlowAnalysis, InterfaceContract, StateMachineAnalysis } from "@/types/audit";
import { cn } from "@/lib/utils";

interface UnderstandingPanelProps {
  sessionId: string;
  session: AuditProject;
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

const TABS = [
  { id: "analysis", label: "Analysis", icon: Brain },
  { id: "chat",     label: "Chat",     icon: MessageSquare },
  { id: "testing",  label: "Testing",  icon: FlaskConical },
] as const;
type TabId = (typeof TABS)[number]["id"];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function UnderstandingPanel({ sessionId, session }: UnderstandingPanelProps) {
  const store = useAuditStore();
  const { activeBlockId, understandingTab, setUnderstandingTab } = store;
  const [tab, setTab] = useState<TabId>(understandingTab as TabId);

  function handleTabChange(t: TabId) {
    setTab(t);
    setUnderstandingTab(t as typeof understandingTab);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex border-b border-border/40">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => handleTabChange(id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 py-2 font-mono text-[11px] transition-colors",
              tab === id
                ? "border-b-2 border-blue-500 text-blue-400"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === "analysis" && <AnalysisTab sessionId={sessionId} blockId={activeBlockId} />}
        {tab === "chat"     && <ChatTab sessionId={sessionId} blockId={activeBlockId} />}
        {tab === "testing"  && <TestingTab session={session} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analysis tab
// ---------------------------------------------------------------------------

function AnalysisTab({ sessionId, blockId }: { sessionId: string; blockId: string | null }) {
  const { data: understanding, isLoading } = useQuery({
    queryKey: ["block-understanding", sessionId, blockId],
    queryFn: async (): Promise<AuditBlockUnderstanding | null> => {
      if (!blockId) return null;
      const { data, error } = await supabase
        .from("audit_block_understanding")
        .select("*")
        .eq("block_id", blockId)
        .eq("is_current", true)
        .maybeSingle();
      if (error) throw error;
      return data as AuditBlockUnderstanding | null;
    },
    enabled: !!blockId,
  });

  if (!blockId) {
    return <EmptyState message="Select a block to view its analysis" />;
  }

  if (isLoading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  }

  if (!understanding) {
    return <EmptyState message="No analysis available for this block" />;
  }

  const u = understanding;
  const cq = u.code_quality as { risks?: string[]; deviations_from_conventions?: string[]; analysis_confidence?: string } | null;
  const iface = u.interface_contract as InterfaceContract | null;
  const df = u.data_flow as DataFlowAnalysis | null;
  const fh = u.fault_handling as { description: string } | null;

  return (
    <ScrollArea className="h-full">
      <div className="space-y-3 p-3">
        {/* Purpose + category */}
        {u.purpose && (
          <div>
            <SectionLabel>Purpose</SectionLabel>
            <p className="font-mono text-[11px] leading-relaxed text-foreground/90">{u.purpose}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {u.category && (
            <Badge variant="outline" className="font-mono text-[9px] px-1.5 py-0">
              {String(u.category).replace(/_/g, " ")}
            </Badge>
          )}
          {u.has_state_machine && (
            <Badge variant="outline" className="font-mono text-[9px] px-1.5 py-0 text-purple-400 border-purple-500/40">
              FSM
            </Badge>
          )}
          {cq?.analysis_confidence && (
            <Badge
              variant="outline"
              className={cn("font-mono text-[9px] px-1.5 py-0",
                cq.analysis_confidence === "high" ? "text-green-400 border-green-500/40" :
                cq.analysis_confidence === "medium" ? "text-amber-400 border-amber-500/40" :
                "text-red-400 border-red-500/40"
              )}
            >
              {cq.analysis_confidence} confidence
            </Badge>
          )}
        </div>

        {/* Interface */}
        {iface && (
          <Collapsible label="Interface">
            <InterfaceSection iface={iface} />
          </Collapsible>
        )}

        {/* State machine */}
        {u.has_state_machine && u.state_machine && (
          <Collapsible label="State Machine">
            {(() => {
              const sm = u.state_machine as StateMachineAnalysis;
              return (
                <div className="space-y-1">
                  <div className="font-mono text-[10px] text-muted-foreground">
                    Mechanism: <span className="text-foreground">{sm.mechanism ?? ""}</span>
                  </div>
                  {sm.states && sm.states.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {sm.states.map((s, i) => (
                        <Badge key={i} variant="outline" className="font-mono text-[9px] px-1 py-0">{s}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </Collapsible>
        )}

        {/* Data flow */}
        {df?.called_blocks && df.called_blocks.length > 0 && (
          <Collapsible label={`Calls (${df.called_blocks.length})`}>
            <div className="space-y-0.5">
              {df.called_blocks.map((cb, i) => (
                <div key={i} className="flex items-center gap-2 font-mono text-[10px]">
                  <span className={cn("w-14 shrink-0 text-[9px]", cb.kind === "project" ? "text-blue-400" : "text-zinc-400")}>
                    {cb.kind}
                  </span>
                  <span className="text-foreground/80">{cb.name}</span>
                </div>
              ))}
            </div>
          </Collapsible>
        )}

        {/* Fault handling */}
        {fh?.description && (
          <Collapsible label="Fault Handling">
            <p className="font-mono text-[10px] text-foreground/80">{fh.description}</p>
          </Collapsible>
        )}

        {/* Notes */}
        {u.detailed_notes && (
          <div>
            <SectionLabel>Notes</SectionLabel>
            <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">{u.detailed_notes}</p>
          </div>
        )}

        {/* Risks */}
        {(cq?.risks?.length ?? 0) > 0 && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
            <div className="mb-1 flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3 text-amber-400" />
              <span className="font-mono text-[10px] text-amber-400">Risks</span>
            </div>
            {cq!.risks!.map((r, i) => (
              <div key={i} className="font-mono text-[10px] text-amber-300/80">• {r}</div>
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

function InterfaceSection({ iface }: { iface: InterfaceContract }) {
  const sections = [
    { label: "IN", items: iface.inputs },
    { label: "OUT", items: iface.outputs },
    { label: "IN_OUT", items: iface.in_out },
    { label: "STATIC", items: iface.members },
  ] as const;

  return (
    <div className="space-y-2">
      {sections.map(({ label, items }) =>
        items && items.length > 0 ? (
          <div key={label}>
            <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-0.5">{label}</div>
            {items.map((item, i) => (
              <div key={i} className="flex items-start gap-2 font-mono text-[10px]">
                <span className="w-24 shrink-0 truncate text-foreground/80">{item.name}</span>
                <span className="w-16 shrink-0 truncate text-cyan-400/70">{item.type}</span>
                <span className="flex-1 truncate text-muted-foreground">{item.meaning}</span>
              </div>
            ))}
          </div>
        ) : null
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat tab
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function ChatTab({
  sessionId,
  blockId,
}: {
  sessionId: string;
  blockId: string | null;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [chatScope, setChatScope] = useState<"block" | "project">("block");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Fetch block data + understanding for context
  const { data: blockCtx } = useQuery({
    queryKey: ["chat-block-ctx", sessionId, blockId],
    queryFn: async () => {
      if (!blockId) return null;
      const [blockRes, understRes] = await Promise.all([
        supabase
          .from("audit_blocks")
          .select("name, block_type, programming_language, source_code, line_count")
          .eq("id", blockId)
          .single(),
        supabase
          .from("audit_block_understanding")
          .select("purpose, category, detailed_notes, code_quality, data_flow, interface_contract, state_machine")
          .eq("block_id", blockId)
          .eq("is_current", true)
          .maybeSingle(),
      ]);
      return { block: blockRes.data, understanding: understRes.data };
    },
    enabled: !!blockId && chatScope === "block",
  });

  // Fetch project-level block summaries for project chat
  const { data: projectCtx } = useQuery({
    queryKey: ["chat-project-ctx", sessionId],
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_block_understanding")
        .select("purpose, category, block_id")
        .eq("audit_project_id", sessionId)
        .eq("is_current", true);

      const { data: blocks } = await supabase
        .from("audit_blocks")
        .select("id, name, block_type")
        .eq("audit_project_id", sessionId);

      const blockMap = new Map((blocks ?? []).map((b) => [b.id as string, b]));
      return (data ?? []).map((u) => {
        const b = blockMap.get(u.block_id as string);
        return `${b?.name ?? "?"} (${b?.block_type ?? "?"}): ${u.purpose ?? "no purpose"}`;
      });
    },
    enabled: chatScope === "project",
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Reset messages when block changes or scope changes
  useEffect(() => {
    setMessages([]);
  }, [blockId, chatScope]);

  function buildSystemPrompt(): string {
    if (chatScope === "project") {
      const summaries = projectCtx?.join("\n") ?? "No block summaries available.";
      return `You are a PLC code analysis assistant for a Siemens TIA Portal project.
You have access to the following block summaries for this project:

${summaries}

Answer questions about the project structure, block relationships, modification strategies, and commissioning approach.
Be concise and technical.`;
    }

    if (!blockCtx?.block) {
      return "You are a PLC code analysis assistant. No block is currently selected.";
    }

    const { block, understanding } = blockCtx;
    const sourcePreview = block.source_code
      ? block.source_code.slice(0, 8000)
      : "Source not available.";

    return `You are a PLC code analysis assistant for a Siemens TIA Portal project.

Current block: ${block.name} (${block.block_type}, ${block.programming_language}, ${block.line_count ?? "?"}L)

Analysis:
${JSON.stringify(understanding, null, 2)}

Source code (preview):
\`\`\`
${sourcePreview}
\`\`\`

Answer questions about this block's logic, suggest modifications, explain risks, or help debug issues.
Be concise and technical. Reference specific variable names and line numbers when relevant.`;
  }

  async function handleSend() {
    if (!input.trim() || sending) return;
    const userMsg = input.trim();
    setInput("");
    setSending(true);

    const newMessages: ChatMessage[] = [...messages, { role: "user", content: userMsg }];
    setMessages(newMessages);

    try {
      const apiMessages = newMessages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string }));
      const result = await callNonStreaming(buildSystemPrompt(), apiMessages, AbortSignal.timeout(60_000), 4096);
      setMessages([...newMessages, { role: "assistant", content: result.content }]);
    } catch (err) {
      setMessages([
        ...newMessages,
        { role: "assistant", content: `Error: ${err instanceof Error ? err.message : String(err)}` },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Scope toggle */}
      <div className="flex border-b border-border/40 px-2 py-1.5 gap-2">
        <button
          onClick={() => setChatScope("block")}
          className={cn(
            "rounded px-2 py-0.5 font-mono text-[10px] transition-colors",
            chatScope === "block" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          Block
        </button>
        <button
          onClick={() => setChatScope("project")}
          className={cn(
            "rounded px-2 py-0.5 font-mono text-[10px] transition-colors",
            chatScope === "project" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          Project
        </button>
        {chatScope === "block" && !blockId && (
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">No block selected</span>
        )}
        {chatScope === "block" && blockId && (
          <span className="ml-auto font-mono text-[10px] text-muted-foreground truncate">
            {blockCtx?.block?.name ?? "…"}
          </span>
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div className="space-y-3 p-3">
          {messages.length === 0 && (
            <div className="py-6 text-center">
              <MessageSquare className="mx-auto mb-2 h-6 w-6 text-muted-foreground/30" />
              <p className="font-mono text-[11px] text-muted-foreground">
                {chatScope === "block"
                  ? "Ask about this block's logic, modifications, or risks"
                  : "Ask about the project structure, architecture, or commissioning strategy"}
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "rounded-md px-3 py-2",
                m.role === "user"
                  ? "ml-4 bg-accent/30 text-sm"
                  : "mr-4 border border-border/40 bg-card/40 text-sm"
              )}
            >
              <p className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed">{m.content}</p>
            </div>
          ))}
          {sending && (
            <div className="mr-4 flex items-center gap-2 rounded-md border border-border/40 bg-card/40 px-3 py-2">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              <span className="font-mono text-[11px] text-muted-foreground">Thinking…</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t border-border/40 p-2">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Ask about this block… (Enter to send)"
            rows={2}
            className="flex-1 resize-none rounded-md border border-border/40 bg-muted/10 px-2 py-1.5 font-mono text-[11px] outline-none placeholder:text-muted-foreground/50 focus:border-border/70"
          />
          <Button
            size="sm"
            onClick={() => void handleSend()}
            disabled={sending || !input.trim()}
            className="self-end h-8 w-8 p-0"
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Testing tab
// ---------------------------------------------------------------------------

function TestingTab({ session }: { session: AuditProject }) {
  const store = useAuditStore();
  const { plcsimConnected, setPlcsimConnected } = store;
  const bridgeCfg = getBridgeConfigForVersion(session.tia_version);

  const [plcsimState, setPlcsimState] = useState<"stopped" | "running">("stopped");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Tag monitor state
  const [watchTags, setWatchTags] = useState<Array<{ name: string; dataType: string }>>([]);
  const [tagValues, setTagValues] = useState<Record<string, boolean | number | string | null>>({});
  const [newTagName, setNewTagName] = useState("");
  const [newTagType, setNewTagType] = useState("Bool");
  const [writeTag, setWriteTag] = useState("");
  const [writeValue, setWriteValue] = useState("");

  // Start PLCSIM
  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${bridgeCfg.baseUrl}/tia/plcsim/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instance_name: "PacAudit_Test" }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) throw new Error("PLCSIM start failed");
      return (await res.json()) as PlcsimStartResponse;
    },
    onSuccess: (data) => {
      setPlcsimConnected(true);
      setStatusMsg(data.message);
      setError(null);
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  // Download to PLCSIM
  const downloadMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${bridgeCfg.baseUrl}/tia/plcsim/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error("Download failed");
      return (await res.json()) as PlcsimDownloadResponse;
    },
    onSuccess: (data) => {
      setStatusMsg(data.message);
      setError(null);
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  // Set PLC mode
  const modeMutation = useMutation({
    mutationFn: async (mode: "run" | "stop") => {
      const res = await fetch(`${bridgeCfg.baseUrl}/tia/plcsim/plc-mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Set mode failed`);
      return mode;
    },
    onSuccess: (mode) => {
      setPlcsimState(mode === "run" ? "running" : "stopped");
      setError(null);
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  // Stop PLCSIM
  const stopMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${bridgeCfg.baseUrl}/tia/plcsim/stop`, {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error("Stop failed");
      return res.json();
    },
    onSuccess: () => {
      setPlcsimConnected(false);
      setPlcsimState("stopped");
      setTagValues({});
      setError(null);
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  // Read tags
  const readTagsMutation = useMutation({
    mutationFn: async () => {
      if (watchTags.length === 0) return null;
      const body: PlcsimReadTagRequest[] = watchTags.map((t) => ({ tag_name: t.name, data_type: t.dataType }));
      const res = await fetch(`${bridgeCfg.baseUrl}/tia/plcsim/read-tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error("Read tags failed");
      return (await res.json()) as PlcsimReadTagsResponse;
    },
    onSuccess: (data) => {
      if (!data) return;
      const next: Record<string, boolean | number | string | null> = {};
      for (const v of data.values) {
        next[v.tag_name] = v.success ? v.value : null;
      }
      setTagValues(next);
    },
  });

  // Write tag
  const writeTagMutation = useMutation({
    mutationFn: async ({ name, value }: { name: string; value: string }) => {
      const body: PlcsimWriteTagRequest = { tag_name: name, value: value === "true" ? true : value === "false" ? false : Number(value) || value };
      const res = await fetch(`${bridgeCfg.baseUrl}/tia/plcsim/write-tag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error("Write tag failed");
    },
  });

  const isBusy = startMutation.isPending || downloadMutation.isPending || modeMutation.isPending || stopMutation.isPending;

  return (
    <ScrollArea className="h-full">
      <div className="space-y-3 p-3">
        {/* PLCSIM Controls */}
        <div>
          <SectionLabel>PLCSIM Advanced</SectionLabel>
          <div className="rounded-md border border-border/50 bg-card/40 p-2 space-y-2">
            {/* Status row */}
            <div className="flex items-center gap-2">
              <div className={cn("h-2 w-2 rounded-full", plcsimConnected ? "bg-green-400" : "bg-muted-foreground/40")} />
              <span className="font-mono text-[11px]">
                {plcsimConnected
                  ? plcsimState === "running" ? "RUN" : "STOP"
                  : "Disconnected"
                }
              </span>
              {statusMsg && <span className="ml-auto font-mono text-[10px] text-muted-foreground truncate">{statusMsg}</span>}
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-1.5">
              {!plcsimConnected ? (
                <Button
                  size="sm"
                  onClick={() => startMutation.mutate()}
                  disabled={isBusy}
                  className="h-6 gap-1 px-2 font-mono text-[10px]"
                >
                  {startMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                  Start PLCSIM
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => downloadMutation.mutate()}
                    disabled={isBusy}
                    className="h-6 gap-1 px-2 font-mono text-[10px]"
                  >
                    {downloadMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                    Download
                  </Button>
                  {plcsimState === "stopped" ? (
                    <Button
                      size="sm"
                      onClick={() => modeMutation.mutate("run")}
                      disabled={isBusy}
                      className="h-6 gap-1 bg-green-700 px-2 font-mono text-[10px] hover:bg-green-600"
                    >
                      {modeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3 w-3" />}
                      RUN
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => modeMutation.mutate("stop")}
                      disabled={isBusy}
                      className="h-6 gap-1 px-2 font-mono text-[10px]"
                    >
                      {modeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <StopCircle className="h-3 w-3" />}
                      STOP
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => stopMutation.mutate()}
                    disabled={isBusy}
                    className="h-6 gap-1 px-2 font-mono text-[10px] text-red-400"
                  >
                    Shutdown
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Tag Monitor */}
        {plcsimConnected && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <SectionLabel>Tag Monitor</SectionLabel>
              <button
                onClick={() => readTagsMutation.mutate()}
                disabled={readTagsMutation.isPending || watchTags.length === 0}
                className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                {readTagsMutation.isPending
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <RefreshCw className="h-3 w-3" />
                }
                Refresh
              </button>
            </div>

            {/* Add tag */}
            <div className="flex gap-1 mb-2">
              <input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="Tag name"
                className="flex-1 rounded border border-border/40 bg-muted/10 px-2 py-1 font-mono text-[11px] outline-none"
              />
              <select
                value={newTagType}
                onChange={(e) => setNewTagType(e.target.value)}
                className="rounded border border-border/40 bg-muted/10 px-1 py-1 font-mono text-[11px] outline-none"
              >
                {["Bool", "Int", "DInt", "Real", "Word", "DWord"].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!newTagName.trim()) return;
                  setWatchTags((prev) => [...prev, { name: newTagName.trim(), dataType: newTagType }]);
                  setNewTagName("");
                }}
                className="h-7 px-2 font-mono text-[10px]"
              >
                Add
              </Button>
            </div>

            {/* Tag table */}
            {watchTags.length > 0 && (
              <div className="rounded-md border border-border/40 overflow-hidden">
                <div className="grid grid-cols-[1fr_80px_60px] border-b border-border/30 bg-muted/20 px-2 py-1">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Tag</span>
                  <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Type</span>
                  <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Value</span>
                </div>
                {watchTags.map((t, i) => {
                  const val = tagValues[t.name];
                  return (
                    <div key={i} className="grid grid-cols-[1fr_80px_60px] border-b border-border/20 px-2 py-1 last:border-0">
                      <span className="font-mono text-[10px] truncate">{t.name}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{t.dataType}</span>
                      <span className={cn("font-mono text-[10px]",
                        val === null ? "text-muted-foreground" :
                        val === true ? "text-green-400" :
                        val === false ? "text-red-400" : "text-cyan-400"
                      )}>
                        {val === null ? "–" : String(val)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Write tag */}
            <div className="mt-2">
              <SectionLabel>Write Tag</SectionLabel>
              <div className="flex gap-1">
                <input
                  value={writeTag}
                  onChange={(e) => setWriteTag(e.target.value)}
                  placeholder="Tag name"
                  className="flex-1 rounded border border-border/40 bg-muted/10 px-2 py-1 font-mono text-[11px] outline-none"
                />
                <input
                  value={writeValue}
                  onChange={(e) => setWriteValue(e.target.value)}
                  placeholder="Value"
                  className="w-20 rounded border border-border/40 bg-muted/10 px-2 py-1 font-mono text-[11px] outline-none"
                />
                <Button
                  size="sm"
                  onClick={() => {
                    if (!writeTag.trim()) return;
                    writeTagMutation.mutate({ name: writeTag.trim(), value: writeValue });
                  }}
                  disabled={writeTagMutation.isPending}
                  className="h-7 px-2 font-mono text-[10px]"
                >
                  {writeTagMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Write"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 px-2 py-1.5 font-mono text-[10px] text-red-400">
            {error}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
      {children}
    </div>
  );
}

function Collapsible({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {label}
      </button>
      {open && <div className="mt-1 pl-4">{children}</div>}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <p className="font-mono text-[11px] text-muted-foreground">{message}</p>
    </div>
  );
}
