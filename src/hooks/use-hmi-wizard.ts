import { useMutation } from "@tanstack/react-query";
import type { HmiPanelConfig, HmiUnifiedTheme } from "@/types/hmi-panel";
import { callNonStreaming } from "./use-generation";
import {
  buildHmiWizardPlanSystemPrompt,
  buildHmiWizardPlanUserMessage,
  buildHmiCustomSvgSystemPrompt,
  buildHmiCustomSvgUserMessage,
  parseHmiWizardPlan,
  parseCustomSvg,
} from "@/lib/hmi-wizard-prompts";
import type { HmiWizardPlan } from "@/lib/hmi-wizard-prompts";

const PLAN_MAX_TOKENS = 4096;
const SVG_MAX_TOKENS = 4096;

const FACEPLATE_KEYWORD_HINTS = [
  "motor / dol / reversing",
  "soft starter",
  "vfd / variable frequency drive",
  "pump",
  "valve (solenoid / analog / on-off)",
  "conveyor",
  "heater",
  "sensor / flow / level / pressure / temperature",
  "weigher / siwarex",
  "hopper / tank / silo",
];

export interface RequestPlanInput {
  userPrompt: string;
  screenRole: "overview" | "detail" | "dashboard" | "alarm" | "trend";
  panel: HmiPanelConfig;
  theme: HmiUnifiedTheme;
  useTemplateFrame: boolean;
}

export function useHmiWizardPlan() {
  return useMutation<HmiWizardPlan, Error, RequestPlanInput>({
    mutationFn: async (input) => {
      const systemPrompt = buildHmiWizardPlanSystemPrompt({
        panel: input.panel,
        theme: input.theme,
        useTemplateFrame: input.useTemplateFrame,
        faceplateKeywordHints: FACEPLATE_KEYWORD_HINTS,
      });
      const userMessage = buildHmiWizardPlanUserMessage({
        userPrompt: input.userPrompt,
        screenRole: input.screenRole,
      });

      const { content } = await callNonStreaming(
        systemPrompt,
        [{ role: "user", content: userMessage }],
        AbortSignal.timeout(90_000),
        PLAN_MAX_TOKENS,
        {
          prompt_name: "hmi_wizard_plan",
          agent_role: "hmi_wizard",
          function_name: "plan",
          model: "claude-sonnet-4-6",
          provider: "anthropic",
        },
      );

      return parseHmiWizardPlan(content);
    },
  });
}

export interface RequestCustomSvgInput {
  description: string;
  theme: HmiUnifiedTheme;
}

export function useHmiWizardCustomSvg() {
  return useMutation<string, Error, RequestCustomSvgInput>({
    mutationFn: async (input) => {
      const systemPrompt = buildHmiCustomSvgSystemPrompt({ theme: input.theme });
      const userMessage = buildHmiCustomSvgUserMessage(input.description);

      const { content } = await callNonStreaming(
        systemPrompt,
        [{ role: "user", content: userMessage }],
        AbortSignal.timeout(60_000),
        SVG_MAX_TOKENS,
        {
          prompt_name: "hmi_wizard_custom_svg",
          agent_role: "hmi_wizard",
          function_name: "custom_svg",
          model: "claude-sonnet-4-6",
          provider: "anthropic",
        },
      );

      return parseCustomSvg(content);
    },
  });
}
