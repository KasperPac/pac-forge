import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FbVersionHistory } from "../fb-version-history";
import type { CodeBuilderVersionRow } from "@/types/code-builder";

const version = (over: Partial<CodeBuilderVersionRow>): CodeBuilderVersionRow => ({
  id: "v1", spec_id: "s1", revision: 2, owner_id: "em-1", layer: "em",
  payload: { artifacts: [{ artifact_name: "EM_X", content: "FUNCTION_BLOCK EM_X\nA := 1;\nEND_FUNCTION_BLOCK" }] },
  note: "snapshot A", author: null, created_at: "2026-06-25T10:00:00Z", ...over,
});

const base = {
  fbName: "EM_X",
  currentContent: "FUNCTION_BLOCK EM_X\nA := 2;\nEND_FUNCTION_BLOCK",
  versions: [] as CodeBuilderVersionRow[],
  saving: false,
  restoring: false,
  onSaveVersion: vi.fn(),
  onRestore: vi.fn(),
};

describe("FbVersionHistory", () => {
  it("shows an empty state when there are no versions", () => {
    render(<FbVersionHistory {...base} />);
    expect(screen.getByTestId("version-history")).toHaveTextContent(/no versions/i);
  });

  it("lists versions and diffs the selected one against current", () => {
    render(<FbVersionHistory {...base} versions={[version({})]} />);
    expect(screen.getByText(/snapshot A/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("version-v1"));
    // diff of "A := 1;" vs "A := 2;" → 1 added, 1 removed
    expect(screen.getByTestId("version-diff")).toHaveTextContent(/\+1/);
    expect(screen.getByTestId("version-diff")).toHaveTextContent(/-1/);
  });

  it("fires onRestore for the selected version", () => {
    const onRestore = vi.fn();
    const v = version({});
    render(<FbVersionHistory {...base} versions={[v]} onRestore={onRestore} />);
    fireEvent.click(screen.getByTestId("version-v1"));
    fireEvent.click(screen.getByTestId("restore-v1"));
    expect(onRestore).toHaveBeenCalledWith(v);
  });

  it("fires onSaveVersion", () => {
    const onSaveVersion = vi.fn();
    render(<FbVersionHistory {...base} onSaveVersion={onSaveVersion} />);
    fireEvent.click(screen.getByTestId("save-version"));
    expect(onSaveVersion).toHaveBeenCalled();
  });
});
