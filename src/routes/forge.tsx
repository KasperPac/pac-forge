import { useEffect, useMemo, useState, useRef } from "react";
import {
  Link2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  FolderKanban,
  Sparkles,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { useParams, useSearchParams } from "react-router";
import { cn } from "@/lib/utils";
import { ForgeStepBar } from "@/components/forge/forge-step-bar";
import { ForgeSpecUpload } from "@/components/forge/steps/forge-spec-upload";
import { ForgeProjectSetup } from "@/components/forge/steps/forge-project-setup";
import { ForgeQaReview } from "@/components/forge/steps/forge-qa-review";
import { ForgeHardwareIo } from "@/components/forge/steps/forge-hardware-io";
import { ForgeMatrixReview } from "@/components/forge/steps/forge-matrix-review";
import { ForgeDeviceCode } from "@/components/forge/steps/forge-device-code";
import { ForgeProcessCode } from "@/components/forge/steps/forge-process-code";
import { ForgeHmi } from "@/components/forge/steps/forge-hmi";
import { ForgeTiaExport } from "@/components/forge/steps/forge-tia-export";
import { TiaProvisionDialog } from "@/components/forge/tia-provision-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { useForgeStore } from "@/stores/forge-store";
import { FORGE_STEP_LABELS, FORGE_STEP_ORDER } from "@/types/forge";
import type { ForgeStep, ForgeArtifact, ForgeHardwareConfig, ForgeIoEntry, ForgeDeviceEntry, SpecAnalysis, TiaForgeExportResult, QaMessage } from "@/types/forge";
import type { ProcessLinkageMatrix } from "@/types/process-builder";
import {
  useActiveForgeSession,
  useCreateForgeSession,
  useUpdateForgeSession,
} from "@/hooks/use-forge-session";
import { useDesignProfile } from "@/hooks/use-design-profiles";
import { useFbTemplates } from "@/hooks/use-fb-templates";
import { useActivePatterns } from "@/hooks/use-patterns";
import { useProject } from "@/hooks/use-projects";
import { useForgeProvision } from "@/hooks/use-forge-provision";
import { useToast } from "@/hooks/use-toast";
import type { ForgeProjectSetup as ForgeProjectSetupData, ForgeProjectSetupHandle } from "@/components/forge/steps/forge-project-setup";

export default function ForgePage() {
  const [searchParams] = useSearchParams();
  const params = useParams();
  const projectId = params.projectId ?? searchParams.get("projectId") ?? undefined;

  // Store
  const currentStep = useForgeStore(s => s.currentStep);
  const stepStatuses = useForgeStore(s => s.stepStatuses);
  const canProceedToNext = useForgeStore(s => s.canProceedToNext);
  const goToNextStep = useForgeStore(s => s.goToNextStep);
  const goToPreviousStep = useForgeStore(s => s.goToPreviousStep);
  const setCurrentStep = useForgeStore(s => s.setCurrentStep);
  const setStepStatus = useForgeStore(s => s.setStepStatus);
  const resetStore = useForgeStore(s => s.reset);

  const currentStepIndex = FORGE_STEP_ORDER.indexOf(currentStep);
  const isFirstStep = currentStepIndex <= 0;
  const isLastStep = currentStepIndex === FORGE_STEP_ORDER.length - 1;

  const completedCount = useMemo(
    () => FORGE_STEP_ORDER.filter(step => stepStatuses[step] === "completed").length,
    [stepStatuses],
  );

  const [headerCollapsed, setHeaderCollapsed] = useState(false);

  // Session
  const { data: session, isLoading: sessionLoading, isError: sessionError } = useActiveForgeSession(projectId);
  const { mutateAsync: createSession } = useCreateForgeSession();
  const { mutateAsync: updateSession } = useUpdateForgeSession();

  // Project data (for pre-filling step 2)
  const { data: project } = useProject(projectId);

  // Ref for project setup form — lets footer nav trigger save
  const projectSetupRef = useRef<ForgeProjectSetupHandle>(null);
  const [projectSetupCanSave, setProjectSetupCanSave] = useState(false);
  const { toast } = useToast();

  // TIA project provisioning (runs at IO approval)
  const { provision: provisionTia, status: provisionStatus, reset: resetProvision } = useForgeProvision();
  const [provisionDialogOpen, setProvisionDialogOpen] = useState(false);

  // Dependencies
  const { data: profile } = useDesignProfile(session?.design_profile_id ?? undefined);
  const { data: fbTemplates = [] } = useFbTemplates();
  const { data: patterns = [] } = useActivePatterns("SIEMENS_TIA");

  // Auto-create session if none exists
  useEffect(() => {
    if (!sessionLoading && !session && projectId) {
      createSession({ project_id: projectId, design_profile_id: null }).catch(console.error);
    }
  }, [sessionLoading, session, projectId, createSession]);

  // Activate current step
  useEffect(() => {
    if (stepStatuses[currentStep] === "pending") {
      setStepStatus(currentStep, "active");
    }
  }, [currentStep, setStepStatus, stepStatuses]);

  // Advance step
  function completeStep(step: ForgeStep) {
    setStepStatus(step, "completed");
    goToNextStep();
  }

  // Session update helpers
  async function saveSession(updates: Parameters<typeof updateSession>[0]["updates"]) {
    if (!session) return;
    await updateSession({ id: session.id, updates });
  }

  async function handleNewSession() {
    if (!projectId) return;
    resetStore();
    await createSession({ project_id: projectId, design_profile_id: null });
  }

  // Per-step handlers
  async function handleSpecComplete(specText: string, specFilename: string, analysis: SpecAnalysis) {
    await saveSession({ spec_text: specText, spec_filename: specFilename, spec_analysis: analysis, current_step: "qa_review" });
    completeStep("spec_upload");
  }

  async function handleQaComplete(updatedAnalysis: SpecAnalysis, _messages: QaMessage[]) {
    await saveSession({ spec_analysis: updatedAnalysis, current_step: "project_setup" });
    completeStep("qa_review");
  }

  async function handleProjectSetupComplete(setup: ForgeProjectSetupData) {
    try {
      await saveSession({
        design_profile_id: setup.design_profile_id,
        hardware_config: {
          cpu_type: setup.cpu_type,
          tia_version: setup.tia_version,
          racks: session?.hardware_config?.racks ?? [],
        },
        tia_project_path: setup.tia_project_path ?? null,
        device_fb_language: setup.device_fb_language,
        io_linking_language: setup.io_linking_language,
        process_code_language: setup.process_code_language,
        current_step: "hardware_io",
      });
      completeStep("project_setup");
    } catch (err) {
      toast({
        title: "Failed to save project setup",
        description: err instanceof Error ? err.message : "Database error — check console for details.",
        variant: "destructive",
      });
    }
  }

  async function handleHardwareIoComplete(
    hardware: ForgeHardwareConfig,
    ioList: ForgeIoEntry[],
    devices: ForgeDeviceEntry[],
  ) {
    await saveSession({ hardware_config: hardware, io_list: ioList, device_list: devices, current_step: "matrix_review" });

    // Provision the TIA project and show a progress dialog.
    // If bridge is offline it silently skips; compile step handles it later.
    if (session?.tia_project_path) {
      resetProvision();
      setProvisionDialogOpen(true);
      void provisionTia(
        session.tia_project_path,
        hardware,
        ioList,
        project?.description_short ?? undefined,
      );
    }

    completeStep("hardware_io");
  }

  async function handleMatrixComplete(matrix: ProcessLinkageMatrix) {
    await saveSession({ linkage_matrix: matrix, current_step: "device_code" });
    completeStep("matrix_review");
  }

  async function handleDeviceArtifactsUpdate(artifacts: ForgeArtifact[]) {
    await saveSession({ device_artifacts: artifacts });
  }

  async function handleProcessArtifactsUpdate(artifacts: ForgeArtifact[]) {
    await saveSession({ process_artifacts: artifacts });
  }

  async function handleHmiArtifactsUpdate(artifacts: ForgeArtifact[]) {
    await saveSession({ hmi_artifacts: artifacts });
  }

  async function handleExportComplete(result: TiaForgeExportResult) {
    await saveSession({ tia_export_result: result, current_step: "tia_export" });
    completeStep("tia_export");
  }

  // Default profile shim (so steps never receive undefined profile)
  // Session language overrides take precedence over whatever is on the design profile
  const profileOrDefault = {
    id: "",
    name: "Default",
    client_name: null,
    plc_brand: "SIEMENS_TIA",
    rules: "",
    general_rules: "",
    folder_rules: "",
    io_linking_rules: "",
    process_rules: [],
    fb_rules: [],
    device_fb_language: "SCL" as const,
    io_linking_language: "SCL" as const,
    process_code_language: "SCL" as const,
    hmi_theme: "default",
    naming_prefix: "",
    db_naming_prefix: "",
    created_by: null,
    updated_at: "",
    created_at: "",
    ...(profile ?? {}),
    // Apply session-level language overrides (set in project setup form)
    ...(session?.device_fb_language ? { device_fb_language: session.device_fb_language } : {}),
    ...(session?.io_linking_language ? { io_linking_language: session.io_linking_language } : {}),
    ...(session?.process_code_language ? { process_code_language: session.process_code_language } : {}),
  };

  function renderStep() {
    if (!session) return null;

    switch (currentStep) {
      case "spec_upload":
        return (
          <ForgeSpecUpload
            onComplete={handleSpecComplete}
            fbTemplates={fbTemplates}
            onSkip={() => {
              // Skip both spec upload and Q&A
              setStepStatus("qa_review", "completed");
              completeStep("spec_upload");
            }}
          />
        );

      case "qa_review":
        if (!session.spec_analysis) {
          // No spec — skip straight to project setup
          completeStep("qa_review");
          return null;
        }
        return (
          <ForgeQaReview
            specAnalysis={session.spec_analysis}
            specText={session.spec_text ?? undefined}
            onComplete={handleQaComplete}
            onSkip={() => {
              void saveSession({ current_step: "project_setup" });
              completeStep("qa_review");
            }}
          />
        );

      case "project_setup":
        return (
          <ForgeProjectSetup
            ref={projectSetupRef}
            specAnalysis={session.spec_analysis}
            project={project ?? null}
            onComplete={handleProjectSetupComplete}
            onCanSubmitChange={setProjectSetupCanSave}
            initialDeviceFbLanguage={session.device_fb_language ?? undefined}
            initialIoLinkingLanguage={session.io_linking_language ?? undefined}
            initialProcessCodeLanguage={session.process_code_language ?? undefined}
          />
        );

      case "hardware_io":
        return (
          <ForgeHardwareIo
            specAnalysis={session.spec_analysis}
            savedDevices={session.device_list?.length ? session.device_list : undefined}
            savedIoList={session.io_list?.length ? session.io_list : undefined}
            savedHardware={session.hardware_config ?? undefined}
            fbTemplates={fbTemplates}
            deviceFbLanguage={profileOrDefault.device_fb_language}
            provisionStatus={provisionStatus}
            onComplete={handleHardwareIoComplete}
          />
        );

      case "matrix_review":
        return (
          <ForgeMatrixReview
            session={session}
            fbTemplates={fbTemplates}
            onComplete={handleMatrixComplete}
          />
        );

      case "device_code":
        return (
          <ForgeDeviceCode
            session={session}
            profile={profileOrDefault}
            fbTemplates={fbTemplates}
            patterns={patterns}
            onArtifactsUpdate={handleDeviceArtifactsUpdate}
            onComplete={() => completeStep("device_code")}
          />
        );

      case "process_code":
        return (
          <ForgeProcessCode
            session={session}
            profile={profileOrDefault}
            patterns={patterns}
            onArtifactsUpdate={handleProcessArtifactsUpdate}
            onComplete={() => completeStep("process_code")}
          />
        );

      case "hmi":
        return (
          <ForgeHmi
            session={session}
            profile={profileOrDefault}
            onArtifactsUpdate={handleHmiArtifactsUpdate}
            onComplete={() => completeStep("hmi")}
          />
        );

      case "tia_export":
        return (
          <ForgeTiaExport
            session={session}
            onComplete={handleExportComplete}
          />
        );
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <TiaProvisionDialog
        open={provisionDialogOpen}
        status={provisionStatus}
        onClose={() => setProvisionDialogOpen(false)}
      />
      {/* Header — collapsible */}
      <Card className="border-border/70 bg-card/80">
        {/* Always-visible slim bar */}
        <button
          type="button"
          onClick={() => setHeaderCollapsed(c => !c)}
          className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/30 transition-colors rounded-t-lg"
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">Project Wizard</span>
          <div className="flex items-center gap-2 ml-2">
            <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.14em]">
              Step {currentStepIndex + 1}
            </Badge>
            <Badge variant="secondary" className="font-mono text-[10px] uppercase tracking-[0.14em]">
              {FORGE_STEP_LABELS[currentStep]}
            </Badge>
            {!projectId && (
              <Badge variant="destructive" className="font-mono text-[10px] uppercase tracking-[0.14em]">
                Missing projectId
              </Badge>
            )}
          </div>
          <ChevronDown className={cn("ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform duration-200", headerCollapsed && "-rotate-90")} />
        </button>

        {/* Collapsible body */}
        <div className={cn("grid transition-[grid-template-rows] duration-200", headerCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]")}>
          <div className="overflow-hidden">
            <CardHeader className="gap-4 pb-4 pt-0">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-xl">Forge pipeline workspace</CardTitle>
                  <CardDescription className="max-w-3xl text-sm">
                    Guided flow from functional specification through TIA Portal export.
                  </CardDescription>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2">
                    <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Project</div>
                    <div className="mt-1 flex items-center gap-2 text-sm">
                      <FolderKanban className="h-4 w-4 text-primary" />
                      <span className="truncate">{projectId ?? "No project"}</span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2">
                    <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Progress</div>
                    <div className="mt-1 text-sm">{completedCount} / {FORGE_STEP_ORDER.length} complete</div>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Session</div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 gap-1 px-1.5 font-mono text-[10px] text-muted-foreground hover:text-destructive"
                            title="Start a new session (discards current progress)"
                          >
                            <RotateCcw className="h-2.5 w-2.5" />
                            New
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Start a new session?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will create a fresh session and discard all current wizard progress — uploaded spec, Q&amp;A, hardware, devices, and generated code. The old session is not deleted and can be recovered from the database, but this wizard will start over from Step 1.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => void handleNewSession()}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Start Over
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-sm font-mono">
                      {sessionLoading
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        : session
                        ? <><Link2 className="h-3.5 w-3.5 text-green-500" />{session.id.slice(0, 8)}…</>
                        : <span className="text-muted-foreground">No session</span>}
                    </div>
                  </div>
                </div>
              </div>
            </CardHeader>
          </div>
        </div>
      </Card>

      {/* Step bar — hidden when header is collapsed */}
      {!headerCollapsed && (
        <ForgeStepBar
          steps={FORGE_STEP_ORDER}
          currentStep={currentStep}
          stepStatuses={stepStatuses}
          onStepClick={step => {
            if (step === currentStep || stepStatuses[step] === "completed") {
              setCurrentStep(step);
            }
          }}
        />
      )}

      {/* Step content */}
      <div className="min-h-0 flex-1 rounded-md border border-border/70 bg-card/70 p-5">
        {sessionLoading ? (
          <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading session…</span>
          </div>
        ) : sessionError ? (
          <div className="flex h-full items-center justify-center">
            <p className="font-mono text-sm text-destructive">Failed to load session — check database connection and migrations.</p>
          </div>
        ) : (
          renderStep()
        )}
      </div>

      {/* Footer nav */}
      <Card className="border-border/70 bg-card/80">
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={goToPreviousStep}
              disabled={isFirstStep}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[11px] uppercase tracking-[0.18em]">
              {stepStatuses[currentStep]}
            </Badge>
            {currentStep === "project_setup" ? (
              <Button
                size="sm"
                disabled={!projectSetupCanSave}
                onClick={() => projectSetupRef.current?.submit()}
              >
                Save Project Setup
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={goToNextStep}
                disabled={!canProceedToNext() || isLastStep}
              >
                {isLastStep ? "Complete" : "Next"}
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
