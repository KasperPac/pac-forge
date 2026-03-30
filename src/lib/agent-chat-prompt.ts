import { getAgentProfile } from "@/lib/agent-profiles";
import type { AgentKnowledgeDoc, Artifact } from "@/types";
import type { PipelineStepResult } from "@/lib/pipeline";
import type { TiaCompileResult, CompileFixMessage } from "@/stores/tia-console-store";
import type { ForgeSession } from "@/types/forge";
import { buildWiringContext } from "@/lib/wiring-context";

/** Hard cap for total system prompt size (chars). Edge Function has ~100K limit. */
const MAX_PROMPT_CHARS = 60_000;
/** Max chars per artifact code block. */
const MAX_ARTIFACT_CHARS = 4_000;
/** Max chars per pipeline step response. */
const MAX_STEP_CHARS = 2_000;
/** Max chars per knowledge doc. */
const MAX_KNOWLEDGE_CHARS = 3_000;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n... (truncated)";
}

export interface SessionContext {
  /** Generated code artifacts from the current session */
  artifacts: Artifact[];
  /** Pipeline step results (each agent's response/reasoning) */
  pipelineSteps: PipelineStepResult[];
  /** Most recent compile result (errors/warnings from TIA Portal) */
  compileResult?: TiaCompileResult | null;
  /** Compile-fix chat messages (auto-fix conversation history) */
  compileFixMessages?: CompileFixMessage[];
  /** Active forge wizard session — spec analysis, devices, artifacts, Q&A */
  forgeSession?: ForgeSession | null;
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
    `- When referencing a fact, briefly cite WHERE it comes from using the learning ID when available (e.g. "per K-0042", "based on P-0017", "from the Platform Rules", "based on the compile error in line 42 of ControlMotor").`,
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
      sections.push(`### [${doc.short_id}] ${doc.title}`, truncate(doc.content, MAX_KNOWLEDGE_CHARS), "");
    }
  }

  // Inject forge wizard context — spec analysis, devices, Q&A, artifacts
  if (sessionContext?.forgeSession) {
    const fs = sessionContext.forgeSession;
    sections.push("", "## Forge Wizard — Active Session");
    sections.push(
      "The engineer is currently working through the Forge project wizard. " +
        "This is the state of the current session. Use this to answer questions " +
        "about decisions made during the wizard, including spec analysis, device extraction, and code generation.",
    );

    if (fs.spec_analysis) {
      const sa = fs.spec_analysis;
      sections.push("", "### Spec Analysis");
      sections.push(`**Project:** ${sa.project_name}`);
      sections.push(`**Description:** ${sa.project_description}`);
      sections.push(`**PLC:** ${sa.plc_type} | **HMI:** ${sa.hmi_type || "not specified"}`);

      if (sa.subsystems.length > 0) {
        sections.push("", "**Subsystems:**");
        for (const sub of sa.subsystems) {
          sections.push(`- ${sub.name}: ${sub.description}`);
        }
      }

      if (sa.devices.length > 0) {
        sections.push("", "**Devices extracted from spec:**");
        for (const d of sa.devices) {
          const signals = d.io_signals.map(s => `${s.tag_name}(${s.signal_type})`).join(", ");
          sections.push(`- ${d.tag} — ${d.name} (${d.device_type}, subsystem: ${d.subsystem})${signals ? ` | IO: ${signals}` : ""}`);
        }
      }

      if (sa.process_sequences.length > 0) {
        sections.push("", "**Process Sequences:**");
        for (const seq of sa.process_sequences) {
          sections.push(`- **${seq.name}** (${seq.subsystem}): ${seq.steps.length} steps, permissives: ${seq.permissives.join(", ") || "none"}`);
        }
      }

      if (sa.interlocks.length > 0) {
        sections.push("", "**Interlocks:**");
        for (const il of sa.interlocks) {
          sections.push(`- ${il.name}: ${il.condition} → affects: ${il.affected_devices.join(", ")}`);
        }
      }

      if (sa.alarms.length > 0) {
        sections.push("", "**Alarms:**");
        for (const al of sa.alarms) {
          sections.push(`- ${al.name} (${al.severity}): ${al.description}`);
        }
      }
    }

    if (fs.qa_messages.length > 0) {
      sections.push("", "### Q&A Review Conversation");
      sections.push("This Q&A happened between the PM agent and the engineer to clarify spec gaps:");
      for (const m of fs.qa_messages) {
        const label = m.role === "assistant" ? "PM Agent" : "Engineer";
        sections.push(`**${label}:** ${truncate(m.content, MAX_STEP_CHARS)}`, "");
      }
    }

    if (fs.device_list.length > 0) {
      sections.push("", "### Confirmed Device List");
      for (const d of fs.device_list) {
        const signals = (d.io_signals ?? []).map(s => `${s.tag_name}(${s.signal_type})`).join(", ");
        sections.push(`- ${d.tag} — ${d.name} (${d.device_type}, FB template: ${d.fb_template_id ? "matched" : "AI-generated"}, confidence: ${d.fb_match_confidence})${signals ? ` | IO: ${signals}` : ""}`);
      }
    }

    if (fs.device_artifacts.length > 0) {
      sections.push("", "### Generated Device Code");
      for (const a of fs.device_artifacts) {
        const lang = a.language === "LAD" ? "json" : "scl";
        sections.push(`#### ${a.name} (${a.type})`, `\`\`\`${lang}`, truncate(a.content, MAX_ARTIFACT_CHARS), "```", "");
      }
    }

    if (fs.process_artifacts.length > 0) {
      sections.push("", "### Generated Process Code");
      for (const a of fs.process_artifacts) {
        const lang = a.language === "LAD" ? "json" : "scl";
        sections.push(`#### ${a.name} (${a.type})`, `\`\`\`${lang}`, truncate(a.content, MAX_ARTIFACT_CHARS), "```", "");
      }
    }

    if (fs.linkage_matrix) {
      const wiringMap = buildWiringContext(fs.linkage_matrix, fs.io_list ?? []);
      if (wiringMap) {
        sections.push("", wiringMap);
      }
    }

    sections.push("");
  }

  // Inject current Pac-ST/TIA session context so agent can discuss what was just built
  if (sessionContext) {
    const { artifacts, pipelineSteps } = sessionContext;

    if (artifacts.length > 0) {
      sections.push("", "## Current Session — Generated Code");
      sections.push(
        "The following code blocks were just generated in the current session. " +
          "The engineer may ask about design decisions, structure, or specific details.",
      );
      for (const a of artifacts) {
        sections.push(`### ${a.name} (${a.type})`, "```scl", truncate(a.content, MAX_ARTIFACT_CHARS), "```", "");
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
          truncate(step.rawResponse, MAX_STEP_CHARS),
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

  const prompt = sections.join("\n");
  return truncate(prompt, MAX_PROMPT_CHARS);
}
