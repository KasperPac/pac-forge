import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// --- Mocks --------------------------------------------------------

const updateCalls: Array<{ table: string; payload: Record<string, unknown> }> = [];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      update: (payload: Record<string, unknown>) => ({
        eq: () => {
          updateCalls.push({ table, payload });
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
  },
}));

const streamMock = vi.fn();

vi.mock("@/hooks/use-generation", () => ({
  streamFromEdgeFunction: (...args: unknown[]) => streamMock(...args),
}));

// --- Imports under test ------------------------------------------

import { useFdsConversation } from "../use-fds-conversation";
import type { OperatingStateV2 } from "@/types/spec-contract-v2";

// --- Fixtures ----------------------------------------------------

const ASSEMBLY_ID = "00000000-0000-4000-8000-000000000a01";
const SUBSYSTEM_ID = "00000000-0000-4000-8000-000000000b01";
const SESSION_ID = "00000000-0000-4000-8000-000000000s01";

const baseSession = {
  id: SESSION_ID,
  spec_project_id: "00000000-0000-4000-8000-000000000001",
  assembly_id: ASSEMBLY_ID,
  subsystem_id: SUBSYSTEM_ID,
  status: "static_confirmed",
  static_states: {},
  sequential_states: {},
  conversation: [],
} as never;

const baseAssembly = {
  assembly_id: ASSEMBLY_ID,
  assembly_name: "LFT01",
  devices: [
    {
      device_id: "d1",
      device_name: "Pump M01",
      device_class: "motor",
      is_safety: false,
      io_signals: [
        { tag: "LFT01_M01_CMD", signal_type: "DO" },
        { tag: "LFT01_M01_FB", signal_type: "DI" },
      ],
    },
  ],
} as never;

const baseSubsystem = {
  subsystem_id: SUBSYSTEM_ID,
  subsystem_name: "Catodo",
  equipment_type: "lift",
} as never;

const baseTags = [
  { tag: "LFT01_M01_CMD", description: "Pump cmd", signal_direction: "DO" },
  { tag: "LFT01_M01_FB", description: "Pump fb", signal_direction: "DI" },
] as never;

const baseStates: OperatingStateV2[] = [
  { state_id: 6, packml_id: 6, display_name: "Execute", description: "Running", state_pattern: "sequential" },
];

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

// --- Tests -------------------------------------------------------

describe("useFdsConversation validator gate", () => {
  beforeEach(() => {
    updateCalls.length = 0;
    streamMock.mockReset();
  });

  it("merges a valid V2 emission and does NOT post a failure turn", async () => {
    const validResponse = `Here's Execute:

\`\`\`json
[
  {
    "state_id": 6,
    "override_kind": "override",
    "permissives": [],
    "steps": [
      {
        "step_id": "lft01_execute_step_10",
        "branch_id": "main",
        "actions": [],
        "monitors": [],
        "transitions": [
          { "transition_id": "lft01_execute_step_10_terminal", "guard": [ { "kind": "tag_equals", "tag": "LFT01_M01_FB", "value": true, "within_ms": 3000, "on_fail": { "fault_code": "F_X", "severity": "fault" } } ], "next_step_id": null }
        ]
      }
    ],
    "notes": null
  }
]
\`\`\``;

    streamMock.mockImplementation(async (_body, _signal, onChunk) => {
      onChunk(validResponse);
    });

    const { result } = renderHook(
      () =>
        useFdsConversation({
          session: baseSession,
          assembly: baseAssembly,
          subsystem: baseSubsystem,
          allTags: baseTags,
          allStates: baseStates,
        }),
      { wrapper: ({ children }) => wrap(children) },
    );

    await act(async () => {
      await result.current.sendMessage("Tell me Execute");
    });

    // Last update should include the new sequential_states row.
    const final = updateCalls[updateCalls.length - 1];
    expect(final.payload.sequential_states).toBeDefined();
    expect((final.payload.sequential_states as Record<string, unknown>)["6"]).toBeDefined();

    // No system-role turn in any persisted conversation snapshot.
    const conversations = updateCalls
      .map((c) => c.payload.conversation as Array<{ role: string }> | undefined)
      .filter((c): c is Array<{ role: string }> => !!c);
    const sawSystemTurn = conversations.some((conv) => conv.some((t) => t.role === "system"));
    expect(sawSystemTurn).toBe(false);
  });

  it("rejects an invalid V2 emission and posts a system-role failure turn", async () => {
    // Invalid: override_kind="inherit" must have empty permissives/steps/
    // monitors/branches. This row claims to inherit but supplies a step,
    // which the override_kind content-rule validator rejects with
    // "inherit rows must be empty".
    const invalidResponse = `Here's a broken Execute:

\`\`\`json
[
  {
    "state_id": 6,
    "override_kind": "inherit",
    "permissives": [],
    "steps": [
      {
        "step_id": "lft01_execute_step_10",
        "branch_id": "main",
        "actions": [],
        "monitors": [],
        "transitions": []
      }
    ],
    "notes": null
  }
]
\`\`\``;

    streamMock.mockImplementation(async (_body, _signal, onChunk) => {
      onChunk(invalidResponse);
    });

    const { result } = renderHook(
      () =>
        useFdsConversation({
          session: baseSession,
          assembly: baseAssembly,
          subsystem: baseSubsystem,
          allTags: baseTags,
          allStates: baseStates,
        }),
      { wrapper: ({ children }) => wrap(children) },
    );

    await act(async () => {
      await result.current.sendMessage("Tell me");
    });

    const final = updateCalls[updateCalls.length - 1];
    // No sequential_states update (block rejected).
    expect(final.payload.sequential_states).toBeUndefined();

    // System-role turn appended to the conversation.
    const conv = final.payload.conversation as Array<{ role: string; content: string }>;
    const sysTurn = conv.find((t) => t.role === "system");
    expect(sysTurn).toBeDefined();
    expect(sysTurn!.content).toMatch(/rejected/i);
  });
});
