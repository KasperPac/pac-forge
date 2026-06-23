import type { ReactElement } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CodeBuilderPage from "../code-builder";

const mockSpec = vi.fn();
const mockCb = vi.fn();

vi.mock("@/hooks/use-spec-projects", () => ({ useSpecProject: () => mockSpec() }));
vi.mock("@/hooks/use-code-builder", () => ({ useCodeBuilder: () => mockCb() }));
vi.mock("react-router", async (orig) => {
  const actual = await orig<typeof import("react-router")>();
  return { ...actual, useParams: () => ({ projectId: "p1", specId: "s1" }) };
});

function wrap(ui: ReactElement) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CodeBuilderPage", () => {
  beforeEach(() => {
    mockCb.mockReturnValue({
      artifacts: { data: [] },
      approve: { mutate: vi.fn(), isPending: false },
      saveEdit: { mutate: vi.fn(), isPending: false },
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
});
