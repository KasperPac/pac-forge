import { useState, useCallback, useRef } from "react";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import type {
  PlcsimWriteTagRequest,
  PlcsimReadTagRequest,
  PlcsimReadTagsResponse,
  PlcsimStartResponse,
  PlcsimStatusResponse,
} from "@/lib/tia-bridge-contract";
import type {
  PlcsimTestSuite,
  PlcsimTestCase,
  IoSimulationRule,
  TestCaseResult,
  TestStepResult,
  TestAssertionResult,
  TestIoAction,
  PlcStateSnapshot,
} from "@/types/plcsim-test";

// ---------------------------------------------------------------------------
// Bridge REST helpers
// ---------------------------------------------------------------------------

const BASE = DEFAULT_BRIDGE_CONFIG.baseUrl;

async function bridgeGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`Bridge ${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function bridgePost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Bridge ${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function writeTags(actions: Array<{ tag: string; value: boolean | number | string; dataType: string }>): Promise<void> {
  for (const a of actions) {
    await bridgePost<PlcsimStartResponse>("/tia/plcsim/write-tag", {
      tag_name: a.tag,
      value: a.value,
      data_type: a.dataType,
    } satisfies PlcsimWriteTagRequest);
  }
}

async function readTags(
  tags: Array<{ tag: string; dataType: string }>,
): Promise<PlcsimReadTagsResponse> {
  const body: PlcsimReadTagRequest[] = tags.map((t) => ({
    tag_name: t.tag,
    data_type: t.dataType,
  }));
  return bridgePost<PlcsimReadTagsResponse>("/tia/plcsim/read-tags", body);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Assertion checking
// ---------------------------------------------------------------------------

function checkAssertion(
  action: TestIoAction,
  actual: boolean | number | string | null,
): { passed: boolean; anomaly: string | null } {
  if (actual === null) {
    return { passed: false, anomaly: `Tag ${action.tag} returned null (read failed)` };
  }

  if (action.dataType === "Bool") {
    const expected = Boolean(action.value);
    const actualBool = Boolean(actual);
    if (expected !== actualBool) {
      return {
        passed: false,
        anomaly: `${action.tag}: expected ${expected}, got ${actualBool}`,
      };
    }
    return { passed: true, anomaly: null };
  }

  // Numeric types with optional tolerance
  if (["Int", "DInt", "Real", "Word"].includes(action.dataType)) {
    const expected = Number(action.value);
    const actualNum = Number(actual);
    const tol = action.tolerance ?? 0;
    if (Math.abs(expected - actualNum) > tol) {
      return {
        passed: false,
        anomaly: `${action.tag}: expected ${expected}${tol > 0 ? `±${tol}` : ""}, got ${actualNum}`,
      };
    }
    return { passed: true, anomaly: null };
  }

  // String comparison
  if (String(action.value) !== String(actual)) {
    return {
      passed: false,
      anomaly: `${action.tag}: expected "${action.value}", got "${actual}"`,
    };
  }
  return { passed: true, anomaly: null };
}

// ---------------------------------------------------------------------------
// Simulation rule engine
// ---------------------------------------------------------------------------

/**
 * Simple simulation rule processor. After each write action,
 * checks if any enabled rules should fire and schedules the response writes.
 */
function scheduleSimRules(
  writeTag: string,
  writeValue: boolean | number | string,
  rules: IoSimulationRule[],
): Array<{ delayMs: number; tag: string; value: boolean | number; dataType: string }> {
  const pending: Array<{ delayMs: number; tag: string; value: boolean | number; dataType: string }> = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.triggerTag === writeTag && rule.triggerValue === writeValue) {
      pending.push({
        delayMs: rule.delayMs,
        tag: rule.responseTag,
        value: rule.responseValue,
        dataType: typeof rule.responseValue === "boolean" ? "Bool" : "Int",
      });
    }
  }
  return pending;
}

// ---------------------------------------------------------------------------
// Hook types
// ---------------------------------------------------------------------------

export interface TestRunProgress {
  currentTestIndex: number;
  totalTests: number;
  currentTestName: string;
  currentStepIndex: number;
  totalSteps: number;
}

export interface TestRunOptions {
  /** Pause execution when a step fails — user must call resume() to continue */
  pauseOnFailure?: boolean;
  /** Called after each step completes — use to update UI in real-time */
  onStepComplete?: (testCaseId: string, stepResult: TestStepResult) => void;
}

export interface UsePlcsimRunnerReturn {
  /** Run all approved test cases */
  runAll: (suite: PlcsimTestSuite, options?: TestRunOptions) => Promise<PlcsimTestSuite>;
  /** Run a single test case */
  runSingle: (suite: PlcsimTestSuite, testCaseId: string, options?: TestRunOptions) => Promise<PlcsimTestSuite>;
  /** Check if PLCSIM bridge is reachable and running */
  checkConnection: () => Promise<PlcsimStatusResponse>;
  /** Resume after pause-on-failure */
  resume: () => void;
  running: boolean;
  paused: boolean;
  pausedTestName: string | null;
  progress: TestRunProgress | null;
  error: string | null;
  /** Cancel a running test */
  cancel: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePlcsimRunner(): UsePlcsimRunnerReturn {
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pausedTestName, setPausedTestName] = useState<string | null>(null);
  const [progress, setProgress] = useState<TestRunProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const pauseResolveRef = useRef<(() => void) | null>(null);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    // Also resolve any pending pause
    if (pauseResolveRef.current) {
      pauseResolveRef.current();
      pauseResolveRef.current = null;
    }
  }, []);

  const resume = useCallback(() => {
    setPaused(false);
    setPausedTestName(null);
    if (pauseResolveRef.current) {
      pauseResolveRef.current();
      pauseResolveRef.current = null;
    }
  }, []);

  const checkConnection = useCallback(async () => {
    return bridgeGet<PlcsimStatusResponse>("/tia/plcsim/status");
  }, []);

  /**
   * Ensures TIA Portal is connected, PLCSIM is started, project is downloaded,
   * and PLC is in RUN. Handles the full lifecycle automatically.
   */
  const ensurePlcsimReady = useCallback(async () => {
    // 1. Check if bridge is reachable and connected to TIA Portal
    interface BridgeStatus {
      connected: boolean;
      tia_project_open: boolean;
      tia_version: string | null;
    }
    let bridgeStatus: BridgeStatus;
    try {
      bridgeStatus = await bridgeGet<BridgeStatus>("/tia/status");
    } catch {
      throw new Error(
        "Cannot reach the TIA bridge. Make sure the bridge is running (dotnet run --project bridge/PacForgeBridge).",
      );
    }

    // 2. Connect bridge to TIA Portal if not connected
    if (!bridgeStatus.connected || !bridgeStatus.tia_project_open) {
      console.log("[plcsim-runner] Connecting bridge to TIA Portal...");
      const connectResult = await bridgePost<{ success: boolean; message: string }>(
        "/tia/connect",
        { mode: "attach", with_ui: true },
      );
      if (!connectResult.success) {
        throw new Error(
          `Failed to connect to TIA Portal: ${connectResult.message}. Make sure TIA Portal is open with a project loaded.`,
        );
      }
      // Re-check status
      bridgeStatus = await bridgeGet<BridgeStatus>("/tia/status");
      if (!bridgeStatus.tia_project_open) {
        throw new Error("TIA Portal is connected but no project is open. Open a project in TIA Portal first.");
      }
      console.log("[plcsim-runner] Connected to TIA Portal");
    }

    // 3. Check if a PLCSIM instance is already running with code loaded
    let plcsimStatus: PlcsimStatusResponse;
    try {
      plcsimStatus = await checkConnection();
    } catch {
      plcsimStatus = { connected: false, instance_name: null, operating_state: "OFF", has_instance: false };
    }

    // If PLC is already in RUN — refresh tags then go straight to tests
    if (plcsimStatus.connected && plcsimStatus.operating_state === "Run") {
      console.log("[plcsim-runner] PLC already in RUN — refreshing tag list...");
      try {
        await bridgePost("/tia/plcsim/update-tags", {});
      } catch {
        console.warn("[plcsim-runner] Tag list update failed — tags may be stale");
      }
      return;
    }

    // If connected but in STOP — try to switch to RUN (code may already be loaded)
    if (plcsimStatus.connected && plcsimStatus.has_instance && plcsimStatus.operating_state === "Stop") {
      console.log("[plcsim-runner] PLC in STOP — attempting to switch to RUN...");
      try {
        await bridgePost("/tia/plcsim/plc-mode", { mode: "run", timeout_ms: 10000 });
        await sleep(1000);
        const recheck = await checkConnection();
        if (recheck.operating_state === "Run") {
          console.log("[plcsim-runner] PLC set to RUN — refreshing tag list...");
          try { await bridgePost("/tia/plcsim/update-tags", {}); } catch { /* non-fatal */ }
          return;
        }
      } catch {
        // Can't enter RUN — might need download
      }
    }

    // No running instance — start one
    if (!plcsimStatus.connected || !plcsimStatus.has_instance) {
      console.log("[plcsim-runner] Starting PLCSIM instance...");
      const startResult = await bridgePost<PlcsimStartResponse>("/tia/plcsim/start", {
        instance_name: "PLC_1",
        timeout_ms: 30000,
      });
      if (!startResult.success) {
        throw new Error(`Failed to start PLCSIM: ${startResult.message}`);
      }
      await sleep(3000);
    }

    // Need manual download — provide clear instructions
    throw new Error(
      "PLCSIM instance started but needs a program download.\n\n" +
      "In TIA Portal:\n" +
      "1. Compile: right-click PLC_1 → Compile → Hardware and Software\n" +
      "2. Download: Online → Download to device → PG/PC interface = PLCSIM → Download\n" +
      "3. Click Run Tests again — it will detect the PLC is running",
    );
  }, [checkConnection]);

  /**
   * Capture a snapshot of all tags used in the test case.
   * Reads every unique tag from all steps' actions.
   */
  const captureSnapshot = useCallback(
    async (testCase: PlcsimTestCase): Promise<PlcStateSnapshot> => {
      const tagSet = new Map<string, string>(); // tag → dataType
      for (const step of testCase.steps) {
        for (const action of step.actions) {
          if (action.tag && action.type !== "wait") {
            tagSet.set(action.tag, action.dataType);
          }
        }
      }

      const tags: PlcStateSnapshot["tags"] = [];
      if (tagSet.size > 0) {
        try {
          const response = await readTags(
            Array.from(tagSet.entries()).map(([tag, dataType]) => ({ tag, dataType })),
          );
          for (const v of response.values ?? []) {
            tags.push({
              tag: v.tag_name,
              value: v.success ? v.value : null,
              dataType: tagSet.get(v.tag_name) ?? "Bool",
            });
          }
        } catch (err) {
          console.warn("[plcsim-runner] Snapshot capture failed:", err);
        }
      }

      console.log(`[plcsim-runner] 📸 Snapshot captured: ${tags.length} tags`);
      return { capturedAt: new Date().toISOString(), tags };
    },
    [],
  );

  /**
   * Wait for user to click resume (returns a promise that resolves when resume() is called).
   */
  const waitForResume = useCallback(
    (testName: string): Promise<void> => {
      return new Promise<void>((resolve) => {
        setPaused(true);
        setPausedTestName(testName);
        pauseResolveRef.current = resolve;
      });
    },
    [],
  );

  /**
   * Execute a single test case and return its result.
   */
  const executeTestCase = useCallback(
    async (
      testCase: PlcsimTestCase,
      simRules: IoSimulationRule[],
      options: TestRunOptions,
      testIndex: number,
      totalTests: number,
    ): Promise<TestCaseResult> => {
      const startedAt = new Date().toISOString();
      const stepResults: TestStepResult[] = [];
      const anomalies: string[] = [];

      // Get active sim rules for this test
      const activeRules = simRules.filter(
        (r) => r.enabled && (testCase.simRules.length === 0 || testCase.simRules.includes(r.id)),
      );

      try {
        for (let si = 0; si < testCase.steps.length; si++) {
          if (cancelledRef.current) break;

          const step = testCase.steps[si];
          setProgress({
            currentTestIndex: testIndex,
            totalTests,
            currentTestName: testCase.name,
            currentStepIndex: si,
            totalSteps: testCase.steps.length,
          });

          const stepStart = performance.now();
          const assertions: TestAssertionResult[] = [];
          let stepStatus: "pass" | "fail" | "error" = "pass";
          let stepError: string | undefined;

          try {
            console.log(`[plcsim-runner] Step ${step.stepNumber}: ${step.description} (${step.actions.length} actions)`);
            for (const action of step.actions) {
              if (cancelledRef.current) break;

              switch (action.type) {
                case "write": {
                  console.log(`[plcsim-runner]   WRITE ${action.tag} = ${action.value} (${action.dataType})`);
                  await writeTags([
                    { tag: action.tag, value: action.value, dataType: action.dataType },
                  ]);

                  // Verify write by reading back
                  const verifyResp = await readTags([
                    { tag: action.tag, dataType: action.dataType },
                  ]);
                  const verifyVal = verifyResp.values?.[0];
                  if (verifyVal?.success) {
                    const match = String(verifyVal.value) === String(action.value);
                    console.log(`[plcsim-runner]   ✓ VERIFY ${action.tag} = ${verifyVal.value} ${match ? "(OK)" : `(MISMATCH — wrote ${action.value})`}`);
                    assertions.push({
                      tag: action.tag,
                      expected: action.value,
                      actual: verifyVal.value,
                      passed: match,
                      description: `Write: ${action.description || action.tag}`,
                    });
                    if (!match) {
                      stepStatus = "fail";
                      anomalies.push(`Write verify failed: ${action.tag} wrote ${action.value} but read back ${verifyVal.value}`);
                    }
                  } else {
                    console.warn(`[plcsim-runner]   ✗ VERIFY ${action.tag} read-back failed: ${verifyVal?.error ?? "no response"}`);
                    assertions.push({
                      tag: action.tag,
                      expected: action.value,
                      actual: null,
                      passed: false,
                      description: `Write: ${action.description || action.tag} (read-back failed)`,
                    });
                    stepStatus = "fail";
                    anomalies.push(`Write verify failed: ${action.tag} could not read back after write`);
                  }

                  // Check simulation rules and schedule responses
                  const pending = scheduleSimRules(action.tag, action.value, activeRules);
                  for (const p of pending) {
                    await sleep(p.delayMs);
                    console.log(`[plcsim-runner]   SIM RULE: ${p.tag} = ${p.value} (after ${p.delayMs}ms)`);
                    await writeTags([{ tag: p.tag, value: p.value, dataType: p.dataType }]);
                  }
                  break;
                }

                case "wait": {
                  console.log(`[plcsim-runner]   WAIT ${action.waitMs ?? 200}ms`);
                  await sleep(action.waitMs ?? 200);
                  break;
                }

                case "read": {
                  console.log(`[plcsim-runner]   READ ${action.tag} (expect ${action.value})`);
                  const response = await readTags([
                    { tag: action.tag, dataType: action.dataType },
                  ]);
                  const tagResult = response.values?.[0];
                  const actual = tagResult?.success ? tagResult.value : null;
                  const { passed, anomaly } = checkAssertion(action, actual);
                  console.log(`[plcsim-runner]   → ${passed ? "PASS" : "FAIL"}: ${action.tag} expected=${action.value} actual=${actual}${anomaly ? ` (${anomaly})` : ""}`);

                  assertions.push({
                    tag: action.tag,
                    expected: action.value,
                    actual,
                    passed,
                    description: action.description,
                  });

                  if (!passed) {
                    stepStatus = "fail";
                    if (anomaly) anomalies.push(anomaly);
                  }
                  break;
                }
              }
            }
          } catch (err) {
            stepStatus = "error";
            stepError = err instanceof Error ? err.message : String(err);
            anomalies.push(`Step ${step.stepNumber} error: ${stepError}`);
          }

          const durationMs = Math.round(performance.now() - stepStart);

          // Capture PLC state snapshot on failure
          let snapshot: PlcStateSnapshot | undefined;
          if (stepStatus === "fail" || stepStatus === "error") {
            console.log(`[plcsim-runner] 📸 Capturing PLC state snapshot (step ${step.stepNumber} ${stepStatus})...`);
            snapshot = await captureSnapshot(testCase);
          }

          const completedStep: TestStepResult = {
            stepId: step.id,
            stepNumber: step.stepNumber,
            status: stepStatus,
            assertions,
            durationMs,
            errorMessage: stepError,
            snapshot,
          };
          stepResults.push(completedStep);

          // Notify UI immediately so results appear in real-time
          options.onStepComplete?.(testCase.id, completedStep);

          // Pause on failure if requested — let user inspect in TIA Portal
          if ((stepStatus === "fail" || stepStatus === "error") && options.pauseOnFailure) {
            console.log(`[plcsim-runner] ⏸ PAUSED — step ${step.stepNumber} ${stepStatus}. Open TIA Portal to inspect. Click Resume to continue.`);
            await waitForResume(testCase.name);
            if (cancelledRef.current) break;
          }

          // If step errored, don't continue remaining steps
          if (stepStatus === "error") break;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        anomalies.push(`Test execution error: ${msg}`);
      }

      // Determine overall status
      console.log(`[plcsim-runner] Test "${testCase.name}": ${stepResults.length} steps, ${stepResults.filter(s => s.assertions.length > 0).length} with assertions`);
      const hasError = stepResults.some((s) => s.status === "error");
      const hasFail = stepResults.some((s) => s.status === "fail");
      const wasCancel = cancelledRef.current;
      const status = wasCancel
        ? "skipped" as const
        : hasError
          ? "error" as const
          : hasFail
            ? "fail" as const
            : "pass" as const;

      return {
        testCaseId: testCase.id,
        testCaseName: testCase.name,
        category: testCase.category,
        status,
        runMode: "auto",
        startedAt,
        completedAt: new Date().toISOString(),
        stepResults,
        errorMessage: hasError
          ? stepResults.find((s) => s.errorMessage)?.errorMessage ?? null
          : null,
        comment: anomalies.length > 0 ? anomalies.join("\n") : null,
      };
    },
    [captureSnapshot, waitForResume],
  );

  const runAll = useCallback(
    async (suite: PlcsimTestSuite, options: TestRunOptions = {}): Promise<PlcsimTestSuite> => {
      setRunning(true);
      setError(null);
      cancelledRef.current = false;

      try {
        // Auto-setup: start PLCSIM → download project → set RUN
        await ensurePlcsimReady();

        const approved = suite.testCases
          .filter((tc) => tc.approved)
          .sort((a, b) => a.priority - b.priority);

        if (approved.length === 0) {
          throw new Error("No approved test cases to run.");
        }

        const results: TestCaseResult[] = [];

        for (let i = 0; i < approved.length; i++) {
          if (cancelledRef.current) break;

          const result = await executeTestCase(
            approved[i],
            suite.ioSimRules,
            options,
            i,
            approved.length,
          );
          results.push(result);
        }

        // Merge results: keep existing manual results, replace auto results
        const existingManual = suite.results.filter((r) => r.runMode === "manual");
        const mergedResults = [...existingManual, ...results];

        const passed = mergedResults.filter((r) => r.status === "pass").length;
        const failed = mergedResults.filter((r) => r.status === "fail").length;
        const errors = mergedResults.filter((r) => r.status === "error").length;
        const skipped = mergedResults.filter((r) => r.status === "skipped").length;

        const updated: PlcsimTestSuite = {
          ...suite,
          lastRunAt: new Date().toISOString(),
          results: mergedResults,
          summary: {
            total: mergedResults.length,
            passed,
            failed,
            errors,
            skipped,
          },
        };

        setProgress(null);
        return updated;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setRunning(false);
      }
    },
    [checkConnection, ensurePlcsimReady, executeTestCase],
  );

  const runSingle = useCallback(
    async (suite: PlcsimTestSuite, testCaseId: string, options: TestRunOptions = {}): Promise<PlcsimTestSuite> => {
      setRunning(true);
      setError(null);
      cancelledRef.current = false;

      try {
        const testCase = suite.testCases.find((tc) => tc.id === testCaseId);
        if (!testCase) throw new Error(`Test case ${testCaseId} not found`);

        await ensurePlcsimReady();

        const result = await executeTestCase(testCase, suite.ioSimRules, options, 0, 1);

        // Replace any existing result for this test case
        const otherResults = suite.results.filter((r) => r.testCaseId !== testCaseId);
        const mergedResults = [...otherResults, result];

        const passed = mergedResults.filter((r) => r.status === "pass").length;
        const failed = mergedResults.filter((r) => r.status === "fail").length;
        const errors = mergedResults.filter((r) => r.status === "error").length;
        const skipped = mergedResults.filter((r) => r.status === "skipped").length;

        const updated: PlcsimTestSuite = {
          ...suite,
          lastRunAt: new Date().toISOString(),
          results: mergedResults,
          summary: {
            total: mergedResults.length,
            passed,
            failed,
            errors,
            skipped,
          },
        };

        setProgress(null);
        return updated;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setRunning(false);
      }
    },
    [checkConnection, ensurePlcsimReady, executeTestCase],
  );

  return { runAll, runSingle, checkConnection, resume, running, paused, pausedTestName, progress, error, cancel };
}
