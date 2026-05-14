import { useState, useCallback, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { buildPrompt } from "@/lib/prompt-builder";
import { parseArtifacts } from "@/lib/artifact-parser";
import type { ParsedArtifact } from "@/lib/artifact-parser";
import { buildManifest } from "@/lib/manifest-builder";
import { analyzeArtifacts } from "@/lib/safety-analyzer";
import { usePacStStore } from "@/stores/pac-st-store";
import { getRelevantReferenceSections } from "@/lib/reference-lookup";
import { CODE_GEN_MAX_TOKENS } from "@/lib/pipeline";
import type {
  Project,
  Agent,
  Artifact,
  GenerationMode,
  SafetyWarning,
  TiaManifest,
  PatternCandidate,
  FbTemplate,
  DesignProfile,
  AgentKnowledgeDoc,
  ReferenceLibrarySection,
} from "@/types";

const ARTIFACTS_KEY = ["artifacts"] as const;

export interface GenerateInput {
  project: Project;
  sessionId: string;
  agents: Agent[];
  generationMode: GenerationMode;
  userMessage: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  approvedPatterns?: PatternCandidate[];
  fbTemplates?: FbTemplate[];
  designProfile?: DesignProfile;
  agentKnowledgeDocs?: Record<string, AgentKnowledgeDoc[]>;
  promptSections?: Record<string, string>;
  referenceSections?: ReferenceLibrarySection[];
}

export interface GenerateResult {
  artifacts: Artifact[];
  manifest: TiaManifest;
  warnings: SafetyWarning[];
  summary: string;
  parseErrors: string[];
  manifestErrors: string[];
  rawResponse: string;
  dbWarnings: string[];
}

// --- Shared post-processing pipeline ---

/**
 * Saves pre-parsed artifacts to DB, runs safety analysis, builds manifest,
 * saves snapshots and conversation turns. Used by both processRawResponse()
 * and the pipeline hook.
 */
export async function saveArtifactsAndTurns(
  parsedArtifacts: ParsedArtifact[],
  summary: string,
  input: GenerateInput,
  rawResponse: string,
): Promise<GenerateResult> {
  const { project, sessionId, agents, userMessage } = input;

  // Run safety analyzer
  const warnings = analyzeArtifacts(parsedArtifacts);

  // Build full Artifact objects
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id ?? "";

  const artifacts: Artifact[] = parsedArtifacts.map((pa) => ({
    id: crypto.randomUUID(),
    project_id: project.id,
    session_id: sessionId,
    name: pa.name,
    type: pa.type,
    filename: pa.filename,
    content: pa.content,
    approved_content: null,
    destination_folder: pa.folder || "",
    dependencies: pa.dependencies,
    compile_after_import: true,
    overwrite_strategy: "CREATE_OR_UPDATE" as const,
    safety_warnings: warnings.filter((w) => w.artifact_name === pa.name),
    notes: "",
    created_at: new Date().toISOString(),
  }));

  // Build manifest
  const parseErrors: string[] = [];
  const dbWarnings: string[] = [];
  const { manifest, errors: manifestErrors } = buildManifest(artifacts, {
    projectId: project.id,
    tiaVersion: project.tia_version,
    cpuType: project.cpu_type,
    userId,
    sessionId,
  });

  // Save artifacts to DB
  if (artifacts.length > 0) {
    const { error: insertError } = await supabase
      .from("artifacts")
      .insert(
        artifacts.map((a) => ({
          id: a.id,
          project_id: a.project_id,
          session_id: a.session_id,
          name: a.name,
          type: a.type,
          filename: a.filename,
          content: a.content,
          approved_content: null,
          destination_folder: a.destination_folder,
          dependencies: a.dependencies,
          compile_after_import: a.compile_after_import,
          overwrite_strategy: a.overwrite_strategy,
          safety_warnings: a.safety_warnings,
          notes: a.notes,
        }))
      );
    if (insertError) {
      console.error("Failed to save artifacts:", insertError);
      dbWarnings.push(`Failed to save artifacts: ${insertError.message}`);
    }
  }

  // Save GENERATION snapshot for each artifact
  if (artifacts.length > 0) {
    const snapshots = artifacts.map((a) => ({
      project_id: project.id,
      artifact_id: a.id,
      content: a.content,
      trigger: "GENERATION" as const,
      version_number: 1,
      created_by: userId,
    }));

    const { error: snapError } = await supabase
      .from("snapshots")
      .insert(snapshots);
    if (snapError) {
      console.error("Failed to save snapshots:", snapError);
      dbWarnings.push(`Failed to save snapshots: ${snapError.message}`);
    }
  }

  // Save conversation turns (user + agent)
  await supabase.from("conversation_turns").insert({
    session_id: sessionId,
    role: "USER",
    agent_id: null,
    content: userMessage,
    artifacts_generated: [],
    safety_warnings: [],
  });

  await supabase.from("conversation_turns").insert({
    session_id: sessionId,
    role: "AGENT",
    agent_id: agents[0]?.id ?? null,
    content: summary || rawResponse.slice(0, 500),
    artifacts_generated: artifacts.map((a) => a.name),
    safety_warnings: warnings,
  });

  return {
    artifacts,
    manifest,
    warnings,
    summary,
    parseErrors,
    manifestErrors,
    rawResponse,
    dbWarnings,
  };
}

/**
 * Parses raw Claude response text into artifacts, then saves everything.
 * Convenience wrapper around parseArtifacts() + saveArtifactsAndTurns().
 */
export async function processRawResponse(
  rawResponse: string,
  input: GenerateInput,
): Promise<GenerateResult> {
  const { artifacts: parsedArtifacts, summary, errors: parseErrors } =
    parseArtifacts(rawResponse);

  const result = await saveArtifactsAndTurns(parsedArtifacts, summary, input, rawResponse);

  return {
    ...result,
    parseErrors: [...parseErrors, ...result.parseErrors],
  };
}

// --- Auth + streaming helpers (exported for reuse by other hooks) ---

// Cache the token briefly to avoid repeated lock acquisitions on the auth store.
// The Supabase auth lock (Navigator LockManager) can deadlock when many
// concurrent calls all try to getSession() at once (e.g. pipeline stages).
let _cachedToken: string | null = null;
let _cachedTokenExp = 0;

export async function getAuthToken(): Promise<string> {
  // Return cached token if it's still valid (with 60s buffer)
  if (_cachedToken && Date.now() < _cachedTokenExp - 60_000) {
    return _cachedToken;
  }
  // Try getSession first — Supabase auto-refreshes if needed
  let { data: { session: authSession } } = await supabase.auth.getSession();
  // If token is expired or missing, force a refresh
  if (!authSession?.access_token || (authSession.expires_at && authSession.expires_at * 1000 < Date.now())) {
    const { data: { session: refreshed } } = await supabase.auth.refreshSession();
    authSession = refreshed;
  }
  const token = authSession?.access_token;
  if (!token) throw new Error("Not authenticated");
  _cachedToken = token;
  _cachedTokenExp = (authSession!.expires_at ?? 0) * 1000;
  return token;
}

/** Clear cached auth token — call on 401 responses to force re-auth on next request */
export function invalidateAuthToken(): void {
  _cachedToken = null;
  _cachedTokenExp = 0;
}

/**
 * Streams SSE from the Edge Function and returns the full accumulated content.
 * Calls `onChunk` with each text delta as it arrives.
 */
export async function streamFromEdgeFunction(
  body: Record<string, unknown>,
  signal: AbortSignal,
  onChunk: (text: string) => void,
  maxTokens?: number,
  plMeta?: PromptLayerMeta,
): Promise<string> {
  if (maxTokens) body.max_tokens = maxTokens;
  if (plMeta) body.promptlayer_metadata = plMeta;
  const token = await getAuthToken();

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      },
      body: JSON.stringify(body),
      signal,
    }
  );

  if (!response.ok) {
    const text = await response.text();
    let detail: string;
    try {
      const parsed = JSON.parse(text);
      const parts = [parsed.error, parsed.details].filter(Boolean);
      detail = parts.join(" — ") || text;
    } catch {
      detail = text;
    }
    throw new Error(`Generation failed (${response.status}): ${detail}`);
  }

  if (!response.body) {
    throw new Error("No response body for streaming");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = "";
  let buffer = "";
  let streamedModel: string | undefined;
  let usage: { input: number; output: number } | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === "[DONE]") continue;

      try {
        const data = JSON.parse(jsonStr);
        if (data.type === "content_block_delta" && data.delta?.type === "text_delta") {
          const text = data.delta.text as string;
          fullContent += text;
          onChunk(text);
        } else if (data.type === "message_start") {
          if (typeof data.message?.model === "string") {
            streamedModel = data.message.model;
          }
          if (data.message?.usage) {
            usage = {
              input: data.message.usage.input_tokens ?? 0,
              output: data.message.usage.output_tokens ?? 0,
            };
          }
        } else if (data.type === "message_delta" && data.usage) {
          const prevInput: number = usage ? usage.input : 0;
          const prevOutput: number = usage ? usage.output : 0;
          usage = {
            input: data.usage.input_tokens ?? prevInput,
            output: data.usage.output_tokens ?? prevOutput,
          };
        }
      } catch {
        // Skip malformed JSON lines
      }
    }
  }

  const { provider, model } = resolveProviderAndModel(plMeta, body, streamedModel);
  if (provider === "anthropic" && !signal.aborted) {
    await logToPromptLayerFromClient(
      typeof body.system_prompt === "string" ? body.system_prompt : "",
      Array.isArray(body.messages)
        ? (body.messages as Array<{ role: string; content: MessageContent }>)
        : [],
      fullContent,
      usage,
      { provider, model, ...plMeta },
    );
  }

  return fullContent;
}

/** Content can be a plain string or multimodal array (for vision) */
export type MessageContent = string | Array<
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
>;

/** Metadata passed to PromptLayer for observability tagging */
export interface PromptLayerMeta {
  prompt_name?: string;
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
  /** Override AI model — e.g. "o3", "gemini-2.5-pro", "claude-sonnet-4-6" */
  model?: string;
  /** Override provider — auto-detected from model if omitted */
  provider?: "anthropic" | "openai" | "google";
}

function detectProviderFromModel(model?: string): "anthropic" | "openai" | "google" {
  if (!model) return "anthropic";
  if (model.startsWith("claude-") || model.startsWith("anthropic/")) return "anthropic";
  if (model.startsWith("gemini-") || model.startsWith("google/")) return "google";
  if (
    model.startsWith("o1") ||
    model.startsWith("o3") ||
    model.startsWith("o4") ||
    model.startsWith("gpt-") ||
    model.startsWith("openai/")
  ) {
    return "openai";
  }
  return "anthropic";
}

function resolveProviderAndModel(
  plMeta?: PromptLayerMeta,
  body?: Record<string, unknown>,
  streamedModel?: string,
): { provider: "anthropic" | "openai" | "google"; model: string } {
  const requestedModel =
    streamedModel ??
    (typeof plMeta?.model === "string" ? plMeta.model : undefined) ??
    (typeof body?.model === "string" ? body.model : undefined);
  const provider =
    plMeta?.provider ??
    (typeof body?.provider === "string" && ["anthropic", "openai", "google"].includes(body.provider)
      ? (body.provider as "anthropic" | "openai" | "google")
      : detectProviderFromModel(requestedModel));

  const model =
    requestedModel ??
    (provider === "openai"
      ? "o3"
      : provider === "google"
        ? "gemini-2.5-pro"
        : "claude-sonnet-4-6");

  return { provider, model };
}

/**
 * Makes a streaming call but collects the full response — avoids edge function
 * wall-clock timeout (60s) that kills long non-streaming calls.
 * Same return signature as callNonStreaming.
 */
export async function callStreamingCollect(
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: MessageContent }>,
  signal: AbortSignal,
  maxTokens?: number,
  plMeta?: PromptLayerMeta,
): Promise<{ content: string; usage: { input: number; output: number } | null }> {
  const token = await getAuthToken();

  const body: Record<string, unknown> = {
    system_prompt: systemPrompt,
    messages,
    stream: true,
  };
  if (maxTokens) body.max_tokens = maxTokens;
  if (plMeta) body.promptlayer_metadata = plMeta;
  if (plMeta?.model) body.model = plMeta.model;
  if (plMeta?.provider) body.provider = plMeta.provider;
  if (plMeta?.project_id && plMeta?.session_id) {
    body.project_context = {
      project_id: plMeta.project_id,
      session_id: plMeta.session_id,
    };
  }

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      },
      body: JSON.stringify(body),
      signal,
    },
  );

  if (response.status === 401) {
    // Token expired — refresh and retry once
    invalidateAuthToken();
    const freshToken = await getAuthToken();
    const retry = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${freshToken}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
        },
        body: JSON.stringify(body),
        signal,
      },
    );
    if (!retry.ok) {
      const text = await retry.text();
      throw new Error(`API call failed after token refresh (${retry.status}): ${text}`);
    }
    // Replace response with the retry — continue to streaming reader below
    return processStreamingResponse(retry, systemPrompt, messages, plMeta, body);
  }

  if (!response.ok) {
    const text = await response.text();
    let detail: string;
    try {
      const parsed = JSON.parse(text);
      const parts = [parsed.error, parsed.details].filter(Boolean);
      detail = parts.join(" — ") || text;
    } catch {
      detail = text;
    }
    throw new Error(`API call failed (${response.status}): ${detail}`);
  }

  return processStreamingResponse(response, systemPrompt, messages, plMeta, body);
}

/** Read SSE stream and collect full response content. */
async function processStreamingResponse(
  response: Response,
  systemPrompt: string,
  messages: Array<{ role: string; content: MessageContent }>,
  plMeta?: PromptLayerMeta,
  body?: Record<string, unknown>,
): Promise<{ content: string; usage: { input: number; output: number } | null }> {
  if (!response.body) {
    throw new Error("No response body for streaming");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = "";
  let buffer = "";
  let usage: { input: number; output: number } | null = null;
  let streamedModel: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === "[DONE]") continue;

      try {
        const data = JSON.parse(jsonStr);
        if (data.type === "content_block_delta" && data.delta?.type === "text_delta") {
          fullContent += data.delta.text as string;
        } else if (data.type === "message_start") {
          if (typeof data.message?.model === "string") {
            streamedModel = data.message.model;
          }
          if (data.message?.usage) {
            usage = {
              input: data.message.usage.input_tokens ?? 0,
              output: data.message.usage.output_tokens ?? 0,
            };
          }
        } else if (data.type === "message_delta" && data.usage) {
          const prevInput: number = usage ? usage.input : 0;
          const prevOutput: number = usage ? usage.output : 0;
          usage = {
            input: data.usage.input_tokens ?? prevInput,
            output: data.usage.output_tokens ?? prevOutput,
          };
        }
      } catch {
        // Skip malformed JSON lines
      }
    }
  }

  // Skip client-side PromptLayer logging — the edge function handles it for all providers.
  // Previously needed because Deno's streaming finally block was unreliable, but the
  // edge function now also wraps non-streaming providers as fake SSE, so it always logs.

  const { provider, model } = resolveProviderAndModel(plMeta, body, streamedModel);
  if (provider === "anthropic") {
    await logToPromptLayerFromClient(
      systemPrompt,
      messages,
      fullContent,
      usage,
      { provider, model, ...plMeta },
    );
  }

  return { content: fullContent, usage };
}

/**
 * Client-side PromptLayer logging for streaming calls.
 * The Edge Function's streaming finally block is unreliable (Deno kills the runtime),
 * so we log from the frontend after collecting the full response.
 */
async function logToPromptLayerFromClient(
  systemPrompt: string,
  messages: Array<{ role: string; content: MessageContent }>,
  responseText: string,
  usage: { input: number; output: number } | null,
  meta: PromptLayerMeta,
): Promise<void> {
  const plKey = import.meta.env.VITE_PROMPTLAYER_API_KEY as string;
  if (!plKey) return;

  const functionName = meta.pipeline_step ?? meta.agent_role ?? "forge.generate";
  const metadataEntries: Record<string, string> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v !== undefined && v !== null) metadataEntries[k] = String(v);
  }

  const body = {
    provider: meta.provider ?? detectProviderFromModel(meta.model),
    model:
      meta.model ??
      ((meta.provider ?? detectProviderFromModel(meta.model)) === "openai"
        ? "o3"
        : (meta.provider ?? detectProviderFromModel(meta.model)) === "google"
          ? "gemini-2.5-pro"
          : "claude-sonnet-4-6"),
    function_name: functionName,
    input: {
      type: "chat",
      messages: [
        { role: "system", content: [{ type: "text", text: systemPrompt }] },
        ...messages.map((m) => ({
          role: m.role,
          content: [{ type: "text", text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
        })),
      ],
    },
    output: {
      type: "chat",
      messages: [{ role: "assistant", content: [{ type: "text", text: responseText }] }],
    },
    request_start_time: new Date(Date.now() - (usage?.output ?? 0) * 50).toISOString(), // approximate
    request_end_time: new Date().toISOString(),
    input_tokens: usage?.input ?? 0,
    output_tokens: usage?.output ?? 0,
    status: "SUCCESS",
    metadata: metadataEntries,
    tags: [functionName],
  };

  try {
    await fetch("https://api.promptlayer.com/log-request", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": plKey },
      body: JSON.stringify(body),
    });
  } catch {
    // Best-effort logging
  }
}

/**
 * Makes a non-streaming call to the Edge Function and returns the content + token usage.
 * Used by pipeline steps (PM plan, reviews, pattern analysis, summary).
 */

export async function callNonStreaming(
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: MessageContent }>,
  signal: AbortSignal,
  maxTokens?: number,
  plMeta?: PromptLayerMeta,
): Promise<{ content: string; usage: { input: number; output: number } | null }> {
  const token = await getAuthToken();

  const body: Record<string, unknown> = {
    system_prompt: systemPrompt,
    messages,
    stream: false,
  };
  if (maxTokens) body.max_tokens = maxTokens;
  if (plMeta) body.promptlayer_metadata = plMeta;
  if (plMeta?.model) body.model = plMeta.model;
  if (plMeta?.provider) body.provider = plMeta.provider;
  if (plMeta?.project_id && plMeta?.session_id) {
    body.project_context = {
      project_id: plMeta.project_id,
      session_id: plMeta.session_id,
    };
  }

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      },
      body: JSON.stringify(body),
      signal,
    },
  );

  if (response.status === 401) {
    // Token expired mid-session — refresh and retry once
    invalidateAuthToken();
    const freshToken = await getAuthToken();
    const retry = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${freshToken}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
        },
        body: JSON.stringify(body),
        signal,
      },
    );
    if (!retry.ok) {
      const text = await retry.text();
      throw new Error(`API call failed after token refresh (${retry.status}): ${text}`);
    }
    const retryResult = await retry.json();
    return {
      content: retryResult.content ?? "",
      usage: retryResult.usage
        ? { input: retryResult.usage.input_tokens ?? 0, output: retryResult.usage.output_tokens ?? 0 }
        : null,
    };
  }

  if (!response.ok) {
    const text = await response.text();
    let detail: string;
    try {
      const parsed = JSON.parse(text);
      const parts = [parsed.error, parsed.details].filter(Boolean);
      detail = parts.join(" — ") || text;
    } catch {
      detail = text;
    }
    throw new Error(`API call failed (${response.status}): ${detail}`);
  }

  const result = await response.json();
  const content = result.content as string;
  const usage = result.usage
    ? { input: result.usage.input_tokens as number, output: result.usage.output_tokens as number }
    : null;

  return { content, usage };
}

function buildRequestBody(input: GenerateInput, stream: boolean, maxTokens?: number) {
  const { project, sessionId, generationMode, approvedPatterns, fbTemplates, designProfile, agentKnowledgeDocs, promptSections, userMessage, conversationHistory, agents } = input;
  const { systemPrompt, messages } = buildPrompt({
    project,
    agents,
    generationMode,
    approvedPatterns,
    fbTemplates,
    designProfile,
    agentKnowledgeDocs,
    promptSections,
    userMessage,
    conversationHistory,
  });
  const fetchBody: Record<string, unknown> = {
    system_prompt: systemPrompt,
    messages,
    project_context: {
      project_id: project.id,
      session_id: sessionId,
    },
    generation_mode: generationMode,
    stream,
  };
  if (maxTokens) fetchBody.max_tokens = maxTokens;
  return { systemPrompt, fetchBody };
}

// --- Non-streaming hook (original) ---

export function useGenerate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: GenerateInput): Promise<GenerateResult> => {
      const { fetchBody } = buildRequestBody(input, false, CODE_GEN_MAX_TOKENS);
      const token = await getAuthToken();

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
          },
          body: JSON.stringify(fetchBody),
        }
      );

      if (!response.ok) {
        const body = await response.text();
        let detail: string;
        try {
          const parsed = JSON.parse(body);
          const parts = [parsed.error, parsed.details].filter(Boolean);
          detail = parts.join(" — ") || body;
        } catch {
          detail = body;
        }
        throw new Error(`Generation failed (${response.status}): ${detail}`);
      }

      const result = await response.json();
      const rawResponse = result.content as string;

      return processRawResponse(rawResponse, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ARTIFACTS_KEY });
      queryClient.invalidateQueries({ queryKey: ["conversation-turns"] });
      queryClient.invalidateQueries({ queryKey: ["snapshots"] });
    },
  });
}

// --- Streaming hook ---

export function useGenerateStream() {
  const queryClient = useQueryClient();
  const { appendStreamChunk, clearStreaming } = usePacStStore();
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const generateStream = useCallback(
    async (
      input: GenerateInput,
      callbacks?: {
        onSuccess?: (result: GenerateResult) => void;
        onError?: (error: Error) => void;
      },
    ) => {
      setError(null);
      clearStreaming();
      setIsStreaming(true);

      const abort = new AbortController();
      abortRef.current = abort;

      // Reference lookup before building prompt
      let enrichedInput = input;
      if (!input.referenceSections) {
        try {
          const refSections = await getRelevantReferenceSections(
            input.userMessage,
            "generation_request",
            input.project.plc_brand,
            abort.signal,
            20,
            input.promptSections,
            "SCL",
          );
          if (refSections.length > 0) {
            enrichedInput = { ...input, referenceSections: refSections };
          }
        } catch {
          // Non-fatal — continue without reference sections
        }
      }

      const { fetchBody } = buildRequestBody(enrichedInput, true, CODE_GEN_MAX_TOKENS);

      try {
        const chatPlMeta: PromptLayerMeta = {
          agent_role: "code_architect",
          pipeline_step: "chat_generate",
          session_id: input.sessionId,
          project_id: input.project.id,
          generation_mode: input.generationMode,
        };
        const fullContent = await streamFromEdgeFunction(
          fetchBody,
          abort.signal,
          appendStreamChunk,
          undefined,
          chatPlMeta,
        );

        // Stream complete — run post-processing pipeline
        setIsStreaming(false);
        clearStreaming();

        const result = await processRawResponse(fullContent, input);

        queryClient.invalidateQueries({ queryKey: ARTIFACTS_KEY });
        queryClient.invalidateQueries({ queryKey: ["conversation-turns"] });
        queryClient.invalidateQueries({ queryKey: ["snapshots"] });

        callbacks?.onSuccess?.(result);
        return result;
      } catch (err) {
        setIsStreaming(false);
        clearStreaming();

        if (err instanceof DOMException && err.name === "AbortError") {
          return undefined;
        }

        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        callbacks?.onError?.(error);
        return undefined;
      }
    },
    [queryClient, appendStreamChunk, clearStreaming],
  );

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    clearStreaming();
  }, [clearStreaming]);

  return { generateStream, cancelStream, isStreaming, error };
}
