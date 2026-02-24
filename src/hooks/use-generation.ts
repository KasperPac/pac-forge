import { useState, useCallback, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { buildPrompt } from "@/lib/prompt-builder";
import { parseArtifacts } from "@/lib/artifact-parser";
import type { ParsedArtifact } from "@/lib/artifact-parser";
import { buildManifest } from "@/lib/manifest-builder";
import { analyzeArtifacts } from "@/lib/safety-analyzer";
import { usePacStStore } from "@/stores/pac-st-store";
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
}

export interface GenerateResult {
  artifacts: Artifact[];
  manifest: TiaManifest;
  warnings: SafetyWarning[];
  summary: string;
  parseErrors: string[];
  manifestErrors: string[];
  rawResponse: string;
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
    destination_folder: "",
    dependencies: pa.dependencies,
    compile_after_import: true,
    overwrite_strategy: "CREATE_OR_UPDATE" as const,
    safety_warnings: warnings.filter((w) => w.artifact_name === pa.name),
    notes: "",
    created_at: new Date().toISOString(),
  }));

  // Build manifest
  const parseErrors: string[] = [];
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

export async function getAuthToken(): Promise<string> {
  const { data: { session: authSession } } = await supabase.auth.getSession();
  const token = authSession?.access_token;
  if (!token) throw new Error("Not authenticated");
  return token;
}

/**
 * Streams SSE from the Edge Function and returns the full accumulated content.
 * Calls `onChunk` with each text delta as it arrives.
 */
export async function streamFromEdgeFunction(
  body: Record<string, unknown>,
  signal: AbortSignal,
  onChunk: (text: string) => void,
): Promise<string> {
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
      detail = parsed.error ?? parsed.details ?? text;
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
        }
      } catch {
        // Skip malformed JSON lines
      }
    }
  }

  return fullContent;
}

function buildRequestBody(input: GenerateInput, stream: boolean) {
  const { project, sessionId, generationMode, approvedPatterns, fbTemplates, designProfile, agentKnowledgeDocs, userMessage, conversationHistory, agents } = input;
  const { systemPrompt, messages } = buildPrompt({
    project,
    agents,
    generationMode,
    approvedPatterns,
    fbTemplates,
    designProfile,
    agentKnowledgeDocs,
    userMessage,
    conversationHistory,
  });
  return {
    systemPrompt,
    fetchBody: {
      system_prompt: systemPrompt,
      messages,
      project_context: {
        project_id: project.id,
        session_id: sessionId,
      },
      generation_mode: generationMode,
      stream,
    },
  };
}

// --- Non-streaming hook (original) ---

export function useGenerate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: GenerateInput): Promise<GenerateResult> => {
      const { fetchBody } = buildRequestBody(input, false);
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
          detail = parsed.error ?? parsed.details ?? body;
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
      const { fetchBody } = buildRequestBody(input, true);

      setError(null);
      clearStreaming();
      setIsStreaming(true);

      const abort = new AbortController();
      abortRef.current = abort;

      try {
        const fullContent = await streamFromEdgeFunction(
          fetchBody,
          abort.signal,
          appendStreamChunk,
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
