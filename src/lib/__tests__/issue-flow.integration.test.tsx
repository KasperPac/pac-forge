/**
 * End-to-end integration test for the Issue flow.
 *
 * Uses an in-memory stateful supabase mock so the real hook code path
 * (fetchBundle → buildSnapshot → validateForIssue → fetch → rpc → invalidate)
 * runs against simulated DB state. fetch is mocked to return a synthetic
 * storage_key. The RPC handler in the mock applies the same state
 * transitions as 081_pac_quote_issue_rpc.sql so the post-conditions can
 * be asserted on the in-memory store.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { useIssueRevision } from "@/hooks/use-issue-quote";

// -------------------- in-memory DB --------------------

interface Tables {
  customers: Record<string, unknown>[];
  projects: Record<string, unknown>[];
  quotes: Record<string, unknown>[];
  quote_revisions: Record<string, unknown>[];
  doc_scope_items: Record<string, unknown>[];
  doc_inclusions: Record<string, unknown>[];
  doc_exclusions: Record<string, unknown>[];
  doc_assumptions: Record<string, unknown>[];
  doc_line_items: Record<string, unknown>[];
  doc_commercial_terms: Record<string, unknown>[];
  doc_tnc_selections: Record<string, unknown>[];
  doc_tnc_override: Record<string, unknown>[];
  tnc_templates: Record<string, unknown>[];
  tnc_clauses: Record<string, unknown>[];
  issue_audit_log: Record<string, unknown>[];
}

let db: Tables;

function freshDb(): Tables {
  return {
    customers: [
      {
        id: "c-1",
        name: "Conveyor Logistics",
        display_code: "CVL",
        dropbox_root_path: null,
        created_at: "2026-05-17T00:00:00Z",
        updated_at: "2026-05-17T00:00:00Z",
        created_by: null,
      },
    ],
    projects: [
      {
        id: "p-1",
        customer_id: "c-1",
        project_number: "CVL-2129",
        project_name: "Infeed Conveyor Replacement",
        stage: "quoting",
        awarded_quote_id: null,
        client_name: "Conveyor Logistics",
        created_at: "2026-05-17T00:00:00Z",
        updated_at: "2026-05-17T00:00:00Z",
      },
    ],
    quotes: [
      {
        id: "q-1",
        project_id: "p-1",
        number: "CVL-2129-Q01",
        status: "draft",
        created_at: "2026-05-17T00:00:00Z",
        updated_at: "2026-05-17T00:00:00Z",
        created_by: null,
      },
    ],
    quote_revisions: [
      {
        id: "r-1",
        quote_id: "q-1",
        rev_number: 1,
        status: "draft",
        summary: null,
        issued_at: null,
        issued_by: null,
        snapshot_json: null,
        pdf_storage_key: null,
        dropbox_content_hash: null,
        created_at: "2026-05-17T00:00:00Z",
        updated_at: "2026-05-17T00:00:00Z",
        created_by: null,
      },
    ],
    doc_scope_items: [
      {
        id: "s-1",
        parent_type: "quote_revision",
        parent_id: "r-1",
        title: "Cabinet build",
        body: null,
        ordering: 0,
        created_at: "2026-05-17T00:00:00Z",
        updated_at: "2026-05-17T00:00:00Z",
      },
    ],
    doc_inclusions: [],
    doc_exclusions: [],
    doc_assumptions: [
      {
        id: "a-1",
        parent_type: "quote_revision",
        parent_id: "r-1",
        assumption_key: "POWER_3PH_415V",
        title: "Power available",
        value: "415V 3-phase",
        notes: null,
        ordering: 0,
        created_at: "2026-05-17T00:00:00Z",
        updated_at: "2026-05-17T00:00:00Z",
      },
    ],
    doc_line_items: [
      {
        id: "li-1",
        parent_type: "quote_revision",
        parent_id: "r-1",
        category: "hardware_materials",
        description: "Cabinet kit",
        qty: "2",
        unit: "ea",
        unit_price: "600",
        hours: null,
        hour_rate: null,
        hour_rate_multiplier: "1",
        subtotal: null,
        show_in_customer_doc: true,
        customer_doc_label: null,
        ordering: 0,
        created_at: "2026-05-17T00:00:00Z",
        updated_at: "2026-05-17T00:00:00Z",
      },
    ],
    doc_commercial_terms: [
      {
        id: "ct-1",
        parent_type: "quote_revision",
        parent_id: "r-1",
        payment_schedule: "30/60/10",
        validity: "30 days",
        gst_treatment: "Excludes GST",
        currency: "AUD",
        notes: null,
        created_at: "2026-05-17T00:00:00Z",
        updated_at: "2026-05-17T00:00:00Z",
      },
    ],
    doc_tnc_selections: [
      {
        id: "sel-1",
        parent_type: "quote_revision",
        parent_id: "r-1",
        template_id: "tpl-1",
        omitted_clause_ids: [],
        added_custom_clauses: [],
        created_at: "2026-05-17T00:00:00Z",
        updated_at: "2026-05-17T00:00:00Z",
      },
    ],
    doc_tnc_override: [],
    tnc_templates: [
      {
        id: "tpl-1",
        name: "Pac Standard",
        version: 1,
        status: "active",
        is_default: true,
      },
    ],
    tnc_clauses: [
      {
        id: "cl-1",
        template_id: "tpl-1",
        clause_number: "1",
        title: "Validity",
        body_markdown: "Valid for 30 days.",
        ordering: 0,
      },
    ],
    issue_audit_log: [],
  };
}

// -------------------- supabase mock --------------------

type Row = Record<string, unknown>;

function makeQueryBuilder(tableName: keyof Tables) {
  const filters: Array<{ col: string; val: unknown }> = [];

  const apply = (): Row[] =>
    (db[tableName] as Row[]).filter((row) =>
      filters.every((f) => row[f.col] === f.val),
    );

  const builder = {
    eq(col: string, val: unknown) {
      filters.push({ col, val });
      return builder;
    },
    order() {
      return builder;
    },
    in(col: string, vals: unknown[]) {
      const set = new Set(vals);
      filters.push({ col, val: undefined });
      // Replace last filter with an inclusion check
      filters[filters.length - 1] = {
        col,
        val: { __in: set } as unknown as unknown,
      };
      return builder;
    },
    single() {
      const rows = apply();
      if (rows.length === 0) {
        return Promise.resolve({ data: null, error: { message: "not found" } });
      }
      return Promise.resolve({ data: rows[0], error: null });
    },
    maybeSingle() {
      const rows = apply();
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
    then(onFulfilled?: (value: { data: Row[]; error: null }) => unknown) {
      return Promise.resolve({ data: apply(), error: null }).then(onFulfilled);
    },
  };
  return builder;
}

function makeTableApi(tableName: keyof Tables) {
  return {
    select() {
      return makeQueryBuilder(tableName);
    },
    insert(row: Row | Row[]) {
      const rows = Array.isArray(row) ? row : [row];
      const inserted: Row[] = rows.map((r, i) => ({
        id: `gen-${tableName}-${(db[tableName] as Row[]).length + i + 1}`,
        ...r,
      }));
      (db[tableName] as Row[]).push(...inserted);
      return {
        select() {
          return {
            single() {
              return Promise.resolve({ data: inserted[0], error: null });
            },
          };
        },
      };
    },
    update(updates: Row) {
      return {
        eq(col: string, val: unknown) {
          const rows = db[tableName] as Row[];
          for (const row of rows) {
            if (row[col] === val) Object.assign(row, updates);
          }
          return {
            select() {
              return {
                single() {
                  const row = rows.find((r) => r[col] === val);
                  return Promise.resolve({ data: row, error: null });
                },
              };
            },
          };
        },
      };
    },
  };
}

function runIssueRpc(args: {
  _rev_id: string;
  _snapshot: Record<string, unknown>;
  _storage_key: string;
}) {
  const rev = (db.quote_revisions as Row[]).find((r) => r.id === args._rev_id);
  if (!rev) return { data: null, error: { message: "revision not found" } };
  if (rev.status !== "draft") {
    return {
      data: null,
      error: { message: `revision is not in draft (status=${rev.status})` },
    };
  }

  // Supersede prior issued revs on the same quote.
  for (const r of db.quote_revisions as Row[]) {
    if (r.quote_id === rev.quote_id && r.status === "issued" && r.id !== rev.id) {
      r.status = "superseded";
    }
  }

  rev.status = "issued";
  rev.snapshot_json = args._snapshot;
  rev.pdf_storage_key = args._storage_key;
  rev.issued_at = new Date().toISOString();
  rev.issued_by = "u-1";

  const quote = (db.quotes as Row[]).find((q) => q.id === rev.quote_id);
  const total =
    Number(
      (args._snapshot?.totals as { grand_total?: unknown })?.grand_total ?? 0,
    ) || 0;

  db.issue_audit_log.push({
    id: `audit-${db.issue_audit_log.length + 1}`,
    actor_id: "u-1",
    occurred_at: new Date().toISOString(),
    event_type: "issued",
    target_type: "quote_revision",
    target_id: rev.id,
    details_json: {
      quote_number: quote?.number,
      rev_number: rev.rev_number,
      total,
    },
  });

  return { data: rev, error: null };
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from(name: string) {
      return makeTableApi(name as keyof Tables);
    },
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "issue_quote_revision") {
        return Promise.resolve(
          runIssueRpc(
            args as {
              _rev_id: string;
              _snapshot: Record<string, unknown>;
              _storage_key: string;
            },
          ),
        );
      }
      return Promise.resolve({ data: null, error: { message: "unknown rpc" } });
    },
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: { access_token: "test-token" } },
        }),
      getUser: () =>
        Promise.resolve({
          data: { user: { id: "u-1", email: "kasper@pac.test" } },
          error: null,
        }),
    },
  },
}));

// -------------------- test wrapper --------------------

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
  db = freshDb();
  vi.stubEnv("VITE_SUPABASE_URL", "https://supa.test");
  globalThis.fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ storage_key: "quote-revisions/r-1/CVL-2129-Q01-Rev1.pdf" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// -------------------- the vertical slice --------------------

describe("issue-flow end-to-end", () => {
  it("creates customer/project/quote/rev + content, then issuing flips status, persists snapshot, sets storage key, and writes audit", async () => {
    // Sanity-check that the seed represents the prerequisite create-flow.
    expect(db.customers).toHaveLength(1);
    expect(db.projects).toHaveLength(1);
    expect(db.quotes).toHaveLength(1);
    expect(db.quote_revisions[0].status).toBe("draft");
    expect(db.doc_scope_items).toHaveLength(1);
    expect(db.doc_line_items).toHaveLength(1);
    expect(db.doc_commercial_terms).toHaveLength(1);
    expect(db.doc_tnc_selections).toHaveLength(1);

    const { result } = renderHook(() => useIssueRevision(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ revId: "r-1" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Post-conditions on the in-memory DB.
    const rev = db.quote_revisions[0] as Record<string, unknown>;
    expect(rev.status).toBe("issued");
    expect(rev.snapshot_json).not.toBeNull();
    expect((rev.snapshot_json as { schema_version: number }).schema_version).toBe(1);
    expect(rev.pdf_storage_key).toBe(
      "quote-revisions/r-1/CVL-2129-Q01-Rev1.pdf",
    );
    expect(rev.issued_at).toBeTruthy();
    expect(rev.issued_by).toBe("u-1");

    // Audit row written with correct event_type + details_json.
    expect(db.issue_audit_log).toHaveLength(1);
    const audit = db.issue_audit_log[0] as Record<string, unknown>;
    expect(audit.event_type).toBe("issued");
    expect(audit.target_type).toBe("quote_revision");
    expect(audit.target_id).toBe("r-1");
    const details = audit.details_json as Record<string, unknown>;
    expect(details.quote_number).toBe("CVL-2129-Q01");
    expect(details.rev_number).toBe(1);
    expect(details.total).toBe(1200);

    // PDF render fetch was called once with dry_run:false and the right filename.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const init = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0][1];
    const body = JSON.parse(init.body as string);
    expect(body.dry_run).toBe(false);
    expect(body.filename).toBe("CVL-2129-Q01-Rev1.pdf");
  });

  it("issuing an already-issued rev fails with a db error and does not duplicate the audit row", async () => {
    // Pre-issue the rev so the precondition kicks in.
    db.quote_revisions[0] = {
      ...(db.quote_revisions[0] as Record<string, unknown>),
      status: "issued",
    };
    const { result } = renderHook(() => useIssueRevision(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ revId: "r-1" }),
      ).rejects.toMatchObject({ kind: "db" });
    });

    expect(db.issue_audit_log).toHaveLength(0);
  });
});
