// Supabase Edge Function: Dropbox API proxy
// Keeps DROPBOX_APP_SECRET server-side. Action-based routing.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DROPBOX_API = "https://api.dropboxapi.com/2";
const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const TEMPLATE_PATH = "/Pac/Jobs/1.JobTemplate";
const JOBS_ROOT = "/Pac/Jobs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ---------- Helpers ----------

interface TokenRow {
  id: string;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: string | null;
  root_namespace_id: string | null;
}

async function getValidToken(
  supabase: ReturnType<typeof createClient>,
  _userId: string
): Promise<{ token: string; rootNamespaceId?: string; error?: string }> {
  // Shared connection — get the single team connection (no user_id filter)
  const { data, error } = await supabase
    .from("dropbox_connections")
    .select("id, access_token, refresh_token, token_expires_at, root_namespace_id")
    .limit(1)
    .single();

  if (error || !data) {
    return { token: "", error: "No Dropbox connection found" };
  }

  const row = data as TokenRow;

  // Check if token is expired (with 60s buffer)
  if (row.token_expires_at) {
    const expiresAt = new Date(row.token_expires_at).getTime();
    if (Date.now() > expiresAt - 60_000) {
      if (!row.refresh_token) {
        return { token: "", error: "Token expired and no refresh token" };
      }
      // Refresh the token
      const refreshed = await refreshAccessToken(row.refresh_token);
      if (refreshed.error) {
        return { token: "", error: refreshed.error };
      }
      // Update stored tokens
      await supabase
        .from("dropbox_connections")
        .update({
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token ?? row.refresh_token,
          token_expires_at: new Date(
            Date.now() + refreshed.expires_in * 1000
          ).toISOString(),
        })
        .eq("id", row.id);

      return { token: refreshed.access_token, rootNamespaceId: row.root_namespace_id ?? undefined };
    }
  }

  return { token: row.access_token, rootNamespaceId: row.root_namespace_id ?? undefined };
}

async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  error?: string;
}> {
  const appKey = Deno.env.get("DROPBOX_APP_KEY")!;
  const appSecret = Deno.env.get("DROPBOX_APP_SECRET")!;

  const resp = await fetch(DROPBOX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: appKey,
      client_secret: appSecret,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    return { access_token: "", expires_in: 0, error: `Refresh failed: ${text}` };
  }

  return await resp.json();
}

async function dropboxApi(
  token: string,
  endpoint: string,
  body: Record<string, unknown>,
  rootNamespaceId?: string
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string; status?: number }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  // For Business/Team accounts, set the path root to the team namespace
  if (rootNamespaceId) {
    headers["Dropbox-API-Path-Root"] = JSON.stringify({
      ".tag": "root",
      root: rootNamespaceId,
    });
  }

  // Retry with backoff for rate-limit errors (too_many_write_operations)
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const resp = await fetch(`${DROPBOX_API}${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      // Retry on too_many_write_operations (Dropbox 409 rate limit)
      if (text.includes("too_many_write_operations") && attempt < MAX_RETRIES) {
        const delay = (attempt + 1) * 2000; // 2s, 4s, 6s
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      return { ok: false, error: text, status: resp.status };
    }

    const data = await resp.json();
    return { ok: true, data };
  }

  return { ok: false, error: "Max retries exceeded", status: 429 };
}

// ---------- Action Handlers ----------

async function handleExchangeCode(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  userEmail: string,
  body: Record<string, unknown>
): Promise<Response> {
  const { code, code_verifier, redirect_uri } = body as {
    code: string;
    code_verifier: string;
    redirect_uri: string;
  };

  if (!code || !code_verifier || !redirect_uri) {
    return jsonResponse({ error: "code, code_verifier, redirect_uri required" }, 400);
  }

  const appKey = Deno.env.get("DROPBOX_APP_KEY")!;
  const appSecret = Deno.env.get("DROPBOX_APP_SECRET")!;

  const tokenResp = await fetch(DROPBOX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      code_verifier,
      redirect_uri,
      client_id: appKey,
      client_secret: appSecret,
    }),
  });

  if (!tokenResp.ok) {
    const text = await tokenResp.text();
    return jsonResponse({ error: `Token exchange failed: ${text}` }, 400);
  }

  const tokens = await tokenResp.json();

  // Get account info
  const accountResp = await fetch(`${DROPBOX_API}/users/get_current_account`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      "Content-Type": "application/json",
    },
    body: "null",
  });

  let displayName = null;
  let email = null;
  let accountId = null;
  let rootNamespaceId = null;
  if (accountResp.ok) {
    const account = await accountResp.json();
    displayName = account.name?.display_name ?? null;
    email = account.email ?? null;
    accountId = account.account_id ?? null;
    // For Business/Team accounts, capture the root namespace ID
    rootNamespaceId = account.root_info?.root_namespace_id ?? null;
  }

  // Shared connection: delete any existing connections, then insert new one
  await supabase.from("dropbox_connections").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  const { error } = await supabase.from("dropbox_connections").insert({
    user_id: userId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? null,
    token_expires_at: tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null,
    account_id: accountId,
    display_name: displayName,
    email,
    connected_at: new Date().toISOString(),
    connected_by_email: userEmail,
    root_namespace_id: rootNamespaceId,
  });

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  return jsonResponse({ connected: true, display_name: displayName, email, connected_by_email: userEmail }, 200);
}

async function handleCheckConnection(
  supabase: ReturnType<typeof createClient>,
  _userId: string
): Promise<Response> {
  // Shared connection — check if ANY connection exists (not per-user)
  const { data, error } = await supabase
    .from("dropbox_connections")
    .select("display_name, email, account_id, connected_at, connected_by_email")
    .limit(1)
    .single();

  if (error || !data) {
    return jsonResponse({ connected: false }, 200);
  }

  return jsonResponse({
    connected: true,
    display_name: data.display_name,
    email: data.email,
    account_id: data.account_id,
    connected_at: data.connected_at,
    connected_by_email: data.connected_by_email,
  }, 200);
}

async function handleDisconnect(
  supabase: ReturnType<typeof createClient>,
  _userId: string
): Promise<Response> {
  // Shared connection — delete all connections (any user can disconnect)
  const { error } = await supabase
    .from("dropbox_connections")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  return jsonResponse({ disconnected: true }, 200);
}

async function handleCheckClientFolder(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>
): Promise<Response> {
  const clientName = body.client_name as string;
  if (!clientName) {
    return jsonResponse({ error: "client_name required" }, 400);
  }

  const { token, rootNamespaceId, error: tokenErr } = await getValidToken(supabase, userId);
  if (tokenErr) return jsonResponse({ error: tokenErr }, 401);

  const folderPath = `${JOBS_ROOT}/${clientName}`;
  const result = await dropboxApi(token, "/files/get_metadata", { path: folderPath }, rootNamespaceId);

  if (result.ok) {
    return jsonResponse({ exists: true, path: folderPath }, 200);
  }

  // 409 with path/not_found means folder doesn't exist
  if (result.status === 409) {
    return jsonResponse({ exists: false, path: folderPath }, 200);
  }

  return jsonResponse({ error: result.error ?? "Dropbox API error" }, 500);
}

async function handleCreateClientFolder(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>
): Promise<Response> {
  const clientName = body.client_name as string;
  if (!clientName) {
    return jsonResponse({ error: "client_name required" }, 400);
  }

  const { token, rootNamespaceId, error: tokenErr } = await getValidToken(supabase, userId);
  if (tokenErr) return jsonResponse({ error: tokenErr }, 401);

  const folderPath = `${JOBS_ROOT}/${clientName}`;
  const result = await dropboxApi(token, "/files/create_folder_v2", { path: folderPath }, rootNamespaceId);

  if (!result.ok) {
    // Folder already exists — treat as success (idempotent)
    if (result.error?.includes("conflict/folder")) {
      return jsonResponse({ created: false, already_exists: true, path: folderPath }, 200);
    }
    return jsonResponse({ error: result.error ?? "Failed to create folder" }, 500);
  }

  return jsonResponse({ created: true, path: folderPath }, 200);
}

async function handleCopyTemplate(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>
): Promise<Response> {
  const clientName = body.client_name as string;
  const projectNumber = body.project_number as string;
  const descriptionShort = body.description_short as string;

  if (!clientName || !projectNumber || !descriptionShort) {
    return jsonResponse(
      { error: "client_name, project_number, description_short required" },
      400
    );
  }

  const { token, rootNamespaceId, error: tokenErr } = await getValidToken(supabase, userId);
  if (tokenErr) return jsonResponse({ error: tokenErr }, 401);

  const destPath = `${JOBS_ROOT}/${clientName}/${projectNumber} - ${descriptionShort}`;

  const result = await dropboxApi(token, "/files/copy_v2", {
    from_path: TEMPLATE_PATH,
    to_path: destPath,
  }, rootNamespaceId);

  if (!result.ok) {
    // Folder already exists — treat as success and link to it
    if (result.error?.includes("to/conflict/folder")) {
      return jsonResponse({ copied: false, already_exists: true, path: destPath }, 200);
    }
    return jsonResponse({ error: result.error ?? "Failed to copy template" }, 500);
  }

  return jsonResponse({ copied: true, path: destPath }, 200);
}

async function handleListFolder(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>
): Promise<Response> {
  const path = body.path as string;
  if (!path) {
    return jsonResponse({ error: "path required" }, 400);
  }

  const { token, rootNamespaceId, error: tokenErr } = await getValidToken(supabase, userId);
  if (tokenErr) return jsonResponse({ error: tokenErr }, 401);

  const result = await dropboxApi(token, "/files/list_folder", { path }, rootNamespaceId);

  if (!result.ok) {
    return jsonResponse({ error: result.error ?? "Failed to list folder" }, 500);
  }

  const entries = (result.data?.entries as Array<Record<string, unknown>>) ?? [];
  return jsonResponse({
    entries: entries.map((e) => ({
      name: e.name,
      path: e.path_display ?? e.path_lower,
      tag: e[".tag"],
    })),
  }, 200);
}

async function handleSuggestProjectNumber(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>
): Promise<Response> {
  const clientName = body.client_name as string;
  if (!clientName) {
    return jsonResponse({ error: "client_name required" }, 400);
  }

  const { token, rootNamespaceId, error: tokenErr } = await getValidToken(supabase, userId);
  if (tokenErr) return jsonResponse({ error: tokenErr }, 401);

  const folderPath = `${JOBS_ROOT}/${clientName}`;

  // Check if client folder exists
  const metaResult = await dropboxApi(token, "/files/get_metadata", { path: folderPath }, rootNamespaceId);
  if (!metaResult.ok) {
    // Diagnostic: list JOBS_ROOT to see what folders the API can actually see
    const rootList = await dropboxApi(token, "/files/list_folder", { path: JOBS_ROOT }, rootNamespaceId);
    const rootFolders = rootList.ok
      ? ((rootList.data?.entries as Array<Record<string, unknown>>) ?? [])
          .filter((e) => e[".tag"] === "folder")
          .map((e) => e.name as string)
          .slice(0, 20)
      : [];
    return jsonResponse({
      suggested: null,
      clientExists: false,
      debug_path_checked: folderPath,
      debug_api_error: metaResult.error?.slice(0, 200),
      debug_root_accessible: rootList.ok,
      debug_root_error: rootList.ok ? undefined : rootList.error?.slice(0, 200),
      debug_root_folders: rootFolders,
    }, 200);
  }

  // List subfolders
  const listResult = await dropboxApi(token, "/files/list_folder", { path: folderPath }, rootNamespaceId);
  if (!listResult.ok) {
    return jsonResponse({ suggested: null, clientExists: true }, 200);
  }

  const entries = (listResult.data?.entries as Array<Record<string, unknown>>) ?? [];
  const folderNames = entries
    .filter((e) => e[".tag"] === "folder")
    .map((e) => e.name as string);

  // Parse pattern: PREFIX-YYNN (e.g. CVL-2601 = year 26, seq 01)
  const parsed: Array<{ prefix: string; year: number; seq: number; full: string }> = [];
  for (const name of folderNames) {
    const match = name.match(/^([A-Za-z]+)-(\d{2})(\d{2,})/);
    if (match) {
      parsed.push({
        prefix: match[1].toUpperCase(),
        year: parseInt(match[2], 10),
        seq: parseInt(match[3], 10),
        full: `${match[1].toUpperCase()}-${match[2]}${match[3]}`,
      });
    }
  }

  if (parsed.length === 0) {
    return jsonResponse({ suggested: null, clientExists: true }, 200);
  }

  // Find most common prefix
  const prefixCounts: Record<string, number> = {};
  for (const p of parsed) {
    prefixCounts[p.prefix] = (prefixCounts[p.prefix] ?? 0) + 1;
  }
  const topPrefix = Object.entries(prefixCounts).sort((a, b) => b[1] - a[1])[0][0];

  // Current 2-digit year
  const currentYear = new Date().getFullYear() % 100; // e.g. 26 for 2026

  // Filter to current year entries for this prefix
  const currentYearEntries = parsed.filter(
    (p) => p.prefix === topPrefix && p.year === currentYear
  );

  let suggested: string;
  if (currentYearEntries.length > 0) {
    // Next sequential for current year
    const maxSeq = Math.max(...currentYearEntries.map((p) => p.seq));
    const nextSeq = String(maxSeq + 1).padStart(2, "0");
    suggested = `${topPrefix}-${currentYear}${nextSeq}`;
  } else {
    // No projects this year yet — start at 01
    suggested = `${topPrefix}-${currentYear}01`;
  }

  return jsonResponse({
    prefix: topPrefix,
    lastNumber: currentYearEntries.length > 0
      ? Math.max(...currentYearEntries.map((p) => p.seq))
      : 0,
    suggested,
    clientExists: true,
  }, 200);
}

// ---------- Router ----------

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

  // Create supabase client with user's auth context for RLS
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Use service role for DB operations (we verify auth separately)
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Verify user from JWT
  const supabaseAuth = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
  if (authError || !user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    const body = await req.json();
    const action = body.action as string;

    switch (action) {
      case "exchange-code":
        return await handleExchangeCode(supabase, user.id, user.email ?? "", body);
      case "check-connection":
        return await handleCheckConnection(supabase, user.id);
      case "disconnect":
        return await handleDisconnect(supabase, user.id);
      case "check-client-folder":
        return await handleCheckClientFolder(supabase, user.id, body);
      case "create-client-folder":
        return await handleCreateClientFolder(supabase, user.id, body);
      case "copy-template":
        return await handleCopyTemplate(supabase, user.id, body);
      case "list-folder":
        return await handleListFolder(supabase, user.id, body);
      case "suggest-project-number":
        return await handleSuggestProjectNumber(supabase, user.id, body);
      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500
    );
  }
});
