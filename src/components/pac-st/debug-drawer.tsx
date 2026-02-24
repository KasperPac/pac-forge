import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgentAvatar } from "@/components/agent-avatar";
import { usePacStStore } from "@/stores/pac-st-store";
import { Clock, Cpu, FileText, BookOpen } from "lucide-react";
import type { PipelineStepResult } from "@/lib/pipeline";

const ROLE_LABELS: Record<string, string> = {
  plan: "Plan",
  generate: "Generate",
  review: "Review",
  patterns: "Patterns",
  summary: "Summary",
};

function StepSelector({
  steps,
  selectedId,
  onSelect,
}: {
  steps: PipelineStepResult[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Select value={selectedId} onValueChange={onSelect}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {steps.map((step, i) => (
          <SelectItem key={`${step.agentId}-${i}`} value={step.agentId}>
            <div className="flex items-center gap-2">
              <AgentAvatar
                displayName={step.agentName.replace(" (Summary)", "")}
                size="xs"
              />
              <span className="font-mono text-xs">
                {step.agentName}
              </span>
              <span className="text-[10px] text-muted-foreground">
                ({ROLE_LABELS[step.role] ?? step.role})
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PromptTab({ step }: { step: PipelineStepResult }) {
  if (!step.systemPrompt) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        No prompt data for this step.
      </div>
    );
  }

  return (
    <ScrollArea className="h-[calc(100vh-16rem)]">
      <div className="space-y-3 pr-4">
        <div>
          <div className="mb-1 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            System Prompt
          </div>
          <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
            {step.systemPrompt}
          </pre>
        </div>
      </div>
    </ScrollArea>
  );
}

function ResponseTab({ step }: { step: PipelineStepResult }) {
  if (!step.rawResponse) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        No response data for this step.
      </div>
    );
  }

  return (
    <ScrollArea className="h-[calc(100vh-16rem)]">
      <div className="pr-4">
        <div className="mb-1 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Raw Response
        </div>
        <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
          {step.rawResponse}
        </pre>
      </div>
    </ScrollArea>
  );
}

function MetricsTab({ steps }: { steps: PipelineStepResult[] }) {
  const completedSteps = steps.filter((s) => s.status === "completed" || s.status === "failed");
  const totalDuration = completedSteps.reduce((sum, s) => sum + s.durationMs, 0);
  const totalInput = completedSteps.reduce((sum, s) => sum + (s.tokenUsage?.input ?? 0), 0);
  const totalOutput = completedSteps.reduce((sum, s) => sum + (s.tokenUsage?.output ?? 0), 0);

  return (
    <ScrollArea className="h-[calc(100vh-16rem)]">
      <div className="space-y-4 pr-4">
        {/* Totals */}
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="mb-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Pipeline Totals
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="font-mono text-lg font-semibold">
                {(totalDuration / 1000).toFixed(1)}s
              </div>
              <div className="font-mono text-[10px] text-muted-foreground">Duration</div>
            </div>
            <div>
              <div className="font-mono text-lg font-semibold">
                {totalInput.toLocaleString()}
              </div>
              <div className="font-mono text-[10px] text-muted-foreground">Input tokens</div>
            </div>
            <div>
              <div className="font-mono text-lg font-semibold">
                {totalOutput.toLocaleString()}
              </div>
              <div className="font-mono text-[10px] text-muted-foreground">Output tokens</div>
            </div>
          </div>
        </div>

        {/* Per-step metrics */}
        <div className="space-y-2">
          <div className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Per Agent
          </div>
          {completedSteps.map((step, i) => (
            <div
              key={`${step.agentId}-${i}`}
              className="flex items-center gap-3 rounded-md border px-3 py-2"
            >
              <AgentAvatar
                displayName={step.agentName.replace(" (Summary)", "")}
                size="xs"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs font-medium">
                  {step.agentName}
                </div>
                <div className="font-mono text-[10px] text-muted-foreground">
                  {ROLE_LABELS[step.role] ?? step.role}
                  {step.artifactsModified.length > 0 &&
                    ` · ${step.artifactsModified.length} modified`}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono text-xs">
                  {(step.durationMs / 1000).toFixed(1)}s
                </div>
                {step.tokenUsage && (
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {step.tokenUsage.input.toLocaleString()} in / {step.tokenUsage.output.toLocaleString()} out
                  </div>
                )}
                {!step.tokenUsage && (
                  <div className="font-mono text-[10px] text-muted-foreground">
                    streaming
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}

function KnowledgeTab({ step }: { step: PipelineStepResult }) {
  // Knowledge docs are embedded in the system prompt.
  // Extract sections that match the "Reference Documentation" header pattern.
  const prompt = step.systemPrompt;
  if (!prompt) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        No knowledge data for this step.
      </div>
    );
  }

  const refIdx = prompt.indexOf("**Reference Documentation:**");
  if (refIdx === -1) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        No knowledge docs were injected for {step.agentName}.
      </div>
    );
  }

  // Extract from the reference docs header to the next ## heading or end
  const afterRef = prompt.slice(refIdx);
  const nextSectionMatch = afterRef.slice(30).search(/\n## /);
  const knowledgeText =
    nextSectionMatch === -1
      ? afterRef
      : afterRef.slice(0, nextSectionMatch + 30);

  return (
    <ScrollArea className="h-[calc(100vh-16rem)]">
      <div className="pr-4">
        <div className="mb-1 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Injected Knowledge — {step.agentName}
        </div>
        <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
          {knowledgeText}
        </pre>
      </div>
    </ScrollArea>
  );
}

export function DebugDrawer() {
  const open = usePacStStore((s) => s.debugDrawerOpen);
  const setOpen = usePacStStore((s) => s.setDebugDrawerOpen);
  const execution = usePacStStore((s) => s.pipelineExecution);

  const steps = execution?.steps ?? [];
  const [selectedStepId, setSelectedStepId] = useState<string>("");

  // Auto-select first step if none selected or invalid
  const validSelection = steps.find((s) => s.agentId === selectedStepId);
  const activeStep = validSelection ?? steps[0];
  const activeStepId = activeStep?.agentId ?? "";

  if (!execution || steps.length === 0) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-[520px] sm:max-w-[520px]">
          <SheetHeader>
            <SheetTitle className="font-mono text-sm">Pipeline Debug</SheetTitle>
            <SheetDescription>
              No pipeline execution data available. Run a generation first.
            </SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-[600px] p-0 sm:max-w-[600px]">
        <div className="flex h-full flex-col">
          <div className="space-y-3 border-b px-4 pb-3 pt-4">
            <SheetHeader className="space-y-0.5">
              <SheetTitle className="font-mono text-sm">Pipeline Debug</SheetTitle>
              <SheetDescription className="font-mono text-[10px]">
                {steps.length} step(s) · {execution.completedAt ? "Complete" : "Running"}
                {execution.completedAt && ` · ${execution.finalArtifactCount} artifact(s)`}
              </SheetDescription>
            </SheetHeader>

            <StepSelector
              steps={steps}
              selectedId={activeStepId}
              onSelect={setSelectedStepId}
            />
          </div>

          <div className="flex-1 overflow-hidden px-4 pb-4 pt-2">
            <Tabs defaultValue="prompt" className="flex h-full flex-col">
              <TabsList className="w-full">
                <TabsTrigger value="prompt" className="flex-1 gap-1.5 font-mono text-xs">
                  <FileText className="h-3 w-3" />
                  Prompt
                </TabsTrigger>
                <TabsTrigger value="response" className="flex-1 gap-1.5 font-mono text-xs">
                  <Cpu className="h-3 w-3" />
                  Response
                </TabsTrigger>
                <TabsTrigger value="metrics" className="flex-1 gap-1.5 font-mono text-xs">
                  <Clock className="h-3 w-3" />
                  Metrics
                </TabsTrigger>
                <TabsTrigger value="knowledge" className="flex-1 gap-1.5 font-mono text-xs">
                  <BookOpen className="h-3 w-3" />
                  Knowledge
                </TabsTrigger>
              </TabsList>

              {activeStep && (
                <>
                  <TabsContent value="prompt" className="flex-1 overflow-hidden">
                    <PromptTab step={activeStep} />
                  </TabsContent>
                  <TabsContent value="response" className="flex-1 overflow-hidden">
                    <ResponseTab step={activeStep} />
                  </TabsContent>
                  <TabsContent value="metrics" className="flex-1 overflow-hidden">
                    <MetricsTab steps={steps} />
                  </TabsContent>
                  <TabsContent value="knowledge" className="flex-1 overflow-hidden">
                    <KnowledgeTab step={activeStep} />
                  </TabsContent>
                </>
              )}
            </Tabs>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
