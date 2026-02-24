import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { AuditAction } from "@/types/tia";

/**
 * Hook to log audit actions. Fire-and-forget — errors are logged but not thrown.
 */
export function useAuditLog() {
  return useMutation({
    mutationFn: async (input: {
      action: AuditAction;
      projectId?: string;
      details?: Record<string, unknown>;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase.from("audit_logs").insert({
        user_id: user?.id ?? "",
        project_id: input.projectId ?? null,
        action: input.action,
        details: input.details ?? {},
      });

      if (error) {
        console.error("Audit log failed:", error);
      }
    },
  });
}
