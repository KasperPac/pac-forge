import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const upsertCalls: Array<{ table: string; payload: Record<string, unknown> }> = [];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      upsert: (payload: Record<string, unknown>) => {
        upsertCalls.push({ table, payload });
        return Promise.resolve({ data: null, error: null });
      },
    }),
  },
}));

const streamMock = vi.fn();

vi.mock("@/hooks/use-generation", () => ({
  streamFromEdgeFunction: (...args: unknown[]) => streamMock(...args),
}));

import { useFdsOrchestrationConversation } from "../use-fds-orchestration-conversation";
import type { OperatingStateV2 } from "@/types/spec-contract-v2";

const SPEC_ID = "00000000-0000-4000-8000-000000000001";
const SUBSYSTEM_ID = "00000000-0000-4000-8000-000000000b01";
const ASM1 = "00000000-0000-4000-8000-000000000a01";
const ASM2 = "00000000-0000-4000-8000-000000000a02";

const baseSubsystem = {
  unit_id: SUBSYSTEM_ID,
  unit_name: "Catodo",
  equipment_type: "lift",
  equipment_modules: [
    { equipment_module_id: ASM1, equipment_module_name: "LFT01" },
    { equipment_module_id: ASM2, equipment_module_name: "CV01" },
  ],
} as never;

const baseSessions = [
  { equipment_module_id: ASM1, status: "complete", sequential_states: { "6": { permissives: [], steps: [], notes: null } } },
  { equipment_module_id: ASM2, status: "complete", sequential_states: { "6": { permissives: [], steps: [], notes: null } } },
] as never;

const baseStates: OperatingStateV2[] = [
  { state_id: 6, packml_id: 6, display_name: "Execute", description: "Running", state_pattern: "sequential" },
];

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

describe("useFdsOrchestrationConversation validator gate", () => {
  beforeEach(() => {
    upsertCalls.length = 0;
    streamMock.mockReset();
  });

  it("merges a valid V2 orchestration emission", async () => {
    const validResponse = `Here's Execute orchestration:

\`\`\`json
{
  "state_id": 6,
  "equipment_module_order": ["${ASM1}", "${ASM2}"],
  "shared_permissives": [],
  "inter_equipment_module_interlocks": [
    { "interlock_id": "IL_X", "source_equipment_module": "${ASM1}", "source_condition": { "kind": "tag_equals", "tag": "LFT01_RUNNING", "value": true }, "target_equipment_module": "${ASM2}", "effect": "enable", "prose": "x" }
  ],
  "notes": null
}
\`\`\``;

    streamMock.mockImplementation(async (_body, _signal, onChunk) => {
      onChunk(validResponse);
    });

    const { result } = renderHook(
      () =>
        useFdsOrchestrationConversation({
          specProjectId: SPEC_ID,
          unit: baseSubsystem,
          sessions: baseSessions,
          orchestration: null,
          allStates: baseStates,
        }),
      { wrapper: ({ children }) => wrap(children) },
    );

    await act(async () => {
      await result.current.sendMessage("Tell me");
    });

    const final = upsertCalls[upsertCalls.length - 1];
    const stateSequences = final.payload.state_sequences as Record<string, unknown>;
    expect(stateSequences["6"]).toBeDefined();

    const conv = final.payload.conversation as Array<{ role: string }>;
    expect(conv.every((t) => t.role !== "system")).toBe(true);
  });

  it("rejects an invalid orchestration emission and posts a system-role turn", async () => {
    // Invalid: effect is not in the closed enum. Zod safeParse catches this.
    const invalidResponse = `Bad orchestration:

\`\`\`json
{
  "state_id": 6,
  "equipment_module_order": ["${ASM1}"],
  "shared_permissives": [],
  "inter_equipment_module_interlocks": [
    { "interlock_id": "IL_X", "source_equipment_module": "${ASM1}", "source_condition": { "kind": "tag_equals", "tag": "X", "value": true }, "target_equipment_module": "${ASM2}", "effect": "fly_to_the_moon", "prose": "x" }
  ],
  "notes": null
}
\`\`\``;

    streamMock.mockImplementation(async (_body, _signal, onChunk) => {
      onChunk(invalidResponse);
    });

    const { result } = renderHook(
      () =>
        useFdsOrchestrationConversation({
          specProjectId: SPEC_ID,
          unit: baseSubsystem,
          sessions: baseSessions,
          orchestration: null,
          allStates: baseStates,
        }),
      { wrapper: ({ children }) => wrap(children) },
    );

    await act(async () => {
      await result.current.sendMessage("Tell me");
    });

    const final = upsertCalls[upsertCalls.length - 1];
    const stateSequences = final.payload.state_sequences as Record<string, unknown>;
    expect(stateSequences["6"]).toBeUndefined();

    const conv = final.payload.conversation as Array<{ role: string; content: string }>;
    const sysTurn = conv.find((t) => t.role === "system");
    expect(sysTurn).toBeDefined();
    expect(sysTurn!.content).toMatch(/rejected/i);
  });
});
