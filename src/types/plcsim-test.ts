/**
 * Types for PLCSIM Advanced automated testing.
 * Test cases are derived from the linkage matrix + fault spec by the PM agent,
 * reviewed by the engineer, then executed against a PLCSIM virtual controller.
 */

// ---------------------------------------------------------------------------
// IO Actions & Simulation Rules
// ---------------------------------------------------------------------------

/** A single IO action within a test step */
export interface TestIoAction {
  id: string;
  /** "write" = force tag value, "read" = assert tag value, "wait" = delay */
  type: "write" | "read" | "wait";
  /** PLC tag name (symbolic): "DB_Inputs".ESTOP_OK, "InstM01".fwdrun, etc. */
  tag: string;
  /** Expected value (for read) or forced value (for write) */
  value: boolean | number | string;
  /** Data type: Bool, Int, DInt, Real, Word */
  dataType: "Bool" | "Int" | "DInt" | "Real" | "Word";
  /** For "read": tolerance for analog values */
  tolerance?: number;
  /** For "wait": milliseconds to wait */
  waitMs?: number;
  /** Human-readable description */
  description: string;
}

/**
 * IO simulation rule — auto-responds to output changes.
 * E.g., when motor CMD goes TRUE, after N ms set run feedback TRUE.
 */
export interface IoSimulationRule {
  id: string;
  /** Output tag that triggers the simulation */
  triggerTag: string;
  /** Value that activates this rule */
  triggerValue: boolean | number;
  /** Input tag to set in response */
  responseTag: string;
  /** Value to set on the response tag */
  responseValue: boolean | number;
  /** Delay in milliseconds before responding */
  delayMs: number;
  /** Human description: "Motor run feedback after 500ms" */
  description: string;
  /** Whether this rule is enabled */
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Test Cases
// ---------------------------------------------------------------------------

/** A single test step within a test case */
export interface TestStep {
  id: string;
  stepNumber: number;
  /** What this step verifies */
  description: string;
  /** Ordered actions: write inputs → wait → read outputs */
  actions: TestIoAction[];
}

/** Test case category */
export type TestCategory = "device_fb" | "normal" | "fault" | "permissive" | "interlock" | "reset";

/** A complete test case */
export interface PlcsimTestCase {
  id: string;
  name: string;
  /** Which sequence this tests (null for system-level tests) */
  sequenceName: string | null;
  /** Test category */
  category: TestCategory;
  /** What this test proves */
  description: string;
  /** Ordered steps */
  steps: TestStep[];
  /** IO simulation rules active during this test */
  simRules: string[]; // IDs of IoSimulationRule
  /** Priority for execution ordering (lower = first) */
  priority: number;
  /** Whether the engineer has approved this test */
  approved: boolean;
}

// ---------------------------------------------------------------------------
// Test Results
// ---------------------------------------------------------------------------

/** Result of a single assertion (read action) */
export interface TestAssertionResult {
  tag: string;
  expected: boolean | number | string;
  actual: boolean | number | string | null;
  passed: boolean;
  description: string;
}

/** Snapshot of all PLC tag values at a point in time (captured on failure) */
export interface PlcStateSnapshot {
  capturedAt: string;
  tags: Array<{ tag: string; value: boolean | number | string | null; dataType: string }>;
}

/** Result of a single test step */
export interface TestStepResult {
  stepId: string;
  stepNumber: number;
  status: "pass" | "fail" | "error";
  assertions: TestAssertionResult[];
  durationMs: number;
  errorMessage?: string;
  /** PLC state snapshot captured when this step fails — all tag values at failure moment */
  snapshot?: PlcStateSnapshot;
}

/** How the result was obtained */
export type TestRunMode = "auto" | "manual";

/** Result of a complete test case execution */
export interface TestCaseResult {
  testCaseId: string;
  testCaseName: string;
  category: TestCategory;
  status: "pass" | "fail" | "error" | "skipped";
  /** How this result was obtained */
  runMode: TestRunMode;
  startedAt: string;
  completedAt: string | null;
  stepResults: TestStepResult[];
  errorMessage: string | null;
  /** Engineer or auto-generated comment (anomalies, observations) */
  comment: string | null;
}

// ---------------------------------------------------------------------------
// Test Suite (stored on session)
// ---------------------------------------------------------------------------

/** Full test suite — stored as session.plcsim_test_suite */
export interface PlcsimTestSuite {
  /** All test cases (PM-generated + engineer-added) */
  testCases: PlcsimTestCase[];
  /** Global IO simulation rules (apply to all tests) */
  ioSimRules: IoSimulationRule[];
  /** When the test cases were generated */
  generatedAt: string;
  /** When tests were last executed */
  lastRunAt: string | null;
  /** Results from the last test run */
  results: TestCaseResult[];
  /** Summary stats */
  summary: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
    skipped: number;
  } | null;
  /** PM learnings from post-test failure analysis */
  learnings?: TestLearning[];
}

/** A learning/finding from post-test analysis by the PM agent */
export interface TestLearning {
  id: string;
  /** Which test case triggered this learning */
  testCaseId: string;
  testCaseName: string;
  /** Severity: bug = code defect, improvement = design suggestion, note = observation */
  severity: "bug" | "improvement" | "note";
  /** Short title */
  title: string;
  /** Detailed explanation of what went wrong and what to check */
  description: string;
  /** Which artifact/block is likely affected */
  affectedBlock: string | null;
  /** Suggested fix (human-readable, not auto-applied) */
  suggestedFix: string | null;
  /** Has the engineer acknowledged/addressed this learning */
  acknowledged: boolean;
}

// ---------------------------------------------------------------------------
// PLCSIM Status (from bridge)
// ---------------------------------------------------------------------------

export interface PlcsimStatus {
  connected: boolean;
  instance_name: string | null;
  operating_state: string;
  has_instance: boolean;
}
