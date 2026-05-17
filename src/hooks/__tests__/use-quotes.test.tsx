import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { useCloneRevisionAsDraft } from "@/hooks/use-quotes";

type MockRow = Record<string, unknown>;

const insertCalls: Record<string, MockRow[]> = {};

let revisionFetch: { data: MockRow | null; error: unknown } = {
  data: null,
  error: null,
};
let newRevisionInsert: { data: MockRow | null; error: unknown } = {
  data: null,
  error: null,
};
let polyRows: Record<string, MockRow[]> = {};
let commercialTermsRow: MockRow | null = null;
let tncSelRow: MockRow | null = null;

function resetMocks() {
  for (const k of Object.keys(insertCalls)) delete insertCalls[k];
  revisionFetch = {
    data: {
      id: "rev-1",
      quote_id: "q-1",
      rev_number: 1,
      status: "issued",
      summary: null,
    },
    error: null,
  };
  newRevisionInsert = {
    data: {
      id: "rev-2",
      quote_id: "q-1",
      rev_number: 2,
      status: "draft",
      summary: null,
    },
    error: null,
  };
  polyRows = {
    doc_scope_items: [
      {
        id: "s1",
        parent_type: "quote_revision",
        parent_id: "rev-1",
        title: "Scope A",
        body: null,
        ordering: 1,
        created_at: "x",
        updated_at: "y",
      },
    ],
    doc_inclusions: [],
    doc_exclusions: [],
    doc_assumptions: [],
    doc_line_items: [
      {
        id: "li1",
        parent_type: "quote_revision",
        parent_id: "rev-1",
        category: "labour",
        description: "Engineering",
        ordering: 1,
        created_at: "x",
        updated_at: "y",
      },
    ],
  };
  commercialTermsRow = {
    id: "ct1",
    parent_type: "quote_revision",
    parent_id: "rev-1",
    payment_schedule: "30 days",
    validity: null,
    gst_treatment: null,
    currency: null,
    notes: null,
    created_at: "x",
    updated_at: "y",
  };
  tncSelRow = {
    id: "ts1",
    parent_type: "quote_revision",
    parent_id: "rev-1",
    template_id: "tmpl-1",
    omitted_clause_ids: [],
    added_custom_clauses: [],
    created_at: "x",
    updated_at: "y",
  };
}

function makeBuilder(table: string) {
  let mode: "select" | "insert" | "update" | "delete" = "select";
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    insert: (rows: MockRow | MockRow[]) => {
      mode = "insert";
      insertCalls[table] = insertCalls[table] ?? [];
      insertCalls[table].push(rows as MockRow);
      return builder;
    },
    update: () => {
      mode = "update";
      return builder;
    },
    delete: () => {
      mode = "delete";
      return builder;
    },
    single: () => {
      if (mode === "insert") {
        if (table === "quote_revisions") return Promise.resolve(newRevisionInsert);
        return Promise.resolve({ data: null, error: null });
      }
      if (table === "quote_revisions") return Promise.resolve(revisionFetch);
      return Promise.resolve({ data: null, error: null });
    },
    maybeSingle: () => {
      if (table === "doc_commercial_terms")
        return Promise.resolve({ data: commercialTermsRow, error: null });
      if (table === "doc_tnc_selections")
        return Promise.resolve({ data: tncSelRow, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      if (mode === "insert") {
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      }
      const rows = polyRows[table] ?? [];
      return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
    },
  });
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => makeBuilder(table),
    auth: {
      getUser: vi.fn(() =>
        Promise.resolve({ data: { user: { id: "u1" } } })
      ),
    },
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useCloneRevisionAsDraft", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("creates new draft revision and copies content rows with new parent_id", async () => {
    const { result } = renderHook(() => useCloneRevisionAsDraft(), { wrapper });
    result.current.mutate("rev-1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // New revision: incremented rev_number, draft status
    expect(insertCalls.quote_revisions?.[0]).toMatchObject({
      quote_id: "q-1",
      rev_number: 2,
      status: "draft",
    });

    // Scope items copied with new parent_id, id/timestamps stripped
    expect(insertCalls.doc_scope_items?.[0]).toEqual([
      {
        parent_type: "quote_revision",
        parent_id: "rev-2",
        title: "Scope A",
        body: null,
        ordering: 1,
      },
    ]);

    // Line items copied
    expect(insertCalls.doc_line_items?.[0]).toEqual([
      {
        parent_type: "quote_revision",
        parent_id: "rev-2",
        category: "labour",
        description: "Engineering",
        ordering: 1,
      },
    ]);

    // Commercial terms (single-row) copied
    expect(insertCalls.doc_commercial_terms?.[0]).toMatchObject({
      parent_type: "quote_revision",
      parent_id: "rev-2",
      payment_schedule: "30 days",
    });

    // T&Cs selection copied
    expect(insertCalls.doc_tnc_selections?.[0]).toMatchObject({
      parent_type: "quote_revision",
      parent_id: "rev-2",
      template_id: "tmpl-1",
    });
  });

  it("rejects clone when previous revision is not issued", async () => {
    revisionFetch = {
      data: {
        id: "rev-1",
        quote_id: "q-1",
        rev_number: 1,
        status: "draft",
        summary: null,
      },
      error: null,
    };
    const { result } = renderHook(() => useCloneRevisionAsDraft(), { wrapper });
    result.current.mutate("rev-1");
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error)?.message).toBe(
      "Can only clone from an issued revision"
    );
    expect(insertCalls.quote_revisions).toBeUndefined();
  });
});
