// src/components/code-builder/__tests__/send-to-tia-panel.test.tsx
//
// Fresh-project build UI (G9-W9): the guard, the form, and the
// already-existed outcome. The open-project reimport path is untouched.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SendToTiaPanel } from "../send-to-tia-panel";
import type { CodeSendPlan } from "@/hooks/use-send-code-to-tia";
import type { ProvisionStep } from "@/lib/tia-provision-progress";
import type { ProvisionProjectResponse } from "@/lib/tia-bridge-contract";

const basePlan: CodeSendPlan = {
  sources: { EM_Belt: "FUNCTION_BLOCK\nEND_FUNCTION_BLOCK\n", Main: "ORGANIZATION_BLOCK\nEND_ORGANIZATION_BLOCK\n" },
  folders: {},
  countsByType: { FB: 1, OB: 1 },
  editedBlocks: [],
  ioTags: [],
  provision: { cpuOrderNumber: "6ES7 516-3AN02-0AB0/V2.9", ioModules: [], missingOrderNumbers: [] },
  warnings: [],
};

const hookState = {
  buildPlan: vi.fn(async () => basePlan),
  plan: basePlan as CodeSendPlan | null,
  planning: false,
  error: null as string | null,
  send: vi.fn(),
  sending: false,
  tagResult: null,
  compileResult: null,
  sendError: null,
  provisionFresh: vi.fn(async () => null),
  provisioning: false,
  provisionSteps: [] as ProvisionStep[],
  // Must be the real response type — the panel reads `compile_result` off it.
  provisionResult: null as ProvisionProjectResponse | null,
};

vi.mock("@/hooks/use-send-code-to-tia", () => ({
  useSendCodeToTia: () => hookState,
}));

beforeEach(() => {
  hookState.plan = basePlan;
  hookState.provisionResult = null;
  hookState.provisionFresh.mockClear();
  localStorage.clear();
});

function open(defaultProjectName = "SRL-1427") {
  render(<SendToTiaPanel specId="spec-1" revision={1} defaultProjectName={defaultProjectName} />);
  fireEvent.click(screen.getByRole("button", { name: /send to tia/i }));
}

describe("SendToTiaPanel fresh build", () => {
  it("passes the folder, name and plan to provisionFresh", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /create new project/i }));
    fireEvent.change(screen.getByLabelText(/folder/i), { target: { value: "C:\\TIA" } });
    expect(screen.getByLabelText(/project name/i)).toHaveValue("SRL-1427");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^build project$/i }));
    });
    expect(hookState.provisionFresh).toHaveBeenCalledWith(basePlan, {
      projectPath: "C:\\TIA",
      projectName: "SRL-1427",
    });
  });

  it("blocks the fresh build when no CPU is resolvable", () => {
    hookState.plan = { ...basePlan, provision: { ...basePlan.provision, cpuOrderNumber: undefined } };
    open();
    fireEvent.click(screen.getByRole("button", { name: /create new project/i }));
    expect(screen.getByRole("button", { name: /^build project$/i })).toBeDisabled();
    expect(screen.getByText(/author a cpu in the skeleton wizard/i)).toBeInTheDocument();
  });

  it("warns and redirects the user when the project already existed", () => {
    hookState.provisionResult = {
      success: true,
      created: false,
      project_file_path: "C:\\TIA\\M1\\M1.ap20",
      message: "Opened existing project: M1",
      warnings: ["Project already existed — program not imported."],
    };
    open();
    fireEvent.click(screen.getByRole("button", { name: /create new project/i }));
    expect(screen.getByText(/program was not imported/i)).toBeInTheDocument();
  });
});
