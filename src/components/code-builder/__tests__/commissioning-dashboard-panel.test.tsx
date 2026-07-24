import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommissioningDashboardPanel } from "@/components/code-builder/commissioning-dashboard-panel";
import { useFbTemplates } from "@/hooks/use-fb-templates";

vi.mock("@/hooks/use-generate-dashboard", () => ({
  useGenerateDashboard: () => ({ generate: vi.fn(), isGenerating: false, warnings: ["w1"] }),
}));

// The panel guards Generate against firing before FB templates have loaded
// (Task 8 review finding: useGenerateDashboard compiles against `[]` if
// templates aren't ready yet, silently producing a wrong bundle). Mock the
// hook directly so each test controls the loading/ready state explicitly.
vi.mock("@/hooks/use-fb-templates", () => ({
  useFbTemplates: vi.fn(),
}));

const mockedUseFbTemplates = vi.mocked(useFbTemplates);

describe("CommissioningDashboardPanel", () => {
  beforeEach(() => {
    mockedUseFbTemplates.mockReturnValue({ data: [] } as unknown as ReturnType<typeof useFbTemplates>);
  });

  it("renders the generate button and warnings", () => {
    render(<CommissioningDashboardPanel specId="s1" projectName="M" revision={1} />);
    expect(screen.getByRole("button", { name: /generate/i })).toBeTruthy();
    expect(screen.getByText("w1")).toBeTruthy();
  });

  it("disables Generate and shows a hint while FB templates are still loading", () => {
    mockedUseFbTemplates.mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useFbTemplates>);
    render(<CommissioningDashboardPanel specId="s1" projectName="M" revision={1} />);
    expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled();
    expect(screen.getByText(/loading templates/i)).toBeTruthy();
  });

  it("enables Generate once FB templates have loaded", () => {
    render(<CommissioningDashboardPanel specId="s1" projectName="M" revision={1} />);
    expect(screen.getByRole("button", { name: /generate/i })).not.toBeDisabled();
    expect(screen.queryByText(/loading templates/i)).toBeNull();
  });
});
