import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { AgentKnowledgeDoc, AgentKnowledgeDocCreate } from "@/types";

const KNOWLEDGE_KEY = ["agent-knowledge"] as const;

export function useAgentKnowledgeDocs(agentId: string | undefined) {
  return useQuery({
    queryKey: [...KNOWLEDGE_KEY, agentId],
    queryFn: async (): Promise<AgentKnowledgeDoc[]> => {
      const { data, error } = await supabase
        .from("agent_knowledge_docs")
        .select("*")
        .eq("agent_id", agentId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as AgentKnowledgeDoc[];
    },
    enabled: !!agentId,
  });
}

/** Fetch knowledge docs for multiple agents at once (keyed by agent ID). */
export function useMultiAgentKnowledgeDocs(agentIds: string[]) {
  return useQuery({
    queryKey: [...KNOWLEDGE_KEY, "multi", ...agentIds],
    queryFn: async (): Promise<Record<string, AgentKnowledgeDoc[]>> => {
      if (agentIds.length === 0) return {};
      const { data, error } = await supabase
        .from("agent_knowledge_docs")
        .select("*")
        .in("agent_id", agentIds)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const grouped: Record<string, AgentKnowledgeDoc[]> = {};
      for (const doc of data as AgentKnowledgeDoc[]) {
        if (!grouped[doc.agent_id]) grouped[doc.agent_id] = [];
        grouped[doc.agent_id].push(doc);
      }
      return grouped;
    },
    enabled: agentIds.length > 0,
  });
}

/**
 * Fetch knowledge docs for a single agent, filtered by platform and CPU.
 * If cpuType is undefined, filters by brand only.
 * Docs with compatible_cpus containing 'ALL' always match.
 */
export function useFilteredAgentKnowledgeDocs(
  agentId: string | undefined,
  plcBrand: string,
  cpuType?: string
) {
  return useQuery({
    queryKey: [...KNOWLEDGE_KEY, "filtered", agentId, plcBrand, cpuType ?? "any"],
    queryFn: async (): Promise<AgentKnowledgeDoc[]> => {
      let query = supabase
        .from("agent_knowledge_docs")
        .select("*")
        .eq("agent_id", agentId!)
        .eq("plc_brand", plcBrand);

      if (cpuType) {
        query = query.or(`compatible_cpus.cs.{ALL},compatible_cpus.cs.{${cpuType}}`);
      }

      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;
      return data as AgentKnowledgeDoc[];
    },
    enabled: !!agentId,
  });
}

/**
 * Fetch knowledge docs for multiple agents, filtered by platform and CPU.
 * If cpuType is undefined, filters by brand only.
 * Docs with compatible_cpus containing 'ALL' always match.
 */
export function useFilteredMultiAgentKnowledgeDocs(
  agentIds: string[],
  plcBrand: string,
  cpuType?: string
) {
  return useQuery({
    queryKey: [...KNOWLEDGE_KEY, "filtered-multi", plcBrand, cpuType ?? "any", ...agentIds],
    queryFn: async (): Promise<Record<string, AgentKnowledgeDoc[]>> => {
      if (agentIds.length === 0) return {};

      let query = supabase
        .from("agent_knowledge_docs")
        .select("*")
        .in("agent_id", agentIds)
        .eq("plc_brand", plcBrand);

      if (cpuType) {
        query = query.or(`compatible_cpus.cs.{ALL},compatible_cpus.cs.{${cpuType}}`);
      }

      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;

      const grouped: Record<string, AgentKnowledgeDoc[]> = {};
      for (const doc of data as AgentKnowledgeDoc[]) {
        if (!grouped[doc.agent_id]) grouped[doc.agent_id] = [];
        grouped[doc.agent_id].push(doc);
      }
      return grouped;
    },
    enabled: agentIds.length > 0,
  });
}

export function useCreateAgentKnowledgeDoc() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (doc: AgentKnowledgeDocCreate) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("agent_knowledge_docs")
        .insert({ ...doc, created_by: user.id })
        .select()
        .single();
      if (error) throw error;
      return data as AgentKnowledgeDoc;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...KNOWLEDGE_KEY, variables.agent_id] });
      queryClient.invalidateQueries({ queryKey: [...KNOWLEDGE_KEY, "multi"] });
    },
  });
}

export function useDeleteAgentKnowledgeDoc() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, agentId }: { id: string; agentId: string }) => {
      const { error } = await supabase
        .from("agent_knowledge_docs")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return agentId;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...KNOWLEDGE_KEY, variables.agentId] });
      queryClient.invalidateQueries({ queryKey: [...KNOWLEDGE_KEY, "multi"] });
    },
  });
}
