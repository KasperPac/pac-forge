import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Circle, Eye, Loader2, Monitor } from "lucide-react";
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
import { useForgeCompileCheck } from "@/hooks/use-forge-compile-check";
import { useForgeHmiGenerate } from "@/hooks/use-forge-hmi-generate";
import type { SubPipelineStage } from "@/components/forge/forge-sub-pipeline";
import type { DesignProfile } from "@/types/design-profile";
import type { HmiScreenSpec } from "@/types/hmi-screen";
import type { ForgeArtifact, ForgeSession } from "@/types/forge";

export interface ForgeHmiProps {
  session: ForgeSession;
  profile: DesignProfile;
  onArtifactsUpdate: (artifacts: ForgeArtifact[]) => void;
  onComplete: () => void;
}

const INITIAL_STAGES: SubPipelineStage[] = [
  { label: "Generate", status: "pending" },
  { label: "Approve", status: "pending" },
  { label: "Upload to TIA", status: "pending" },
];

function parseScreenSpec(content: string | undefined): HmiScreenSpec | null {
  if (!content) {
    return null;
  }

  try {
    return JSON.parse(content) as HmiScreenSpec;
  } catch {
    return null;
  }
}

function screenRoleLabel(role: HmiScreenSpec["screenRole"] | undefined): string {
  switch (role) {
    case "template_shell":
      return "Template Shell";
    case "overview":
      return "Overview";
    case "device_faceplate":
      return "Device Faceplate";
    case "subsystem_checklist":
      return "Subsystem Checklist";
    case "alarm_summary":
      return "Alarm Summary";
    case "popup":
      return "Popup";
    default:
      return "Screen";
  }
}

export function ForgeHmi({
  session,
  profile,
  onArtifactsUpdate,
  onComplete,
}: ForgeHmiProps) {
  const [artifacts, setArtifacts] = useState<ForgeArtifact[]>(session.hmi_artifacts ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(artifacts[0]?.id ?? null);
  const [stages, setStages] = useState<SubPipelineStage[]>(INITIAL_STAGES);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);

  const { generateAll, loading: genLoading, error: genError } = useForgeHmiGenerate();
  const { uploadHmi, loading: uploadLoading } = useForgeCompileCheck();

  const loading = genLoading || uploadLoading;
  const selected = artifacts.find((artifact) => artifact.id === selectedId) ?? null;
  const selectedScreen = useMemo(() => parseScreenSpec(selected?.content), [selected?.content]);
  const approvedCount = artifacts.filter((artifact) => artifact.approved).length;

  function setStageStatus(
    label: string,
    status: SubPipelineStage["status"],
    detail?: string,
  ) {
    setStages((previous) =>
      previous.map((stage) => (stage.label === label ? { ...stage, status, detail } : stage)),
    );
  }

  function toggleApprove(id: string) {
    const updated = artifacts.map((artifact) =>
      artifact.id === id ? { ...artifact, approved: !artifact.approved } : artifact,
    );
    setArtifacts(updated);
    onArtifactsUpdate(updated);
  }

  function approveAll() {
    const updated = artifacts.map((artifact) => ({ ...artifact, approved: true }));
    setArtifacts(updated);
    onArtifactsUpdate(updated);
    setStageStatus("Approve", "completed", `${updated.length} screens`);
  }

  async function handleGenerate() {
    setStages(INITIAL_STAGES.map((stage) => ({ ...stage, status: "pending" })));
    setUploadErrors([]);

    try {
      setStageStatus("Generate", "running");
      const generated = await generateAll(session, profile);
      setArtifacts(generated);
      onArtifactsUpdate(generated);
      if (generated.length > 0) {
        setSelectedId(generated[0].id);
      }
      setStageStatus("Generate", "completed", `${generated.length} screens`);
      setStageStatus("Approve", "pending");
    } catch {
      setStageStatus("Generate", "failed");
    }
  }

  async function handleUpload() {
    const approved = artifacts.filter((artifact) => artifact.approved);
    if (approved.length === 0) {
      return;
    }

    if (!session.tia_project_path) {
      setUploadErrors(["No TIA project path set."]);
      return;
    }

    setStageStatus("Approve", "completed", `${approved.length} approved`);
    setStageStatus("Upload to TIA", "running");

    const errors = await uploadHmi(approved, session.tia_project_path);
    if (errors.length === 0) {
      setStageStatus("Upload to TIA", "completed", `${approved.length} screens`);
      setUploadErrors([]);
      return;
    }

    setStageStatus("Upload to TIA", "failed", `${errors.length} errors`);
    setUploadErrors(errors);
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="rounded-md border border-border/50 bg-muted/10 px-3 py-2">
        <ForgeSubPipeline stages={stages} />
      </div>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1 rounded-md border border-border/70">
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
              {artifacts.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-3 py-8 text-center">
                  <Monitor className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-xs text-muted-foreground">
                    Generate the WinCC Unified screen suite to create the template shell, overview, subsystem checklists, and device faceplates.
                  </p>
                </div>
              ) : (
                <div className="space-y-0.5 p-2">
                  {artifacts.map((artifact) => (
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
                        {parseScreenSpec(artifact.content)?.screenRole && (
                          <Badge variant="secondary" className="ml-auto hidden text-[9px] uppercase tracking-wide md:inline-flex">
                            {screenRoleLabel(parseScreenSpec(artifact.content)?.screenRole)}
                          </Badge>
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

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
                          backgroundColor: selectedScreen.backgroundColor || "#0f172a",
                        }}
                      >
                        {selectedScreen.elements.slice(0, 24).map((element) => (
                          <div
                            key={element.id}
                            className="absolute overflow-hidden rounded-[2px] border text-[8px]"
                            style={{
                              left: `${(element.x / Math.max(selectedScreen.width, 1)) * 100}%`,
                              top: `${(element.y / Math.max(selectedScreen.height, 1)) * 100}%`,
                              width: `${(element.width / Math.max(selectedScreen.width, 1)) * 100}%`,
                              height: `${(element.height / Math.max(selectedScreen.height, 1)) * 100}%`,
                              backgroundColor: element.style.backgroundColor ?? "rgba(30,41,59,0.85)",
                              borderColor: element.style.borderColor ?? "rgba(148,163,184,0.6)",
                              borderWidth: Math.max(element.style.borderWidth ?? 1, 1),
                              color: element.style.textColor ?? "#e2e8f0",
                              borderRadius: element.style.borderRadius ?? 2,
                              opacity: element.style.opacity ?? 1,
                              zIndex: element.zIndex,
                            }}
                            title={`${element.name} (${element.type})`}
                          >
                            <div className="truncate px-1 py-0.5 font-mono leading-tight">
                              {element.text || element.name}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="grid gap-2 rounded-md border border-border/60 bg-background/60 p-3 text-[11px] font-mono text-muted-foreground md:grid-cols-2">
                        <div>
                          <span className="text-foreground">Platform:</span> {selectedScreen.targetPlatform ?? "wincc_unified_comfort"}
                        </div>
                        <div>
                          <span className="text-foreground">Suite:</span> {selectedScreen.templateSuite ?? "siemens_hmi_template_suite"}
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
                        {selectedScreen.checklistItems && selectedScreen.checklistItems.length > 0 && (
                          <div className="md:col-span-2">
                            <span className="text-foreground">Checklist:</span> {selectedScreen.checklistItems.length} item(s)
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="max-w-xs text-center text-xs text-muted-foreground">
                      Generate or select an HMI screen to preview its layout.
                    </div>
                  )}
                </div>
              </div>
              <div className="min-h-0">
                <Editor
                  height="100%"
                  language="json"
                  value={selected?.content ?? "// Select a screen to view its HmiScreenSpec JSON"}
                  options={{
                    readOnly: true,
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

      <div className="flex flex-col gap-2">
        {(genError ?? uploadErrors.length > 0) && (
          <div className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
            {genError && (
              <div className="flex items-center gap-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {genError}
              </div>
            )}
            {uploadErrors.map((error, index) => (
              <div key={index} className="flex items-center gap-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleGenerate} disabled={loading} className="gap-2">
            {genLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Generate Unified HMI Suite
          </Button>
          {artifacts.length > 0 ? (
            <>
              <Button variant="outline" onClick={approveAll} disabled={loading}>
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
            </>
          ) : (
            !loading && (
              <>
                <div className="flex-1" />
                <Button variant="outline" onClick={onComplete}>
                  Skip HMI
                </Button>
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}
