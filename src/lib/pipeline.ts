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
  PATTERNS: "patterns",
  SUMMARY: "summary",
} as const;

export type PipelineRole =
  (typeof PIPELINE_ROLES)[keyof typeof PIPELINE_ROLES];

export interface PipelineStepResult {
  agentId: string;
  agentName: string;
  role: PipelineRole;
  status: PipelineStepStatus;
  systemPrompt: string;
  rawResponse: string;
  tokenUsage: { input: number; output: number } | null;
  durationMs: number;
  artifactsModified: string[];
  summary: string;
  error?: string;
}

export interface PipelineExecution {
  id: string;
  startedAt: string;
  completedAt: string | null;
  steps: PipelineStepResult[];
  finalArtifactCount: number;
}

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
    rawResponse: "",
    tokenUsage: null,
    durationMs: 0,
    artifactsModified: [],
    summary: "",
  };
}
