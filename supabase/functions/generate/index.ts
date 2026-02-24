// Supabase Edge Function: Claude API proxy for PLC code generation
// Deployed with --no-verify-jwt; auth verified internally.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 8192;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(
  body: Record<string, unknown>,
  status: number
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

interface GenerateRequest {
  system_prompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  project_context: {
    project_id: string;
    session_id: string;
  };
  generation_mode: "FB_PER_DEVICE" | "PROJECT_LEVEL" | "PROCESS_CODE";
  stream?: boolean;
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Verify user is authenticated
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing Authorization header" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return jsonResponse(
      { error: "Unauthorized", details: authError?.message ?? "Invalid token" },
      401
    );
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return jsonResponse({ error: "ANTHROPIC_API_KEY not configured" }, 500);
  }

  try {
    const body: GenerateRequest = await req.json();
    const { system_prompt, messages, stream } = body;

    if (!system_prompt || !messages || messages.length === 0) {
      return jsonResponse(
        { error: "system_prompt and messages are required" },
        400
      );
    }

    const claudeBody = {
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: system_prompt,
      messages,
      stream: stream ?? false,
    };

    const claudeResponse = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(claudeBody),
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      return jsonResponse(
        {
          error: `Claude API error: ${claudeResponse.status}`,
          details: errorText,
        },
        502
      );
    }

    // Streaming response — forward SSE chunks
    if (stream && claudeResponse.body) {
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          const reader = claudeResponse.body!.getReader();
          const decoder = new TextDecoder();

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = decoder.decode(value, { stream: true });
              controller.enqueue(encoder.encode(chunk));
            }
          } catch (err) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "error", error: String(err) })}\n\n`
              )
            );
          } finally {
            controller.close();
          }
        },
      });

      return new Response(readable, {
        status: 200,
        headers: {
          ...CORS,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // Non-streaming response
    const result = await claudeResponse.json();
    const content = result.content?.[0]?.text ?? "";

    return jsonResponse(
      { content, model: result.model, usage: result.usage },
      200
    );
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500
    );
  }
});
