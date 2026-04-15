import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleX,
  FileDown,
  FlaskConical,
  Loader2,
  MessageSquare,
  Play,
  Plus,
  Square,
  Trash2,
  Settings2,
  AlertTriangle,
  CircleCheck,
  CircleMinus,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { ForgeSubPipeline } from "@/components/forge/forge-sub-pipeline";
import type { SubPipelineStage } from "@/components/forge/forge-sub-pipeline";
import { usePlcsimTestGenerate } from "@/hooks/use-plcsim-test-generate";
import { usePlcsimRunner } from "@/hooks/use-plcsim-runner";
import { usePlcsimTestAnalysis } from "@/hooks/use-plcsim-test-analysis";
import { downloadTestReport } from "@/lib/plcsim-test-report";
import type { ForgeSession } from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import type {
  PlcsimTestSuite,
  PlcsimTestCase,
  TestCaseResult,
  TestLearning,
  TestStep,
  TestStepResult,
  TestIoAction,
  TestCategory,
} from "@/types/plcsim-test";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type PlcsimTestMode = "device" | "system";

export interface ForgePlcsimTestProps {
  session: ForgeSession;
  profile: DesignProfile;
  /** "device" = device FB tests after device code, "system" = full tests after process code */
  mode: PlcsimTestMode;
  onTestSuiteUpdate: (suite: PlcsimTestSuite) => void;
  onComplete: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_STAGES: SubPipelineStage[] = [
  { label: "Generate", status: "pending" },
  { label: "Review", status: "pending" },
  { label: "Execute", status: "pending" },
];

const CATEGORY_COLORS: Record<TestCategory, string> = {
  device_fb: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  normal: "bg-green-500/15 text-green-400 border-green-500/30",
  fault: "bg-red-500/15 text-red-400 border-red-500/30",
  permissive: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  interlock: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  reset: "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

const ACTION_TYPE_COLORS: Record<string, string> = {
  write: "text-amber-400",
  read: "text-green-400",
  wait: "text-muted-foreground",
};

const RESULT_ICONS: Record<string, React.ReactNode> = {
  pass: <CircleCheck className="h-3.5 w-3.5 text-green-500" />,
  fail: <CircleX className="h-3.5 w-3.5 text-red-500" />,
  error: <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />,
  skipped: <CircleMinus className="h-3.5 w-3.5 text-muted-foreground" />,
};

// ---------------------------------------------------------------------------
// Tag autocomplete helper
// ---------------------------------------------------------------------------

function collectAvailableTags(session: ForgeSession): string[] {
  const tags = new Set<string>();

  // IO list tags
  for (const io of session.io_list ?? []) {
    if (io.tag_name) tags.add(io.tag_name);
  }

  // Device linkage wiring — build full qualified tag paths
  const matrix = session.linkage_matrix;
  if (matrix?.deviceLinkage) {
    for (const dev of matrix.deviceLinkage) {
      for (const wire of dev.wiring ?? []) {
        if (wire.connectedTo) tags.add(wire.connectedTo);
        // Also add instance DB path: "InstDBName".paramName
        if (dev.instanceDbName && wire.paramName) {
          tags.add(`"${dev.instanceDbName}".${wire.paramName}`);
        }
      }
    }
  }

  // Global data block fields
  if (matrix?.globalData) {
    for (const gd of matrix.globalData) {
      for (const f of gd.fields ?? []) {
        tags.add(`"${gd.dbName}".${f.fieldName}`);
      }
    }
  }

  return Array.from(tags).sort();
}

/**
 * Detect test actions that override timing configuration for reliable testing.
 * Returns a list of human-readable descriptions of the overrides.
 */
function detectTimingOverrides(testCases: PlcsimTestCase[]): string[] {
  const overrides: string[] = [];
  const seen = new Set<string>();
  for (const tc of testCases) {
    for (const step of tc.steps) {
      for (const action of step.actions) {
        if (action.type !== "write") continue;
        // Detect Time-type writes to Configuration/Config DBs
        const tag = action.tag.toLowerCase();
        if (
          (tag.includes("config") || tag.includes("delay") || tag.includes("timeout") || tag.includes("duration")) &&
          (typeof action.value === "string" && /^T#/i.test(action.value))
        ) {
          const key = action.tag;
          if (seen.has(key)) continue;
          seen.add(key);
          overrides.push(`${action.tag} \u2192 ${action.value}`);
        }
      }
    }
  }
  return overrides;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ForgePlcsimTest({
  session,
  profile,
  mode,
  onTestSuiteUpdate,
  onComplete,
}: ForgePlcsimTestProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const initialSuite = mode === "device"
    ? session.plcsim_device_test_suite ?? null
    : session.plcsim_test_suite ?? null;
  const [suite, setSuite] = useState<PlcsimTestSuite | null>(initialSuite);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [expandedRules, setExpandedRules] = useState(false);
  const [stages, setStages] = useState<SubPipelineStage[]>(INITIAL_STAGES);

  const { generate, loading: genLoading, error: genError } = usePlcsimTestGenerate();
  const {
    runAll,
    runSingle,
    resume: resumeExec,
    running: execRunning,
    paused: execPaused,
    pausedTestName,
    progress: execProgress,
    error: execError,
    cancel: cancelExec,
  } = usePlcsimRunner();
  const { analyse: analyseFailures, loading: analysisLoading } = usePlcsimTestAnalysis();
  const [pauseOnFailure, setPauseOnFailure] = useState(true);
  const [timingOverrides, setTimingOverrides] = useState<string[] | null>(null);
  const pendingRunRef = useRef<(() => void) | null>(null);

  const loading = genLoading || execRunning || analysisLoading;
  const error = genError || execError;

  const testCases = suite?.testCases ?? [];
  const simRules = suite?.ioSimRules ?? [];
  const selectedTest = testCases.find((t) => t.id === selectedTestId) ?? null;
  const approvedCount = testCases.filter((t) => t.approved).length;

  // Live step results — accumulate during execution, cleared when test finishes
  const [liveStepResults, setLiveStepResults] = useState<Map<string, TestStepResult[]>>(new Map());

  const handleStepComplete = useCallback((testCaseId: string, stepResult: TestStepResult) => {
    setLiveStepResults((prev) => {
      const next = new Map(prev);
      const existing = next.get(testCaseId) ?? [];
      next.set(testCaseId, [...existing, stepResult]);
      return next;
    });
  }, []);

  const availableTags = useMemo(() => collectAvailableTags(session), [session]);

  // Result lookup — merge completed results with live in-progress results
  const resultMap = useMemo(() => {
    const map = new Map<string, TestCaseResult>();
    for (const r of suite?.results ?? []) map.set(r.testCaseId, r);
    return map;
  }, [suite?.results]);

  // ---- Helpers ----

  function updateSuite(updated: PlcsimTestSuite) {
    setSuite(updated);
    onTestSuiteUpdate(updated);
  }

  function setStageStatus(
    label: string,
    status: SubPipelineStage["status"],
    detail?: string,
  ) {
    setStages((prev) =>
      prev.map((s) => (s.label === label ? { ...s, status, detail } : s)),
    );
  }

  // ---- Generation ----

  async function handleGenerate() {
    setStages(INITIAL_STAGES.map((s) => ({ ...s, status: "pending" })));

    try {
      setStageStatus("Generate", "running");
      const promptOptions = mode === "device"
        ? { categoryFilter: ["device_fb"], artifactScope: "device_only" as const }
        : { categoryFilter: ["normal", "fault", "permissive", "interlock", "reset"], artifactScope: "all" as const };
      const result = await generate(session, profile.id ? profile : null, promptOptions);
      setSuite(result);
      onTestSuiteUpdate(result);
      setStageStatus("Generate", "completed", `${result.testCases.length} tests`);
      setStageStatus("Review", "running");

      if (result.testCases.length > 0) {
        setSelectedTestId(result.testCases[0].id);
      }
    } catch {
      setStageStatus("Generate", "failed", genError ?? "Generation failed");
    }
  }

  // ---- Test execution ----

  async function handleRunAll() {
    if (!suite || execRunning) return;

    // Check for timing configuration overrides
    const overrides = detectTimingOverrides(suite.testCases);
    if (overrides.length > 0) {
      setTimingOverrides(overrides);
      pendingRunRef.current = () => executeRunAll();
      return; // Wait for user to confirm the dialog
    }

    executeRunAll();
  }

  async function executeRunAll() {
    if (!suite) return;
    const clearedSuite: PlcsimTestSuite = { ...suite, results: [], summary: null };
    setSuite(clearedSuite);
    setLiveStepResults(new Map());
    setStageStatus("Execute", "running");
    try {
      const updated = await runAll(clearedSuite, { pauseOnFailure, onStepComplete: handleStepComplete });
      setLiveStepResults(new Map());
      updateSuite(updated);
      const s = updated.summary;
      if (s) {
        const detail = `${s.passed}✓ ${s.failed}✗ ${s.errors}⚠`;
        setStageStatus("Execute", s.failed > 0 || s.errors > 0 ? "failed" : "completed", detail);
      }

      // Auto-analyse failures and generate learnings
      const hasFailures = updated.results.some((r) => r.status === "fail" || r.status === "error");
      if (hasFailures) {
        setStageStatus("Execute", "failed", "Analysing failures...");
        try {
          console.log("[plcsim-test] Analysing failures — calling PM agent...");
          const learnings = await analyseFailures(updated, session);
          console.log(`[plcsim-test] PM returned ${learnings.length} learnings`);
          const withLearnings = { ...updated, learnings };
          setSuite(withLearnings);
          onTestSuiteUpdate(withLearnings);
          const s2 = updated.summary;
          setStageStatus("Execute", "failed", `${s2?.passed ?? 0}✓ ${s2?.failed ?? 0}✗ · ${learnings.length} learnings`);
        } catch (analysisErr) {
          const analysisMsg = analysisErr instanceof Error ? analysisErr.message : String(analysisErr);
          console.error("[plcsim-test] Analysis failed:", analysisMsg);
          // Still show results even if analysis failed
          const s2 = updated.summary;
          setStageStatus("Execute", "failed", `${s2?.passed ?? 0}✓ ${s2?.failed ?? 0}✗ · analysis failed`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[plcsim-test] Run failed:", msg);
      setStageStatus("Execute", "failed", msg.split("\n")[0].slice(0, 60));
    }
  }

  async function handleRunSingle(testCaseId: string) {
    if (!suite || execRunning) return;
    // Clear this test's previous result before running
    const clearedSuite: PlcsimTestSuite = {
      ...suite,
      results: suite.results.filter((r) => r.testCaseId !== testCaseId),
    };
    setSuite(clearedSuite);
    setLiveStepResults((prev) => { const next = new Map(prev); next.delete(testCaseId); return next; });
    try {
      const updated = await runSingle(clearedSuite, testCaseId, { pauseOnFailure, onStepComplete: handleStepComplete });
      setLiveStepResults((prev) => { const next = new Map(prev); next.delete(testCaseId); return next; });
      updateSuite(updated);

      // Analyse if this test failed
      const thisResult = updated.results.find((r) => r.testCaseId === testCaseId);
      if (thisResult && (thisResult.status === "fail" || thisResult.status === "error")) {
        try {
          console.log("[plcsim-test] Analysing single test failure...");
          const learnings = await analyseFailures(updated, session);
          console.log(`[plcsim-test] PM returned ${learnings.length} learnings`);
          if (learnings.length > 0) {
            const withLearnings = { ...updated, learnings: [...(updated.learnings ?? []), ...learnings] };
            setSuite(withLearnings);
            onTestSuiteUpdate(withLearnings);
          }
        } catch (analysisErr) {
          console.error("[plcsim-test] Analysis failed:", analysisErr instanceof Error ? analysisErr.message : analysisErr);
        }
      }
    } catch (err) {
      console.error("[plcsim-test] Single run failed:", err instanceof Error ? err.message : err);
    }
  }

  // ---- Manual pass/fail ----

  function setManualResult(testCaseId: string, status: "pass" | "fail" | "skipped", comment: string) {
    if (!suite) return;
    const tc = suite.testCases.find((t) => t.id === testCaseId);
    if (!tc) return;

    const now = new Date().toISOString();
    const newResult: TestCaseResult = {
      testCaseId,
      testCaseName: tc.name,
      category: tc.category,
      status,
      runMode: "manual",
      startedAt: now,
      completedAt: now,
      stepResults: [],
      errorMessage: null,
      comment: comment || null,
    };

    const otherResults = suite.results.filter((r) => r.testCaseId !== testCaseId);
    const mergedResults = [...otherResults, newResult];

    const passed = mergedResults.filter((r) => r.status === "pass").length;
    const failed = mergedResults.filter((r) => r.status === "fail").length;
    const errors = mergedResults.filter((r) => r.status === "error").length;
    const skipped = mergedResults.filter((r) => r.status === "skipped").length;

    updateSuite({
      ...suite,
      results: mergedResults,
      summary: { total: mergedResults.length, passed, failed, errors, skipped },
    });
  }

  // ---- CRUD ----

  function toggleApprove(testId: string) {
    if (!suite) return;
    updateSuite({
      ...suite,
      testCases: suite.testCases.map((t) =>
        t.id === testId ? { ...t, approved: !t.approved } : t,
      ),
    });
  }

  function approveAll() {
    if (!suite) return;
    updateSuite({
      ...suite,
      testCases: suite.testCases.map((t) => ({ ...t, approved: true })),
    });
    setStageStatus("Review", "completed", `${suite.testCases.length} approved`);
  }

  function removeTest(testId: string) {
    if (!suite) return;
    if (selectedTestId === testId) setSelectedTestId(null);
    updateSuite({
      ...suite,
      testCases: suite.testCases.filter((t) => t.id !== testId),
    });
  }

  function toggleSimRule(ruleId: string) {
    if (!suite) return;
    updateSuite({
      ...suite,
      ioSimRules: suite.ioSimRules.map((r) =>
        r.id === ruleId ? { ...r, enabled: !r.enabled } : r,
      ),
    });
  }

  function updateTestField(testId: string, field: keyof PlcsimTestCase, value: unknown) {
    if (!suite) return;
    updateSuite({
      ...suite,
      testCases: suite.testCases.map((t) =>
        t.id === testId ? { ...t, [field]: value } : t,
      ),
    });
  }

  function updateAction(testId: string, stepId: string, actionId: string, field: keyof TestIoAction, value: unknown) {
    if (!suite) return;
    updateSuite({
      ...suite,
      testCases: suite.testCases.map((t) =>
        t.id !== testId ? t : {
          ...t,
          steps: t.steps.map((s) =>
            s.id !== stepId ? s : {
              ...s,
              actions: s.actions.map((a) =>
                a.id !== actionId ? a : { ...a, [field]: value },
              ),
            },
          ),
        },
      ),
    });
  }

  function addTestCase() {
    if (!suite) return;
    const newTest: PlcsimTestCase = {
      id: crypto.randomUUID(),
      name: "",
      sequenceName: null,
      category: "normal",
      description: "",
      steps: [{ id: crypto.randomUUID(), stepNumber: 1, description: "Initial step", actions: [] }],
      simRules: [],
      priority: suite.testCases.length + 1,
      approved: false,
    };
    updateSuite({ ...suite, testCases: [...suite.testCases, newTest] });
    setSelectedTestId(newTest.id);
  }

  function addStep(testId: string) {
    if (!suite) return;
    const test = suite.testCases.find((t) => t.id === testId);
    if (!test) return;
    const newStep: TestStep = {
      id: crypto.randomUUID(),
      stepNumber: test.steps.length + 1,
      description: "",
      actions: [],
    };
    updateTestField(testId, "steps", [...test.steps, newStep]);
  }

  function addAction(testId: string, stepId: string) {
    if (!suite) return;
    const newAction: TestIoAction = {
      id: crypto.randomUUID(),
      type: "write",
      tag: "",
      value: false,
      dataType: "Bool",
      description: "",
    };
    updateSuite({
      ...suite,
      testCases: suite.testCases.map((t) =>
        t.id !== testId ? t : {
          ...t,
          steps: t.steps.map((s) =>
            s.id !== stepId ? s : { ...s, actions: [...s.actions, newAction] },
          ),
        },
      ),
    });
  }

  // ---- PDF Export ----

  function handleExportPdf() {
    if (!suite) return;
    downloadTestReport(suite, {
      projectName: session.spec_analysis?.project_name ?? "Untitled Project",
      projectDescription: session.spec_analysis?.project_description,
      plcType: session.spec_analysis?.plc_type ?? session.hardware_config?.cpu_type,
      companyName: "Pac Technologies",
    });
  }

  function handleComplete() {
    if (!suite) return;
    setStageStatus("Review", "completed", `${approvedCount} approved`);
    onComplete();
  }

  // ---- Render ----

  return (
    <div className={cn(
      "flex flex-col gap-3",
      fullscreen
        ? "fixed inset-0 z-50 bg-background p-4"
        : "h-full",
    )}>
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ForgeSubPipeline stages={stages} />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setFullscreen((v) => !v)}
            className="h-7 w-7 p-0"
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {suite?.summary && (
            <div className="flex items-center gap-1.5 text-xs font-mono">
              <span className="text-green-400">{suite.summary.passed}✓</span>
              <span className="text-red-400">{suite.summary.failed}✗</span>
              <span className="text-amber-400">{suite.summary.errors}⚠</span>
            </div>
          )}
          {suite && (
            <Badge variant="outline" className="font-mono text-xs">
              {approvedCount}/{testCases.length} approved
            </Badge>
          )}
          <Button size="sm" onClick={handleGenerate} disabled={loading} className="gap-1.5">
            {genLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
            {suite ? "Regenerate" : "Generate Tests"}
          </Button>
          {suite && testCases.length > 0 && (
            <>
              <Button size="sm" variant="outline" onClick={approveAll} className="gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Approve All
              </Button>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Checkbox
                  checked={pauseOnFailure}
                  onCheckedChange={(v) => setPauseOnFailure(!!v)}
                  className="h-3 w-3"
                />
                <span className="text-xs font-mono text-muted-foreground">Pause on fail</span>
              </label>
              {execRunning ? (
                <Button size="sm" variant="destructive" onClick={cancelExec} className="gap-1.5">
                  <Square className="h-3.5 w-3.5" />
                  Stop
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRunAll}
                  disabled={loading || approvedCount === 0}
                  className="gap-1.5"
                >
                  <Play className="h-3.5 w-3.5" />
                  Run Tests
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={handleExportPdf} className="gap-1.5">
                <FileDown className="h-3.5 w-3.5" />
                PDF
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={handleComplete}
                disabled={approvedCount === 0}
                className="gap-1.5"
              >
                Continue
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Execution progress */}
      {execRunning && execProgress && (
        <div className="flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <div className="flex-1">
            <div className="text-xs font-medium">
              Running: {execProgress.currentTestName}
              <span className="ml-2 text-muted-foreground">
                (step {execProgress.currentStepIndex + 1}/{execProgress.totalSteps})
              </span>
            </div>
            <Progress
              value={((execProgress.currentTestIndex + 1) / execProgress.totalTests) * 100}
              className="mt-1 h-1.5"
            />
          </div>
          <span className="text-xs font-mono text-muted-foreground">
            {execProgress.currentTestIndex + 1}/{execProgress.totalTests}
          </span>
        </div>
      )}

      {/* Paused banner */}
      {execPaused && (
        <div className="flex items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          <div className="flex-1">
            <div className="text-xs font-medium text-amber-400">
              Test paused — "{pausedTestName}" failed
            </div>
            <div className="text-xs text-muted-foreground">
              Inspect the PLC state in TIA Portal (Online → Go online). Click Resume to continue to the next test.
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={resumeExec} className="gap-1.5 border-amber-500/30 text-amber-400 hover:bg-amber-500/10">
            <Play className="h-3.5 w-3.5" />
            Resume
          </Button>
          <Button size="sm" variant="ghost" onClick={cancelExec} className="gap-1.5 text-muted-foreground">
            <Square className="h-3.5 w-3.5" />
            Stop All
          </Button>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Learnings panel — shown after test run with failures */}
      {suite?.learnings && suite.learnings.length > 0 && (
        <LearningsPanel
          learnings={suite.learnings}
          onAcknowledge={(id) => {
            if (!suite) return;
            const updated: PlcsimTestSuite = {
              ...suite,
              learnings: suite.learnings!.map((l) =>
                l.id === id ? { ...l, acknowledged: true } : l,
              ),
            };
            updateSuite(updated);
          }}
          analysisLoading={analysisLoading}
        />
      )}

      {/* Main content */}
      {!suite ? (
        <Card className="flex flex-1 items-center justify-center border-dashed">
          <CardContent className="text-center">
            <FlaskConical className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              Generate test cases from the linkage matrix and generated code.
            </p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              The PM agent will create tests for all sequences, faults, permissives, and interlocks.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ResizablePanelGroup orientation="horizontal" className="flex-1 rounded-md border">
          {/* Left: Test case list */}
          <ResizablePanel defaultSize={35} minSize={25}>
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Test Cases
                </span>
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2" onClick={addTestCase}>
                  <Plus className="h-3 w-3" />
                  <span className="text-xs">Add</span>
                </Button>
              </div>

              <ScrollArea className="flex-1">
                <div className="p-1.5 space-y-0.5">
                  {testCases.map((tc) => {
                    const result = resultMap.get(tc.id);
                    return (
                      <button
                        key={tc.id}
                        type="button"
                        onClick={() => setSelectedTestId(tc.id)}
                        className={cn(
                          "flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors",
                          selectedTestId === tc.id ? "bg-accent" : "hover:bg-accent/50",
                        )}
                      >
                        <Checkbox
                          checked={tc.approved}
                          onCheckedChange={() => toggleApprove(tc.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {result && RESULT_ICONS[result.status]}
                            <span className="truncate font-medium">
                              {tc.name || "Untitled Test"}
                            </span>
                            <Badge
                              variant="outline"
                              className={cn("shrink-0 text-xs px-1.5 py-0.5", CATEGORY_COLORS[tc.category])}
                            >
                              {tc.category}
                            </Badge>
                          </div>
                          {tc.sequenceName && (
                            <span className="text-xs text-muted-foreground">{tc.sequenceName}</span>
                          )}
                          <span className="block text-xs text-muted-foreground/60 truncate">
                            {tc.steps.length} steps · {tc.steps.reduce((n, s) => n + s.actions.length, 0)} actions
                            {result?.runMode === "manual" && " · Manual"}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removeTest(tc.id); }}
                          className="shrink-0 p-0.5 text-muted-foreground/40 hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>

              {/* IO Simulation Rules */}
              <div>
                <button
                  type="button"
                  onClick={() => setExpandedRules((v) => !v)}
                  className="flex w-full items-center gap-2 border-t px-3 py-2 text-xs hover:bg-accent/30"
                >
                  {expandedRules ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  <Settings2 className="h-3 w-3 text-muted-foreground" />
                  <span className="font-mono uppercase tracking-wider text-muted-foreground">IO Sim Rules</span>
                  <Badge variant="secondary" className="ml-auto text-xs">
                    {simRules.filter((r) => r.enabled).length}/{simRules.length}
                  </Badge>
                </button>
                {expandedRules && (
                  <ScrollArea className="max-h-48 border-t">
                    <div className="p-2 space-y-1">
                      {simRules.map((rule) => (
                        <div key={rule.id} className="flex items-start gap-2 rounded px-2 py-1 text-xs">
                          <Checkbox
                            checked={rule.enabled}
                            onCheckedChange={() => toggleSimRule(rule.id)}
                            className="mt-0.5"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="font-medium">{rule.description}</div>
                            <div className="text-muted-foreground/60">
                              <span className="text-amber-400">{rule.triggerTag}</span>
                              {" → "}
                              <span className="text-green-400">{rule.responseTag}</span>
                              {" ("}{rule.delayMs}ms)
                            </div>
                          </div>
                        </div>
                      ))}
                      {simRules.length === 0 && (
                        <p className="text-xs text-muted-foreground/50 px-2">No simulation rules yet.</p>
                      )}
                    </div>
                  </ScrollArea>
                )}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right: Test detail / step editor */}
          <ResizablePanel defaultSize={65} minSize={35}>
            {selectedTest ? (
              <TestDetailPane
                test={selectedTest}
                result={resultMap.get(selectedTest.id) ?? null}
                liveStepResults={liveStepResults.get(selectedTest.id) ?? null}
                availableTags={availableTags}
                running={execRunning}
                onUpdateField={(field, value) => updateTestField(selectedTest.id, field, value)}
                onUpdateAction={(stepId, actionId, field, value) =>
                  updateAction(selectedTest.id, stepId, actionId, field, value)
                }
                onAddStep={() => addStep(selectedTest.id)}
                onAddAction={(stepId) => addAction(selectedTest.id, stepId)}
                onToggleApprove={() => toggleApprove(selectedTest.id)}
                onManualResult={(status, comment) => setManualResult(selectedTest.id, status, comment)}
                onRunSingle={() => handleRunSingle(selectedTest.id)}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Select a test case to view details
              </div>
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
      {/* Timing configuration override dialog */}
      <AlertDialog open={timingOverrides !== null} onOpenChange={(open) => { if (!open) { setTimingOverrides(null); pendingRunRef.current = null; } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Timing Configuration Adjustment</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  To ensure accurate and repeatable test results, the test runner will temporarily
                  adjust the following timing parameters to allow sufficient measurement windows
                  between state transitions.
                </p>
                <div className="rounded-md border border-border bg-muted/50 p-3 font-mono text-xs space-y-1">
                  {timingOverrides?.map((o, i) => (
                    <div key={i}>{o}</div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  These values will be written to the PLC at the start of each relevant test
                  and will persist until the project is re-downloaded or the values are manually reset.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              setTimingOverrides(null);
              pendingRunRef.current?.();
              pendingRunRef.current = null;
            }}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Test Detail Pane
// ---------------------------------------------------------------------------

interface TestDetailPaneProps {
  test: PlcsimTestCase;
  result: TestCaseResult | null;
  liveStepResults: TestStepResult[] | null;
  availableTags: string[];
  running: boolean;
  onUpdateField: (field: keyof PlcsimTestCase, value: unknown) => void;
  onUpdateAction: (stepId: string, actionId: string, field: keyof TestIoAction, value: unknown) => void;
  onAddStep: () => void;
  onAddAction: (stepId: string) => void;
  onToggleApprove: () => void;
  onManualResult: (status: "pass" | "fail" | "skipped", comment: string) => void;
  onRunSingle: () => void;
}

function TestDetailPane({
  test,
  result,
  liveStepResults,
  availableTags,
  running,
  onUpdateField,
  onUpdateAction,
  onAddStep,
  onAddAction,
  onToggleApprove,
  onManualResult,
  onRunSingle,
}: TestDetailPaneProps) {
  const [manualComment, setManualComment] = useState(result?.comment ?? "");
  const [showManual, setShowManual] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus name input when it's empty (new test case)
  useEffect(() => {
    if (!test.name && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [test.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-4 py-2.5">
        <div className="flex-1 space-y-1">
          <Input
            ref={nameInputRef}
            value={test.name}
            onChange={(e) => onUpdateField("name", e.target.value)}
            className="h-8 border-none bg-transparent px-0 font-medium text-base shadow-none focus-visible:ring-0"
            placeholder="Enter test case name…"
          />
          <div className="flex items-center gap-2">
            <Select value={test.category} onValueChange={(v) => onUpdateField("category", v)}>
              <SelectTrigger className="h-5 w-auto gap-1 border-none bg-transparent px-0 text-xs shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="device_fb">Device FB</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="fault">Fault</SelectItem>
                <SelectItem value="permissive">Permissive</SelectItem>
                <SelectItem value="interlock">Interlock</SelectItem>
                <SelectItem value="reset">Reset</SelectItem>
              </SelectContent>
            </Select>
            {test.sequenceName && (
              <span className="text-xs text-muted-foreground">Sequence: {test.sequenceName}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {result && (
            <div className="flex items-center gap-1 mr-2">
              {RESULT_ICONS[result.status]}
              <span className={cn(
                "text-xs font-mono uppercase",
                result.status === "pass" && "text-green-500",
                result.status === "fail" && "text-red-500",
                result.status === "error" && "text-amber-500",
              )}>
                {result.status} ({result.runMode})
              </span>
            </div>
          )}
          <Button size="sm" variant="ghost" onClick={() => setShowManual((v) => !v)} className="gap-1 h-7 px-2">
            <MessageSquare className="h-3 w-3" />
            <span className="text-xs">Manual</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onRunSingle}
            disabled={running || !test.approved}
            className="gap-1 h-7 px-2"
            title={!test.approved ? "Approve first to run" : "Run this test"}
          >
            <Play className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant={test.approved ? "default" : "outline"}
            onClick={onToggleApprove}
            className="gap-1.5"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {test.approved ? "Approved" : "Approve"}
          </Button>
        </div>
      </div>

      {/* Manual verdict panel */}
      {showManual && (
        <div className="border-b bg-card/50 px-4 py-2 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono uppercase text-muted-foreground">Manual verdict:</span>
            <Button
              size="sm" variant="outline"
              className="h-7 gap-1.5 text-xs text-green-500 border-green-500/30 hover:bg-green-500/10"
              onClick={() => onManualResult("pass", manualComment)}
            >
              <CircleCheck className="h-3 w-3" /> Pass
            </Button>
            <Button
              size="sm" variant="outline"
              className="h-7 gap-1.5 text-xs text-red-500 border-red-500/30 hover:bg-red-500/10"
              onClick={() => onManualResult("fail", manualComment)}
            >
              <CircleX className="h-3 w-3" /> Fail
            </Button>
            <Button
              size="sm" variant="outline"
              className="h-7 gap-1.5 text-xs text-muted-foreground"
              onClick={() => onManualResult("skipped", manualComment)}
            >
              <CircleMinus className="h-3 w-3" /> Skip
            </Button>
          </div>
          <Textarea
            value={manualComment}
            onChange={(e) => setManualComment(e.target.value)}
            placeholder="Comment / observations…"
            className="h-16 text-xs resize-none"
          />
        </div>
      )}

      {/* Result comment (from auto or manual) */}
      {result?.comment && !showManual && (
        <div className="border-b bg-muted/30 px-4 py-1.5">
          <span className="text-xs font-mono uppercase text-muted-foreground">Notes: </span>
          <span className="text-xs text-muted-foreground">{result.comment}</span>
        </div>
      )}

      {/* Description */}
      <div className="border-b px-4 py-2">
        <Input
          value={test.description}
          onChange={(e) => onUpdateField("description", e.target.value)}
          className="h-8 border-none bg-transparent px-0 text-sm text-muted-foreground shadow-none focus-visible:ring-0"
          placeholder="What does this test prove?"
        />
      </div>

      {/* Steps */}
      <ScrollArea className="flex-1 w-full [&>[data-radix-scroll-area-viewport]>div]:!block">
        <div className="p-4 space-y-3 w-full">
          {test.steps.map((step) => {
            // Live results take priority (in-progress execution), then completed results
            const stepResult =
              liveStepResults?.find((sr) => sr.stepId === step.id) ??
              result?.stepResults?.find((sr) => sr.stepId === step.id) ??
              null;
            return (
              <StepCard
                key={step.id}
                step={step}
                stepResult={stepResult}
                availableTags={availableTags}
                onUpdateAction={(actionId, field, value) => onUpdateAction(step.id, actionId, field, value)}
                onAddAction={() => onAddAction(step.id)}
              />
            );
          })}
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-1.5 border-dashed text-xs"
            onClick={onAddStep}
          >
            <Plus className="h-3 w-3" />
            Add Step
          </Button>
        </div>
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tag Input with Autocomplete
// ---------------------------------------------------------------------------

interface TagInputProps {
  value: string;
  onChange: (value: string) => void;
  availableTags: string[];
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}

function TagInput({ value, onChange, availableTags, className, placeholder, disabled }: TagInputProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = (filter || value).toLowerCase();
    if (!q) return availableTags.slice(0, 20);
    return availableTags.filter((t) => t.toLowerCase().includes(q)).slice(0, 20);
  }, [availableTags, filter, value]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setFilter(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className={className}
        placeholder={placeholder}
        disabled={disabled}
      />
      {open && filtered.length > 0 && !disabled && (
        <div className="absolute z-50 mt-0.5 max-h-40 w-full overflow-auto rounded-md border bg-popover shadow-md">
          {filtered.map((tag) => (
            <button
              key={tag}
              type="button"
              className="flex w-full items-center px-2 py-1 text-xs font-mono hover:bg-accent text-left"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(tag);
                setOpen(false);
              }}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step Card
// ---------------------------------------------------------------------------

interface StepCardProps {
  step: TestStep;
  stepResult: TestStepResult | null;
  availableTags: string[];
  onUpdateAction: (actionId: string, field: keyof TestIoAction, value: unknown) => void;
  onAddAction: () => void;
}

function StepCard({ step, stepResult, availableTags, onUpdateAction, onAddAction }: StepCardProps) {
  const [expanded, setExpanded] = useState(true);

  // Build assertion lookup: tag → assertion result (for showing pass/fail per action row)
  const assertionByTag = useMemo(() => {
    const map = new Map<string, { passed: boolean; actual: unknown }>();
    if (!stepResult) return map;
    for (const a of stepResult.assertions) {
      map.set(a.tag, { passed: a.passed, actual: a.actual });
    }
    return map;
  }, [stepResult]);

  return (
    <Card className={cn(
      "border-border/50",
      stepResult?.status === "pass" && "border-green-500/20",
      stepResult?.status === "fail" && "border-red-500/20",
      stepResult?.status === "error" && "border-amber-500/20",
    )}>
      <CardHeader className="cursor-pointer px-3 py-2" onClick={() => setExpanded((v) => !v)}>
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          {stepResult && RESULT_ICONS[stepResult.status]}
          <Badge variant="secondary" className="font-mono text-xs">Step {step.stepNumber}</Badge>
          <CardTitle className="text-sm font-normal">{step.description || "No description"}</CardTitle>
          <span className="ml-auto text-xs text-muted-foreground">
            {step.actions.length} actions
            {stepResult && ` · ${stepResult.durationMs}ms`}
          </span>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="px-4 pb-3 pt-0 space-y-1.5">
          <div className="grid grid-cols-[24px_72px_2fr_100px_80px_3fr] w-full gap-2 px-1 text-xs font-mono uppercase tracking-wider text-muted-foreground/50">
            <span></span>
            <span>Type</span>
            <span>Tag</span>
            <span>Value</span>
            <span>Data Type</span>
            <span>Description</span>
          </div>
          {step.actions.map((action) => {
            const assertion = action.tag ? assertionByTag.get(action.tag) : undefined;
            return (
              <div key={action.id} className="grid grid-cols-[24px_72px_2fr_100px_80px_3fr] w-full gap-2 items-center">
                {/* Result indicator */}
                <div className="flex justify-center">
                  {assertion ? (
                    assertion.passed ? (
                      <CircleCheck className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <CircleX className="h-3.5 w-3.5 text-red-500" />
                    )
                  ) : stepResult && action.type === "wait" ? (
                    <CircleCheck className="h-3.5 w-3.5 text-muted-foreground/30" />
                  ) : stepResult ? (
                    <CircleMinus className="h-3.5 w-3.5 text-muted-foreground/20" />
                  ) : null}
                </div>
                <Select value={action.type} onValueChange={(v) => onUpdateAction(action.id, "type", v)}>
                  <SelectTrigger className="h-8 text-xs px-2"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="write">Write</SelectItem>
                    <SelectItem value="read">Read</SelectItem>
                    <SelectItem value="wait">Wait</SelectItem>
                  </SelectContent>
                </Select>
                <TagInput
                  value={action.tag}
                  onChange={(v) => onUpdateAction(action.id, "tag", v)}
                  availableTags={availableTags}
                  className={cn("h-8 font-mono text-xs", ACTION_TYPE_COLORS[action.type])}
                  placeholder={action.type === "wait" ? "(n/a)" : "Tag name"}
                  disabled={action.type === "wait"}
                />
                <div className="flex items-center gap-1">
                  {action.dataType === "Bool" && action.type !== "wait" ? (
                    /* Bool toggle — click to flip between true/false */
                    <button
                      type="button"
                      onClick={() => onUpdateAction(action.id, "value", !action.value)}
                      className={cn(
                        "h-8 w-full rounded-md border px-2 font-mono text-xs text-left transition-colors",
                        action.value
                          ? "border-green-500/40 bg-green-500/10 text-green-400"
                          : "border-border bg-background text-muted-foreground",
                      )}
                    >
                      {action.value ? "true" : "false"}
                    </button>
                  ) : (
                    <Input
                      value={action.type === "wait" ? String(action.waitMs ?? "") : String(action.value)}
                      onChange={(e) => {
                        if (action.type === "wait") {
                          onUpdateAction(action.id, "waitMs", parseInt(e.target.value) || 0);
                        } else {
                          const raw = e.target.value;
                          let val: boolean | number | string = raw;
                          if (["Int", "DInt", "Word"].includes(action.dataType)) val = parseInt(raw) || 0;
                          else if (action.dataType === "Real") val = parseFloat(raw) || 0;
                          onUpdateAction(action.id, "value", val);
                        }
                      }}
                      className="h-8 font-mono text-xs"
                      placeholder={action.type === "wait" ? "ms" : "value"}
                    />
                  )}
                  {/* Show actual value on mismatch */}
                  {assertion && !assertion.passed && (
                    <span className="text-xs text-red-400 whitespace-nowrap" title={`Actual: ${assertion.actual}`}>
                      ≠{String(assertion.actual)}
                    </span>
                  )}
                </div>
                <Select value={action.dataType} onValueChange={(v) => onUpdateAction(action.id, "dataType", v)} disabled={action.type === "wait"}>
                  <SelectTrigger className="h-8 text-xs px-2"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Bool">Bool</SelectItem>
                    <SelectItem value="Int">Int</SelectItem>
                    <SelectItem value="DInt">DInt</SelectItem>
                    <SelectItem value="Real">Real</SelectItem>
                    <SelectItem value="Word">Word</SelectItem>
                    <SelectItem value="Time">Time</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={action.description}
                  onChange={(e) => onUpdateAction(action.id, "description", e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Description"
                />
              </div>
            );
          })}
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs text-muted-foreground" onClick={onAddAction}>
            <Plus className="h-2.5 w-2.5" />
            Add Action
          </Button>

          {/* PLC State Snapshot (shown on failure) */}
          {stepResult?.snapshot && (
            <SnapshotPanel snapshot={stepResult.snapshot} />
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Snapshot Panel — shows PLC state at moment of failure
// ---------------------------------------------------------------------------

function SnapshotPanel({ snapshot }: { snapshot: import("@/types/plcsim-test").PlcStateSnapshot }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-2 rounded border border-amber-500/20 bg-amber-500/5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-xs hover:bg-amber-500/10"
      >
        {expanded ? <ChevronDown className="h-3 w-3 text-amber-400" /> : <ChevronRight className="h-3 w-3 text-amber-400" />}
        <span className="font-mono uppercase tracking-wider text-amber-400">PLC State Snapshot</span>
        <span className="ml-auto text-muted-foreground">{snapshot.tags.length} tags · {new Date(snapshot.capturedAt).toLocaleTimeString()}</span>
      </button>
      {expanded && (
        <div className="border-t border-amber-500/10 px-2 py-1">
          <div className="grid grid-cols-[1fr_80px_60px] gap-1 text-xs font-mono uppercase text-muted-foreground/50 px-1 mb-0.5">
            <span>Tag</span>
            <span>Value</span>
            <span>Type</span>
          </div>
          {snapshot.tags.map((t) => (
            <div key={t.tag} className="grid grid-cols-[1fr_80px_60px] gap-1 text-xs font-mono px-1 py-0.5 hover:bg-accent/30 rounded">
              <span className="truncate text-amber-300">{t.tag}</span>
              <span className={t.value === null ? "text-red-400" : "text-foreground"}>
                {t.value === null ? "null" : String(t.value)}
              </span>
              <span className="text-muted-foreground">{t.dataType}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Learnings Panel — PM analysis of test failures
// ---------------------------------------------------------------------------

const SEVERITY_STYLES: Record<string, { border: string; bg: string; text: string; icon: React.ReactNode }> = {
  bug: {
    border: "border-red-500/30",
    bg: "bg-red-500/5",
    text: "text-red-400",
    icon: <CircleX className="h-3.5 w-3.5 text-red-500" />,
  },
  improvement: {
    border: "border-blue-500/30",
    bg: "bg-blue-500/5",
    text: "text-blue-400",
    icon: <AlertTriangle className="h-3.5 w-3.5 text-blue-500" />,
  },
  note: {
    border: "border-muted-foreground/20",
    bg: "bg-muted/30",
    text: "text-muted-foreground",
    icon: <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />,
  },
};

function LearningsPanel({
  learnings,
  onAcknowledge,
  analysisLoading,
}: {
  learnings: TestLearning[];
  onAcknowledge: (id: string) => void;
  analysisLoading: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const bugs = learnings.filter((l) => l.severity === "bug");
  const improvements = learnings.filter((l) => l.severity === "improvement");
  const notes = learnings.filter((l) => l.severity === "note");
  const unacknowledged = learnings.filter((l) => !l.acknowledged).length;

  return (
    <Card className="border-amber-500/20 bg-amber-500/[0.02]">
      <CardHeader
        className="cursor-pointer px-4 py-2.5"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-amber-400" /> : <ChevronRight className="h-3.5 w-3.5 text-amber-400" />}
          {analysisLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
          ) : (
            <FlaskConical className="h-3.5 w-3.5 text-amber-400" />
          )}
          <span className="text-xs font-medium text-amber-400">
            Test Learnings
          </span>
          <div className="flex items-center gap-1.5 ml-2">
            {bugs.length > 0 && (
              <Badge variant="outline" className="text-xs px-1 py-0 text-red-400 border-red-500/30">
                {bugs.length} bug{bugs.length > 1 ? "s" : ""}
              </Badge>
            )}
            {improvements.length > 0 && (
              <Badge variant="outline" className="text-xs px-1 py-0 text-blue-400 border-blue-500/30">
                {improvements.length} improvement{improvements.length > 1 ? "s" : ""}
              </Badge>
            )}
            {notes.length > 0 && (
              <Badge variant="outline" className="text-xs px-1 py-0 text-muted-foreground border-muted-foreground/20">
                {notes.length} note{notes.length > 1 ? "s" : ""}
              </Badge>
            )}
          </div>
          {unacknowledged > 0 && (
            <span className="ml-auto text-xs text-amber-400/70">
              {unacknowledged} to review
            </span>
          )}
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="px-4 pb-3 pt-0 space-y-2">
          {learnings.map((learning) => {
            const style = SEVERITY_STYLES[learning.severity] ?? SEVERITY_STYLES.note;
            return (
              <div
                key={learning.id}
                className={cn(
                  "rounded-md border px-3 py-2.5 space-y-1.5",
                  style.border,
                  style.bg,
                  learning.acknowledged && "opacity-50",
                )}
              >
                <div className="flex items-start gap-2">
                  {style.icon}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn("text-xs font-medium", style.text)}>
                        {learning.title}
                      </span>
                      <Badge variant="outline" className="text-xs px-1 py-0 shrink-0">
                        {learning.testCaseName}
                      </Badge>
                      {learning.affectedBlock && (
                        <Badge variant="secondary" className="text-xs px-1 py-0 shrink-0 font-mono">
                          {learning.affectedBlock}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {learning.description}
                    </p>
                    {learning.suggestedFix && (
                      <p className="text-xs text-foreground/80 mt-1 border-l-2 border-amber-500/30 pl-2">
                        {learning.suggestedFix}
                      </p>
                    )}
                  </div>
                  {!learning.acknowledged && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAcknowledge(learning.id);
                      }}
                    >
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Ack
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      )}
    </Card>
  );
}
