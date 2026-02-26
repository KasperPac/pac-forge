import { useMemo, useCallback, useState } from "react";
import { detectConflicts } from "@/lib/conflict-detector";
import type { ConflictDetectionContext } from "@/lib/conflict-detector";
import type { KnowledgeSource } from "@/lib/knowledge-priority";
import { useCreatePriorityOverride, usePriorityOverrides } from "./use-knowledge-priority";

export interface ConflictResolution {
  conflictId: string;
  winner: KnowledgeSource;
  scope: "instance" | "permanent";
}

/**
 * Manages conflict detection and resolution for the current session.
 *
 * - Detects conflicts from provided knowledge context
 * - Tracks per-instance resolutions in local state
 * - Persists permanent resolutions to the database
 */
export function useKnowledgeConflicts(context: Omit<ConflictDetectionContext, "overrides"> | null) {
  const { data: overrides } = usePriorityOverrides();
  const createOverride = useCreatePriorityOverride();
  const [instanceResolutions, setInstanceResolutions] = useState<Map<string, KnowledgeSource>>(new Map());

  const conflicts = useMemo(() => {
    if (!context) return [];
    return detectConflicts({ ...context, overrides: overrides ?? [] });
  }, [context, overrides]);

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
    getResolution,
    instanceResolutions,
  };
}
