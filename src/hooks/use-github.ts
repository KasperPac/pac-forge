import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Profile, Project, RevisionLogEntry } from "@/types";

const GITHUB_CONNECTION_KEY = ["github-connection"] as const;
const PROJECTS_KEY = ["projects"] as const;

export interface GitHubConnection {
  connected: boolean;
  username: string | null;
}

export interface GitHubDeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface GitHubRepoInfo {
  name: string;
  full_name: string;
  html_url: string;
  private: boolean;
  default_branch?: string;
  description?: string | null;
  updated_at?: string;
  owner?: string;
}

export interface GitHubCommit {
  sha: string;
  html_url: string;
  message: string;
  author: string;
  date: string;
}

interface DeviceFlowTokenResponse {
  access_token: string;
}

async function parseFunctionError(error: {
  message: string;
  context?: { json?: () => Promise<unknown> };
}) {
  let detail = error.message;
  if (error.context && typeof error.context.json === "function") {
    const body = await error.context.json().catch(() => null) as { error?: string } | null;
    if (body?.error) {
      detail = body.error;
    }
  }
  return detail;
}

async function invokeGitHubProxy<T>(action: string, params?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("github-proxy", {
    body: { action, ...params },
  });

  if (error) {
    throw new Error(await parseFunctionError(error));
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data as T;
}

async function githubDeviceFlowRequest<T>(url: string, body: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });

  const data = await response.json() as Record<string, unknown>;
  if (data.error) {
    throw new Error((data.error_description as string | undefined) ?? String(data.error));
  }
  if (!response.ok) {
    throw new Error(response.statusText);
  }

  return data as T;
}

function buildRevisionEntry(existingLog: RevisionLogEntry[], description: string, author: string): RevisionLogEntry {
  return {
    version: `v${existingLog.length + 1}`,
    description,
    author,
    timestamp: new Date().toISOString(),
  };
}

export function deriveGitHubRepoName(project: Pick<Project, "client_name" | "project_number">) {
  const raw = [project.project_number, project.client_name]
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return raw || "pac-forge-project";
}

export function useGitHubConnection() {
  const queryClient = useQueryClient();

  const connectionQuery = useQuery({
    queryKey: GITHUB_CONNECTION_KEY,
    queryFn: async (): Promise<GitHubConnection> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return { connected: false, username: null };
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("github_username")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return {
        connected: !!data?.github_username,
        username: (data?.github_username as string | null) ?? null,
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  const startDeviceFlow = useMutation({
    mutationFn: async (): Promise<GitHubDeviceCode> => {
      const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID as string | undefined;
      if (!clientId) {
        throw new Error("VITE_GITHUB_CLIENT_ID is not configured");
      }

      return await githubDeviceFlowRequest<GitHubDeviceCode>(
        "https://github.com/login/device/code",
        { client_id: clientId, scope: "repo" },
      );
    },
  });

  const finishDeviceFlow = useMutation({
    mutationFn: async (deviceFlow: GitHubDeviceCode) => {
      const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID as string | undefined;
      if (!clientId) {
        throw new Error("VITE_GITHUB_CLIENT_ID is not configured");
      }

      const expiresAt = Date.now() + deviceFlow.expires_in * 1000;
      let intervalSeconds = Math.max(deviceFlow.interval, 5);

      while (Date.now() < expiresAt) {
        const response = await githubDeviceFlowRequest<DeviceFlowTokenResponse>(
          "https://github.com/login/oauth/access_token",
          {
            client_id: clientId,
            device_code: deviceFlow.device_code,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          },
        ).catch((error: Error) => {
          const message = error.message.toLowerCase();
          if (message.includes("authorization_pending")) {
            return { pending: true } as const;
          }
          if (message.includes("slow_down")) {
            return { slowDown: true } as const;
          }
          if (message.includes("expired_token")) {
            return { expired: true } as const;
          }
          throw error;
        });

        if ("access_token" in response) {
          const userResponse = await fetch("https://api.github.com/user", {
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: `Bearer ${response.access_token}`,
              "User-Agent": "pac-forge-github-connect",
              "X-GitHub-Api-Version": "2022-11-28",
            },
          });

          const userData = await userResponse.json() as { login?: string; message?: string };
          if (!userResponse.ok || !userData.login) {
            throw new Error(userData.message ?? "Failed to read GitHub user profile");
          }

          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (!user) {
            throw new Error("Not authenticated");
          }

          const updates: Partial<Profile> = {
            github_access_token: response.access_token,
            github_username: userData.login,
          };

          const { error } = await supabase
            .from("profiles")
            .update(updates)
            .eq("user_id", user.id);

          if (error) {
            throw error;
          }

          return { username: userData.login };
        }

        if ("expired" in response) {
          throw new Error("GitHub device code expired. Start the connection again.");
        }

        if ("slowDown" in response) {
          intervalSeconds += 5;
        }

        await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
      }

      throw new Error("GitHub authorization timed out. Start the connection again.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GITHUB_CONNECTION_KEY });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        throw new Error("Not authenticated");
      }

      const { error } = await supabase
        .from("profiles")
        .update({
          github_access_token: null,
          github_username: null,
        })
        .eq("user_id", user.id);

      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GITHUB_CONNECTION_KEY });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
  });

  return {
    ...connectionQuery,
    connection: connectionQuery.data ?? { connected: false, username: null },
    startDeviceFlow,
    finishDeviceFlow,
    disconnect,
  };
}

export function useCreateGitHubRepo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      projectId: string;
      repoName: string;
      description?: string | null;
    }) => {
      const repoResponse = await invokeGitHubProxy<{ repo: GitHubRepoInfo }>("create_repo", {
        name: params.repoName,
        description: params.description ?? "",
      });

      const [{ data: currentProject, error: projectError }, { data: authData }] = await Promise.all([
        supabase
          .from("projects")
          .select("revision_log")
          .eq("id", params.projectId)
          .single(),
        supabase.auth.getUser(),
      ]);

      if (projectError) {
        throw projectError;
      }

      const existingLog = (currentProject?.revision_log as RevisionLogEntry[] | null) ?? [];
      const author = authData.user?.email ?? authData.user?.id ?? "unknown";
      const revisionEntry = buildRevisionEntry(
        existingLog,
        `Connected GitHub repository ${repoResponse.repo.full_name}`,
        author,
      );

      const { data, error } = await supabase
        .from("projects")
        .update({
          github_repo_url: repoResponse.repo.html_url,
          github_repo_name: repoResponse.repo.full_name,
          revision_log: [...existingLog, revisionEntry],
        })
        .eq("id", params.projectId)
        .select("*")
        .single();

      if (error) {
        throw error;
      }

      return {
        project: data as Project,
        repo: repoResponse.repo,
      };
    },
    onSuccess: ({ project }) => {
      queryClient.invalidateQueries({ queryKey: PROJECTS_KEY });
      queryClient.setQueryData([...PROJECTS_KEY, project.id], project);
    },
  });
}

export function useGitHubRepo(repoName: string | null | undefined) {
  return useQuery({
    queryKey: ["github-repo", repoName],
    queryFn: async (): Promise<GitHubRepoInfo> => {
      const data = await invokeGitHubProxy<{ repo: GitHubRepoInfo }>("get_repo", {
        repo: repoName,
      });
      return data.repo;
    },
    enabled: !!repoName,
    staleTime: 30 * 1000,
  });
}

export function useGitHubCommits(repoName: string | null | undefined, perPage = 5) {
  return useQuery({
    queryKey: ["github-commits", repoName, perPage],
    queryFn: async (): Promise<GitHubCommit[]> => {
      const data = await invokeGitHubProxy<{ commits: GitHubCommit[] }>("list_commits", {
        repo: repoName,
        per_page: perPage,
      });
      return data.commits;
    },
    enabled: !!repoName,
    staleTime: 30 * 1000,
  });
}
