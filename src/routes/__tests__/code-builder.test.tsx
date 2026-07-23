import type { ReactElement } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CodeBuilderPage from "../code-builder";

const mockSpec = vi.fn();
const mockCb = vi.fn();

vi.mock("@/hooks/use-spec-projects", () => ({ useSpecProject: () => mockSpec() }));
vi.mock("@/hooks/use-code-builder", () => ({ useCodeBuilder: () => mockCb() }));
vi.mock("@/hooks/use-code-builder-versions", () => ({
  useCodeBuilderVersions: () => ({
    versions: { data: [] },
    saveVersion: { mutate: vi.fn(), isPending: false },
    restoreVersion: { mutate: vi.fn(), isPending: false },
  }),
}));
vi.mock("@/hooks/use-em-standards-review", () => ({
  useEmStandardsReview: () => ({ review: vi.fn(), loading: false, error: null }),
}));
vi.mock("react-router", async (orig) => {
  const actual = await orig<typeof import("react-router")>();
  return { ...actual, useParams: () => ({ projectId: "p1", specId: "s1" }) };
});
// Monaco does not run under jsdom.
vi.mock("@monaco-editor/react", () => ({
  default: ({ value }: { value: string }) => <div data-testid="monaco">{value}</div>,
}));

function wrap(ui: ReactElement) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function emView(p: Record<string, unknown>) {
  return {
    artifact_name: "X", layer: "em", owner_id: "em1", owner_name: "Carriage",
    type: "FB", filename: "X.scl", folder: "Program blocks", dependencies: [],
    generated_content: "", edited_content: null, status: "pending", drift: false,
    regionDrift: [], warnings: [], acknowledged_warnings: [], review_status: null, review_findings: [],
    ...p,
  };
}

describe("CodeBuilderPage", () => {
  beforeEach(() => {
    mockCb.mockReturnValue({
      artifacts: { data: [emView({ artifact_name: "EM_Carriage" })] },
      approve: { mutate: vi.fn(), isPending: false },
      saveEdit: { mutate: vi.fn(), isPending: false },
      acknowledgeWarning: { mutate: vi.fn(), isPending: false },
      saveReview: { mutate: vi.fn(), isPending: false },
      revision: 2,
      unitGroups: [{ unitId: "u1", unitName: "Carriage Unit", emIds: ["em1"] }],
      emById: { em1: { emId: "em1", emName: "Carriage", states: [], transitions: [] } },
    });
  });

  it("renders the locked state for an unconfirmed spec", () => {
    mockSpec.mockReturnValue({ data: { confirmation_status: "unconfirmed", doc_code: "DOC" } });
    wrap(<CodeBuilderPage />);
    expect(screen.getByTestId("code-builder-locked")).toBeInTheDocument();
  });

  it("renders the stepper + panes for a confirmed spec", () => {
    mockSpec.mockReturnValue({ data: { confirmation_status: "confirmed", doc_code: "DOC" } });
    wrap(<CodeBuilderPage />);
    expect(screen.getByTestId("code-builder-page")).toBeInTheDocument();
    expect(screen.getByTestId("builder-stepper")).toBeInTheDocument();
  });

  it("switches to the EM layer and groups EM rows under their Unit", () => {
    mockSpec.mockReturnValue({ data: { confirmation_status: "confirmed", doc_code: "DOC" } });
    wrap(<CodeBuilderPage />);
    // device layer initially → no Unit header
    expect(screen.queryByText("Carriage Unit")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("step-em"));
    expect(screen.getByText("Carriage Unit")).toBeInTheDocument();
    expect(screen.getByText("Carriage")).toBeInTheDocument();
  });

  it("renders quality gates and blocks Approve for an EM FB with unacknowledged warnings", async () => {
    // SCL that trips a real safety rule (coil driven TRUE) → gate.blocked.
    const trippingScl = [
      "FUNCTION_BLOCK EM_Pump",
      "BEGIN",
      "VAR Input : Motor_Pump; END_VAR",
      "VAR Output : BOOL; END_VAR",
      "Motor_Pump.Run := TRUE;",
      "END_FUNCTION_BLOCK",
    ].join("\n");
    mockSpec.mockReturnValue({ data: { confirmation_status: "confirmed", doc_code: "DOC" } });
    mockCb.mockReturnValue({
      artifacts: {
        data: [
          emView({
            artifact_name: "EM_Pump", owner_id: "emPump", owner_name: "EM_Pump",
            generated_content: trippingScl, acknowledged_warnings: [],
          }),
        ],
      },
      approve: { mutate: vi.fn(), isPending: false },
      saveEdit: { mutate: vi.fn(), isPending: false },
      acknowledgeWarning: { mutate: vi.fn(), isPending: false },
      saveReview: { mutate: vi.fn(), isPending: false },
      revision: 2,
      unitGroups: [{ unitId: "u1", unitName: "Pump Unit", emIds: ["emPump"] }],
      emById: { emPump: { emId: "emPump", emName: "EM_Pump", states: [], transitions: [] } },
    });
    wrap(<CodeBuilderPage />);
    fireEvent.click(screen.getByTestId("step-em"));
    fireEvent.click(await screen.findByText("EM_Pump"));
    expect(screen.getByTestId("fb-quality-gates")).toBeInTheDocument();
    const approveBtn = screen.getByRole("button", { name: /approve/i });
    expect(approveBtn).toBeDisabled();
  });

  it("renders an artifact-scoped warning (e.g. custom-region carry-over) and acknowledges it via acknowledgeWarning", async () => {
    // Not an EM FB — a device-layer artifact carrying a compile-time
    // advisory (mirrors an FC_*_Process carry-over warning), to prove this
    // surface is NOT gated to the EM safety gate.
    const ackMutate = vi.fn();
    mockSpec.mockReturnValue({ data: { confirmation_status: "confirmed", doc_code: "DOC" } });
    mockCb.mockReturnValue({
      artifacts: {
        data: [
          emView({
            artifact_name: "FC_Process_Unit_Process", layer: "device", type: "FC",
            owner_id: null, owner_name: null,
            warnings: ["custom-region markers missing/mangled in the previous edit — region NOT carried over"],
            acknowledged_warnings: [],
          }),
        ],
      },
      approve: { mutate: vi.fn(), isPending: false },
      saveEdit: { mutate: vi.fn(), isPending: false },
      acknowledgeWarning: { mutate: ackMutate, isPending: false },
      saveReview: { mutate: vi.fn(), isPending: false },
      revision: 2,
      unitGroups: [],
      emById: {},
    });
    wrap(<CodeBuilderPage />);
    fireEvent.click(await screen.findByText("FC_Process_Unit_Process"));
    expect(screen.getByTestId("artifact-warnings")).toBeInTheDocument();
    expect(screen.getByText(/region NOT carried over/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId(
      "ack-artifact-warning-custom-region markers missing/mangled in the previous edit — region NOT carried over",
    ));
    expect(ackMutate).toHaveBeenCalledWith({
      artifactName: "FC_Process_Unit_Process",
      warningKeys: ["custom-region markers missing/mangled in the previous edit — region NOT carried over"],
    });
  });
});
