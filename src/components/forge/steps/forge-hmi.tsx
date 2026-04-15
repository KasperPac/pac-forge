import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Circle, Eye, ExternalLink, Loader2, Monitor } from "lucide-react";
import Editor from "@monaco-editor/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ForgeSubPipeline } from "@/components/forge/forge-sub-pipeline";
import { HmiConfigurator } from "@/components/forge/steps/forge-hmi-configurator";
import { useForgeCompileCheck } from "@/hooks/use-forge-compile-check";
import { useForgeHmiGenerate } from "@/hooks/use-forge-hmi-generate";
import type { SubPipelineStage } from "@/components/forge/forge-sub-pipeline";
import type { DesignProfile } from "@/types/design-profile";
import type { HmiScreenSpec } from "@/types/hmi-screen";
import type { HmiPanelConfig, HmiScreenCategory, FaceplateCatalogEntry } from "@/types/hmi-panel";
import type { ForgeArtifact, ForgeSession } from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";

export interface ForgeHmiProps {
  session: ForgeSession;
  profile: DesignProfile;
  fbTemplates: FbTemplate[];
  onArtifactsUpdate: (artifacts: ForgeArtifact[]) => void;
  onComplete: () => void;
}

type HmiPhase = "configure" | "generating" | "review";

const STAGED_PIPELINE: SubPipelineStage[] = [
  { label: "Configure", status: "pending" },
  { label: "Generate Framework", status: "pending" },
  { label: "Generate Custom (AI)", status: "pending" },
  { label: "Approve", status: "pending" },
  { label: "Upload to TIA", status: "pending" },
];

function parseScreenSpec(content: string | undefined): HmiScreenSpec | null {
  if (!content) return null;
  try {
    return JSON.parse(content) as HmiScreenSpec;
  } catch {
    return null;
  }
}

function screenRoleLabel(role: HmiScreenSpec["screenRole"] | undefined): string {
  switch (role) {
    case "template_shell": return "Template Shell";
    case "overview": return "Overview";
    case "device_faceplate": return "Device Faceplate";
    case "subsystem_checklist": return "Subsystem Checklist";
    case "device_checklist": return "Device Checklist";
    case "alarm_summary": return "Alarm Summary";
    case "trend": return "Trend";
    case "popup": return "Popup";
    case "custom": return "Custom";
    default: return "Screen";
  }
}

/** Type-based border accent for the mini-preview so element types are visually distinct */
function elementTypeColor(type: string): string {
  switch (type) {
    case "FACEPLATE": return "rgba(168,85,247,0.7)";   // purple
    case "BUTTON": return "rgba(59,130,246,0.7)";      // blue
    case "IO_FIELD": return "rgba(34,197,94,0.7)";     // green
    case "SCREEN_WINDOW": return "rgba(236,72,153,0.7)"; // pink
    case "ALARM_VIEW": return "rgba(239,68,68,0.7)";   // red
    case "TREND_VIEW": return "rgba(14,165,233,0.7)";  // sky
    case "TEXT": return "rgba(148,163,184,0.4)";        // subtle
    case "DATE_TIME": return "rgba(148,163,184,0.4)";
    case "CIRCLE": return "rgba(250,204,21,0.6)";      // yellow
    default: return "rgba(148,163,184,0.5)";
  }
}

export function ForgeHmi({
  session,
  profile,
  fbTemplates,
  onArtifactsUpdate,
  onComplete,
}: ForgeHmiProps) {
  const [phase, setPhase] = useState<HmiPhase>(
    session.hmi_artifacts?.length > 0 ? "review" : "configure",
  );
  const [artifacts, setArtifacts] = useState<ForgeArtifact[]>(session.hmi_artifacts ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(artifacts[0]?.id ?? null);
  const [stages, setStages] = useState<SubPipelineStage[]>(STAGED_PIPELINE);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);

  const { generateStaged, loading: genLoading, error: genError } = useForgeHmiGenerate();
  const { uploadHmi, loading: uploadLoading } = useForgeCompileCheck();

  const loading = genLoading || uploadLoading;
  const selected = artifacts.find((a) => a.id === selectedId) ?? null;
  const selectedScreen = useMemo(() => parseScreenSpec(selected?.content), [selected?.content]);
  const approvedCount = artifacts.filter((a) => a.approved).length;

  function setStageStatus(label: string, status: SubPipelineStage["status"], detail?: string) {
    setStages((prev) =>
      prev.map((s) => (s.label === label ? { ...s, status, detail } : s)),
    );
  }

  function toggleApprove(id: string) {
    const updated = artifacts.map((a) =>
      a.id === id ? { ...a, approved: !a.approved } : a,
    );
    setArtifacts(updated);
    onArtifactsUpdate(updated);
  }

  function approveAll() {
    const updated = artifacts.map((a) => ({ ...a, approved: true }));
    setArtifacts(updated);
    onArtifactsUpdate(updated);
    setStageStatus("Approve", "completed", `${updated.length} screens`);
  }

  async function handleConfigured(
    _config: HmiPanelConfig,
    _catalog: FaceplateCatalogEntry[],
    categories: HmiScreenCategory[],
    importedFramework: HmiScreenSpec[] | null,
  ) {
    setPhase("generating");
    setStages(STAGED_PIPELINE.map((s) => ({ ...s, status: "pending" })));
    setUploadErrors([]);

    setStageStatus("Configure", "completed");

    try {
      setStageStatus("Generate Framework", "running");

      const hasAiCategories = categories.some((c) =>
        ["alarm_summary", "trend", "device_faceplate", "custom"].includes(c),
      );

      const result = await generateStaged(session, profile, fbTemplates, categories);

      // If user imported framework from TIA, replace deterministic framework with imported screens
      let finalArtifacts = result.artifacts;
      if (importedFramework && importedFramework.length > 0) {
        // Remove the deterministic framework screen and prepend imported ones
        const nonFramework = result.artifacts.filter((a) => {
          const spec = parseScreenSpec(a.content);
          return spec?.screenRole !== "template_shell";
        });
        const importedArtifacts: ForgeArtifact[] = importedFramework.map((spec) => ({
          id: crypto.randomUUID(),
          name: spec.name,
          type: "HMI_SCREEN" as const,
          language: "SCL" as const,
          content: JSON.stringify(spec, null, 2),
          approved: false,
          stage: "hmi" as const,
          destination_folder: "HMI/TemplateSuite",
          dependencies: [],
          compile_after_import: false,
          deterministic: true,
        }));
        finalArtifacts = [...importedArtifacts, ...nonFramework];
      }

      const detCount = finalArtifacts.filter((a) => a.deterministic).length;
      const aiCount = finalArtifacts.length - detCount;

      const frameworkLabel = importedFramework
        ? `${importedFramework.length} imported from TIA`
        : `${detCount} screens`;
      setStageStatus("Generate Framework", "completed", frameworkLabel);

      if (hasAiCategories) {
        setStageStatus("Generate Custom (AI)", "completed", `${aiCount} screens`);
      } else {
        setStageStatus("Generate Custom (AI)", "completed", "skipped");
      }

      setArtifacts(finalArtifacts);
      onArtifactsUpdate(finalArtifacts);
      if (finalArtifacts.length > 0) {
        setSelectedId(finalArtifacts[0].id);
      }

      setPhase("review");
    } catch {
      setStageStatus("Generate Framework", "failed");
      setPhase("configure");
    }
  }

  async function handleUpload() {
    const approved = artifacts.filter((a) => a.approved);
    if (approved.length === 0) return;

    // Unified artifacts don't need a project path — the bridge is attached to
    // whatever project is open in TIA Portal. Only Comfort artifacts need the path.
    const hasComfortArtifacts = approved.some((a) => a.destination_folder !== "HMI/Unified");
    if (hasComfortArtifacts && !session.tia_project_path) {
      setUploadErrors(["No TIA project path set (required for Comfort HMI upload)."]);
      return;
    }

    setStageStatus("Approve", "completed", `${approved.length} approved`);
    setStageStatus("Upload to TIA", "running");

    const errors = await uploadHmi(approved, session.tia_project_path ?? "");
    if (errors.length === 0) {
      setStageStatus("Upload to TIA", "completed", `${approved.length} screens`);
      setUploadErrors([]);
      return;
    }

    setStageStatus("Upload to TIA", "failed", `${errors.length} errors`);
    setUploadErrors(errors);
  }

  // ── Configure phase ─────────────────────────────────────────────────────
  if (phase === "configure") {
    return (
      <div className="flex h-full flex-col gap-3">
        <div className="rounded-md border border-border/50 bg-muted/10 px-3 py-2">
          <ForgeSubPipeline stages={stages} />
        </div>
        <ScrollArea className="flex-1">
          <div className="mx-auto max-w-2xl py-4">
            <HmiConfigurator
              session={session}
              profile={profile}
              fbTemplates={fbTemplates}
              onConfigured={handleConfigured}
            />
          </div>
        </ScrollArea>
        <div className="flex items-center justify-end">
          <Button variant="outline" onClick={onComplete}>Skip HMI</Button>
        </div>
      </div>
    );
  }

  // ── Generating phase (brief loading state) ──────────────────────────────
  if (phase === "generating") {
    return (
      <div className="flex h-full flex-col gap-3">
        <div className="rounded-md border border-border/50 bg-muted/10 px-3 py-2">
          <ForgeSubPipeline stages={stages} />
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Generating HMI screens...</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Review phase (screen list + preview + actions) ──────────────────────
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="rounded-md border border-border/50 bg-muted/10 px-3 py-2">
        <ForgeSubPipeline stages={stages} />
      </div>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1 rounded-md border border-border/70">
        {/* Screen List */}
        <ResizablePanel defaultSize={30} minSize={20}>
          <div className="flex h-full flex-col">
            <div className="border-b border-border/60 px-3 py-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                HMI Screens
              </span>
              {artifacts.length > 0 && (
                <Badge variant="outline" className="ml-2 font-mono text-[10px]">
                  {approvedCount}/{artifacts.length}
                </Badge>
              )}
            </div>
            <ScrollArea className="flex-1">
              <div className="space-y-0.5 p-2">
                {artifacts.map((artifact) => {
                  const spec = parseScreenSpec(artifact.content);
                  return (
                    <div
                      key={artifact.id}
                      className={`flex items-center gap-2 rounded-md px-2 py-2 text-xs transition-colors ${
                        selectedId === artifact.id
                          ? "bg-primary/15 text-foreground"
                          : "text-muted-foreground hover:bg-muted/40"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleApprove(artifact.id)}
                        className="shrink-0"
                      >
                        {artifact.approved ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                        ) : (
                          <Circle className="h-3.5 w-3.5 text-muted-foreground/50" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedId(artifact.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <Monitor className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                        <span className="truncate font-mono">{artifact.name}</span>
                        <div className="ml-auto flex items-center gap-1">
                          {artifact.deterministic ? (
                            <Badge variant="outline" className="text-[8px] px-1 py-0 bg-green-500/10 text-green-400 border-green-500/20">
                              DET
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[8px] px-1 py-0 bg-violet-500/10 text-violet-400 border-violet-500/20">
                              AI
                            </Badge>
                          )}
                          {spec?.screenRole && (
                            <Badge variant="secondary" className="hidden text-[8px] uppercase tracking-wide md:inline-flex">
                              {screenRoleLabel(spec.screenRole)}
                            </Badge>
                          )}
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Preview + JSON */}
        <ResizablePanel defaultSize={70}>
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
              <span className="font-mono text-[11px] text-muted-foreground">
                {selected ? `${selected.name} - HmiScreenSpec JSON` : "Select a screen"}
              </span>
              <div className="flex items-center gap-2">
                {selectedScreen?.screenRole && (
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    {screenRoleLabel(selectedScreen.screenRole)}
                  </Badge>
                )}
                {selectedScreen && (
                  <Badge variant="outline" className="gap-1 font-mono text-[10px]">
                    <Eye className="h-3 w-3" />
                    {selectedScreen.elements.length} elements
                  </Badge>
                )}
              </div>
            </div>
            <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.15fr)]">
              {/* Visual Preview */}
              <div className="flex min-h-[260px] flex-col border-b border-border/60 bg-background/40 lg:min-h-0 lg:border-b-0 lg:border-r">
                <div className="border-b border-border/60 px-3 py-2">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                    Visual Preview
                  </span>
                </div>
                <div className="flex min-h-0 flex-1 items-center justify-center p-4">
                  {selectedScreen ? (
                    <div className="w-full max-w-[460px] space-y-3">
                      <div
                        className="relative w-full overflow-hidden rounded-md border border-border/70 bg-slate-950 shadow-inner"
                        style={{
                          aspectRatio: `${selectedScreen.width || 1920} / ${selectedScreen.height || 1080}`,
                          backgroundColor: selectedScreen.backgroundColor || "#1E1E1E",
                        }}
                      >
                        {selectedScreen.elements.slice(0, 40).map((element) => (
                          <div
                            key={element.id}
                            className="absolute overflow-hidden rounded-[2px] text-[7px]"
                            style={{
                              left: `${(element.x / Math.max(selectedScreen.width, 1)) * 100}%`,
                              top: `${(element.y / Math.max(selectedScreen.height, 1)) * 100}%`,
                              width: `${(element.width / Math.max(selectedScreen.width, 1)) * 100}%`,
                              height: `${(element.height / Math.max(selectedScreen.height, 1)) * 100}%`,
                              backgroundColor: element.style.backgroundColor ?? "rgba(30,41,59,0.85)",
                              borderColor: elementTypeColor(element.type),
                              borderWidth: element.type === "TEXT" || element.type === "DATE_TIME" ? 0 : 1,
                              borderStyle: "solid",
                              color: element.style.textColor ?? "#e2e8f0",
                              borderRadius: element.style.borderRadius ?? 2,
                              opacity: element.style.opacity ?? 1,
                              zIndex: element.zIndex,
                            }}
                            title={`${element.name} (${element.type})${element.faceplateTypeName ? ` — ${element.faceplateTypeName}` : ""}${element.tagBinding ? ` [${element.tagBinding}]` : ""}`}
                          >
                            <div className="truncate px-0.5 py-0 font-mono leading-tight">
                              {element.type === "FACEPLATE"
                                ? element.faceplateTypeName ?? element.name
                                : element.text || element.name}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="grid gap-2 rounded-md border border-border/60 bg-background/60 p-3 text-[11px] font-mono text-muted-foreground md:grid-cols-2">
                        <div>
                          <span className="text-foreground">Panel:</span> {session.hmi_panel_config?.panelModel ?? profile.hmi_panel_model ?? "TP1500"}
                        </div>
                        <div>
                          <span className="text-foreground">Family:</span> {session.hmi_panel_config?.family ?? profile.hmi_panel_family ?? "comfort"}
                        </div>
                        <div>
                          <span className="text-foreground">Role:</span> {screenRoleLabel(selectedScreen.screenRole)}
                        </div>
                        <div>
                          <span className="text-foreground">Screen #:</span> {selectedScreen.screenNumber ?? "n/a"}
                        </div>
                        {selectedScreen.subsystem && (
                          <div>
                            <span className="text-foreground">Subsystem:</span> {selectedScreen.subsystem}
                          </div>
                        )}
                        {selectedScreen.deviceType && (
                          <div>
                            <span className="text-foreground">Device Type:</span> {selectedScreen.deviceType}
                          </div>
                        )}
                        <div className="md:col-span-2">
                          <span className="text-foreground">Elements:</span> {selectedScreen.elements.length}
                          {" | "}
                          {selectedScreen.elements.filter((e) => e.type === "FACEPLATE").length} faceplates
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full gap-1.5 text-xs"
                        onClick={() => {
                          // Store screen spec in sessionStorage for the editor to pick up
                          sessionStorage.setItem("forge-hmi-preview", selected?.content ?? "");
                          window.open("/hmi-editor?from=forge", "_blank");
                        }}
                      >
                        <ExternalLink className="h-3 w-3" />
                        Open in HMI Editor
                      </Button>
                    </div>
                  ) : (
                    <div className="max-w-xs text-center text-xs text-muted-foreground">
                      Select a screen to preview its layout.
                    </div>
                  )}
                </div>
              </div>
              {/* JSON Editor */}
              <div className="min-h-0">
                <Editor
                  height="100%"
                  language="json"
                  value={selected?.content ?? "// Select a screen to view its HmiScreenSpec JSON"}
                  options={{
                    readOnly: !!selected?.deterministic,
                    minimap: { enabled: false },
                    fontSize: 12,
                    fontFamily: "JetBrains Mono, Consolas, monospace",
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    theme: "vs-dark",
                  }}
                />
              </div>
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Error display */}
      {(genError ?? uploadErrors.length > 0) && (
        <div className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
          {genError && (
            <div className="flex items-center gap-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {genError}
            </div>
          )}
          {uploadErrors.map((err, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {err}
            </div>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={() => setPhase("configure")}
          disabled={loading}
        >
          Reconfigure
        </Button>
        <Button variant="outline" onClick={approveAll} disabled={loading || artifacts.length === 0}>
          Approve All
        </Button>
        <Button
          variant="outline"
          onClick={handleUpload}
          disabled={loading || approvedCount === 0 || !session.tia_project_path}
          title={!session.tia_project_path ? "No TIA project path set" : ""}
          className="gap-2"
        >
          {uploadLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Upload to TIA
        </Button>
        <div className="flex-1" />
        <Button onClick={onComplete}>
          {approvedCount > 0 ? `Continue (${approvedCount} approved)` : "Skip HMI"}
        </Button>
      </div>
    </div>
  );
}
