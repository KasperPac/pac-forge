import { useMemo, useCallback, useState } from "react";
import { detectConflicts, computeConflictFingerprint } from "@/lib/conflict-detector";
import type { KnowledgeConflict, ConflictDetectionContext } from "@/lib/conflict-detector";
import type { KnowledgeSource } from "@/lib/knowledge-priority";
import { useCreatePriorityOverride, usePriorityOverrides } from "./use-knowledge-priority";
import { useConflictDismissals, useCreateConflictDismissal } from "./use-conflict-dismissals";
import { useCreateAgentKnowledgeDoc } from "./use-agent-knowledge";
import { useAgents } from "./use-agents";

export interface ConflictResolution {
  conflictId: string;
  winner: KnowledgeSource;
  scope: "instance" | "permanent";
}

/**
 * Build a structured knowledge doc for the Pattern Librarian
 * from user conflict feedback.
 */
function buildConflictFeedbackContent(
  conflict: KnowledgeConflict,
  reason: string,
  isConfirmed: boolean,
): string {
  const verdict = isConfirmed
    ? "CONFIRMED as a real conflict"
    : "DISMISSED — not a real conflict";

  return [
    `## Conflict Feedback: ${verdict}`,
    "",
    `**Category:** ${conflict.category}`,
    `**Confidence:** ${(conflict.confidence * 100).toFixed(0)}%`,
    "",
    `**Source A (${conflict.sourceA.label}):**`,
    `> ${conflict.sourceA.excerpt}`,
    "",
    `**Source B (${conflict.sourceB.label}):**`,
    `> ${conflict.sourceB.excerpt}`,
    "",
    `**Auto-detected description:** ${conflict.description}`,
    "",
    `**User's reasoning:** ${reason}`,
    "",
    `### Lesson for conflict analysis`,
    isConfirmed
      ? `This type of contradiction IS meaningful: ${reason}`
      : `This type of apparent contradiction is NOT a real conflict: ${reason}`,
  ].join("\n");
}

/**
 * Manages conflict detection and resolution for the current session.
 *
 * - Detects conflicts from provided knowledge context
 * - Filters out previously dismissed conflicts
 * - Tracks per-instance resolutions in local state
 * - Persists permanent resolutions to the database
 * - Teaches Pattern Librarian from user feedback (dismiss/confirm)
 */
export function useKnowledgeConflicts(context: Omit<ConflictDetectionContext, "overrides"> | null) {
  const { data: overrides } = usePriorityOverrides();
  const createOverride = useCreatePriorityOverride();
  const [instanceResolutions, setInstanceResolutions] = useState<Map<string, KnowledgeSource>>(new Map());

  // Dismissal tracking
  const { data: dismissals } = useConflictDismissals();
  const createDismissal = useCreateConflictDismissal();
  const [localDismissals, setLocalDismissals] = useState<Set<string>>(new Set());

  // Pattern Librarian teaching
  const createKnowledgeDoc = useCreateAgentKnowledgeDoc();
  const { data: agents } = useAgents();

  const dismissedFingerprints = useMemo(
    () => {
      const set = new Set((dismissals ?? []).map((d) => d.fingerprint));
      // Merge optimistic local dismissals
      for (const fp of localDismissals) set.add(fp);
      return set;
    },
    [dismissals, localDismissals],
  );

  const conflicts = useMemo(() => {
    if (!context) return [];
    const raw = detectConflicts({ ...context, overrides: overrides ?? [] });
    // Filter out dismissed conflicts
    return raw.filter((c) => !dismissedFingerprints.has(computeConflictFingerprint(c)));
  }, [context, overrides, dismissedFingerprints]);

  // A conflict is "resolved" if it has an instance resolution or a permanent override already applied
  const unresolvedConflicts = useMemo(() => {
    return conflicts.filter((c) => !instanceResolutions.has(c.id));
  }, [conflicts, instanceResolutions]);

  const resolveConflict = useCallback(
    (conflictId: string, winner: KnowledgeSource, scope: "instance" | "permanent", reason?: string) => {
      const conflict = conflicts.find((c) => c.id === conflictId);
      if (!conflict) return;

      if (scope === "instance") {
        setInstanceResolutions((prev) => {
          const next = new Map(prev);
          next.set(conflictId, winner);
          return next;
        });
      } else {
        // Permanent: save to DB as a priority override
        const overrideScope =
          conflict.category === "GENERAL" ? "global" : `category:${conflict.category}`;

        createOverride.mutate({
          source_a: conflict.sourceA.type,
          source_b: conflict.sourceB.type,
          winner,
          scope: overrideScope,
          reason,
        });

        // Also resolve locally so the UI updates immediately
        setInstanceResolutions((prev) => {
          const next = new Map(prev);
          next.set(conflictId, winner);
          return next;
        });
      }
    },
    [conflicts, createOverride],
  );

  /**
   * Dismiss a conflict as "not a real conflict" with a reason.
   * Teaches Pattern Librarian via a knowledge doc and persists the dismissal.
   */
  const dismissConflict = useCallback(
    async (conflictId: string, reason: string) => {
      const conflict = conflicts.find((c) => c.id === conflictId);
      if (!conflict) return;

      const fingerprint = computeConflictFingerprint(conflict);

      // Optimistic: hide immediately
      setLocalDismissals((prev) => new Set([...prev, fingerprint]));

      // Find Pattern Librarian agent
      const patternLibrarian = agents?.find((a) => a.display_name === "Pattern Librarian");

      // Save as Pattern Librarian knowledge doc (teaching)
      let knowledgeDocId: string | null = null;
      if (patternLibrarian && reason.trim()) {
        try {
          const content = buildConflictFeedbackContent(conflict, reason, false);
          const doc = await createKnowledgeDoc.mutateAsync({
            agent_id: patternLibrarian.id,
            title: `Conflict Feedback: Not a conflict (${conflict.category})`,
            content,
            source_filename: null,
            file_type: "md",
            word_count: content.split(/\s+/).length,
            plc_brand: "SIEMENS_TIA",
            compatible_cpus: ["ALL"],
          });
          knowledgeDocId = doc.id;
        } catch {
          // Teaching failed — still save the dismissal
        }
      }

      // Persist dismissal
      createDismissal.mutate({
        fingerprint,
        source_a_type: conflict.sourceA.type,
        source_a_label: conflict.sourceA.label,
        source_a_excerpt: conflict.sourceA.excerpt,
        source_b_type: conflict.sourceB.type,
        source_b_label: conflict.sourceB.label,
        source_b_excerpt: conflict.sourceB.excerpt,
        reason,
        knowledge_doc_id: knowledgeDocId,
      });
    },
    [conflicts, agents, createKnowledgeDoc, createDismissal],
  );

  /**
   * Confirm a conflict as real and explain why — teaches Pattern Librarian
   * what constitutes a genuine conflict. The conflict stays visible.
   */
  const confirmConflict = useCallback(
    async (conflictId: string, reason: string) => {
      const conflict = conflicts.find((c) => c.id === conflictId);
      if (!conflict) return;

      const patternLibrarian = agents?.find((a) => a.display_name === "Pattern Librarian");
      if (!patternLibrarian || !reason.trim()) return;

      const content = buildConflictFeedbackContent(conflict, reason, true);
      await createKnowledgeDoc.mutateAsync({
        agent_id: patternLibrarian.id,
        title: `Conflict Feedback: Confirmed conflict (${conflict.category})`,
        content,
        source_filename: null,
        file_type: "md",
        word_count: content.split(/\s+/).length,
        plc_brand: "SIEMENS_TIA",
        compatible_cpus: ["ALL"],
      });
    },
    [conflicts, agents, createKnowledgeDoc],
  );

  const getResolution = useCallback(
    (conflictId: string): KnowledgeSource | null => {
      return instanceResolutions.get(conflictId) ?? null;
    },
    [instanceResolutions],
  );

  return {
    conflicts,
    unresolvedConflicts,
    unresolvedCount: unresolvedConflicts.length,
    resolveConflict,
    dismissConflict,
    confirmConflict,
    getResolution,
    instanceResolutions,
  };
}
