import type { Agent } from "@/types";

/**
 * Pipeline execution order by agent display name.
 * Position 0 = pre-pipeline (PM plan), 1 = generator, 2-4 = reviewers, 5 = pattern analysis.
 * PM runs at both position 0 (plan) and post-pipeline (summary).
 */
export const PIPELINE_ORDER: Record<string, number> = {
  "Project Manager": 0,
  "Code Architect": 1,
  "PLC Standards Enforcer": 2,
  "IO Validator": 3,
  "Safety Auditor": 4,
  "Pattern Librarian": 5,
};

export const PIPELINE_STEP_STATUSES = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  SKIPPED: "skipped",
} as const;

export type PipelineStepStatus =
  (typeof PIPELINE_STEP_STATUSES)[keyof typeof PIPELINE_STEP_STATUSES];

export const PIPELINE_ROLES = {
  PLAN: "plan",
  GENERATE: "generate",
  REVIEW: "review",
  REWRITE: "rewrite",
  PATTERNS: "patterns",
  SUMMARY: "summary",
  COMPILE_FIX: "compile_fix",
} as const;

export type PipelineRole =
  (typeof PIPELINE_ROLES)[keyof typeof PIPELINE_ROLES];

export interface PipelineStepResult {
  agentId: string;
  agentName: string;
  role: PipelineRole;
  status: PipelineStepStatus;
  systemPrompt: string;
  userMessage: string;
  rawResponse: string;
  tokenUsage: { input: number; output: number } | null;
  durationMs: number;
  artifactsModified: string[];
  summary: string;
  error?: string;
  /** Process Builder stage this step belongs to (e.g. "io", "fb"). */
  stage?: string;
}

export interface PipelineExecution {
  id: string;
  startedAt: string;
  completedAt: string | null;
  steps: PipelineStepResult[];
  finalArtifactCount: number;
}

/** Maximum number of review→rewrite rounds before flagging unresolved findings. */
export const MAX_REVIEW_ROUNDS = 3;

/** Token budget for code generation steps (Code Architect, Rewrite). Default 8192 is too small for full projects. */
export const CODE_GEN_MAX_TOKENS = 16384;

/** A CRITICAL finding that persisted through all review rounds. */
export interface UnresolvedFinding {
  artifactName: string;
  description: string;
  reviewerName: string;
  round: number;
}

/** Pipeline step configuration for the session start dialog. */
export const PIPELINE_STEP_CONFIG = [
  {
    key: "generate",
    label: "Code Generation",
    description: "Generates SCL code from your requests",
    locked: true,
    defaultEnabled: true,
    agentName: "Code Architect",
  },
  {
    key: "standards",
    label: "Standards Review",
    description: "Checks code against TIA Portal best practices",
    locked: false,
    defaultEnabled: true,
    agentName: "PLC Standards Enforcer",
  },
  {
    key: "io",
    label: "IO Validation",
    description: "Verifies IO mappings and address consistency",
    locked: false,
    defaultEnabled: false,
    agentName: "IO Validator",
  },
  {
    key: "safety",
    label: "Safety Audit",
    description: "Audits code for safety compliance",
    locked: false,
    defaultEnabled: false,
    agentName: "Safety Auditor",
  },
  {
    key: "patterns",
    label: "Pattern Learning",
    description: "Learns correction patterns to improve future generations",
    locked: false,
    defaultEnabled: true,
    agentName: "Pattern Librarian",
  },
] as const;

/** Steps that are enabled by default. */
export const DEFAULT_ENABLED_STEPS = new Set<PipelineStepKey>(
  PIPELINE_STEP_CONFIG.filter((s) => s.defaultEnabled).map((s) => s.key),
);

/** Agent names that are active by default in the pipeline. */
export const DEFAULT_PIPELINE_AGENT_NAMES = new Set<string>(
  PIPELINE_STEP_CONFIG.filter((s) => s.defaultEnabled).map((s) => s.agentName),
);

export type PipelineStepKey = (typeof PIPELINE_STEP_CONFIG)[number]["key"];

/** Sort agents by pipeline execution order. */
export function sortAgentsByPipelineOrder(agents: Agent[]): Agent[] {
  return [...agents].sort(
    (a, b) =>
      (PIPELINE_ORDER[a.display_name] ?? 99) -
      (PIPELINE_ORDER[b.display_name] ?? 99)
  );
}

/** The generator agent creates code from scratch (position 1). */
export function isGeneratorAgent(agent: Agent): boolean {
  return (PIPELINE_ORDER[agent.display_name] ?? 99) === 1;
}

/** Reviewer agents inspect and may modify generated code (positions 2-4). */
export function isReviewerAgent(agent: Agent): boolean {
  const order = PIPELINE_ORDER[agent.display_name] ?? 99;
  return order >= 2 && order <= 4;
}

/** The pattern agent analyzes changes to suggest patterns (position 5). */
export function isPatternAgent(agent: Agent): boolean {
  return (PIPELINE_ORDER[agent.display_name] ?? 99) === 5;
}

/** The PM agent coordinates the pipeline (position 0). */
export function isOrchestratorAgent(agent: Agent): boolean {
  return (PIPELINE_ORDER[agent.display_name] ?? 99) === 0;
}

/** Get the pipeline role for an agent. */
export function getAgentRole(agent: Agent): PipelineRole {
  const order = PIPELINE_ORDER[agent.display_name] ?? 99;
  if (order === 0) return "plan";
  if (order === 1) return "generate";
  if (order >= 2 && order <= 4) return "review";
  if (order === 5) return "patterns";
  return "generate"; // fallback for unknown agents
}

/** Create an empty pipeline step for an agent. */
export function createPendingStep(
  agent: Agent,
  role: PipelineRole
): PipelineStepResult {
  return {
    agentId: agent.id,
    agentName: agent.display_name,
    role,
    status: "pending",
    systemPrompt: "",
    userMessage: "",
    rawResponse: "",
    tokenUsage: null,
    durationMs: 0,
    artifactsModified: [],
    summary: "",
  };
}

// --- Log export ---

const ROLE_DISPLAY: Record<string, string> = {
  plan: "Plan",
  generate: "Generate",
  review: "Review",
  rewrite: "Rewrite",
  patterns: "Patterns",
  summary: "Summary",
  compile_fix: "Compile Fix",
};

function formatDurationForLog(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${((ms % 60_000) / 1000).toFixed(0)}s`;
}

/**
 * Format pipeline steps as a readable markdown log for download.
 */
export function formatPipelineLog(steps: PipelineStepResult[]): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  // --- Summary header ---
  const completedCount = steps.filter((s) => s.status === "completed").length;
  const failedCount = steps.filter((s) => s.status === "failed").length;
  const skippedCount = steps.filter((s) => s.status === "skipped").length;
  const totalDurationMs = steps.reduce((sum, s) => sum + s.durationMs, 0);
  const totalInput = steps.reduce((sum, s) => sum + (s.tokenUsage?.input ?? 0), 0);
  const totalOutput = steps.reduce((sum, s) => sum + (s.tokenUsage?.output ?? 0), 0);

  lines.push("# Agent Pipeline Log");
  lines.push("");
  lines.push(`**Generated:** ${timestamp}`);
  lines.push(`**Steps:** ${completedCount} completed, ${failedCount} failed, ${skippedCount} skipped (${steps.length} total)`);
  lines.push(`**Duration:** ${formatDurationForLog(totalDurationMs)}`);
  lines.push(`**Tokens:** ${(totalInput + totalOutput).toLocaleString()} (${totalInput.toLocaleString()} input + ${totalOutput.toLocaleString()} output)`);

  // Per-agent usage table
  const agentMap = new Map<string, { role: string; input: number; output: number; durationMs: number }>();
  for (const step of steps) {
    const existing = agentMap.get(step.agentName);
    const inp = step.tokenUsage?.input ?? 0;
    const out = step.tokenUsage?.output ?? 0;
    if (existing) {
      existing.input += inp;
      existing.output += out;
      existing.durationMs += step.durationMs;
    } else {
      agentMap.set(step.agentName, { role: step.role, input: inp, output: out, durationMs: step.durationMs });
    }
  }

  lines.push("");
  lines.push("## Token Usage by Agent");
  lines.push("");
  lines.push("| Agent | Role | Input | Output | Total | Duration |");
  lines.push("|-------|------|------:|-------:|------:|---------:|");
  for (const [name, u] of agentMap) {
    lines.push(`| ${name} | ${ROLE_DISPLAY[u.role] ?? u.role} | ${u.input.toLocaleString()} | ${u.output.toLocaleString()} | ${(u.input + u.output).toLocaleString()} | ${formatDurationForLog(u.durationMs)} |`);
  }

  // --- Individual steps ---
  lines.push("");
  lines.push("---");
  lines.push("");

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const statusTag =
      step.status === "completed" ? "[OK]" :
      step.status === "failed" ? "[FAIL]" :
      step.status === "skipped" ? "[SKIP]" :
      `[${step.status.toUpperCase()}]`;

    lines.push(`## Step ${i + 1}: ${step.agentName} (${ROLE_DISPLAY[step.role] ?? step.role}) ${statusTag}`);
    lines.push("");

    if (step.durationMs > 0) lines.push(`- **Duration:** ${formatDurationForLog(step.durationMs)}`);
    if (step.tokenUsage) {
      lines.push(`- **Tokens:** ${(step.tokenUsage.input + step.tokenUsage.output).toLocaleString()} (${step.tokenUsage.input.toLocaleString()} in + ${step.tokenUsage.output.toLocaleString()} out)`);
    }
    if (step.artifactsModified.length > 0) lines.push(`- **Artifacts:** ${step.artifactsModified.join(", ")}`);
    if (step.error) lines.push(`- **Error:** ${step.error}`);
    if (step.summary) lines.push(`\n> ${step.summary}`);

    if (step.systemPrompt) {
      lines.push("");
      lines.push(`<details><summary>System Prompt (${step.systemPrompt.length.toLocaleString()} chars)</summary>`);
      lines.push("");
      lines.push("```");
      lines.push(step.systemPrompt);
      lines.push("```");
      lines.push("");
      lines.push("</details>");
    }

    if (step.userMessage) {
      lines.push("");
      lines.push(`<details><summary>User Message (${step.userMessage.length.toLocaleString()} chars)</summary>`);
      lines.push("");
      lines.push("```");
      lines.push(step.userMessage);
      lines.push("```");
      lines.push("");
      lines.push("</details>");
    }

    if (step.rawResponse) {
      lines.push("");
      lines.push(`<details><summary>Response (${step.rawResponse.length.toLocaleString()} chars)</summary>`);
      lines.push("");
      lines.push("```");
      lines.push(step.rawResponse);
      lines.push("```");
      lines.push("");
      lines.push("</details>");
    }

    lines.push("");
  }

  return lines.join("\n");
}
