import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { UnconfirmedLockBanner } from "../unconfirmed-lock-banner";

describe("UnconfirmedLockBanner", () => {
  it("renders the unconfirmed warning copy", () => {
    render(<UnconfirmedLockBanner />);
    expect(screen.getByText(/unconfirmed/i)).toBeInTheDocument();
  });

  it("does not render a Migrate CTA (migrate route retired)", () => {
    render(<UnconfirmedLockBanner />);
    expect(screen.queryByRole("link", { name: /migrate/i })).toBeNull();
  });
});
