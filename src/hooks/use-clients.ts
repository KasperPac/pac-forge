import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Client, ClientCreate, ClientUpdate } from "@/types";

const CLIENTS_KEY = ["clients"] as const;

export function useClient(id: string | undefined) {
  return useQuery({
    queryKey: [...CLIENTS_KEY, "by-id", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as Client;
    },
  });
}

export function useClients() {
  return useQuery({
    queryKey: CLIENTS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as Client[];
    },
  });
}

export function useCreateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ClientCreate) => {
      const { data, error } = await supabase
        .from("clients")
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data as Client;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLIENTS_KEY });
    },
  });
}

export function useUpdateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: ClientUpdate & { id: string }) => {
      const { data, error } = await supabase
        .from("clients")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as Client;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLIENTS_KEY });
    },
  });
}

export function useDeleteClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("clients")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLIENTS_KEY });
    },
  });
}
