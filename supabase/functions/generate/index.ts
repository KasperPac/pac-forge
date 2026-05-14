// Supabase Edge Function: Multi-provider AI proxy for PLC code generation
// Supports Anthropic (Claude), OpenAI (o3/GPT-4o), and Google (Gemini).
// Deployed with --no-verify-jwt; auth verified internally.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Provider API endpoints
// ---------------------------------------------------------------------------

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const PROMPTLAYER_LOG_URL = "https://api.promptlayer.com/log-request";
const PROMPTLAYER_TRACK_PROMPT_URL = "https://api.promptlayer.com/rest/track-prompt";
const PROMPTLAYER_TRACK_METADATA_URL = "https://api.promptlayer.com/rest/track-metadata";

// ---------------------------------------------------------------------------
// Model defaults & caps
// ---------------------------------------------------------------------------

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
const DEFAULT_OPENAI_MODEL = "o3";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-pro";
const DEFAULT_MAX_TOKENS = 8192;
const MAX_TOKENS_CAP = 65536;

type Provider = "anthropic" | "openai" | "google";

/** Map model ID → provider for auto-detection. */
function detectProvider(model: string): Provider {
  if (model.startsWith("claude-") || model.startsWith("anthropic/")) return "anthropic";
  if (model.startsWith("gemini-") || model.startsWith("google/")) return "google";
  if (model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4") ||
      model.startsWith("gpt-") || model.startsWith("openai/")) return "openai";
  return "anthropic"; // fallback
}

// ---------------------------------------------------------------------------
// CORS & helpers
// ---------------------------------------------------------------------------

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
  /** Override model — e.g. "o3", "gemini-2.5-pro", "claude-sonnet-4-6" */
  model?: string;
  /** Override provider — "anthropic" | "openai" | "google". Auto-detected from model if omitted. */
  provider?: Provider;
  // deno-lint-ignore no-explicit-any
  promptlayer_metadata?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// PromptLayer logging (fire-and-forget)
// ---------------------------------------------------------------------------

function logToPromptLayer(
  systemPrompt: string,
  // deno-lint-ignore no-explicit-any
  messages: any[],
  responseText: string,
  model: string,
  provider: string,
  // deno-lint-ignore no-explicit-any
  usage: Record<string, any>,
  startTime: number,
  // deno-lint-ignore no-explicit-any
  metadata?: Record<string, any>,
) {
  const plKey = Deno.env.get("PROMPTLAYER_API_KEY");
  if (!plKey) return;

  const functionName = metadata?.pipeline_step ?? metadata?.function_name ?? "forge.generate";
  const promptName = metadata?.prompt_name ?? functionName;
  const metadataEntries: Record<string, string> = {};
  if (metadata) {
    for (const [k, v] of Object.entries(metadata)) {
      if (v !== undefined && v !== null) metadataEntries[k] = String(v);
    }
  }
  metadataEntries.provider = provider;

  const requestBody = {
    provider,
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
    input_tokens: usage.input_tokens ?? usage.prompt_tokens ?? 0,
    output_tokens: usage.output_tokens ?? usage.completion_tokens ?? 0,
    status: "SUCCESS",
    metadata: metadataEntries,
    tags: [promptName],
  };

  console.log(`[PromptLayer] Logging: fn=${functionName}, prompt=${promptName}, provider=${provider}, model=${model}, output_len=${responseText.length}`);

  const headers = { "Content-Type": "application/json", "X-API-KEY": plKey };

  fetch(PROMPTLAYER_LOG_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  })
    .then((res) => res.json())
    .then((data) => {
      const requestId = data?.id;
      if (!requestId) return;

      fetch(PROMPTLAYER_TRACK_PROMPT_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          request_id: requestId,
          prompt_name: promptName,
          prompt_input_variables: {},
        }),
      }).catch(() => { /* swallow */ });

      if (Object.keys(metadataEntries).length > 0) {
        fetch(PROMPTLAYER_TRACK_METADATA_URL, {
          method: "POST",
          headers,
          body: JSON.stringify({
            request_id: requestId,
            metadata: metadataEntries,
          }),
        }).catch(() => { /* swallow */ });
      }
    })
    .catch((err) => {
      console.warn("[PromptLayer] Log failed:", err.message);
    });
}

// ---------------------------------------------------------------------------
// Provider-specific call functions
// ---------------------------------------------------------------------------

interface ProviderResult {
  content: string;
  model: string;
  // deno-lint-ignore no-explicit-any
  usage: Record<string, any>;
}

/**
 * Call Anthropic Claude API (streaming or non-streaming).
 * Returns either a ProviderResult or a ReadableStream for SSE forwarding.
 */
async function callAnthropic(
  systemPrompt: string,
  // deno-lint-ignore no-explicit-any
  messages: any[],
  model: string,
  maxTokens: number,
  stream: boolean,
  requestStartTime: number,
  // deno-lint-ignore no-explicit-any
  plMeta?: Record<string, any>,
): Promise<ProviderResult | ReadableStream> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const systemBlocks = [
    {
      type: "text",
      text: systemPrompt,
      cache_control: { type: "ephemeral" },
    },
  ];

  // deno-lint-ignore no-explicit-any
  const cachedMessages = (messages as any[]).map(
    (msg: { role: string; content: string }, i: number) => {
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
    model,
    max_tokens: maxTokens,
    system: systemBlocks,
    messages: cachedMessages,
    stream,
  };

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
    },
    body: JSON.stringify(claudeBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
  }

  if (stream && response.body) {
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const reader = response.body!.getReader();
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

          logToPromptLayer(systemPrompt, messages, responseText, model, "anthropic", streamUsage, requestStartTime, plMeta);
        }
      },
    });
    return readable;
  }

  const result = await response.json();
  const content = result.content?.[0]?.text ?? "";
  const usage = result.usage ?? {};

  if (usage.cache_creation_input_tokens || usage.cache_read_input_tokens) {
    console.log(
      `[cache] write=${usage.cache_creation_input_tokens ?? 0} read=${usage.cache_read_input_tokens ?? 0} input=${usage.input_tokens ?? 0}`
    );
  }

  return { content, model: result.model ?? model, usage };
}

/**
 * Call OpenAI API (non-streaming only for now — o3 reasoning models don't support streaming).
 */
async function callOpenAI(
  systemPrompt: string,
  // deno-lint-ignore no-explicit-any
  messages: any[],
  model: string,
  maxTokens: number,
): Promise<ProviderResult> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const isReasoning = model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4");

  // Build OpenAI messages format
  // deno-lint-ignore no-explicit-any
  const openaiMessages: any[] = [];

  if (isReasoning) {
    // o-series models: system prompt goes as a "developer" message
    openaiMessages.push({ role: "developer", content: systemPrompt });
  } else {
    openaiMessages.push({ role: "system", content: systemPrompt });
  }

  for (const msg of messages) {
    openaiMessages.push({
      role: msg.role,
      content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
    });
  }

  // deno-lint-ignore no-explicit-any
  const requestBody: any = {
    model,
    messages: openaiMessages,
  };

  if (isReasoning) {
    // o-series uses max_completion_tokens, not max_tokens
    requestBody.max_completion_tokens = maxTokens;
  } else {
    requestBody.max_tokens = maxTokens;
  }

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content ?? "";
  const usage = result.usage ?? {};

  // Normalize usage keys to match our format
  return {
    content,
    model: result.model ?? model,
    usage: {
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
      reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
    },
  };
}

/**
 * Call Google Gemini API (non-streaming).
 */
async function callGemini(
  systemPrompt: string,
  // deno-lint-ignore no-explicit-any
  messages: any[],
  model: string,
  maxTokens: number,
): Promise<ProviderResult> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  // Build Gemini contents format
  // deno-lint-ignore no-explicit-any
  const contents: any[] = [];
  for (const msg of messages) {
    contents.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) }],
    });
  }

  const requestBody = {
    system_instruction: {
      parts: [{ text: systemPrompt }],
    },
    contents,
    generationConfig: {
      maxOutputTokens: maxTokens,
    },
  };

  const url = `${GEMINI_API_URL}/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  const content = result.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const usage = result.usageMetadata ?? {};

  return {
    content,
    model,
    usage: {
      input_tokens: usage.promptTokenCount ?? 0,
      output_tokens: usage.candidatesTokenCount ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

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

  try {
    const body: GenerateRequest = await req.json();
    const { system_prompt, messages, stream } = body;

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
      Math.max(body.max_tokens ?? DEFAULT_MAX_TOKENS, 1),
      MAX_TOKENS_CAP,
    );

    // Resolve provider and model
    const requestedModel = body.model;
    const provider: Provider = body.provider ?? (requestedModel ? detectProvider(requestedModel) : "anthropic");
    let model: string;
    switch (provider) {
      case "openai":
        model = requestedModel ?? DEFAULT_OPENAI_MODEL;
        break;
      case "google":
        model = requestedModel ?? DEFAULT_GEMINI_MODEL;
        break;
      default:
        model = requestedModel ?? DEFAULT_ANTHROPIC_MODEL;
    }

    console.log(`[generate] provider=${provider}, model=${model}, stream=${!!stream}, max_tokens=${maxTokens}`);

    const requestStartTime = Date.now();

    // ---------------------------------------------------------------------------
    // Route to provider
    // ---------------------------------------------------------------------------

    if (provider === "anthropic") {
      const result = await callAnthropic(
        system_prompt, messages, model, maxTokens, !!stream, requestStartTime, body.promptlayer_metadata,
      );

      // Streaming — return the ReadableStream directly
      if (result instanceof ReadableStream) {
        return new Response(result, {
          status: 200,
          headers: {
            ...CORS,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      // Non-streaming
      logToPromptLayer(system_prompt, messages, result.content, result.model, "anthropic", result.usage, requestStartTime, body.promptlayer_metadata);
      return jsonResponse({ content: result.content, model: result.model, usage: result.usage }, 200);
    }

    if (provider === "openai") {
      if (stream) {
        // OpenAI o-series reasoning models don't support streaming well.
        // Fall through to non-streaming and return the full response.
        console.log(`[generate] OpenAI stream requested but using non-streaming for ${model}`);
      }

      const result = await callOpenAI(system_prompt, messages, model, maxTokens);
      logToPromptLayer(system_prompt, messages, result.content, result.model, "openai", result.usage, requestStartTime, body.promptlayer_metadata);

      // If client expected SSE stream, wrap the result as a single SSE event for compatibility
      if (stream) {
        const encoder = new TextEncoder();
        const ssePayload = [
          `data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
          `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: result.content } })}\n\n`,
          `data: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
          `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: result.usage.output_tokens } })}\n\n`,
          `data: ${JSON.stringify({ type: "message_stop" })}\n\n`,
        ].join("");

        return new Response(encoder.encode(ssePayload), {
          status: 200,
          headers: {
            ...CORS,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      return jsonResponse({ content: result.content, model: result.model, usage: result.usage }, 200);
    }

    if (provider === "google") {
      if (stream) {
        console.log(`[generate] Gemini stream requested but using non-streaming for ${model}`);
      }

      const result = await callGemini(system_prompt, messages, model, maxTokens);
      logToPromptLayer(system_prompt, messages, result.content, result.model, "google", result.usage, requestStartTime, body.promptlayer_metadata);

      if (stream) {
        const encoder = new TextEncoder();
        const ssePayload = [
          `data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
          `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: result.content } })}\n\n`,
          `data: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
          `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: result.usage.output_tokens } })}\n\n`,
          `data: ${JSON.stringify({ type: "message_stop" })}\n\n`,
        ].join("");

        return new Response(encoder.encode(ssePayload), {
          status: 200,
          headers: {
            ...CORS,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      return jsonResponse({ content: result.content, model: result.model, usage: result.usage }, 200);
    }

    return jsonResponse({ error: `Unknown provider: ${provider}` }, 400);
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500
    );
  }
});
