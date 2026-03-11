import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type GitHubProxyAction = "create_repo" | "get_repo" | "list_commits";

interface GitHubProxyRequest {
  action: GitHubProxyAction;
  name?: string;
  description?: string;
  repo?: string;
  per_page?: number;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function sanitizeRepo(repo: string | undefined): string {
  if (!repo) {
    throw new Error("repo is required");
  }

  const trimmed = repo.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    throw new Error("repo must be in owner/name format");
  }

  return trimmed;
}

async function githubRequest(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "pac-forge-github-proxy",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let details = await response.text();
    try {
      const parsed = JSON.parse(details);
      details = parsed.message ?? details;
    } catch {
      // Keep raw text details.
    }
    throw new Error(`GitHub API ${response.status}: ${details}`);
  }

  return await response.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing Authorization header" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return jsonResponse(
      { error: "Unauthorized", details: authError?.message ?? "Invalid token" },
      401,
    );
  }

  try {
    const body = (await req.json()) as GitHubProxyRequest;
    if (!body.action) {
      return jsonResponse({ error: "action is required" }, 400);
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("github_access_token, github_username")
      .eq("user_id", user.id)
      .single();

    if (profileError) {
      return jsonResponse({ error: profileError.message }, 500);
    }

    const token = profile?.github_access_token as string | null;
    if (!token) {
      return jsonResponse({ error: "GitHub is not connected for this user" }, 400);
    }

    if (body.action === "create_repo") {
      if (!body.name?.trim()) {
        return jsonResponse({ error: "name is required" }, 400);
      }

      const repo = await githubRequest(token, "/user/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: body.name.trim(),
          description: body.description?.trim() || "",
          private: true,
          auto_init: true,
        }),
      }) as Record<string, unknown>;

      return jsonResponse({
        repo: {
          name: repo.name,
          full_name: repo.full_name,
          html_url: repo.html_url,
          private: repo.private,
          default_branch: repo.default_branch,
          owner: (repo.owner as Record<string, unknown> | undefined)?.login ?? profile.github_username,
        },
      });
    }

    if (body.action === "get_repo") {
      const repoPath = sanitizeRepo(body.repo);
      const repo = await githubRequest(token, `/repos/${repoPath}`) as Record<string, unknown>;

      return jsonResponse({
        repo: {
          name: repo.name,
          full_name: repo.full_name,
          html_url: repo.html_url,
          private: repo.private,
          default_branch: repo.default_branch,
          description: repo.description,
          updated_at: repo.updated_at,
        },
      });
    }

    if (body.action === "list_commits") {
      const repoPath = sanitizeRepo(body.repo);
      const perPage = Math.min(Math.max(body.per_page ?? 10, 1), 25);
      const commits = await githubRequest(
        token,
        `/repos/${repoPath}/commits?per_page=${perPage}`,
      ) as Array<Record<string, unknown>>;

      return jsonResponse({
        commits: commits.map((entry) => {
          const commit = (entry.commit as Record<string, unknown> | undefined) ?? {};
          const author = (commit.author as Record<string, unknown> | undefined) ?? {};
          return {
            sha: entry.sha,
            html_url: entry.html_url,
            message: commit.message,
            author:
              author.name ??
              (entry.author as Record<string, unknown> | undefined)?.login ??
              "Unknown",
            date: author.date,
          };
        }),
      });
    }

    return jsonResponse({ error: `Unsupported action: ${body.action}` }, 400);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});
