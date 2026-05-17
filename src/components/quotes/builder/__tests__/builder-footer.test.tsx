import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BuilderFooter } from "@/components/quotes/builder/builder-footer";

describe("BuilderFooter", () => {
  it("formats total as AUD and renders the disabled Issue button", () => {
    render(<BuilderFooter total={12345.6} />);
    expect(screen.getByTestId("builder-total")).toHaveTextContent("$12,345.60");
    const issue = screen.getByRole("button", { name: "Issue" });
    expect(issue).toBeDisabled();
  });

  it("enables Issue and fires onIssue when canIssue is true", async () => {
    const onIssue = vi.fn();
    const user = userEvent.setup();
    render(<BuilderFooter total={0} canIssue onIssue={onIssue} />);
    const issue = screen.getByRole("button", { name: "Issue" });
    expect(issue).not.toBeDisabled();
    await user.click(issue);
    expect(onIssue).toHaveBeenCalledOnce();
  });

  it("shows a custom status string when provided", () => {
    render(<BuilderFooter total={0} status="Custom — saved 3s ago" />);
    expect(screen.getByText(/Custom — saved 3s ago/)).toBeInTheDocument();
  });
});
