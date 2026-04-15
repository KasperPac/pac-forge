// ---------------------------------------------------------------------------
// Logic Check types — validates assembly FBs against FDS behavioral spec
// ---------------------------------------------------------------------------

export type LogicCheckCategory =
  | "state_coverage"      // Does the code implement every FDS operating state?
  | "step_sequence"       // Do sequential state steps match FDS step table?
  | "permissive"          // Are all FDS permissives checked in the code?
  | "completion_criteria"  // Are FDS completion criteria implemented as transitions?
  | "timeout"             // Do FDS timeout values match timer declarations?
  | "device_state"        // Do static state output values match FDS device state tables?
  | "fault_handling"      // Are all FDS alarm conditions detected?
  | "interface"           // Does each assembly FB expose required signals?
  | "syntax"              // Basic SCL structure checks (CASE ELSE, END_FUNCTION_BLOCK, etc.)
  | "general";            // Catch-all for other issues

export interface LogicCheckIssue {
  id: string;
  severity: "error" | "warning" | "info";
  category: LogicCheckCategory;
  /** Which assembly this issue belongs to (tag) */
  assemblyTag: string;
  /** Which block within the assembly (e.g. "ControlLFT01") */
  blockName: string;
  /** Human-readable description of the issue */
  message: string;
  /** Suggested fix */
  suggestion?: string;
}

export interface LogicCheckResult {
  /** Overall pass/fail — false if any errors exist */
  passed: boolean;
  /** All issues found */
  issues: LogicCheckIssue[];
  /** When the check was run */
  checkedAt: string;
  /** Number of assemblies checked */
  assembliesChecked: number;
  /** Number of artifacts checked */
  artifactsChecked: number;
}
