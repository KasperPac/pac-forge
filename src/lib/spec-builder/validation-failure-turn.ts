import type { FdsConversationTurn } from "@/types/spec-contract-v2";

interface BuildArgs {
  stateLabel: string;          // human-readable state name (e.g. "Execute (state_id 6)")
  issues: string[];            // raw validator issue strings
  stateContext?: string;       // optional state_id for downstream filtering
}

/**
 * Builds a system-role turn announcing a validator-gate rejection. The
 * conversation hooks (use-fds-conversation, use-fds-orchestration-conversation)
 * append this to the same `conversation` JSONB array that holds user and
 * assistant turns. Valid blocks from the same response still merge — the
 * partial-merge guidance line tells the engineer not to worry about the
 * other states.
 *
 * FdsConversationTurnSchema.role already accepts "system" (verified before
 * Phase 3 plan-write); no schema widening needed.
 */
export function buildValidationFailureTurn({
  stateLabel,
  issues,
  stateContext,
}: BuildArgs): FdsConversationTurn {
  const issueLines = issues.map((i) => `  - ${i}`).join("\n");
  const content =
    `⚠ The AI's proposed update to ${stateLabel} was rejected:\n` +
    `${issueLines}\n\n` +
    `The other state updates in this turn merged successfully. Ask the AI to retry just this state, or correct it by hand.`;
  return {
    role: "system",
    content,
    timestamp: new Date().toISOString(),
    state_context: stateContext,
  };
}
