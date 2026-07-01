import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defaultFbStates } from "@/lib/spec-builder/packml-states";
import type { FbTemplate } from "@/types/fb-template";

const mutate = vi.fn();
vi.mock("@/hooks/use-save-fb-interface", () => ({
  useSaveFbInterface: () => ({ mutate, isPending: false }),
}));

// Imported after the mock so the component picks up the mocked hook.
import { FbStatesGrid } from "../fb-states-grid";

function emTemplate(overrides: Partial<FbTemplate> = {}): FbTemplate {
  return {
    id: "t1", name: "EM_CarriageDrive", device_category: "cat", plc_brand: "SIEMENS_TIA",
    description: null, ai_summary: null, diagram_chart: null, diagram_generated_at: null,
    flow_diagram_json: null, flow_diagram_generated_at: null, version: 1, tags: [],
    source: "custom", library_name: null, is_enabled: true, is_equipment_module: true,
    documentation: null, hmi_faceplate_type: null, interface_contract: null,
    created_by: null, updated_at: "", created_at: "",
    blocks: [{
      id: "b1", template_id: "t1", block_name: "EM_CarriageDrive", block_type: "FB",
      scl_code: 'FUNCTION_BLOCK "EM_CarriageDrive"\nVAR_INPUT\n iStart : Bool;\nEND_VAR\nBEGIN\nEND_FUNCTION_BLOCK',
      block_xml: null, programming_language: "SCL", sort_order: 0, created_at: "",
    }],
    ...overrides,
  };
}

beforeEach(() => mutate.mockClear());

describe("FbStatesGrid", () => {
  it("declares all 17 PackML states, aborted safe, needs-review when no contract", () => {
    render(<FbStatesGrid template={emTemplate()} />);
    const impl = screen.getAllByTestId(/^impl-/);
    expect(impl).toHaveLength(17);
    expect(impl.every((c) => (c as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByText("Execute")).toBeInTheDocument();
    expect(screen.getByText(/needs review/i)).toBeInTheDocument();
    expect((screen.getByTestId("safe-aborted") as HTMLInputElement).checked).toBe(true);
  });

  it("renders nothing for a non-equipment-module template", () => {
    const { container } = render(<FbStatesGrid template={emTemplate({ is_equipment_module: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("save excludes an unticked state and preserves pins", () => {
    const template = emTemplate({
      interface_contract: {
        block_name: "EM_CarriageDrive",
        pins: [{ name: "iStart", scl_type: "Bool", direction: "input", role: "cmd", default_binding: "hmi", exposed: false, description: "" }],
        states: defaultFbStates(),
        reviewed: false,
        generated_at: "2026-01-01T00:00:00Z",
      },
    });
    render(<FbStatesGrid template={template} />);
    fireEvent.click(screen.getByTestId("impl-held"));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(mutate).toHaveBeenCalledTimes(1);
    const arg = mutate.mock.calls[0][0];
    expect(arg.templateId).toBe("t1");
    expect(arg.contract.states).toHaveLength(16);
    expect(arg.contract.states.map((s: { slug: string }) => s.slug)).not.toContain("held");
    expect(arg.contract.pins).toHaveLength(1);
    expect(arg.contract.pins[0].name).toBe("iStart");
    expect(arg.contract.reviewed).toBe(true);
  });

  it("marks exactly one state safe when the safe marker changes", () => {
    render(<FbStatesGrid template={emTemplate()} />);
    fireEvent.click(screen.getByTestId("safe-stopped"));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    const arg = mutate.mock.calls[0][0];
    const safe = arg.contract.states.filter((s: { is_safe?: boolean }) => s.is_safe);
    expect(safe).toHaveLength(1);
    expect(safe[0].slug).toBe("stopped");
  });

  it("moves the safe marker to a declared state when the safe row is unticked", () => {
    render(<FbStatesGrid template={emTemplate()} />);
    // make 'stopped' the safe state, then un-declare it
    fireEvent.click(screen.getByTestId("safe-stopped"));
    fireEvent.click(screen.getByTestId("impl-stopped")); // untick the now-safe row
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    const arg = mutate.mock.calls[0][0];
    const safe = arg.contract.states.filter((s: { is_safe?: boolean }) => s.is_safe);
    expect(safe).toHaveLength(1);
    expect(safe[0].slug).not.toBe("stopped");
    // canonical safe (aborted) is still declared, so it should win
    expect(safe[0].slug).toBe("aborted");
  });
});
