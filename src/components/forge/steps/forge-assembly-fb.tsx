/**
 * Forge wizard step: Assembly FB Generation
 *
 * Standalone step (extracted from forge-device-fb.tsx) for generating
 * assembly function blocks. Shows per-assembly generation with FDS brief
 * summary, Monaco code editor, regenerate with instructions, and approval.
 */
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  Maximize2,
  BookMarked,
  RotateCcw,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import Editor from "@monaco-editor/react";
import { useForgeAssemblyGenerate } from "@/hooks/use-forge-assembly-generate";
import { useForgeFdsHandoff } from "@/hooks/use-forge-fds-handoff";
import type {
  ForgeSession,
  ForgeArtifact,
  ForgeAssemblyEntry,
  SpecAnalysisAssembly,
} from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import type { FbTemplate } from "@/types/fb-template";
import type { PatternCandidate } from "@/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ForgeAssemblyFbProps {
  session: ForgeSession;
  profile: DesignProfile;
  fbTemplates: FbTemplate[];
  patterns: PatternCandidate[];
  onArtifactsUpdate: (artifacts: ForgeArtifact[]) => void;
  /** Called once when the resolved assembly list is computed (for DB persistence) */
  onAssemblyListResolved?: (assemblies: ForgeAssemblyEntry[]) => void;
  onComplete: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function typeBadge(type: ForgeArtifact["type"]) {
  const colors: Record<string, string> = {
    FB: "border-blue-500/50 text-blue-400",
    FC: "border-cyan-500/50 text-cyan-400",
    DB: "border-purple-500/50 text-purple-400",
    UDT: "border-orange-500/50 text-orange-400",
  };
  return (
    <Badge variant="outline" className={`font-mono text-[10px] ${colors[type] ?? ""}`}>
      {type}
    </Badge>
  );
}

/** Convert SpecAnalysisAssembly[] (7 fields) → ForgeAssemblyEntry[] (11 fields) safely */
function specAnalysisToAssemblyEntries(
  assemblies: SpecAnalysisAssembly[] | undefined,
): ForgeAssemblyEntry[] | null {
  if (!assemblies?.length) return null;
  return assemblies.map((a) => ({
    id: a.id,
    name: a.name,
    tag: a.tag,
    assembly_type: a.assembly_type,
    description: a.description,
    subsystem: a.subsystem,
    device_ids: a.device_ids,
    fb_template_id: null,
    fb_match_confidence: "none" as const,
    language_override: null,
    approved: false,
  }));
}

type AssemblyStatus = "pending" | "generating" | "generated" | "approved";

function getAssemblyStatus(
  assembly: ForgeAssemblyEntry,
  artifacts: ForgeArtifact[],
  generatingTag: string | null,
): AssemblyStatus {
  if (generatingTag === assembly.tag) return "generating";
  const asmArtifacts = artifacts.filter((a) =>
    a.name.toLowerCase().includes(assembly.tag.toLowerCase().replace(/[^a-z0-9]/g, "")),
  );
  if (asmArtifacts.length === 0) return "pending";
  if (asmArtifacts.every((a) => a.approved)) return "approved";
  return "generated";
}

function statusIcon(status: AssemblyStatus) {
  switch (status) {
    case "pending":
      return <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    case "generating":
      return <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin shrink-0" />;
    case "generated":
      return <CheckCircle2 className="h-3.5 w-3.5 text-yellow-500 shrink-0" />;
    case "approved":
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />;
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ForgeAssemblyFb({
  session,
  profile,
  fbTemplates,
  patterns,
  onArtifactsUpdate,
  onAssemblyListResolved,
  onComplete,
}: ForgeAssemblyFbProps) {
  const { generateAll, generateSingle, loading, progress, error } = useForgeAssemblyGenerate();
  const { briefs, assemblyEntries: fdsAssemblies, isFdsLinked } = useForgeFdsHandoff(
    session.spec_project_id,
    session.device_list,
  );

  const [artifacts, setArtifacts] = useState<ForgeArtifact[]>(
    () => (session.assembly_artifacts as ForgeArtifact[])?.filter((a) => a.stage === "assembly_fb") ?? [],
  );
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [generatingTag, setGeneratingTag] = useState<string | null>(null);
  const [regenInstructions, setRegenInstructions] = useState("");
  const [regenOpen, setRegenOpen] = useState(false);
  const [expandedArtifactId, setExpandedArtifactId] = useState<string | null>(null);

  const assemblies = useMemo(
    () =>
      // Priority: persisted assembly_list > FDS-derived entries > spec analysis fallback
      (session.assembly_list?.length ? session.assembly_list : null) ??
      (isFdsLinked && fdsAssemblies.length ? fdsAssemblies : null) ??
      specAnalysisToAssemblyEntries(session.spec_analysis?.assemblies) ??
      [],
    [session, isFdsLinked, fdsAssemblies],
  );

  // Persist the resolved assembly list to DB when it's first computed
  const resolvedRef = useRef(false);
  useEffect(() => {
    if (resolvedRef.current || !assemblies.length || !onAssemblyListResolved) return;
    // Only persist if session doesn't already have it
    if (!session.assembly_list?.length) {
      onAssemblyListResolved(assemblies);
      resolvedRef.current = true;
    }
  }, [assemblies, session.assembly_list, onAssemblyListResolved]);

  const deviceArtifacts = useMemo(
    () => (session.device_artifacts as ForgeArtifact[]) ?? [],
    [session.device_artifacts],
  );

  // Artifacts for the selected assembly
  const selectedArtifacts = useMemo(() => {
    if (!selectedTag) return [];
    const tagClean = selectedTag.toLowerCase().replace(/[^a-z0-9]/g, "");
    return artifacts.filter((a) => a.name.toLowerCase().includes(tagClean));
  }, [artifacts, selectedTag]);

  const approvedCount = useMemo(
    () => artifacts.filter((a) => a.approved).length,
    [artifacts],
  );

  // ── Generate all ──

  const handleGenerateAll = useCallback(async () => {
    try {
      const result = await generateAll(
        assemblies,
        session,
        profile,
        deviceArtifacts,
        fbTemplates,
        patterns,
        isFdsLinked ? briefs : undefined,
      );
      setArtifacts(result);
      onArtifactsUpdate(result);
    } catch {
      // error shown via hook state
    }
  }, [assemblies, session, profile, deviceArtifacts, fbTemplates, patterns, isFdsLinked, briefs, generateAll, onArtifactsUpdate]);

  // ── Generate single ──

  const handleGenerateSingle = useCallback(async (assembly: ForgeAssemblyEntry, instructions?: string) => {
    setGeneratingTag(assembly.tag);
    try {
      const result = await generateSingle(
        assembly,
        session,
        profile,
        deviceArtifacts,
        fbTemplates,
        patterns,
        isFdsLinked ? briefs[assembly.id] : undefined,
        instructions,
      );

      // Replace artifacts for this assembly, keep others
      const tagClean = assembly.tag.toLowerCase().replace(/[^a-z0-9]/g, "");
      const updated = [
        ...artifacts.filter((a) => !a.name.toLowerCase().includes(tagClean)),
        ...result,
      ];
      setArtifacts(updated);
      onArtifactsUpdate(updated);
    } catch {
      // error shown
    } finally {
      setGeneratingTag(null);
    }
  }, [session, profile, deviceArtifacts, fbTemplates, patterns, isFdsLinked, briefs, artifacts, generateSingle, onArtifactsUpdate]);

  // ── Approve / unapprove ──

  const toggleApprove = useCallback((artifactId: string) => {
    setArtifacts((prev) => {
      const updated = prev.map((a) =>
        a.id === artifactId ? { ...a, approved: !a.approved } : a,
      );
      onArtifactsUpdate(updated);
      return updated;
    });
  }, [onArtifactsUpdate]);

  const approveAllForAssembly = useCallback((tag: string) => {
    const tagClean = tag.toLowerCase().replace(/[^a-z0-9]/g, "");
    setArtifacts((prev) => {
      const updated = prev.map((a) =>
        a.name.toLowerCase().includes(tagClean) ? { ...a, approved: true } : a,
      );
      onArtifactsUpdate(updated);
      return updated;
    });
  }, [onArtifactsUpdate]);

  // ── No assemblies ──

  if (assemblies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <p className="text-sm">No assemblies found.</p>
        <Button onClick={onComplete}>Skip — Continue</Button>
      </div>
    );
  }

  // ── Render ──

  const selectedAssembly = assemblies.find((a) => a.tag === selectedTag);
  const selectedBrief = selectedAssembly && isFdsLinked ? briefs[selectedAssembly.id] : undefined;

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={handleGenerateAll}
          disabled={loading || deviceArtifacts.length === 0}
          className="gap-2"
          title={deviceArtifacts.length === 0 ? "Generate device FBs first" : ""}
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {loading
            ? `Generating ${progress.assemblyTag} (${progress.current}/${progress.total})`
            : artifacts.length > 0 ? "Regenerate All" : "Generate All Assembly FBs"}
        </Button>

        {isFdsLinked && (
          <Badge variant="outline" className="text-[9px] border-blue-500/30 text-blue-400">FDS</Badge>
        )}

        <div className="flex-1" />

        {error && (
          <div className="flex items-center gap-1 text-xs text-destructive">
            <AlertCircle className="h-3 w-3" />
            {error}
          </div>
        )}

        <Badge variant="outline" className="font-mono text-[10px]">
          {approvedCount}/{artifacts.length} approved
        </Badge>

        <Button
          size="sm"
          disabled={approvedCount === 0}
          onClick={onComplete}
        >
          Continue ({approvedCount} approved)
        </Button>
      </div>

      {/* Main layout */}
      <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
        {/* Left: Assembly list */}
        <ResizablePanel defaultSize={28} minSize={18}>
          <ScrollArea className="h-full">
            <div className="space-y-1 p-2">
              {assemblies.map((asm) => {
                const status = getAssemblyStatus(asm, artifacts, generatingTag);
                const isSelected = selectedTag === asm.tag;
                const asmArtCount = artifacts.filter((a) =>
                  a.name.toLowerCase().includes(asm.tag.toLowerCase().replace(/[^a-z0-9]/g, "")),
                ).length;

                return (
                  <button
                    key={asm.id}
                    className={`w-full text-left rounded px-2 py-2 transition-colors ${
                      isSelected
                        ? "bg-accent border border-accent-foreground/10"
                        : "hover:bg-muted/50 border border-transparent"
                    }`}
                    onClick={() => setSelectedTag(asm.tag)}
                  >
                    <div className="flex items-center gap-2">
                      {statusIcon(status)}
                      <span className="font-mono text-xs font-semibold truncate">{asm.tag}</span>
                      {asm.fb_template_id && (
                        <span title="Library match">
                          <BookMarked className="h-3 w-3 text-emerald-400 shrink-0" />
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground ml-5.5 truncate">
                      {asm.name} ({asm.assembly_type})
                    </div>
                    {asmArtCount > 0 && (
                      <div className="text-[9px] text-muted-foreground ml-5.5 mt-0.5">
                        {asmArtCount} artifacts
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right: Code + controls */}
        <ResizablePanel defaultSize={72} minSize={40}>
          {selectedTag && selectedAssembly ? (
            <div className="flex flex-col h-full">
              {/* Assembly header */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30 shrink-0">
                <span className="font-mono text-xs font-semibold">{selectedAssembly.tag}</span>
                <span className="text-[10px] text-muted-foreground">{selectedAssembly.name}</span>
                <div className="flex-1" />

                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  disabled={loading || generatingTag !== null}
                  onClick={() => handleGenerateSingle(selectedAssembly)}
                >
                  {generatingTag === selectedAssembly.tag
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <RotateCcw className="h-3 w-3" />}
                  {selectedArtifacts.length > 0 ? "Regenerate" : "Generate"}
                </Button>

                {selectedArtifacts.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => approveAllForAssembly(selectedAssembly.tag)}
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    Approve All
                  </Button>
                )}
              </div>

              {/* FDS brief summary (when linked) */}
              {selectedBrief && (
                <BriefSummary brief={selectedBrief} />
              )}

              {/* Regenerate with instructions */}
              {selectedArtifacts.length > 0 && (
                <div className="px-3 py-1.5 border-b border-border/20">
                  <button
                    className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                    onClick={() => setRegenOpen(!regenOpen)}
                  >
                    {regenOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    Regenerate with instructions
                  </button>
                  {regenOpen && (
                    <div className="flex gap-1.5 mt-1.5">
                      <Textarea
                        value={regenInstructions}
                        onChange={(e) => setRegenInstructions(e.target.value)}
                        className="text-xs min-h-[50px]"
                        placeholder="e.g. 'Add jog mode handling' or 'Use separate timers for each direction'"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-auto text-xs shrink-0"
                        disabled={!regenInstructions.trim() || generatingTag !== null}
                        onClick={() => {
                          void handleGenerateSingle(selectedAssembly, regenInstructions.trim());
                          setRegenInstructions("");
                          setRegenOpen(false);
                        }}
                      >
                        Regenerate
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Artifacts */}
              <ScrollArea className="flex-1">
                <div className="p-3 space-y-2">
                  {selectedArtifacts.length === 0 ? (
                    <div className="text-center text-muted-foreground text-sm py-8">
                      Click "Generate" to create the assembly FB
                    </div>
                  ) : (
                    selectedArtifacts.map((a) => (
                      <div key={a.id} className="rounded border border-border/30 bg-background/60">
                        <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border/20">
                          {typeBadge(a.type)}
                          <span className="font-mono text-xs">{a.name}</span>
                          <div className="flex-1" />
                          <button
                            className={`text-xs px-2 py-0.5 rounded ${
                              a.approved
                                ? "bg-green-500/10 text-green-400 border border-green-500/30"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                            onClick={() => toggleApprove(a.id)}
                          >
                            {a.approved ? "Approved" : "Approve"}
                          </button>
                          <button
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => setExpandedArtifactId(expandedArtifactId === a.id ? null : a.id)}
                          >
                            <Maximize2 className="h-3 w-3" />
                          </button>
                        </div>
                        {expandedArtifactId === a.id && (
                          <Editor
                            height="300px"
                            defaultLanguage="pascal"
                            value={a.content}
                            theme="vs-dark"
                            options={{ readOnly: true, minimap: { enabled: false }, lineNumbers: "on", fontSize: 12, scrollBeyondLastLine: false }}
                          />
                        )}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Select an assembly from the list
            </div>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FDS Brief Summary (compact, shown above code)
// ---------------------------------------------------------------------------

function BriefSummary({ brief }: { brief: import("@/types/forge-brief").AssemblyBrief }) {
  const [open, setOpen] = useState(false);
  const stateCount = brief.operatingStates.length;
  const seqCount = Object.keys(brief.sequentialStates).length;
  const staticCount = Object.keys(brief.staticStates).length;

  return (
    <div className="px-3 py-1.5 border-b border-blue-500/20 bg-blue-500/5">
      <button
        className="flex items-center gap-2 text-[10px] text-blue-400 w-full"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className="font-semibold">FDS Brief</span>
        <span className="text-blue-400/60">
          {stateCount} states — {seqCount} sequential — {staticCount} static — {brief.alarmConditions.length} alarms
        </span>
        {brief.annotations.length > 0 && (
          <Badge variant="outline" className="text-[8px] px-1 py-0 border-orange-500/30 text-orange-400 ml-auto">
            {brief.annotations.length} annotations
          </Badge>
        )}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1 text-[10px]">
          {brief.operatingStates.map((os) => (
            <div key={os.state_id} className="flex items-center gap-2">
              <Badge variant="outline" className={`font-mono text-[8px] px-1 py-0 ${
                os.state_pattern === "static" ? "border-amber-500/30 text-amber-400" : "border-cyan-500/30 text-cyan-400"
              }`}>
                {os.state_pattern === "static" ? "S" : "Q"}
              </Badge>
              <span className="font-mono">{os.state_name}</span>
              <span className="text-muted-foreground">{os.description}</span>
            </div>
          ))}
          {brief.annotations.map((a, i) => (
            <div key={i} className="text-orange-400/80 ml-4">Note: {a}</div>
          ))}
        </div>
      )}
    </div>
  );
}
