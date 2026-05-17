import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { useCustomers } from "@/hooks/use-customers";

const orderMock = vi.fn(() =>
  Promise.resolve({
    data: [
      {
        id: "1",
        name: "Acme",
        display_code: "ACM",
        dropbox_root_path: null,
        created_at: "2026-05-15T00:00:00Z",
        updated_at: "2026-05-15T00:00:00Z",
        created_by: null,
      },
    ],
    error: null,
  })
);
const selectMock = vi.fn(() => ({ order: orderMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: { id: "u1" } } })),
    },
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useCustomers", () => {
  it("queries customers ordered by name", async () => {
    const { result } = renderHook(() => useCustomers(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fromMock).toHaveBeenCalledWith("customers");
    expect(selectMock).toHaveBeenCalledWith("*");
    expect(orderMock).toHaveBeenCalledWith("name");
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].name).toBe("Acme");
  });
});
