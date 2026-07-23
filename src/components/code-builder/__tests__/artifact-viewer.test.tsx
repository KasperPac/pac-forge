import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ArtifactViewer } from "@/components/code-builder/artifact-viewer";
import type { CodeBuilderArtifactView } from "@/types/code-builder";
import type { EmStateV2, EmTransitionV2 } from "@/types/spec-contract-v2";

// Monaco does not run under jsdom — stub it to a plain element.
vi.mock("@monaco-editor/react", () => ({
  default: ({ value }: { value: string }) => <div data-testid="monaco">{value}</div>,
}));

function view(p: Partial<CodeBuilderArtifactView>): CodeBuilderArtifactView {
  return {
    artifact_name: "X", layer: "device", owner_id: null, owner_name: null,
    type: "FB", filename: "X.scl", folder: "Program blocks", dependencies: [],
    generated_content: "", edited_content: null, status: "pending", drift: false,
    ...p,
  };
}

const states: EmStateV2[] = [
  { state_id: "idle", name: "Idle", kind: "static", allowed_modes: [], is_safe_state: true },
];
const transitions: EmTransitionV2[] = [];

const emFb = view({ artifact_name: "EM_Carriage", type: "FB", layer: "em", owner_id: "em1", owner_name: "Carriage", generated_content: "FUNCTION_BLOCK" });
const emRelated: CodeBuilderArtifactView[] = [
  emFb,
  view({ artifact_name: "EM_Carriage_State", type: "UDT", layer: "em", owner_id: "em1" }),
  view({ artifact_name: "Carriage_CMD", type: "DB", layer: "em", owner_id: "em1" }),
  view({ artifact_name: "EM_Carriage_DB", type: "DB", layer: "em", owner_id: "em1" }),
];

describe("ArtifactViewer — EM artifact", () => {
  it("shows State and hides Flow", () => {
    render(<ArtifactViewer artifact={emFb} related={emRelated} editable={false} onContentChange={() => {}} states={states} transitions={transitions} />);
    expect(screen.getByRole("tab", { name: "State" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Map" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Flow" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "State" }));
    expect(screen.getByTestId("em-state-diagram")).toBeInTheDocument();
  });
});

describe("ArtifactViewer — device artifact", () => {
  it("keeps Flow and has no State/Map", () => {
    const dev = view({ artifact_name: "CM_M01", type: "FB", layer: "device" });
    render(<ArtifactViewer artifact={dev} related={[dev]} editable={false} onContentChange={() => {}} />);
    expect(screen.getByRole("tab", { name: "Flow" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "State" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Map" })).not.toBeInTheDocument();
  });
});
