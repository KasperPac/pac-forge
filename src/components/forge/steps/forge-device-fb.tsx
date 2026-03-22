import { useState } from "react";
import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  Maximize2,
  BookMarked,
  ChevronDown,
  ChevronRight,
  Pencil,
} from "lucide-react";
import { ForgeCodeViewer } from "@/components/forge/forge-code-viewer";
import { ForgeArtifactDialog } from "@/components/forge/forge-artifact-dialog";
import { ForgeDeviceFbDialog } from "@/components/forge/forge-device-fb-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { ForgeSubPipeline } from "@/components/forge/forge-sub-pipeline";
import type { SubPipelineStage } from "@/components/forge/forge-sub-pipeline";
import { useForgeDeviceGenerate } from "@/hooks/use-forge-device-generate";
import type { DeviceGenLogEntry } from "@/hooks/use-forge-device-generate";
import { useCreateFbTemplate } from "@/hooks/use-fb-templates";
import { useFbDeviceCategories, useCreateFbDeviceCategory } from "@/hooks/use-fb-categories";
import type { ForgeSession, ForgeArtifact, ForgeDeviceEntry } from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import type { FbTemplate } from "@/types/fb-template";
import type { PatternCandidate } from "@/types";

export interface ForgeDeviceFbProps {
  session: ForgeSession;
  profile: DesignProfile;
  fbTemplates: FbTemplate[];
  patterns: PatternCandidate[];
  onArtifactsUpdate: (artifacts: ForgeArtifact[]) => void;
  onBeforeGenerate?: () => Promise<FbTemplate[]>;
  onComplete: () => void;
}

function typeBadge(type: ForgeArtifact["type"]) {
  const colors: Record<string, string> = {
    FB: "border-blue-500/50 text-blue-400",
    FC: "border-cyan-500/50 text-cyan-400",
    DB: "border-purple-500/50 text-purple-400",
    UDT: "border-orange-500/50 text-orange-400",
    OB: "border-green-500/50 text-green-400",
    TAG_TABLE: "border-gray-500/50 text-gray-400",
  };
  return (
    <Badge variant="outline" className={`font-mono text-[10px] ${colors[type] ?? ""}`}>
      {type}
    </Badge>
  );
}

function langBadge(lang: ForgeArtifact["language"]) {
  return (
    <Badge
      variant="outline"
      className={`font-mono text-[10px] ${lang === "SCL" ? "border-emerald-500/50 text-emerald-400" : "border-yellow-500/50 text-yellow-400"}`}
    >
      {lang}
    </Badge>
  );
}

function GenerationLog({ entries }: { entries: DeviceGenLogEntry[] }) {
  const [open, setOpen] = useState(true);
  const warnCount = entries.filter(e => e.level === "warn").length;
  const fixCount = entries.filter(e => e.level === "fix").length;

  return (
    <div className="rounded-md border border-border/60 bg-muted/10">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Generation Log</span>
        <div className="ml-auto flex items-center gap-1.5">
          {fixCount > 0 && <Badge variant="outline" className="font-mono text-[9px] border-amber-500/50 text-amber-400">{fixCount} auto-fixed</Badge>}
          {warnCount > 0 && <Badge variant="outline" className="font-mono text-[9px] border-red-500/50 text-red-400">{warnCount} warnings</Badge>}
          <Badge variant="outline" className="font-mono text-[9px]">{entries.length} entries</Badge>
        </div>
      </button>
      {open && (
        <div className="border-t border-border/40 px-3 py-2">
          <div className="max-h-48 overflow-y-auto space-y-0.5 font-mono text-[10px]">
            {entries.map((e, i) => (
              <div key={i} className={`flex gap-2 ${e.level === "warn" ? "text-red-400" : e.level === "fix" ? "text-amber-400" : "text-muted-foreground"}`}>
                <span className="shrink-0 text-muted-foreground/50">{new Date(e.ts).toLocaleTimeString()}</span>
                <span className={`shrink-0 uppercase ${e.level === "warn" ? "text-red-500" : e.level === "fix" ? "text-amber-500" : "text-blue-500"}`}>{e.level}</span>
                <span className="break-all">{e.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const INITIAL_STAGES: SubPipelineStage[] = [
  { label: "Generate FBs", status: "pending" },
  { label: "Approve", status: "pending" },
];

export function ForgeDeviceFb({
  session,
  profile,
  fbTemplates,
  patterns,
  onArtifactsUpdate,
  onBeforeGenerate,
  onComplete,
}: ForgeDeviceFbProps) {
  const [artifacts, setArtifacts] = useState<ForgeArtifact[]>(
    () => (session.device_artifacts as ForgeArtifact[])?.filter(a => a.stage === "device_fb") ?? [],
  );
  const [selectedId, setSelectedId] = useState<string | null>(artifacts[0]?.id ?? null);
  const [editable, setEditable] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [stages, setStages] = useState<SubPipelineStage[]>(INITIAL_STAGES);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [currentStepLabel, setCurrentStepLabel] = useState<string | null>(null);
  const [savedToLibrary, setSavedToLibrary] = useState<Set<string>>(new Set());

  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewArtifact, setReviewArtifact] = useState<ForgeArtifact | null>(null);
  const [reviewDevice, setReviewDevice] = useState<ForgeDeviceEntry | null>(null);

  const { generateFbsOnly, regenerateSingleFb, loading: genLoading, progress, error: genError, log: genLog } = useForgeDeviceGenerate();
  const createTemplate = useCreateFbTemplate();
  const { data: existingCategories = [] } = useFbDeviceCategories();
  const createCategory = useCreateFbDeviceCategory();

  const selected = artifacts.find(a => a.id === selectedId) ?? null;
  const approvedCount = artifacts.filter(a => a.approved).length;
  const progressPct = genLoading
    ? Math.round((progress.current / Math.max(progress.total, 1)) * 100)
    : 0;

  function setStageStatus(label: string, status: SubPipelineStage["status"], detail?: string) {
    setStages(prev => prev.map(s => s.label === label ? { ...s, status, detail } : s));
  }

  function toggleApprove(id: string) {
    const updated = artifacts.map(a => a.id === id ? { ...a, approved: !a.approved } : a);
    setArtifacts(updated);
    onArtifactsUpdate(updated);
  }

  function approveAll() {
    const updated = artifacts.map(a => ({ ...a, approved: true }));
    setArtifacts(updated);
    onArtifactsUpdate(updated);
    setStageStatus("Approve", "completed", `${updated.length} artifacts`);
  }

  function updateContent(id: string, content: string) {
    const updated = artifacts.map(a => a.id === id ? { ...a, content } : a);
    setArtifacts(updated);
    onArtifactsUpdate(updated);
  }

  async function handleGenerateAll() {
    setStages(INITIAL_STAGES.map(s => ({ ...s, status: "pending" })));
    setPipelineError(null);
    setCurrentStepLabel(null);

    try {
      const freshTemplates = onBeforeGenerate ? await onBeforeGenerate() : fbTemplates;

      setStageStatus("Generate FBs", "running");
      setCurrentStepLabel("Generating device FBs…");
      const generated = await generateFbsOnly(session, profile, freshTemplates, patterns);
      setArtifacts(generated);
      onArtifactsUpdate(generated);
      if (generated.length > 0) setSelectedId(generated[0].id);
      setStageStatus("Generate FBs", "completed", `${generated.length} artifacts`);
      setStageStatus("Approve", "pending");
      setCurrentStepLabel(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPipelineError(msg);
      setCurrentStepLabel(null);
      setStages(prev => prev.map(s => s.status === "running" ? { ...s, status: "failed", detail: msg } : s));
    }
  }

  async function handleSaveToLibrary() {
    const approvedFbs = artifacts.filter(a => a.approved && a.type === "FB");
    if (approvedFbs.length === 0) return;

    for (const artifact of approvedFbs) {
      if (savedToLibrary.has(artifact.id)) continue;

      const device = (session.device_list as ForgeDeviceEntry[])?.find(d =>
        artifact.name.toLowerCase().includes(d.device_type.toLowerCase().replace(/\s+/g, "")) ||
        d.device_type.toLowerCase().replace(/\s+/g, "").includes(artifact.name.toLowerCase())
      );

      const categoryName = device?.device_type ?? artifact.name;

      // Create the category in fb_device_categories if it doesn't already exist
      const categoryExists = existingCategories.some(
        c => c.name.toLowerCase() === categoryName.toLowerCase(),
      );
      if (!categoryExists) {
        try {
          await createCategory.mutateAsync({
            name: categoryName,
            display_name: categoryName,
          });
        } catch {
          // ignore duplicate — another concurrent save may have created it
        }
      }

      await createTemplate.mutateAsync({
        name: artifact.name,
        device_category: categoryName,
        plc_brand: "SIEMENS_TIA",
        description: "",
        tags: [],
        blocks: [{ block_name: artifact.name, block_type: "FB", scl_code: artifact.content, sort_order: 0 }],
      });
    }

    setSavedToLibrary(prev => {
      const next = new Set(prev);
      approvedFbs.forEach(a => next.add(a.id));
      return next;
    });
  }

  function openReview(artifact: ForgeArtifact) {
    const device = (session.device_list as ForgeDeviceEntry[])?.find(d =>
      artifact.name.toLowerCase().includes(d.name.toLowerCase().replace(/\s+/g, "")) ||
      d.name.toLowerCase().replace(/\s+/g, "").includes(artifact.name.toLowerCase())
    ) ?? null;
    setReviewArtifact(artifact);
    setReviewDevice(device);
    setReviewDialogOpen(true);
  }

  async function handleRegenerate(instructions: string): Promise<ForgeArtifact[]> {
    if (!reviewDevice) return [];
    const newArtifacts = await regenerateSingleFb(
      reviewDevice, session, profile, patterns, instructions,
    );
    if (newArtifacts.length > 0) {
      setReviewArtifact(newArtifacts[0]);
    }
    return newArtifacts;
  }

  function handleAccept(artifact: ForgeArtifact) {
    const exists = artifacts.some(a => a.id === artifact.id);
    const final = exists
      ? artifacts.map(a => a.id === artifact.id ? artifact : a)
      : [...artifacts, artifact];
    setArtifacts(final);
    onArtifactsUpdate(final);
    setReviewDialogOpen(false);
  }

  async function handleDialogSaveToLibrary(artifact: ForgeArtifact, category: string) {
    const categoryExists = existingCategories.some(
      c => c.name.toLowerCase() === category.toLowerCase(),
    );
    if (!categoryExists) {
      try {
        await createCategory.mutateAsync({ name: category, display_name: category });
      } catch {
        // ignore duplicate
      }
    }
    await createTemplate.mutateAsync({
      name: artifact.name,
      device_category: category,
      plc_brand: "SIEMENS_TIA",
      description: "",
      tags: [],
      blocks: [{ block_name: artifact.name, block_type: "FB", scl_code: artifact.content, sort_order: 0 }],
    });
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Sub-pipeline progress */}
      <div className="rounded-md border border-border/50 bg-muted/10 px-3 py-2">
        <ForgeSubPipeline stages={stages} />
      </div>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1 rounded-md border border-border/70">
        {/* Left panel — artifact list */}
        <ResizablePanel defaultSize={35} minSize={25}>
          <div className="flex h-full flex-col">
            <div className="border-b border-border/60 px-3 py-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                Artifacts
              </span>
              {artifacts.length > 0 && (
                <Badge variant="outline" className="ml-2 font-mono text-[10px]">
                  {approvedCount}/{artifacts.length} approved
                </Badge>
              )}
            </div>
            <ScrollArea className="flex-1">
              {artifacts.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  No artifacts yet — click Generate All
                </div>
              ) : (
                <div className="space-y-0.5 p-2">
                  {artifacts.map(a => (
                    <button
                      key={a.id}
                      onClick={() => setSelectedId(a.id)}
                      className={`group/row flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors ${selectedId === a.id ? "bg-primary/15 text-foreground" : "hover:bg-muted/40 text-muted-foreground"}`}
                    >
                      <button
                        onClick={e => { e.stopPropagation(); toggleApprove(a.id); }}
                        className="shrink-0"
                      >
                        {a.approved
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                          : <Circle className="h-3.5 w-3.5 text-muted-foreground/50" />}
                      </button>
                      <span className="min-w-0 flex-1 truncate font-mono">{a.name}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        {a.fb_template_id && (
                          <Badge variant="outline" className="font-mono text-[9px] border-green-600/40 text-green-500">
                            library
                          </Badge>
                        )}
                        {savedToLibrary.has(a.id) && (
                          <Badge variant="outline" className="font-mono text-[9px] border-blue-500/40 text-blue-400">
                            saved
                          </Badge>
                        )}
                        {typeBadge(a.type)}
                        {langBadge(a.language)}
                        <button
                          onClick={e => { e.stopPropagation(); setExpandedId(a.id); }}
                          className="ml-1 hidden rounded p-0.5 hover:bg-muted/60 group-hover/row:flex"
                          title="Open full-screen editor"
                        >
                          <Maximize2 className="h-3 w-3 text-muted-foreground" />
                        </button>
                        {a.type === "FB" && !a.fb_template_id && (
                          <button
                            onClick={e => { e.stopPropagation(); openReview(a); }}
                            className="ml-1 hidden rounded p-0.5 hover:bg-blue-500/20 group-hover/row:flex"
                            title="Review & edit this AI-generated FB"
                          >
                            <Pencil className="h-3 w-3 text-blue-400" />
                          </button>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right panel — Monaco editor */}
        <ResizablePanel defaultSize={65}>
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
              <span className="font-mono text-[11px] text-muted-foreground">
                {selected ? selected.name : "Select an artifact"}
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <ForgeCodeViewer
                artifact={selected}
                editable={editable}
                onToggleEditable={() => setEditable(v => !v)}
                onContentChange={content => { if (selected) updateContent(selected.id, content); }}
              />
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Bottom toolbar */}
      <div className="flex flex-col gap-2">
        {genLoading && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-muted-foreground">{progress.currentDevice}</span>
              <span className="font-mono text-xs text-muted-foreground">{progress.current}/{progress.total}</span>
            </div>
            <Progress value={progressPct} className="h-1.5" />
          </div>
        )}

        {currentStepLabel && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {currentStepLabel}
          </div>
        )}

        {genLog.length > 0 && (
          <GenerationLog entries={genLog} />
        )}

        {(genError ?? pipelineError) && (
          <div className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
            {genError && (
              <div className="flex items-center gap-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {genError}
              </div>
            )}
            {pipelineError && (
              <div className="flex items-center gap-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {pipelineError}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleGenerateAll}
            disabled={genLoading}
            className="gap-2"
          >
            {genLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Generate All
          </Button>

          {artifacts.length > 0 && (
            <>
              <Button variant="outline" onClick={approveAll} disabled={genLoading}>
                Approve All
              </Button>
              <Button
                variant="outline"
                onClick={() => void handleSaveToLibrary()}
                disabled={genLoading || approvedCount === 0 || createTemplate.isPending}
                className="gap-2"
                title="Save approved FB artifacts to FB Library"
              >
                {createTemplate.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <BookMarked className="h-3.5 w-3.5" />}
                Save FBs to Library
              </Button>
              <div className="flex-1" />
              <Button
                disabled={approvedCount === 0}
                onClick={onComplete}
              >
                Continue ({approvedCount} approved)
              </Button>
            </>
          )}
        </div>
      </div>

      <ForgeArtifactDialog
        artifacts={artifacts}
        initialId={expandedId}
        open={expandedId !== null}
        onClose={() => setExpandedId(null)}
        onContentChange={updateContent}
        onToggleApprove={toggleApprove}
      />

      <ForgeDeviceFbDialog
        open={reviewDialogOpen}
        artifact={reviewArtifact}
        device={reviewDevice}
        onAccept={handleAccept}
        onSaveToLibrary={(artifact, category) => void handleDialogSaveToLibrary(artifact, category)}
        onClose={() => setReviewDialogOpen(false)}
        onRegenerate={handleRegenerate}
        regenerating={genLoading}
      />
    </div>
  );
}
