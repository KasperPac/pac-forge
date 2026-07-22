import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ControlModuleList } from "@/components/code-builder/control-module-list";
import type { CodeBuilderArtifactView } from "@/types/code-builder";
import type { CodeBuilderUnitGroup } from "@/lib/spec-builder/code-builder-em-ui-model";

function view(p: Partial<CodeBuilderArtifactView>): CodeBuilderArtifactView {
  return {
    artifact_name: "X", layer: "device", owner_id: null, owner_name: null,
    type: "FB", filename: "X.scl", folder: "Program blocks", dependencies: [],
    generated_content: "", edited_content: null, status: "pending", drift: false,
    ...p,
  };
}

const emViews: CodeBuilderArtifactView[] = [
  view({ artifact_name: "EM_Carriage", type: "FB", layer: "em", owner_id: "em1", owner_name: "Carriage" }),
  view({ artifact_name: "EM_Carriage_DB", type: "DB", layer: "em", owner_id: "em1", owner_name: "Carriage" }),
  view({ artifact_name: "EM_Clamp", type: "FB", layer: "em", owner_id: "em2", owner_name: "Clamp", drift: true }),
];
const unitGroups: CodeBuilderUnitGroup[] = [
  { unitId: "u1", unitName: "Carriage Unit", emIds: ["em1", "em2"] },
];

describe("ControlModuleList — device layer", () => {
  it("renders flat device owner rows", () => {
    const views = [view({ artifact_name: "CM_M01", layer: "device", owner_id: "d1", owner_name: "M01" })];
    render(<ControlModuleList artifacts={views} layer="device" selected={null} onSelect={() => {}} />);
    expect(screen.getByText("M01")).toBeInTheDocument();
  });
});

describe("ControlModuleList — device layer empty state", () => {
  it("explains WHY the device layer is empty for fully-synthesized projects", () => {
    render(<ControlModuleList artifacts={[]} layer="device" selected={null} onSelect={() => {}} />);
    // not a bare "No artifacts." — must point the user at the EM step and the
    // library-assignment path that produces standalone device FBs
    expect(screen.getByText(/inlined into their EM blocks/i)).toBeInTheDocument();
    expect(screen.getByText(/EM step/i)).toBeInTheDocument();
  });
});

describe("ControlModuleList — EM layer", () => {
  it("groups EM rows under a collapsible Unit header", () => {
    render(
      <ControlModuleList
        artifacts={emViews} layer="em" unitGroups={unitGroups}
        selected={null} onSelect={() => {}}
      />,
    );
    expect(screen.getByText("Carriage Unit")).toBeInTheDocument();
    expect(screen.getByText("Carriage")).toBeInTheDocument();
    expect(screen.getByText("Clamp")).toBeInTheDocument();

    // collapse the unit → EM rows disappear
    fireEvent.click(screen.getByText("Carriage Unit"));
    expect(screen.queryByText("Carriage")).not.toBeInTheDocument();
  });
});
