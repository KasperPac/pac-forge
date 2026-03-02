import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  buildAuthUrl,
  getRedirectUri,
} from "@/lib/dropbox-oauth";

const DROPBOX_KEY = ["dropbox-connection"] as const;

interface DropboxConnection {
  connected: boolean;
  display_name?: string;
  email?: string;
  account_id?: string;
  connected_at?: string;
}

interface ProjectNumberSuggestion {
  prefix?: string;
  lastNumber?: number;
  suggested: string | null;
  clientExists?: boolean;
}

async function invokeDropbox(action: string, params?: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("dropbox", {
    body: { action, ...params },
  });
  if (error) throw new Error(error.message ?? `Dropbox ${action} failed`);
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Query: check if user has active Dropbox connection. */
export function useDropboxConnection() {
  return useQuery({
    queryKey: DROPBOX_KEY,
    queryFn: async (): Promise<DropboxConnection> => {
      return await invokeDropbox("check-connection");
    },
    staleTime: 5 * 60 * 1000, // 5 min
  });
}

/** Mutation: start OAuth PKCE flow (redirects browser). */
export function useDropboxConnect() {
  return useMutation({
    mutationFn: async () => {
      const appKey = import.meta.env.VITE_DROPBOX_APP_KEY as string;
      if (!appKey) throw new Error("VITE_DROPBOX_APP_KEY not set");

      const verifier = generateCodeVerifier();
      const challenge = await generateCodeChallenge(verifier);

      // Store verifier for callback
      sessionStorage.setItem("dropbox_code_verifier", verifier);

      const url = buildAuthUrl(appKey, getRedirectUri(), challenge);
      window.location.href = url;
    },
  });
}

/** Mutation: disconnect Dropbox. */
export function useDropboxDisconnect() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await invokeDropbox("disconnect");
    },
    onSuccess: () => {
      queryClient.setQueryData(DROPBOX_KEY, { connected: false });
      queryClient.invalidateQueries({ queryKey: DROPBOX_KEY });
    },
  });
}

/** Mutation: exchange OAuth code (used by callback page). */
export function useDropboxExchangeCode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      code: string;
      code_verifier: string;
      redirect_uri: string;
    }) => {
      return await invokeDropbox("exchange-code", params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DROPBOX_KEY });
    },
  });
}

/** Mutation: check if client folder exists in Dropbox. */
export function useCheckClientFolder() {
  return useMutation({
    mutationFn: async (clientName: string) => {
      return await invokeDropbox("check-client-folder", { client_name: clientName });
    },
  });
}

/** Mutation: suggest next project number from existing Dropbox folders. */
export function useSuggestProjectNumber() {
  return useMutation({
    mutationFn: async (clientName: string): Promise<ProjectNumberSuggestion> => {
      return await invokeDropbox("suggest-project-number", { client_name: clientName });
    },
  });
}

/** Mutation: full folder setup — check client folder, create if needed, copy template. */
export function useSetupProjectFolder() {
  return useMutation({
    mutationFn: async (params: {
      client_name: string;
      project_number: string;
      description_short: string;
      onProgress?: (step: string) => void;
    }) => {
      const { client_name, project_number, description_short, onProgress } = params;

      // Step 1: Check if client folder exists
      onProgress?.("Checking client folder...");
      const checkResult = await invokeDropbox("check-client-folder", { client_name });

      // Step 2: Create client folder if needed
      if (!checkResult.exists) {
        onProgress?.("Creating client folder...");
        await invokeDropbox("create-client-folder", { client_name });
      }

      // Step 3: Copy template
      onProgress?.("Copying job template...");
      const copyResult = await invokeDropbox("copy-template", {
        client_name,
        project_number,
        description_short,
      });

      return { path: copyResult.path as string };
    },
  });
}
