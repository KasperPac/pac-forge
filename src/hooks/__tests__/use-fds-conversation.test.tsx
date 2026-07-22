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

// Source-section lookup is irrelevant to these tests — stub it.
vi.mock("@/hooks/use-source-sections", () => ({
  useSourceSectionsForEm: () => ({ data: [] }),
}));

// --- Imports under test ------------------------------------------

import { useFdsConversation } from "../use-fds-conversation";
import type { EmStateV2, OperatorMode } from "@/types/spec-contract-v2";

// --- Fixtures ----------------------------------------------------

const ASSEMBLY_ID = "00000000-0000-4000-8000-000000000a01";
const SUBSYSTEM_ID = "00000000-0000-4000-8000-000000000b01";
const SESSION_ID = "00000000-0000-4000-8000-000000000s01";

// EM-local slug used as the sequential state id keyed by Stage B.
const EXECUTE_SLUG = "auto_cycle";

const baseEmStates: EmStateV2[] = [
  { state_id: "stopped", name: "Stopped", kind: "static", allowed_modes: [], is_safe_state: true },
  { state_id: EXECUTE_SLUG, name: "Auto Cycle", kind: "sequential", allowed_modes: [], is_safe_state: false },
];

const baseSession = {
  id: SESSION_ID,
  spec_project_id: "00000000-0000-4000-8000-000000000001",
  equipment_module_id: ASSEMBLY_ID,
  unit_id: SUBSYSTEM_ID,
  status: "static_confirmed",
  static_states: {},
  sequential_states: {},
  em_states: baseEmStates,
  em_transitions: [],
  conversation: [],
} as never;

const baseEquipmentModule = {
  equipment_module_id: ASSEMBLY_ID,
  equipment_module_name: "LFT01",
  control_modules: [
    {
      control_module_id: "d1",
      control_module_name: "Pump M01",
      control_module_class: "motor",
      is_safety: false,
      io_signals: [
        { tag: "LFT01_M01_CMD", signal_type: "DO" },
        { tag: "LFT01_M01_FB", signal_type: "DI" },
      ],
    },
  ],
} as never;

const baseUnit = {
  unit_id: SUBSYSTEM_ID,
  unit_name: "Catodo",
  equipment_type: "lift",
} as never;

const baseTags = [
  { tag: "LFT01_M01_CMD", description: "Pump cmd", signal_direction: "DO" },
  { tag: "LFT01_M01_FB", description: "Pump fb", signal_direction: "DI" },
] as never;

const baseModes: OperatorMode[] = [
  { mode_id: "auto", name: "Auto", is_default: true },
];

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

// --- Tests -------------------------------------------------------

describe("useFdsConversation Stage B validator gate", () => {
  beforeEach(() => {
    updateCalls.length = 0;
    streamMock.mockReset();
  });

  it("merges a valid V2 emission keyed by the EM-local slug and posts no failure turn", async () => {
    const validResponse = `Here's Auto Cycle:

\`\`\`json
[
  {
    "state_id": "${EXECUTE_SLUG}",
    "override_kind": "override",
    "permissives": [],
    "steps": [
      {
        "step_id": "lft01_execute_step_10",
        "branch_id": "main",
        "actions": [],
        "monitors": [],
        "transitions": [
          {
            "transition_id": "lft01_execute_step_10_terminal",
            "kind": "single",
            "target_step_id": "",
            "guard": [ { "kind": "tag_equals", "tag": "LFT01_M01_FB", "value": true, "within_ms": 3000, "on_fail": { "fault_code": "F_X", "severity": "fault" } } ],
            "priority": 0,
            "is_default": true,
            "notes": null
          }
        ],
        "step": 10,
        "action": "Run pump",
        "completion_criteria": [],
        "completion_criteria_text": ""
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
          equipment_module: baseEquipmentModule,
          unit: baseUnit,
          allTags: baseTags,
          modes: baseModes,
        }),
      { wrapper: ({ children }) => wrap(children) },
    );

    // EM already has authored states → Stage B.
    expect(result.current.stage).toBe("behavior");

    await act(async () => {
      await result.current.sendMessage("Tell me Auto Cycle");
    });

    // Last update should include the new sequential_states row keyed by slug.
    const final = updateCalls[updateCalls.length - 1];
    expect(final.payload.sequential_states).toBeDefined();
    expect((final.payload.sequential_states as Record<string, unknown>)[EXECUTE_SLUG]).toBeDefined();

    // No system-role turn in any persisted conversation snapshot.
    const conversations = updateCalls
      .map((c) => c.payload.conversation as Array<{ role: string }> | undefined)
      .filter((c): c is Array<{ role: string }> => !!c);
    const sawSystemTurn = conversations.some((conv) => conv.some((t) => t.role === "system"));
    expect(sawSystemTurn).toBe(false);
  });

  it("rejects an invalid V2 emission and posts a system-role failure turn", async () => {
    // Invalid: override_kind="inherit" must have empty permissives/steps/
    // monitors/branches. This row claims to inherit but supplies a step.
    const invalidResponse = `Here's a broken Auto Cycle:

\`\`\`json
[
  {
    "state_id": "${EXECUTE_SLUG}",
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
          equipment_module: baseEquipmentModule,
          unit: baseUnit,
          allTags: baseTags,
          modes: baseModes,
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

describe("useFdsConversation Stage A state-machine authoring", () => {
  beforeEach(() => {
    updateCalls.length = 0;
    streamMock.mockReset();
  });

  const stageASession = { ...baseSession, em_states: [], em_transitions: [] } as never;

  it("starts in the state_machine stage when the EM has no authored states", () => {
    const { result } = renderHook(
      () =>
        useFdsConversation({
          session: stageASession,
          equipment_module: baseEquipmentModule,
          unit: baseUnit,
          allTags: baseTags,
          modes: baseModes,
        }),
      { wrapper: ({ children }) => wrap(children) },
    );
    expect(result.current.stage).toBe("state_machine");
  });

  it("persists a valid {states,transitions} proposal to em_states / em_transitions", async () => {
    const proposal = `Proposed machine:

\`\`\`json
{
  "states": [
    { "state_id": "aborted", "name": "Aborted", "kind": "static", "allowed_modes": [], "is_safe_state": true },
    { "state_id": "execute", "name": "Execute", "kind": "sequential", "allowed_modes": ["auto"], "is_safe_state": false }
  ],
  "transitions": [
    { "transition_id": "t1", "from_state_id": "aborted", "to_state_id": "execute", "trigger": { "kind": "command", "expr": { "tag": "LFT01_START", "operator": "=", "value": true } }, "guard": [] }
  ]
}
\`\`\``;
    // NOTE: slugs must be PackML and the safe state must be "aborted" —
    // the SP-3b conformance gate hard-blocks anything else (by design).

    streamMock.mockImplementation(async (_body, _signal, onChunk) => {
      onChunk(proposal);
    });

    const { result } = renderHook(
      () =>
        useFdsConversation({
          session: stageASession,
          equipment_module: baseEquipmentModule,
          unit: baseUnit,
          allTags: baseTags,
          modes: baseModes,
        }),
      { wrapper: ({ children }) => wrap(children) },
    );

    await act(async () => {
      await result.current.sendMessage("Here are the states");
    });

    const final = updateCalls[updateCalls.length - 1];
    expect(final.payload.em_states).toBeDefined();
    expect((final.payload.em_states as EmStateV2[]).length).toBe(2);
    expect(final.payload.em_transitions).toBeDefined();
    // No failure turn for a valid proposal.
    const conv = final.payload.conversation as Array<{ role: string }>;
    expect(conv.some((t) => t.role === "system")).toBe(false);
  });

  it("rejects a proposal with no safe state and posts a failure turn", async () => {
    const badProposal = `Proposed machine:

\`\`\`json
{
  "states": [
    { "state_id": "stopped", "name": "Stopped", "kind": "static", "allowed_modes": [], "is_safe_state": false },
    { "state_id": "auto_cycle", "name": "Auto Cycle", "kind": "sequential", "allowed_modes": [], "is_safe_state": false }
  ],
  "transitions": []
}
\`\`\``;

    streamMock.mockImplementation(async (_body, _signal, onChunk) => {
      onChunk(badProposal);
    });

    const { result } = renderHook(
      () =>
        useFdsConversation({
          session: stageASession,
          equipment_module: baseEquipmentModule,
          unit: baseUnit,
          allTags: baseTags,
          modes: baseModes,
        }),
      { wrapper: ({ children }) => wrap(children) },
    );

    await act(async () => {
      await result.current.sendMessage("Here are the states");
    });

    const final = updateCalls[updateCalls.length - 1];
    // Invalid machine not persisted.
    expect(final.payload.em_states).toBeUndefined();
    const conv = final.payload.conversation as Array<{ role: string; content: string }>;
    const sysTurn = conv.find((t) => t.role === "system");
    expect(sysTurn).toBeDefined();
    expect(sysTurn!.content).toMatch(/rejected/i);
  });
});
