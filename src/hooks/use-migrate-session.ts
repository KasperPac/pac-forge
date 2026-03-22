import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { MigrationSession, MigrationSessionCreate, MigrationSessionUpdate } from "@/types";

const KEY = ["migration_sessions"] as const;

function sessionKey(id: string) {
  return [...KEY, id] as const;
}

function rowToSession(row: Record<string, unknown>): MigrationSession {
  return row as unknown as MigrationSession;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useMigrationSession(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: sessionKey(sessionId ?? "none"),
    queryFn: async (): Promise<MigrationSession | null> => {
      const { data, error } = await supabase
        .from("migration_sessions")
        .select("*")
        .eq("id", sessionId!)
        .maybeSingle();
      if (error) throw error;
      return data ? rowToSession(data) : null;
    },
    enabled: !!sessionId,
  });
}

export function useMigrationSessions() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<MigrationSession[]> => {
      const { data, error } = await supabase
        .from("migration_sessions")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(rowToSession);
    },
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateMigrationSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: MigrationSessionCreate): Promise<MigrationSession> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("migration_sessions")
        .insert({
          user_id: user.id,
          name: payload.name,
          current_step: "connect",
          source_blocks: {},
          source_block_count: 0,
          migration_plan: [],
          migrated_blocks: [],
          review_findings: [],
        })
        .select()
        .single();
      if (error) throw error;
      return rowToSession(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
    },
  });
}

export function useUpdateMigrationSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: MigrationSessionUpdate;
    }): Promise<MigrationSession> => {
      const { data, error } = await supabase
        .from("migration_sessions")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return rowToSession(data);
    },
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: KEY });
      queryClient.invalidateQueries({ queryKey: sessionKey(id) });
    },
  });
}

export function useDeleteMigrationSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("migration_sessions")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
    },
  });
}
