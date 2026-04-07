// Supabase Edge Function: Claude API proxy for PLC code generation
// Deployed with --no-verify-jwt; auth verified internally.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const PROMPTLAYER_LOG_URL = "https://api.promptlayer.com/log-request";
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
  // deno-lint-ignore no-explicit-any
  promptlayer_metadata?: Record<string, any>;
}

/** Fire-and-forget log to PromptLayer. Errors are swallowed. */
function logToPromptLayer(
  systemPrompt: string,
  // deno-lint-ignore no-explicit-any
  messages: any[],
  responseText: string,
  model: string,
  // deno-lint-ignore no-explicit-any
  usage: Record<string, any>,
  startTime: number,
  // deno-lint-ignore no-explicit-any
  metadata?: Record<string, any>,
) {
  const plKey = Deno.env.get("PROMPTLAYER_API_KEY");
  if (!plKey) return;

  const functionName = metadata?.pipeline_step ?? metadata?.function_name ?? "forge.generate";
  const metadataEntries: Record<string, string> = {};
  if (metadata) {
    for (const [k, v] of Object.entries(metadata)) {
      if (v !== undefined && v !== null) metadataEntries[k] = String(v);
    }
  }

  const requestBody = {
    provider: "anthropic",
    model,
    function_name: functionName,
    input: {
      type: "chat",
      messages: [
        { role: "system", content: [{ type: "text", text: systemPrompt }] },
        ...messages.map((m: { role: string; content: string }) => ({
          role: m.role,
          content: [{ type: "text", text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
        })),
      ],
    },
    output: {
      type: "chat",
      messages: [{ role: "assistant", content: [{ type: "text", text: responseText }] }],
    },
    request_start_time: new Date(startTime).toISOString(),
    request_end_time: new Date().toISOString(),
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    status: "SUCCESS",
    metadata: metadataEntries,
    tags: [functionName],
  };

  console.log(`[PromptLayer] Logging: fn=${functionName}, output_len=${responseText.length}`);

  fetch(PROMPTLAYER_LOG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": plKey },
    body: JSON.stringify(requestBody),
  }).catch((err) => {
    console.warn("[PromptLayer] Log failed:", err.message);
  });
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
    // deno-lint-ignore no-explicit-any
    const cachedMessages = (messages as any[]).map(
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

    const requestStartTime = Date.now();

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
          let fullBuffer = "";

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = decoder.decode(value, { stream: true });
              fullBuffer += chunk;
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

            // Extract response text and usage from buffered SSE events for PromptLayer
            let responseText = "";
            // deno-lint-ignore no-explicit-any
            let streamUsage: Record<string, any> = {};
            for (const line of fullBuffer.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              try {
                const evt = JSON.parse(line.slice(6));
                if (evt.type === "content_block_delta" && evt.delta?.text) {
                  responseText += evt.delta.text;
                }
                if (evt.type === "message_delta" && evt.usage) {
                  streamUsage = { ...streamUsage, ...evt.usage };
                }
                if (evt.type === "message_start" && evt.message?.usage) {
                  streamUsage = { ...streamUsage, ...evt.message.usage };
                }
              } catch { /* skip non-JSON lines */ }
            }

            logToPromptLayer(system_prompt, messages, responseText, CLAUDE_MODEL, streamUsage, requestStartTime, body.promptlayer_metadata);
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

    logToPromptLayer(system_prompt, messages, content, result.model ?? CLAUDE_MODEL, usage, requestStartTime, body.promptlayer_metadata);

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
