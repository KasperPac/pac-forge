import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SectionNavigator } from "@/components/quotes/builder/section-navigator";
import {
  BUILDER_SECTIONS,
  BUILDER_SECTION_LABELS,
  useQuoteBuilderStore,
} from "@/stores/quote-builder-store";

describe("SectionNavigator", () => {
  beforeEach(() => {
    useQuoteBuilderStore.setState({ activeSection: "scope", isDirty: false });
  });

  it("renders one button per builder section in canonical order", () => {
    render(<SectionNavigator />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(BUILDER_SECTIONS.length);
    BUILDER_SECTIONS.forEach((s, i) => {
      expect(buttons[i]).toHaveTextContent(BUILDER_SECTION_LABELS[s]);
    });
  });

  it("marks the active section with aria-current=page", () => {
    useQuoteBuilderStore.setState({ activeSection: "tnc" });
    render(<SectionNavigator />);
    const active = screen.getByRole("button", { current: "page" });
    expect(active).toHaveTextContent(BUILDER_SECTION_LABELS.tnc);
  });

  it("clicking a section updates the store", async () => {
    const user = userEvent.setup();
    render(<SectionNavigator />);
    await user.click(screen.getByRole("button", { name: "Pricing" }));
    expect(useQuoteBuilderStore.getState().activeSection).toBe("line-items");
  });
});
