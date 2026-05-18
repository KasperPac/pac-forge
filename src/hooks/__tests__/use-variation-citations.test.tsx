// src/hooks/__tests__/use-variation-citations.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import {
  useCitationsForVariation,
  useCreateCitation,
  useDeleteCitation,
} from "@/hooks/use-variation-citations";

let citations: Record<string, unknown>[] = [];
const insertMock = vi.fn();
const deleteEqMock = vi.fn();

let insertShouldReturnUniqueViolation = false;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from(name: string) {
      if (name !== "variation_citations") throw new Error(`unexpected ${name}`);
      return {
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: citations, error: null }),
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          insertMock(row);
          if (insertShouldReturnUniqueViolation) {
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: null,
                    error: {
                      code: "23505",
                      message:
                        "duplicate key value violates unique constraint",
                    },
                  }),
              }),
            };
          }
          const created = { id: "vc-new", ...row };
          citations.push(created);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: created, error: null }),
            }),
          };
        },
        delete: () => ({
          eq: (col: string, val: unknown) => {
            deleteEqMock({ col, val });
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  citations = [];
  insertMock.mockClear();
  deleteEqMock.mockClear();
  insertShouldReturnUniqueViolation = false;
});

describe("useVariationCitations", () => {
  it("lists citations for a variation", async () => {
    citations = [
      {
        id: "vc-1",
        variation_id: "v-1",
        target_section: "scope",
        target_doc_id: "s-1",
        source_kind: "quote_revision",
        source_id: "r-1",
        source_section: "scope",
        source_item_id: "src-1",
        original_text_verbatim: "Original scope",
        created_at: "2026-05-18T00:00:00Z",
      },
    ];
    const { result } = renderHook(() => useCitationsForVariation("v-1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it("creates a citation", async () => {
    const { result } = renderHook(() => useCreateCitation(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        variation_id: "v-1",
        target_section: "scope",
        target_doc_id: "s-2",
        source_kind: "quote_revision",
        source_id: "r-1",
        source_section: "scope",
        source_item_id: "src-2",
        original_text_verbatim: "Cabinet kit",
      });
    });
    expect(insertMock).toHaveBeenCalledOnce();
    const payload = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.target_section).toBe("scope");
    expect(payload.source_kind).toBe("quote_revision");
  });

  it("surfaces a clean error on UNIQUE violation", async () => {
    insertShouldReturnUniqueViolation = true;
    const { result } = renderHook(() => useCreateCitation(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          variation_id: "v-1",
          target_section: "scope",
          target_doc_id: "s-2",
          source_kind: "quote_revision",
          source_id: "r-1",
          source_section: "scope",
          source_item_id: "src-2",
          original_text_verbatim: "x",
        }),
      ).rejects.toThrowError(/already has a citation/i);
    });
  });

  it("deletes a citation", async () => {
    const { result } = renderHook(() => useDeleteCitation(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: "vc-1", variation_id: "v-1" });
    });
    expect(deleteEqMock).toHaveBeenCalledWith({ col: "id", val: "vc-1" });
  });
});
