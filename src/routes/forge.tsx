import { useEffect, useMemo } from "react";
import { Link2, ChevronLeft, ChevronRight, FolderKanban, Sparkles } from "lucide-react";
import { useParams, useSearchParams } from "react-router";
import { ForgeStepBar } from "@/components/forge/forge-step-bar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useForgeStore } from "@/stores/forge-store";
import { FORGE_STEP_LABELS, FORGE_STEP_ORDER } from "@/types/forge";
import type { ForgeStep } from "@/types/forge";

const STEP_DESCRIPTIONS: Record<ForgeStep, string> = {
  spec_upload: "Upload a functional specification or start from scratch.",
  project_setup: "Confirm metadata, profile defaults, language, and target PLC.",
  hardware_io: "Review hardware modules, network layout, device list, and IO.",
  device_code: "Generate and review device-level FBs, DBs, and IO linking blocks.",
  process_code: "Generate the sequence logic that orchestrates the device layer.",
  hmi: "Create basic HMI screens and tags for the selected device set.",
  tia_export: "Import approved artifacts into TIA Portal and compile the project.",
};

const STEP_ACTION_LABELS: Record<ForgeStep, string> = {
  spec_upload: "Analyze Spec",
  project_setup: "Save Setup",
  hardware_io: "Confirm IO",
  device_code: "Generate Device Code",
  process_code: "Generate Process Code",
  hmi: "Generate HMI",
  tia_export: "Export to TIA",
};

function ForgeStepPlaceholder({ step }: { step: ForgeStep }) {
  return (
    <Card className="h-full border-border/70 bg-card/70">
      <CardHeader className="gap-2 border-b border-border/60 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">{FORGE_STEP_LABELS[step]}</CardTitle>
            <CardDescription className="mt-1 text-sm">
              {STEP_DESCRIPTIONS[step]}
            </CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-[11px] uppercase tracking-[0.2em]">
            {step.replace("_", " ")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex h-[calc(100%-93px)] flex-col gap-4 p-5">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
          <div className="rounded-lg border border-dashed border-border/70 bg-background/50 p-4">
            <div className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Active Step Workspace
            </div>
            <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
              This shell is in place so the dedicated step component can plug in without
              reworking the route. Data loading, form controls, editors, and AI actions
              will be mounted here in the next task passes.
            </p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/50 p-4">
            <div className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Planned Actions
            </div>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>Resume or create forge session when hooks are available.</li>
              <li>Sync step completion with server-side session state.</li>
              <li>Render the step-specific component for this stage.</li>
            </ul>
          </div>
        </div>
        <div className="mt-auto rounded-lg border border-border/70 bg-background/40 p-4">
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Step Summary
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {STEP_DESCRIPTIONS[step]}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ForgePage() {
  const [searchParams] = useSearchParams();
  const params = useParams();
  const currentStep = useForgeStore((state) => state.currentStep);
  const stepStatuses = useForgeStore((state) => state.stepStatuses);
  const canProceedToNext = useForgeStore((state) => state.canProceedToNext);
  const goToNextStep = useForgeStore((state) => state.goToNextStep);
  const goToPreviousStep = useForgeStore((state) => state.goToPreviousStep);
  const setCurrentStep = useForgeStore((state) => state.setCurrentStep);
  const setStepStatus = useForgeStore((state) => state.setStepStatus);

  const projectId = params.projectId ?? searchParams.get("projectId");
  const currentStepIndex = FORGE_STEP_ORDER.indexOf(currentStep);
  const isFirstStep = currentStepIndex <= 0;
  const isLastStep = currentStepIndex === FORGE_STEP_ORDER.length - 1;
  const actionLabel = STEP_ACTION_LABELS[currentStep];

  const completedCount = useMemo(
    () =>
      FORGE_STEP_ORDER.filter((step) => stepStatuses[step] === "completed").length,
    [stepStatuses]
  );

  useEffect(() => {
    if (stepStatuses[currentStep] === "pending") {
      setStepStatus(currentStep, "active");
    }
  }, [currentStep, setStepStatus, stepStatuses]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Card className="border-border/70 bg-card/80">
        <CardHeader className="gap-4 pb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="font-mono text-xs uppercase tracking-[0.24em]">
                  Project Wizard
                </span>
              </div>
              <div>
                <CardTitle className="text-xl">Forge pipeline workspace</CardTitle>
                <CardDescription className="mt-1 max-w-3xl text-sm">
                  Guided flow from functional specification through TIA Portal export.
                  This shell is ready for the forge-specific hooks and step components.
                </CardDescription>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Project
                </div>
                <div className="mt-1 flex items-center gap-2 text-sm">
                  <FolderKanban className="h-4 w-4 text-primary" />
                  <span>{projectId ?? "No project selected"}</span>
                </div>
              </div>
              <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Progress
                </div>
                <div className="mt-1 text-sm">{completedCount} / {FORGE_STEP_ORDER.length} complete</div>
              </div>
              <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Session
                </div>
                <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                  <Link2 className="h-4 w-4" />
                  Forge session hooks pending
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono text-[11px] uppercase tracking-[0.18em]">
              Step {currentStepIndex + 1}
            </Badge>
            <Badge variant="secondary" className="font-mono text-[11px] uppercase tracking-[0.18em]">
              {FORGE_STEP_LABELS[currentStep]}
            </Badge>
            {!projectId && (
              <Badge variant="destructive" className="font-mono text-[11px] uppercase tracking-[0.18em]">
                Missing projectId
              </Badge>
            )}
          </div>
        </CardHeader>
      </Card>

      <ForgeStepBar
        steps={FORGE_STEP_ORDER}
        currentStep={currentStep}
        stepStatuses={stepStatuses}
        onStepClick={(step) => {
          if (step === currentStep || stepStatuses[step] === "completed") {
            setCurrentStep(step);
          }
        }}
      />

      <div className="min-h-0 flex-1">
        <ForgeStepPlaceholder step={currentStep} />
      </div>

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
            <Button
              size="sm"
              onClick={() => setStepStatus(currentStep, "completed")}
            >
              {actionLabel}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[11px] uppercase tracking-[0.18em]">
              {stepStatuses[currentStep]}
            </Badge>
            <Button
              size="sm"
              onClick={goToNextStep}
              disabled={!canProceedToNext() || isLastStep}
            >
              {isLastStep ? "Complete" : "Next"}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
