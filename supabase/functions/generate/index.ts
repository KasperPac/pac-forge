// Supabase Edge Function: Claude API proxy for PLC code generation
// Deployed with --no-verify-jwt; auth verified internally.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const PROMPTLAYER_LOG_URL = "https://api.promptlayer.com/log-request";
const PROMPTLAYER_METADATA_URL = "https://api.promptlayer.com/rest/track-metadata";
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

interface PromptLayerMetadata {
  agent_role?: string;
  pipeline_step?: string;
  session_id?: string;
  project_id?: string;
  design_profile_id?: string;
  design_profile_name?: string;
  generation_mode?: string;
  plc_language?: string;
  artifact_type?: string;
  reference_lookup_used?: boolean;
  reference_section_count?: number;
  knowledge_doc_count?: number;
  prompt_section_keys?: string[];
  call_role?: "primary" | "supporting";
  function_name?: string;
  round_index?: number;
  round?: number;
}

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
  promptlayer_metadata?: PromptLayerMetadata;
}

interface PromptLayerLogParams {
  systemPrompt: string;
  messages: Array<{ role: string; content: unknown }>;
  responseText: string;
  model: string;
  usage: Record<string, number>;
  requestStartTime: number;
  requestEndTime: number;
  metadata?: PromptLayerMetadata;
  isStream: boolean;
  projectContext?: GenerateRequest["project_context"];
}

interface NormalizedPromptLayerContext {
  functionName: string;
  tags: string[];
  metadata: Record<string, string>;
  sessionId?: string;
  artifactType?: string;
  pipelineStep?: string;
  roundIndex: number;
  callRole: "primary" | "supporting";
}

function inferFunctionName(
  pipelineStep?: string,
  generationMode?: string,
): string {
  if (!pipelineStep) {
    return generationMode === "PROCESS_CODE"
      ? "forge.process.generate"
      : "forge.device_fb.generate";
  }

  if (pipelineStep === "reference_lookup") return "reference.lookup";
  if (pipelineStep === "chat" || pipelineStep === "chat_generate") return "pacst.chat";
  if (pipelineStep === "review") return "forge.review.run";
  if (pipelineStep === "rewrite") return "forge.rewrite.run";
  if (pipelineStep === "compile_fix") return "forge.compile_fix.run";
  if (pipelineStep === "fb_selection") return "forge.fb_selection.run";
  if (pipelineStep === "patterns") return "forge.patterns.run";
  if (pipelineStep === "summary") return "forge.summary.run";
  if (pipelineStep === "plan") return "forge.plan.run";
  if (pipelineStep === "process_generate") return "forge.process.generate";
  if (pipelineStep === "matrix_generate") return "forge.matrix.generate";
  if (pipelineStep.startsWith("generate_fb_")) return "forge.device_fb.generate";
  if (pipelineStep.startsWith("generate_")) return "forge.process.generate";
  if (pipelineStep === "generate") {
    return generationMode === "PROCESS_CODE"
      ? "forge.process.generate"
      : "forge.device_fb.generate";
  }

  return `forge.${pipelineStep}.run`;
}

function inferArtifactType(
  pipelineStep?: string,
  functionName?: string,
  generationMode?: string,
): string | undefined {
  if (pipelineStep === "reference_lookup" || functionName === "reference.lookup") {
    return "reference_lookup";
  }
  if (pipelineStep === "chat" || pipelineStep === "chat_generate" || functionName === "pacst.chat") {
    return "chat";
  }
  if (pipelineStep === "review" || pipelineStep === "rewrite") {
    return "device_code";
  }
  if (pipelineStep === "compile_fix") return "compile_fix";
  if (pipelineStep === "matrix_generate" || functionName === "forge.matrix.generate") {
    return "matrix";
  }
  if (pipelineStep === "fb_selection" || functionName === "forge.fb_selection.run") {
    return "fb_selection";
  }
  if (functionName === "forge.process.generate" || generationMode === "PROCESS_CODE") {
    return "process_code";
  }
  if (functionName === "forge.device_call_fc.generate") return "call_fc";
  if (functionName === "forge.device_fb.generate") return "device_fb";
  if (functionName === "forge.plan.run") return "plan";
  if (functionName === "forge.summary.run") return "summary";
  if (functionName === "forge.patterns.run") return "patterns";
  return undefined;
}

function inferCallRole(
  functionName: string,
  pipelineStep?: string,
): "primary" | "supporting" {
  if (
    functionName === "reference.lookup" ||
    functionName === "forge.fb_selection.run" ||
    pipelineStep === "reference_lookup" ||
    pipelineStep === "fb_selection"
  ) {
    return "supporting";
  }
  return "primary";
}

function normalizePromptLayerContext(
  metadata: PromptLayerMetadata | undefined,
  projectContext: GenerateRequest["project_context"] | undefined,
  isStream: boolean,
): NormalizedPromptLayerContext {
  const pipelineStep = metadata?.pipeline_step;
  const sessionId = metadata?.session_id ?? projectContext?.session_id;
  const projectId = metadata?.project_id ?? projectContext?.project_id;
  const roundIndex = metadata?.round_index ?? metadata?.round ?? 0;
  const functionName = metadata?.function_name ?? inferFunctionName(pipelineStep, metadata?.generation_mode);
  const artifactType = metadata?.artifact_type ?? inferArtifactType(pipelineStep, functionName, metadata?.generation_mode);
  const callRole = metadata?.call_role ?? inferCallRole(functionName, pipelineStep);
  const plcLanguage = metadata?.plc_language?.toLowerCase();
  const tags = new Set<string>();

  if (functionName.startsWith("forge.")) tags.add("forge");
  if (functionName === "pacst.chat") tags.add("pacst");
  if (functionName === "reference.lookup") tags.add("reference");
  tags.add(isStream ? "streaming" : "non_streaming");
  if (plcLanguage === "scl" || plcLanguage === "lad") tags.add(plcLanguage);

  const normalized: Record<string, string> = {
    function_name: functionName,
    pipeline_step: pipelineStep ?? functionName,
    call_role: callRole,
    round_index: String(roundIndex),
  };

  if (metadata?.agent_role) normalized.agent_role = metadata.agent_role;
  if (sessionId) normalized.session_id = sessionId;
  if (projectId) normalized.project_id = projectId;
  if (metadata?.design_profile_id) normalized.design_profile_id = metadata.design_profile_id;
  if (metadata?.design_profile_name) normalized.design_profile_name = metadata.design_profile_name;
  if (metadata?.generation_mode) normalized.generation_mode = metadata.generation_mode;
  if (metadata?.plc_language) normalized.plc_language = metadata.plc_language;
  if (artifactType) normalized.artifact_type = artifactType;
  if (typeof metadata?.reference_lookup_used === "boolean") {
    normalized.reference_lookup_used = String(metadata.reference_lookup_used);
  }
  if (typeof metadata?.reference_section_count === "number") {
    normalized.reference_section_count = String(metadata.reference_section_count);
  }
  if (typeof metadata?.knowledge_doc_count === "number") {
    normalized.knowledge_doc_count = String(metadata.knowledge_doc_count);
  }
  if (metadata?.prompt_section_keys?.length) {
    normalized.prompt_section_keys = metadata.prompt_section_keys.join(",");
  }

  return {
    functionName,
    tags: [...tags],
    metadata: normalized,
    sessionId,
    artifactType,
    pipelineStep: pipelineStep ?? functionName,
    roundIndex,
    callRole,
  };
}

/** Convert message content to PromptLayer content block array format */
function toPromptLayerContent(
  content: unknown,
): Array<{ type: string; text: string }> {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  if (!Array.isArray(content)) {
    return [{ type: "text", text: String(content ?? "") }];
  }

  return content.map((block) => {
    if (typeof block === "object" && block) {
      const typedBlock = block as { type?: string; text?: string; source?: { media_type?: string } };
      if (typedBlock.type === "text" && typedBlock.text) {
        return { type: "text", text: typedBlock.text };
      }
      if (typedBlock.type === "image") {
        return { type: "text", text: `[image:${typedBlock.source?.media_type ?? "unknown"}]` };
      }
    }
    return { type: "text", text: String(block) };
  });
}

function persistPromptLayerRequest(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  requestId: number,
  ctx: NormalizedPromptLayerContext,
) {
  if (!ctx.sessionId || !ctx.artifactType || !ctx.pipelineStep) return;

  supabase.from("forge_pl_requests").upsert({
    user_id: userId,
    session_id: ctx.sessionId,
    artifact_type: ctx.artifactType,
    pipeline_step: ctx.pipelineStep,
    round_index: ctx.roundIndex,
    function_name: ctx.functionName,
    call_role: ctx.callRole,
    pl_request_id: requestId,
  }, {
    onConflict: "session_id,artifact_type,pipeline_step,round_index",
  }).then(({ error }) => {
    if (error) {
      console.warn("[PromptLayer] Request persistence failed:", error.message);
    }
  });
}

// Fire-and-forget PromptLayer logging — never blocks the response
function logToPromptLayer(
  params: PromptLayerLogParams,
  supabase: ReturnType<typeof createClient>,
  userId: string,
) {
  const plKey = Deno.env.get("PROMPTLAYER_API_KEY");
  if (!plKey) {
    console.warn("[PromptLayer] PROMPTLAYER_API_KEY not set — skipping log");
    return;
  }

  const ctx = normalizePromptLayerContext(
    params.metadata,
    params.projectContext,
    params.isStream,
  );

  // /log-request format: provider + model + input/output ChatPrompt + ISO timestamps
  // All message content MUST be arrays of content blocks: [{ type: "text", text: "..." }]
  const inputMessages: Array<{ role: string; content: Array<{ type: string; text: string }> }> = [
    {
      role: "system",
      content: [{ type: "text", text: params.systemPrompt }],
    },
    ...params.messages.map((message) => ({
      role: message.role,
      content: typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : Array.isArray(message.content)
          ? (message.content as Array<{ type: string; text?: string }>)
              .filter((b) => b.type === "text" && b.text)
              .map((b) => ({ type: "text", text: b.text! }))
          : [{ type: "text", text: String(message.content) }],
    })),
  ];

  const requestBody = {
    provider: "anthropic",
    model: params.model,
    function_name: ctx.functionName,
    input: {
      type: "chat",
      messages: inputMessages,
    },
    output: {
      type: "chat",
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: params.responseText }],
        },
      ],
    },
    request_start_time: new Date(params.requestStartTime).toISOString(),
    request_end_time: new Date(params.requestEndTime).toISOString(),
    parameters: {
      max_tokens: params.usage.output_tokens ?? DEFAULT_MAX_TOKENS,
    },
    tags: ctx.tags,
    metadata: ctx.metadata,
    input_tokens: params.usage.input_tokens ?? 0,
    output_tokens: params.usage.output_tokens ?? 0,
    status: "SUCCESS",
  };

  const outputLen = requestBody.output?.messages?.[0]?.content?.[0]?.text?.length ?? 0;
  console.log(`[PromptLayer] Sending /log-request: fn=${requestBody.function_name}, input_msgs=${inputMessages.length}, output_len=${outputLen}, tags=${requestBody.tags?.join(",")}`);

  fetch(PROMPTLAYER_LOG_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": plKey,
    },
    body: JSON.stringify(requestBody),
  }).then(async (response) => {
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`HTTP ${response.status}: ${detail}`);
    }

    const payload = await response.json();
    const requestId = Number(payload?.request_id);
    console.log(`[PromptLayer] Logged request ${requestId} (${ctx.functionName})`);
    if (!Number.isFinite(requestId)) {
      return;
    }

    fetch(PROMPTLAYER_METADATA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": plKey,
      },
      body: JSON.stringify({
        request_id: requestId,
        metadata: ctx.metadata,
      }),
    }).then(async (metadataResponse) => {
      if (!metadataResponse.ok) {
        const detail = await metadataResponse.text();
        throw new Error(`HTTP ${metadataResponse.status}: ${detail}`);
      }
    }).catch((err) => {
      console.warn("[PromptLayer] Metadata tracking failed:", err.message);
    });

    persistPromptLayerRequest(supabase, userId, requestId, ctx);
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

    const requestStartTime = Date.now();
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

    // Streaming response — forward SSE chunks and log to PromptLayer after completion
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

            // Extract response text and usage from buffered SSE events
            let responseText = "";
            let streamUsage: Record<string, number> = {};
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

            logToPromptLayer({
              systemPrompt: body.system_prompt,
              messages: body.messages,
              responseText,
              model: CLAUDE_MODEL,
              usage: streamUsage,
              requestStartTime,
              requestEndTime: Date.now(),
              metadata: body.promptlayer_metadata,
              isStream: true,
              projectContext: body.project_context,
            }, supabase, user.id);
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

    logToPromptLayer({
      systemPrompt: body.system_prompt,
      messages: body.messages,
      responseText: content,
      model: result.model ?? CLAUDE_MODEL,
      usage,
      requestStartTime,
      requestEndTime: Date.now(),
      metadata: body.promptlayer_metadata,
      isStream: false,
      projectContext: body.project_context,
    }, supabase, user.id);

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
