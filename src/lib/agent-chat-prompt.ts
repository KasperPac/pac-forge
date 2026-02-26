import { getAgentProfile } from "@/lib/agent-profiles";
import type { AgentKnowledgeDoc, Artifact } from "@/types";
import type { PipelineStepResult } from "@/lib/pipeline";
import type { TiaCompileResult, CompileFixMessage } from "@/stores/tia-console-store";

export interface SessionContext {
  /** Generated code artifacts from the current session */
  artifacts: Artifact[];
  /** Pipeline step results (each agent's response/reasoning) */
  pipelineSteps: PipelineStepResult[];
  /** Most recent compile result (errors/warnings from TIA Portal) */
  compileResult?: TiaCompileResult | null;
  /** Compile-fix chat messages (auto-fix conversation history) */
  compileFixMessages?: CompileFixMessage[];
}

/**
 * Builds a system prompt for the floating agent chat.
 * Includes agent identity, skills, knowledge docs, and — if available —
 * the generated code and pipeline reasoning from the current session so
 * the user can ask "why did you build it this way?".
 */
export function buildAgentChatPrompt(
  agentName: string,
  knowledgeDocs?: AgentKnowledgeDoc[],
  sessionContext?: SessionContext,
): string {
  const profile = getAgentProfile(agentName);

  const sections: string[] = [
    `# ${agentName}`,
    "",
    `**Role:** ${profile.tagline}`,
    `**Personality:** ${profile.personality}`,
    "",
    `## Description`,
    profile.description,
    "",
    `## Your Capabilities`,
    ...profile.skills.map((s) => `- ${s}`),
    "",
    `## Instructions`,
    `You are ${agentName}, a specialist PLC automation agent in the Pac-Forge engineering tool.`,
    `You are having a direct conversation with an automation engineer.`,
    ``,
    `**CRITICAL: This is a CONVERSATION, not a code generation session.**`,
    `- Do NOT generate or rewrite full code blocks unless the engineer explicitly asks you to write code.`,
    `- When asked about issues, errors, or design decisions: EXPLAIN your reasoning, point to the specific problem, and discuss the fix conceptually.`,
    `- Use short inline code snippets (\`like this\`) to reference specific variables, types, or expressions — but do NOT output entire function blocks or SCL files.`,
    `- If the engineer wants you to actually generate a fix, they will ask. Until then, just talk about it.`,
    ``,
    `**CRITICAL: Be factual, not sycophantic.**`,
    `- Do NOT say "Great question!", "You're absolutely right!", "That's a really good point!" or any other filler praise. Get straight to the substance.`,
    `- Only state things you can back up with evidence from: your Knowledge Base (below), the Session Context (below), Platform Rules, or Siemens documentation you have been given.`,
    `- When referencing a fact, briefly cite WHERE it comes from (e.g. "per the naming convention in your design profile", "from the Platform Rules", "based on the compile error in line 42 of ControlMotor").`,
    `- If you are ASSUMING something (because you lack the information to know for certain), you MUST say so explicitly. Use phrasing like: "I'm assuming X because I don't have Y — if you upload Y as a learning document or provide it here, I can give a definitive answer."`,
    `- When you get something wrong or miss something, explain what specific knowledge or context you were missing that led to the mistake, and what the engineer could provide (as a learning doc, design profile rule, or correction pattern) so you don't repeat it.`,
    `- If you genuinely don't know, say "I don't know" rather than guessing.`,
    ``,
    `Answer questions based on your specialty area. Be precise and technical.`,
    `Follow Siemens TIA Portal conventions for S7-1200/S7-1500.`,
    `If the engineer's question would benefit from project-specific context (IO lists, CPU type, existing code, design profiles), proactively ask if they'd like to share that information.`,
    `Keep responses concise and well-structured. Use markdown formatting.`,
  ];

  if (knowledgeDocs && knowledgeDocs.length > 0) {
    sections.push("", "## Your Knowledge Base");
    for (const doc of knowledgeDocs) {
      sections.push(`### ${doc.title}`, doc.content, "");
    }
  }

  // Inject current session context so agent can discuss what was just built
  if (sessionContext) {
    const { artifacts, pipelineSteps } = sessionContext;

    if (artifacts.length > 0) {
      sections.push("", "## Current Session — Generated Code");
      sections.push(
        "The following code blocks were just generated in the current session. " +
          "The engineer may ask about design decisions, structure, or specific details.",
      );
      for (const a of artifacts) {
        sections.push(`### ${a.name} (${a.type})`, "```scl", a.content, "```", "");
      }
    }

    if (pipelineSteps.length > 0) {
      sections.push("", "## Current Session — Agent Pipeline Reasoning");
      sections.push(
        "These are the reasoning/responses from each agent step in the pipeline that produced the code above. " +
          "Use this to explain WHY the code was built the way it was.",
      );
      for (const step of pipelineSteps) {
        if (!step.rawResponse) continue;
        sections.push(
          `### ${step.agentName} (${step.role})`,
          step.rawResponse,
          "",
        );
      }
    }

    const { compileResult, compileFixMessages } = sessionContext;

    if (compileResult) {
      sections.push("", "## Current Session — Last Compile Result");
      sections.push(
        compileResult.success
          ? "Compilation succeeded."
          : "Compilation FAILED. The following errors were reported by TIA Portal:",
      );
      if (compileResult.errors.length > 0) {
        sections.push("");
        for (const err of compileResult.errors) {
          const loc = err.line != null ? ` (line ${err.line})` : "";
          sections.push(
            `- **${err.severity}** in \`${err.artifact_name}\`${loc}: ${err.error_text}`,
          );
        }
      }
      if (compileResult.warnings.length > 0) {
        sections.push("", "### Warnings");
        for (const w of compileResult.warnings) {
          const loc = w.line != null ? ` (line ${w.line})` : "";
          sections.push(
            `- **WARNING** in \`${w.artifact_name}\`${loc}: ${w.error_text}`,
          );
        }
      }
    }

    if (compileFixMessages && compileFixMessages.length > 0) {
      sections.push("", "## Current Session — Compile-Fix History");
      sections.push(
        "The following compile-fix conversation occurred while attempting to resolve compile errors:",
      );
      for (const m of compileFixMessages) {
        const label =
          m.role === "user"
            ? "Engineer"
            : m.role === "system"
              ? "System"
              : "Compile-Fix Agent";
        sections.push(`**${label}:** ${m.content}`, "");
      }
    }
  }

  return sections.join("\n");
}
