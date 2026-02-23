import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { buildPrompt } from "@/lib/prompt-builder";
import { parseArtifacts } from "@/lib/artifact-parser";
import { buildManifest } from "@/lib/manifest-builder";
import { analyzeArtifacts } from "@/lib/safety-analyzer";
import type {
  Project,
  Agent,
  Artifact,
  GenerationMode,
  SafetyWarning,
  TiaManifest,
  PatternCandidate,
} from "@/types";

const ARTIFACTS_KEY = ["artifacts"] as const;

interface GenerateInput {
  project: Project;
  sessionId: string;
  agents: Agent[];
  generationMode: GenerationMode;
  userMessage: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  approvedPatterns?: PatternCandidate[];
}

interface GenerateResult {
  artifacts: Artifact[];
  manifest: TiaManifest;
  warnings: SafetyWarning[];
  summary: string;
  parseErrors: string[];
  manifestErrors: string[];
  rawResponse: string;
}

export function useGenerate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: GenerateInput): Promise<GenerateResult> => {
      const { project, sessionId, agents, generationMode, userMessage, conversationHistory, approvedPatterns } = input;

      // 1. Build the prompt
      const { systemPrompt, messages } = buildPrompt({
        project,
        agents,
        generationMode,
        approvedPatterns,
        userMessage,
        conversationHistory,
      });

      // 2. Call the Edge Function
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const token = authSession?.access_token;
      if (!token) throw new Error("Not authenticated");

      const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate`;

      const response = await fetch(functionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          system_prompt: systemPrompt,
          messages,
          project_context: {
            project_id: project.id,
            session_id: sessionId,
          },
          generation_mode: generationMode,
          stream: false,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorBody.error ?? `Generation failed: ${response.status}`);
      }

      const result = await response.json();
      const rawResponse = result.content as string;

      // 3. Parse artifacts from response
      const { artifacts: parsedArtifacts, summary, errors: parseErrors } =
        parseArtifacts(rawResponse);

      // 4. Run safety analyzer
      const warnings = analyzeArtifacts(parsedArtifacts);

      // 5. Build full Artifact objects
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

      // 6. Build manifest
      const { manifest, errors: manifestErrors } = buildManifest(artifacts, {
        projectId: project.id,
        tiaVersion: project.tia_version,
        cpuType: project.cpu_type,
        userId,
        sessionId,
      });

      // 7. Save artifacts to DB
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

      // 8. Save GENERATION snapshot for each artifact
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

      // 9. Save conversation turns (user + agent)
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ARTIFACTS_KEY });
      queryClient.invalidateQueries({ queryKey: ["conversation-turns"] });
      queryClient.invalidateQueries({ queryKey: ["snapshots"] });
    },
  });
}
