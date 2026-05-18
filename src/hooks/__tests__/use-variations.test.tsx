// src/hooks/__tests__/use-variations.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import {
  useVariation,
  useVariationsForProject,
  useCreateVariation,
} from "@/hooks/use-variations";

const insertMock = vi.fn();
let variationsList: Record<string, unknown>[] = [];

const tables: Record<string, () => unknown> = {
  variations: () => ({
    select: () => ({
      eq: () => ({
        order: () =>
          Promise.resolve({ data: variationsList, error: null }),
        single: () =>
          Promise.resolve({
            data: variationsList[0] ?? null,
            error: variationsList[0] ? null : { message: "not found" },
          }),
      }),
    }),
    insert: (row: Record<string, unknown>) => {
      insertMock("variations", row);
      const created = { id: "v-new", ...row };
      variationsList.push(created);
      return {
        select: () => ({
          single: () => Promise.resolve({ data: created, error: null }),
        }),
      };
    },
  }),
  doc_commercial_terms: () => ({
    insert: (row: Record<string, unknown>) => {
      insertMock("doc_commercial_terms", row);
      return Promise.resolve({ data: { id: "ct-new", ...row }, error: null });
    },
  }),
  doc_tnc_selections: () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: {
                id: "sel-1",
                parent_type: "quote_revision",
                parent_id: "r-1",
                template_id: "tpl-1",
                omitted_clause_ids: [],
                added_custom_clauses: [],
                created_at: "2026-05-18T00:00:00Z",
                updated_at: "2026-05-18T00:00:00Z",
              },
              error: null,
            }),
        }),
      }),
    }),
    insert: (row: Record<string, unknown>) => {
      insertMock("doc_tnc_selections", row);
      return Promise.resolve({ data: { id: "sel-new", ...row }, error: null });
    },
  }),
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (name: string) => {
      const h = tables[name];
      if (!h) throw new Error(`unhandled table: ${name}`);
      return h();
    },
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "u-1" } } }) },
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
  insertMock.mockClear();
  variationsList = [];
});

describe("useVariations", () => {
  it("lists variations for a project ordered by variation_number", async () => {
    variationsList = [
      { id: "v-1", project_id: "p-1", variation_number: 1, status: "issued" },
      { id: "v-2", project_id: "p-1", variation_number: 2, status: "draft" },
    ];
    const { result } = renderHook(() => useVariationsForProject("p-1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
  });

  it("loads a single variation by id", async () => {
    variationsList = [{ id: "v-1", project_id: "p-1", variation_number: 1 }];
    const { result } = renderHook(() => useVariation("v-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe("v-1");
  });

  it("creates a variation, auto-assigns variation_number, inserts empty commercial terms, and clones T&Cs when requested", async () => {
    variationsList = [
      { id: "v-1", project_id: "p-1", variation_number: 1, status: "issued" },
      { id: "v-2", project_id: "p-1", variation_number: 2, status: "draft" },
    ];
    const { result } = renderHook(() => useCreateVariation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        project_id: "p-1",
        clone_tnc_from_rev_id: "r-1",
      });
    });

    const variationInsert = insertMock.mock.calls.find(
      (c) => c[0] === "variations",
    )?.[1] as Record<string, unknown>;
    expect(variationInsert.project_id).toBe("p-1");
    expect(variationInsert.variation_number).toBe(3);
    expect(variationInsert.status).toBe("draft");

    const ctInsert = insertMock.mock.calls.find(
      (c) => c[0] === "doc_commercial_terms",
    )?.[1] as Record<string, unknown>;
    expect(ctInsert.parent_type).toBe("variation");
    expect(ctInsert.parent_id).toBe("v-new");

    const tncInsert = insertMock.mock.calls.find(
      (c) => c[0] === "doc_tnc_selections",
    )?.[1] as Record<string, unknown>;
    expect(tncInsert.parent_type).toBe("variation");
    expect(tncInsert.parent_id).toBe("v-new");
    expect(tncInsert.template_id).toBe("tpl-1");
  });
});
