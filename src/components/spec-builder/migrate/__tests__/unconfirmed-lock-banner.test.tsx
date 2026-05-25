import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { UnconfirmedLockBanner } from "../unconfirmed-lock-banner";

function renderWithRouter(href: string) {
  return render(
    <MemoryRouter>
      <UnconfirmedLockBanner migrateHref={href} />
    </MemoryRouter>,
  );
}

describe("UnconfirmedLockBanner", () => {
  it("renders the V1-schema warning copy", () => {
    renderWithRouter("/specs/p1/s1/migrate");
    expect(screen.getByText(/V1 schema/i)).toBeInTheDocument();
  });

  it("renders a Migrate link pointing to migrateHref", () => {
    renderWithRouter("/specs/p1/s1/migrate");
    const link = screen.getByRole("link", { name: /migrate/i });
    expect(link).toHaveAttribute("href", "/specs/p1/s1/migrate");
  });
});
