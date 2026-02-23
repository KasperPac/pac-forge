import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { buildCompileFixSystemPrompt, formatCompileErrorContext } from "@/lib/compile-fix-prompt";
import { parseCompileFixResponse } from "@/lib/compile-fix-parser";
import type { CompileErrorInfo } from "@/lib/compile-fix-prompt";
import type { FixedSource } from "@/lib/compile-fix-parser";
import type { PatternCandidate } from "@/types";

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
}

interface CompileFixResult {
  fixes: FixedSource[];
  explanation: string;
  rawResponse: string;
}

export function useCompileFix() {
  return useMutation({
    mutationFn: async (input: CompileFixInput): Promise<CompileFixResult> => {
      const { errors, warnings, sources, userMessage, conversationHistory, approvedPatterns } = input;

      const systemPrompt = buildCompileFixSystemPrompt(approvedPatterns);

      // Build the user message — either the auto-generated context or a follow-up
      const autoContext = formatCompileErrorContext(errors, warnings, sources);
      const finalUserMessage = userMessage
        ? `${autoContext}\n\n## Additional Instructions\n\n${userMessage}`
        : autoContext;

      const messages: Array<{ role: "user" | "assistant"; content: string }> = [
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

      const { fixes, explanation } = parseCompileFixResponse(rawResponse);

      return { fixes, explanation, rawResponse };
    },
  });
}
