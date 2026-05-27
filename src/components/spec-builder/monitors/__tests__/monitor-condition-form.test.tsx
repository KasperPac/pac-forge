// src/components/spec-builder/monitors/__tests__/monitor-condition-form.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CompletionCriterion } from "@/types/spec-contract-v2";
import { MonitorConditionForm } from "../monitor-condition-form";

describe("MonitorConditionForm", () => {
  it("renders tag_equals tag + value fields", () => {
    const onChange = vi.fn();
    render(
      <MonitorConditionForm
        condition={{ kind: "tag_equals", tag: "E_STOP", value: false }}
        availableTags={["E_STOP", "FB_RUN"]}
        onChange={onChange}
      />,
    );
    expect(screen.getByDisplayValue("E_STOP")).toBeInTheDocument();
    // boolean value renders as a "True"/"False" select
    expect(screen.getByRole("combobox", { name: /value/i })).toBeInTheDocument();
  });

  it("switches kind to tag_compare and resets fields", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MonitorConditionForm
        condition={{ kind: "tag_equals", tag: "TEMP", value: true }}
        availableTags={["TEMP"]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: /kind/i }));
    await user.click(screen.getByRole("option", { name: /tag_compare/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "tag_compare", tag: "TEMP", op: "==", value: 0 }),
    );
  });

  it("switches kind to expression and renders textarea + referenced_tags chips", () => {
    const onChange = vi.fn();
    render(
      <MonitorConditionForm
        condition={{ kind: "expression", text: "X AND Y", referenced_tags: ["X", "Y"] }}
        availableTags={["X", "Y", "Z"]}
        onChange={onChange}
      />,
    );
    expect(screen.getByDisplayValue("X AND Y")).toBeInTheDocument();
    // chips for referenced tags
    expect(screen.getByText("X")).toBeInTheDocument();
    expect(screen.getByText("Y")).toBeInTheDocument();
    // user edits the textarea (fireEvent.change sends the full value at once,
    // which is the correct pattern for controlled components in RTL)
    const ta = screen.getByDisplayValue("X AND Y");
    fireEvent.change(ta, { target: { value: "Z" } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "expression", text: "Z" }),
    );
  });

  it("within_ms input round-trips", () => {
    const onChange = vi.fn();
    const initial: CompletionCriterion = { kind: "tag_equals", tag: "X", value: true };
    render(
      <MonitorConditionForm condition={initial} availableTags={["X"]} onChange={onChange} />,
    );
    const input = screen.getByLabelText(/timeout/i);
    // fireEvent.change sends the full value at once — correct for number inputs
    // in controlled components where the prop doesn't update between keystrokes
    fireEvent.change(input, { target: { value: "5000" } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ within_ms: 5000 }),
    );
  });

  it("tag_compare op selection updates condition", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MonitorConditionForm
        condition={{ kind: "tag_compare", tag: "PRES", op: "==", value: 0 }}
        availableTags={["PRES"]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: /operator/i }));
    await user.click(screen.getByRole("option", { name: ">" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ op: ">" }),
    );
  });
});
