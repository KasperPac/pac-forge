// src/components/fb-library/__tests__/fb-interface-grid.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FbInterfaceGrid } from "../fb-interface-grid";
import type { FbTemplate } from "@/types/fb-template";

vi.mock("@/lib/supabase", () => ({ supabase: { from: () => ({ update: () => ({ eq: () => ({ error: null }) }) }) } }));

const template = {
  id: "t1", name: "Motor", blocks: [
    { id: "b1", template_id: "t1", block_name: "CM_Motor", block_type: "FB",
      scl_code: "FUNCTION_BLOCK\nVAR_INPUT\n Run : Bool; // start\nEND_VAR\nVAR_OUTPUT\n Fault : Bool;\nEND_VAR\nBEGIN\nEND_FUNCTION_BLOCK",
      block_xml: null, programming_language: "SCL", sort_order: 0, created_at: "" },
  ],
  interface_contract: null,
} as unknown as FbTemplate;

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("FbInterfaceGrid", () => {
  it("seeds rows from SCL and shows the needs-review badge when no contract", () => {
    wrap(<FbInterfaceGrid template={template} />);
    expect(screen.getByText("Run")).toBeInTheDocument();
    expect(screen.getByText("Fault")).toBeInTheDocument();
    expect(screen.getByText(/needs review/i)).toBeInTheDocument();
  });
});
