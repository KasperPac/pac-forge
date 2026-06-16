import { useState, useCallback } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import {
  buildInterfaceContractPrompt,
  buildInterfaceContractUserMessage,
} from "@/lib/forge-prompts";
import type { SpecAnalysis } from "@/types/forge";
import type { InterfaceContractMap, EquipmentModuleContract } from "@/types/forge-contract";

/** Parse the AI response and extract InterfaceContractMap from JSON fences */
function parseContractResponse(raw: string): InterfaceContractMap {
  // Extract JSON from ```json fences
  const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();

  const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

  // Validate structure
  const contracts: InterfaceContractMap = {};
  for (const [key, val] of Object.entries(parsed)) {
    const entry = val as Record<string, unknown>;
    if (!entry.equipment_moduleId || !entry.equipment_moduleTag) continue;

    const contract: EquipmentModuleContract = {
      equipment_moduleId: String(entry.equipment_moduleId),
      equipment_moduleTag: String(entry.equipment_moduleTag),
      exposed: Array.isArray(entry.exposed) ? entry.exposed.map(normalizeSignal) : [],
      consumed: Array.isArray(entry.consumed) ? entry.consumed.map(normalizeSignal) : [],
      stateDefinitions: Array.isArray(entry.stateDefinitions)
        ? entry.stateDefinitions.map(String)
        : ["IDLE", "FAULT"],
      approved: false,
    };
    contracts[key] = contract;
  }

  return contracts;
}

function normalizeSignal(raw: unknown): import("@/types/forge-contract").InterfaceSignal {
  const s = raw as Record<string, unknown>;
  return {
    id: String(s.id ?? crypto.randomUUID()),
    name: String(s.name ?? ""),
    dataType: String(s.dataType ?? "Bool"),
    direction: s.direction === "consume" ? "consume" : "expose",
    intentComment: String(s.intentComment ?? ""),
    sourceAssemblyTag: s.sourceAssemblyTag ? String(s.sourceAssemblyTag) : undefined,
    sourceSignalName: s.sourceSignalName ? String(s.sourceSignalName) : undefined,
  };
}

export function useForgeContractGenerate() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateContracts = useCallback(
    async (analysis: SpecAnalysis): Promise<InterfaceContractMap> => {
      setLoading(true);
      setError(null);

      try {
        const systemPrompt = buildInterfaceContractPrompt();
        const userMessage = buildInterfaceContractUserMessage(analysis);
        const controller = new AbortController();

        const { content } = await callNonStreaming(
          systemPrompt,
          [{ role: "user", content: userMessage }],
          controller.signal,
          16384,
          { prompt_name: "forge-interface-contract", agent_role: "pm", pipeline_step: "interface_contract" },
        );

        return parseContractResponse(content);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Contract generation failed";
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { generateContracts, loading, error };
}
