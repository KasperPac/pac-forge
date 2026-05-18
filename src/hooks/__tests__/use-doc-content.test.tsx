import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import {
  scopeItems,
  lineItems,
  useUpsertCommercialTerms,
} from "@/hooks/use-doc-content";

type MockRow = Record<string, unknown>;

const insertCalls: Record<string, MockRow[]> = {};
const upsertCalls: Record<string, MockRow[]> = {};
const fromCallOrder: string[] = [];

function reset() {
  for (const k of Object.keys(insertCalls)) delete insertCalls[k];
  for (const k of Object.keys(upsertCalls)) delete upsertCalls[k];
  fromCallOrder.length = 0;
}

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    insert: (row: MockRow) => {
      insertCalls[table] = insertCalls[table] ?? [];
      insertCalls[table].push(row);
      return builder;
    },
    upsert: (row: MockRow) => {
      upsertCalls[table] = upsertCalls[table] ?? [];
      upsertCalls[table].push(row);
      return builder;
    },
    update: () => builder,
    delete: () => builder,
    single: () =>
      Promise.resolve({
        data: { id: "new-row-id", ...((insertCalls[table]?.[0] ?? upsertCalls[table]?.[0]) as MockRow) },
        error: null,
      }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve, reject),
  });
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      fromCallOrder.push(table);
      return makeBuilder(table);
    },
    auth: {
      getUser: vi.fn(() =>
        Promise.resolve({ data: { user: { id: "u1" } } })
      ),
    },
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("use-doc-content factory", () => {
  beforeEach(reset);

  it("scopeItems.useCreate inserts with parent_type and parent_id", async () => {
    const { result } = renderHook(() => scopeItems.useCreate(), { wrapper });
    result.current.mutate({
      parent_type: "quote_revision",
      parent_id: "rev-1",
      title: "Scope A",
      ordering: 1,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(insertCalls.doc_scope_items?.[0]).toMatchObject({
      parent_type: "quote_revision",
      parent_id: "rev-1",
      title: "Scope A",
      ordering: 1,
    });
  });

  it("lineItems.useCreate inserts to doc_line_items with parent ref", async () => {
    const { result } = renderHook(() => lineItems.useCreate(), { wrapper });
    result.current.mutate({
      parent_type: "variation",
      parent_id: "var-1",
      category: "labour",
      description: "Engineering",
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(insertCalls.doc_line_items?.[0]).toMatchObject({
      parent_type: "variation",
      parent_id: "var-1",
      category: "labour",
      description: "Engineering",
    });
  });

  it("useUpsertCommercialTerms upserts to doc_commercial_terms", async () => {
    const { result } = renderHook(() => useUpsertCommercialTerms(), { wrapper });
    result.current.mutate({
      parent_type: "quote_revision",
      parent_id: "rev-1",
      payment_schedule: "30 days",
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(upsertCalls.doc_commercial_terms?.[0]).toMatchObject({
      parent_type: "quote_revision",
      parent_id: "rev-1",
      payment_schedule: "30 days",
    });
  });

  it("delete with parent_type='variation' first deletes the matching citation", async () => {
    const { result } = renderHook(() => scopeItems.useDelete(), { wrapper });
    result.current.mutate({
      id: "scope-row-id",
      ref: { parent_type: "variation", parent_id: "var-1" },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // variation_citations must be accessed before doc_scope_items
    const citIdx = fromCallOrder.indexOf("variation_citations");
    const docIdx = fromCallOrder.indexOf("doc_scope_items");
    expect(citIdx).toBeGreaterThanOrEqual(0);
    expect(docIdx).toBeGreaterThanOrEqual(0);
    expect(citIdx).toBeLessThan(docIdx);
  });

  it("delete with parent_type='quote_revision' does NOT touch variation_citations", async () => {
    const { result } = renderHook(() => scopeItems.useDelete(), { wrapper });
    result.current.mutate({
      id: "scope-row-id",
      ref: { parent_type: "quote_revision", parent_id: "rev-1" },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fromCallOrder).not.toContain("variation_citations");
  });
});
