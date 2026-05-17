// Supabase Edge Function: quote-render-pdf
//
// Proxies the external Node + Puppeteer service (services/pdf-renderer) and
// optionally persists the result to Supabase Storage.
//
// Request body:
//   {
//     snapshot:  QuoteSnapshotV1,        // required — built client-side
//     dry_run?:  boolean,                // default false
//     rev_id?:   string,                 // required when dry_run = false
//     filename?: string                  // required when dry_run = false; must end with .pdf
//   }
//
// Auth: every caller must present a valid Supabase user JWT in the
// Authorization header. The function rejects anon callers with 401.
//
// Secrets (set via `npx supabase secrets set ...`):
//   PDF_RENDER_URL      — base URL of the Puppeteer service, e.g. https://pac-quote-pdf.fly.dev
//   PDF_RENDER_SECRET   — bearer token shared with the Puppeteer service
//
// On dry_run: returns the raw PDF bytes (application/pdf) for the preview iframe.
// On non-dry_run: uploads to bucket "quote-pdfs" at quote-revisions/{rev_id}/{filename}
//   and returns { storage_key }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const JSON_HEADERS: Record<string, string> = {
  ...CORS_HEADERS,
  "content-type": "application/json",
};

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: JSON_HEADERS,
  });
}

interface RenderRequestBody {
  snapshot?: unknown;
  dry_run?: boolean;
  rev_id?: string;
  filename?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonError(405, "method not allowed");
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const PDF_RENDER_URL = Deno.env.get("PDF_RENDER_URL");
  const PDF_RENDER_SECRET = Deno.env.get("PDF_RENDER_SECRET");

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) {
    return jsonError(500, "supabase env not configured");
  }
  if (!PDF_RENDER_URL || !PDF_RENDER_SECRET) {
    return jsonError(500, "PDF render service not configured");
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return jsonError(401, "unauthorized");
  }

  // Authenticate the caller. Use the anon-key client with the user JWT so
  // RLS-aware checks remain consistent with the rest of the app.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) {
    return jsonError(401, "unauthorized");
  }

  let body: RenderRequestBody;
  try {
    body = (await req.json()) as RenderRequestBody;
  } catch {
    return jsonError(400, "invalid JSON body");
  }

  const { snapshot, dry_run, rev_id, filename } = body;
  if (!snapshot || typeof snapshot !== "object") {
    return jsonError(400, "snapshot required");
  }

  // Call the Puppeteer service.
  let renderRes: Response;
  try {
    renderRes = await fetch(`${PDF_RENDER_URL}/render`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${PDF_RENDER_SECRET}`,
      },
      body: JSON.stringify({ snapshot }),
    });
  } catch (e) {
    return jsonError(
      502,
      `render service unreachable: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!renderRes.ok) {
    const detail = await renderRes.text().catch(() => "");
    return jsonError(502, `render service error (${renderRes.status}): ${detail}`);
  }

  const pdfBytes = new Uint8Array(await renderRes.arrayBuffer());
  if (pdfBytes.byteLength < 4 || String.fromCharCode(...pdfBytes.slice(0, 4)) !== "%PDF") {
    return jsonError(502, "render service returned non-PDF payload");
  }

  if (dry_run) {
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "content-type": "application/pdf",
        "cache-control": "no-store",
      },
    });
  }

  // Persisted upload requires rev_id + filename.
  if (typeof rev_id !== "string" || !rev_id) {
    return jsonError(400, "rev_id required when not dry_run");
  }
  if (typeof filename !== "string" || !filename || !filename.endsWith(".pdf")) {
    return jsonError(400, "filename ending in .pdf required when not dry_run");
  }
  // Reject path traversal — keys must be flat filenames.
  if (filename.includes("/") || filename.includes("..") || filename.includes("\\")) {
    return jsonError(400, "filename must not contain path separators");
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const storageKey = `quote-revisions/${rev_id}/${filename}`;

  const { error: upErr } = await adminClient.storage
    .from("quote-pdfs")
    .upload(storageKey, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (upErr) {
    return jsonError(500, `storage upload failed: ${upErr.message}`);
  }

  return new Response(JSON.stringify({ storage_key: storageKey }), {
    status: 200,
    headers: JSON_HEADERS,
  });
});
