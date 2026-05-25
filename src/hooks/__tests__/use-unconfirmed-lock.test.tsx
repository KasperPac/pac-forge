import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/hooks/use-spec-contract", () => ({
  useSpecContract: (id: string) => {
    if (id === "confirmed-id") {
      return {
        data: { confirmation_status: "confirmed" },
        isLoading: false,
        isError: false,
      };
    }
    if (id === "unconfirmed-id") {
      return {
        data: { confirmation_status: "unconfirmed" },
        isLoading: false,
        isError: false,
      };
    }
    return { data: undefined, isLoading: true, isError: false };
  },
}));

import { useUnconfirmedLock } from "../use-unconfirmed-lock";

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

describe("useUnconfirmedLock", () => {
  it("returns isUnconfirmed=true for unconfirmed projects", async () => {
    const { result } = renderHook(
      () => useUnconfirmedLock("proj-1", "unconfirmed-id"),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isUnconfirmed).toBe(true);
    expect(result.current.migrateHref).toBe("/specs/proj-1/unconfirmed-id/migrate");
  });

  it("returns isUnconfirmed=false for confirmed projects", async () => {
    const { result } = renderHook(
      () => useUnconfirmedLock("proj-1", "confirmed-id"),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isUnconfirmed).toBe(false);
  });
});
