// Supabase Edge Function: Claude API proxy for PLC code generation
// Deployed with --no-verify-jwt; auth verified internally.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 8192;
const MAX_TOKENS_CAP = 32768;

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

// Content can be a plain string or multimodal array (for vision)
type MessageContent = string | Array<{
  type: "text" | "image";
  text?: string;
  source?: { type: "base64"; media_type: string; data: string };
}>;

interface GenerateRequest {
  system_prompt: string;
  messages: Array<{ role: "user" | "assistant"; content: MessageContent }>;
  project_context?: {
    project_id: string;
    session_id: string;
  };
  generation_mode?: "FB_PER_DEVICE" | "PROJECT_LEVEL" | "PROCESS_CODE" | "FB_BUILDER" | "MIGRATION";
  stream?: boolean;
  max_tokens?: number;
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
    const { system_prompt, messages, stream, max_tokens: requestedMaxTokens } = body;

    if (!system_prompt || typeof system_prompt !== "string") {
      return jsonResponse({ error: "system_prompt is required and must be a string" }, 400);
    }
    if (system_prompt.length > 100_000) {
      return jsonResponse({ error: "system_prompt exceeds 100,000 character limit" }, 400);
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return jsonResponse({ error: "messages must be a non-empty array" }, 400);
    }
    if (messages.length > 50) {
      return jsonResponse({ error: "messages exceeds 50 entry limit" }, 400);
    }
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      // Accept string content or multimodal array content (for vision)
      const validContent =
        (typeof msg?.content === "string" && msg.content.trim()) ||
        (Array.isArray(msg?.content) && msg.content.length > 0);
      if (!validContent) {
        return jsonResponse({ error: `messages[${i}].content must be a non-empty string or content array` }, 400);
      }
      if (msg.role !== "user" && msg.role !== "assistant") {
        return jsonResponse({ error: `messages[${i}].role must be "user" or "assistant"` }, 400);
      }
    }

    const maxTokens = Math.min(
      Math.max(requestedMaxTokens ?? DEFAULT_MAX_TOKENS, 1),
      MAX_TOKENS_CAP,
    );

    // Build system prompt as cacheable content block.
    // Claude caches the system prompt server-side for 5 minutes,
    // so repeated calls (pipeline steps, chat turns, review rounds)
    // pay only 10% of input cost for the cached portion.
    const systemBlocks = [
      {
        type: "text",
        text: system_prompt,
        cache_control: { type: "ephemeral" },
      },
    ];

    // Also cache the last context message (reference sections + patterns)
    // if it exists, since these are identical across pipeline steps.
    const cachedMessages = messages.map(
      (msg: { role: string; content: string }, i: number) => {
        // Cache the assistant acknowledgment message (end of context block)
        // which is always at index 1 when context messages are present
        if (i === 1 && msg.role === "assistant" && messages.length > 2) {
          return {
            role: msg.role,
            content: [
              {
                type: "text",
                text: msg.content,
                cache_control: { type: "ephemeral" },
              },
            ],
          };
        }
        return msg;
      }
    );

    const claudeBody = {
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system: systemBlocks,
      messages: cachedMessages,
      stream: stream ?? false,
    };

    const claudeResponse = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
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

    // Include cache metrics in usage for observability
    const usage = result.usage ?? {};
    if (usage.cache_creation_input_tokens || usage.cache_read_input_tokens) {
      console.log(
        `[cache] write=${usage.cache_creation_input_tokens ?? 0} read=${usage.cache_read_input_tokens ?? 0} input=${usage.input_tokens ?? 0}`
      );
    }

    return jsonResponse(
      { content, model: result.model, usage },
      200
    );
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500
    );
  }
});
