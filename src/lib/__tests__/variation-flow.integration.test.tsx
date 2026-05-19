/**
 * End-to-end integration test for the variation Issue flow.
 *
 * Mirrors issue-flow.integration.test.tsx — but seeded with a project that's
 * already awarded, an issued source revision, a draft variation, and a
 * variation_citations row that ties one variation scope row to a source rev
 * scope row. The mocked rpc("issue_variation", …) applies the same state
 * transitions as 084_pac_quote_variation_issue_rpc.sql.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { useIssueVariation } from "@/hooks/use-issue-variation";

// -------------------- in-memory DB --------------------

interface Tables {
  customers: Record<string, unknown>[];
  projects: Record<string, unknown>[];
  quotes: Record<string, unknown>[];
  quote_revisions: Record<string, unknown>[];
  variations: Record<string, unknown>[];
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
  variation_citations: Record<string, unknown>[];
  issue_audit_log: Record<string, unknown>[];
}

let db: Tables;

function freshDb(stage: "awarded" | "in_progress" | "quoting" = "awarded"): Tables {
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
        stage,
        awarded_quote_id: "r-1",
        created_at: "2026-05-17T00:00:00Z",
        updated_at: "2026-05-17T00:00:00Z",
      },
    ],
    quotes: [
      {
        id: "q-1",
        project_id: "p-1",
        number: "CVL-2129-Q01",
        status: "awarded",
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
        status: "issued",
        summary: null,
        issued_at: "2026-05-17T00:00:00Z",
        issued_by: "u-1",
        snapshot_json: { schema_version: 1 },
        pdf_storage_key: "quote-revisions/r-1/r-1.pdf",
        dropbox_content_hash: null,
        created_at: "2026-05-17T00:00:00Z",
        updated_at: "2026-05-17T00:00:00Z",
        created_by: null,
      },
    ],
    variations: [
      {
        id: "var-1",
        project_id: "p-1",
        variation_number: 1,
        status: "draft",
        summary: null,
        issued_at: null,
        issued_by: null,
        snapshot_json: null,
        pdf_storage_key: null,
        dropbox_content_hash: null,
        created_at: "2026-05-18T00:00:00Z",
        updated_at: "2026-05-18T00:00:00Z",
        created_by: null,
      },
    ],
    doc_scope_items: [
      // Source rev's scope item (used by the citation as source)
      {
        id: "src-scope-1",
        parent_type: "quote_revision",
        parent_id: "r-1",
        title: "Original cabinet build",
        body: null,
        ordering: 0,
        created_at: "2026-05-17T00:00:00Z",
        updated_at: "2026-05-17T00:00:00Z",
      },
      // Variation's revised scope item (the target_doc)
      {
        id: "var-scope-1",
        parent_type: "variation",
        parent_id: "var-1",
        title: "Revised cabinet build",
        body: null,
        ordering: 0,
        created_at: "2026-05-18T00:00:00Z",
        updated_at: "2026-05-18T00:00:00Z",
      },
    ],
    doc_inclusions: [],
    doc_exclusions: [],
    doc_assumptions: [],
    doc_line_items: [
      {
        id: "var-li-1",
        parent_type: "variation",
        parent_id: "var-1",
        category: "hardware_materials",
        description: "Extra panel",
        qty: "1",
        unit: "ea",
        unit_price: "850",
        hours: null,
        hour_rate: null,
        hour_rate_multiplier: "1",
        subtotal: null,
        show_in_customer_doc: true,
        customer_doc_label: null,
        ordering: 0,
        created_at: "2026-05-18T00:00:00Z",
        updated_at: "2026-05-18T00:00:00Z",
      },
    ],
    doc_commercial_terms: [
      {
        id: "var-ct-1",
        parent_type: "variation",
        parent_id: "var-1",
        payment_schedule: "Net 30",
        validity: "30 days",
        gst_treatment: "Excludes GST",
        currency: "AUD",
        notes: null,
        created_at: "2026-05-18T00:00:00Z",
        updated_at: "2026-05-18T00:00:00Z",
      },
    ],
    doc_tnc_selections: [
      {
        id: "var-sel-1",
        parent_type: "variation",
        parent_id: "var-1",
        template_id: "tpl-1",
        omitted_clause_ids: [],
        added_custom_clauses: [],
        created_at: "2026-05-18T00:00:00Z",
        updated_at: "2026-05-18T00:00:00Z",
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
    variation_citations: [
      {
        id: "vc-1",
        variation_id: "var-1",
        target_section: "scope",
        target_doc_id: "var-scope-1",
        source_kind: "quote_revision",
        source_id: "r-1",
        source_section: "scope",
        source_item_id: "src-scope-1",
        original_text_verbatim: "Original cabinet build",
        created_at: "2026-05-18T00:00:00Z",
      },
    ],
    issue_audit_log: [],
  };
}

// -------------------- supabase mock --------------------

type Row = Record<string, unknown>;
type Filter =
  | { kind: "eq"; col: string; val: unknown }
  | { kind: "in"; col: string; vals: Set<unknown> };

function makeQueryBuilder(tableName: keyof Tables) {
  const filters: Filter[] = [];

  const apply = (): Row[] =>
    (db[tableName] as Row[]).filter((row) =>
      filters.every((f) => {
        if (f.kind === "in") return f.vals.has(row[f.col]);
        return row[f.col] === f.val;
      }),
    );

  const builder = {
    eq(col: string, val: unknown) {
      filters.push({ kind: "eq", col, val });
      return builder;
    },
    order() {
      return builder;
    },
    in(col: string, vals: unknown[]) {
      filters.push({ kind: "in", col, vals: new Set(vals) });
      return builder;
    },
    single() {
      const rows = apply();
      if (rows.length === 0) {
        return Promise.resolve({
          data: null,
          error: { message: "not found" },
        });
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

// Mirror of supabase/migrations/084_pac_quote_variation_issue_rpc.sql
function runIssueVariationRpc(args: {
  _variation_id: string;
  _snapshot: Record<string, unknown>;
  _storage_key: string;
}) {
  const variation = (db.variations as Row[]).find(
    (v) => v.id === args._variation_id,
  );
  if (!variation) {
    return { data: null, error: { message: "variation not found" } };
  }
  if (variation.status !== "draft") {
    return {
      data: null,
      error: {
        message: `variation is not in draft (status=${variation.status})`,
      },
    };
  }
  const project = (db.projects as Row[]).find(
    (p) => p.id === variation.project_id,
  );
  const stage = project?.stage;
  if (stage !== "awarded" && stage !== "in_progress") {
    return {
      data: null,
      error: {
        message: "variations require an awarded or in-progress project",
      },
    };
  }

  variation.status = "issued";
  variation.snapshot_json = args._snapshot;
  variation.pdf_storage_key = args._storage_key;
  variation.issued_at = new Date().toISOString();
  variation.issued_by = "u-1";

  const total =
    Number(
      (args._snapshot?.totals as { grand_total?: unknown })?.grand_total ?? 0,
    ) || 0;

  db.issue_audit_log.push({
    id: `audit-${db.issue_audit_log.length + 1}`,
    actor_id: "u-1",
    occurred_at: new Date().toISOString(),
    event_type: "issued",
    target_type: "variation",
    target_id: variation.id,
    details_json: {
      variation_number: variation.variation_number,
      project_id: variation.project_id,
      total,
    },
  });

  return { data: variation, error: null };
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from(name: string) {
      return makeTableApi(name as keyof Tables);
    },
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "issue_variation") {
        return Promise.resolve(
          runIssueVariationRpc(
            args as {
              _variation_id: string;
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
        JSON.stringify({
          storage_key: "variations/var-1/CVL-2129-V1.pdf",
        }),
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

describe("variation-flow end-to-end", () => {
  it("issues a draft variation: flips status, persists snapshot with kind+citations, writes audit", async () => {
    expect(db.variations[0].status).toBe("draft");
    expect(db.variation_citations).toHaveLength(1);

    const { result } = renderHook(() => useIssueVariation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ variationId: "var-1" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Variation row flipped to issued with snapshot + storage_key.
    const v = db.variations[0] as Record<string, unknown>;
    expect(v.status).toBe("issued");
    const snapshot = v.snapshot_json as Record<string, unknown>;
    expect(snapshot).not.toBeNull();
    expect(snapshot.schema_version).toBe(1);
    expect(snapshot.kind).toBe("variation");
    expect(v.pdf_storage_key).toBe("variations/var-1/CVL-2129-V1.pdf");
    expect(v.issued_at).toBeTruthy();
    expect(v.issued_by).toBe("u-1");

    // Snapshot citations carry the right fields.
    const citations = snapshot.citations as Array<Record<string, unknown>>;
    expect(citations).toHaveLength(1);
    const c0 = citations[0];
    expect(c0.target_section).toBe("scope");
    expect(c0.target_doc_id).toBe("var-scope-1");
    expect(c0.original_text_verbatim).toBe("Original cabinet build");
    expect(c0.revised_text).toBe("Revised cabinet build");
    expect(c0.source_label).toBe("CVL-2129-Q01 Rev 1, item 1");

    // Audit row written.
    expect(db.issue_audit_log).toHaveLength(1);
    const audit = db.issue_audit_log[0] as Record<string, unknown>;
    expect(audit.event_type).toBe("issued");
    expect(audit.target_type).toBe("variation");
    expect(audit.target_id).toBe("var-1");
    const details = audit.details_json as Record<string, unknown>;
    expect(details.variation_number).toBe(1);
    expect(details.project_id).toBe("p-1");
    expect(details.total).toBe(850);

    // PDF render fetched once with dry_run:false and the right filename.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const init = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    const body = JSON.parse(init.body as string);
    expect(body.dry_run).toBe(false);
    expect(body.rev_id).toBe("var-1");
    expect(body.filename).toBe("CVL-2129-V1.pdf");
  });

  it("rejects issue when the project is still in quoting stage with kind=validation", async () => {
    db = freshDb("quoting");

    const { result } = renderHook(() => useIssueVariation(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ variationId: "var-1" }),
      ).rejects.toMatchObject({
        kind: "validation",
        errors: expect.arrayContaining([
          expect.objectContaining({ field: "project.stage" }),
        ]),
      });
    });

    // Nothing should have been persisted or audited.
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(db.variations[0].status).toBe("draft");
    expect(db.issue_audit_log).toHaveLength(0);
  });
});
