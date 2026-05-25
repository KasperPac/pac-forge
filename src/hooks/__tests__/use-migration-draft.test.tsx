import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const updateMock = vi.fn();
const selectMock = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (_table: string) => ({
      select: (cols: string) => {
        selectMock(cols);
        return {
          eq: () => ({
            single: () =>
              Promise.resolve({ data: { migration_draft: null }, error: null }),
          }),
        };
      },
      update: (payload: unknown) => {
        updateMock(payload);
        return {
          eq: () => Promise.resolve({ data: null, error: null }),
        };
      },
    }),
  },
}));

import { useMigrationDraft } from "../use-migration-draft";

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

describe("useMigrationDraft", () => {
  beforeEach(() => {
    updateMock.mockReset();
    selectMock.mockReset();
  });

  it("reads the draft on mount", async () => {
    const { result } = renderHook(
      () => useMigrationDraft("00000000-0000-0000-0000-000000000000"),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(selectMock).toHaveBeenCalledWith("migration_draft");
  });

  it("writes via saveDraft (debounce coalesces calls)", async () => {
    const { result } = renderHook(
      () => useMigrationDraft("00000000-0000-0000-0000-000000000000"),
      { wrapper: ({ children }) => wrap(children) },
    );
    // Wait for the initial query to settle on real timers — fake timers stall
    // React Query's setTimeout-driven scheduler and waitFor's polling.
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    vi.useFakeTimers();
    try {
      act(() => {
        result.current.saveDraft({ modes: { rows: [], tabComplete: false } });
        result.current.saveDraft({ modes: { rows: [{ mode_id: "auto", name: "Auto", is_default: true }], tabComplete: true } });
      });

      // Flush debounce window.
      act(() => {
        vi.advanceTimersByTime(400);
      });
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock.mock.calls[0][0]).toMatchObject({
      migration_draft: expect.objectContaining({
        modes: expect.objectContaining({ tabComplete: true }),
      }),
    });
  });

  it("clearDraft writes null to the column", async () => {
    const { result } = renderHook(
      () => useMigrationDraft("00000000-0000-0000-0000-000000000000"),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.clearDraft();
    });

    expect(updateMock).toHaveBeenCalledWith({ migration_draft: null });
  });
});
