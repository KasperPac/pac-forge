import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { buildCompileFixSystemPrompt, formatCompileErrorContext } from "@/lib/compile-fix-prompt";
import { parseCompileFixResponse } from "@/lib/compile-fix-parser";
import { getRelevantReferenceSections } from "@/lib/reference-lookup";
import { buildContextMessages } from "@/lib/prompt-builder";
import type { CompileErrorInfo } from "@/lib/compile-fix-prompt";
import type { FixedSource } from "@/lib/compile-fix-parser";
import type { CompileFixPromptInput } from "@/lib/compile-fix-prompt";
import type { PatternCandidate, DesignProfile, AgentKnowledgeDoc, Project, FbTemplate } from "@/types";

interface CompileFixInput {
  errors: CompileErrorInfo[];
  warnings: CompileErrorInfo[];
  sources: Record<string, string>;
  /** Optional extra user instructions beyond the auto-generated error context */
  userMessage?: string;
  /** Previous messages for multi-turn conversation */
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Approved correction patterns to inject into the system prompt */
  approvedPatterns?: PatternCandidate[];
  /** Design profile for customer-specific code rules */
  designProfile?: DesignProfile;
  /** Agent knowledge docs for the Code Architect (injected into system prompt) */
  agentKnowledgeDocs?: AgentKnowledgeDoc[];
  /** Custom prompt sections (DB overrides for identity/instructions/platform_rules) */
  promptSections?: Record<string, string>;
  /** Project context for IO list, CPU type, safety level, etc. */
  project?: Project;
  /** FB templates for company-standard block structures */
  fbTemplates?: FbTemplate[];
}

interface CompileFixResult {
  fixes: FixedSource[];
  explanation: string;
  rawResponse: string;
  /** The system prompt that was sent (for pipeline console visibility) */
  systemPrompt: string;
  /** The user message that was sent (for pipeline console visibility) */
  userMessage: string;
  /** Token usage if available */
  tokenUsage: { input: number; output: number } | null;
}

export function useCompileFix() {
  return useMutation({
    mutationFn: async (input: CompileFixInput): Promise<CompileFixResult> => {
      const { errors, warnings, sources, userMessage, conversationHistory, approvedPatterns, designProfile, agentKnowledgeDocs, promptSections, project, fbTemplates } = input;

      // Reference lookup from compile errors + source code
      let referenceSections;
      try {
        const errorContext = errors.map((e) => `${e.artifact_name}: ${e.error_text}`).join("\n");
        const sourceContext = Object.values(sources).join("\n\n").slice(0, 6000);
        const abort = new AbortController();
        referenceSections = await getRelevantReferenceSections(
          `${errorContext}\n\n${sourceContext}`,
          "compile_errors",
          project?.plc_brand ?? "SIEMENS_TIA",
          abort.signal,
          20,
          promptSections,
        );
      } catch {
        // Non-fatal
      }

      const promptInput: CompileFixPromptInput = { approvedPatterns, designProfile, knowledgeDocs: agentKnowledgeDocs, promptSections, project, fbTemplates, referenceSections };
      const systemPrompt = buildCompileFixSystemPrompt(promptInput);

      // Build the user message — either the auto-generated context or a follow-up
      const autoContext = formatCompileErrorContext(errors, warnings, sources);
      const finalUserMessage = userMessage
        ? `${autoContext}\n\n## Additional Instructions\n\n${userMessage}`
        : autoContext;

      // Reference sections + patterns are sent as prefixed context messages
      // to keep the system prompt under the 100K character limit
      const contextMessages = buildContextMessages(referenceSections ?? [], approvedPatterns ?? []);

      const messages: Array<{ role: "user" | "assistant"; content: string }> = [
        ...contextMessages,
        ...(conversationHistory ?? []),
        { role: "user" as const, content: finalUserMessage },
      ];

      // Call the same Edge Function as Pac-ST generation
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const token = authSession?.access_token;
      if (!token) throw new Error("Not authenticated");

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
          },
          body: JSON.stringify({
            system_prompt: systemPrompt,
            messages,
            stream: false,
          }),
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
        throw new Error(`Compile fix failed (${response.status}): ${detail}`);
      }

      const result = await response.json();
      const rawResponse = result.content as string;
      const tokenUsage = result.usage
        ? { input: result.usage.input_tokens as number, output: result.usage.output_tokens as number }
        : null;

      const { fixes, explanation } = parseCompileFixResponse(rawResponse);

      return { fixes, explanation, rawResponse, systemPrompt, userMessage: finalUserMessage, tokenUsage };
    },
  });
}
