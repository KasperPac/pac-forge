import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { useIssueRevision } from "@/hooks/use-issue-quote";

const REV_ID = "rev-1";
const QUOTE_ID = "q-1";
const PROJECT_ID = "p-1";
const CUSTOMER_ID = "c-1";
const TEMPLATE_ID = "tpl-1";

interface MockState {
  rev: Record<string, unknown>;
  quote: Record<string, unknown>;
  project: Record<string, unknown>;
  customer: Record<string, unknown>;
  scope: Array<Record<string, unknown>>;
  inclusions: Array<Record<string, unknown>>;
  exclusions: Array<Record<string, unknown>>;
  assumptions: Array<Record<string, unknown>>;
  line_items: Array<Record<string, unknown>>;
  commercial: Record<string, unknown> | null;
  tnc_selection: Record<string, unknown> | null;
  tnc_override: Record<string, unknown> | null;
  tnc_template: Record<string, unknown> | null;
  tnc_clauses: Array<Record<string, unknown>>;
}

let state: MockState;

const rpcMock = vi.fn();

function makeState(overrides: Partial<MockState> = {}): MockState {
  return {
    rev: {
      id: REV_ID,
      quote_id: QUOTE_ID,
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
    quote: {
      id: QUOTE_ID,
      project_id: PROJECT_ID,
      number: "CVL-2129-Q01",
      status: "draft",
      created_at: "2026-05-17T00:00:00Z",
      updated_at: "2026-05-17T00:00:00Z",
      created_by: null,
    },
    project: {
      id: PROJECT_ID,
      customer_id: CUSTOMER_ID,
      job_code: "CVL-2129",
      project_name: "Infeed Conveyor Replacement",
      stage: "quoting",
    },
    customer: {
      id: CUSTOMER_ID,
      name: "Conveyor Logistics",
      display_code: "CVL",
    },
    scope: [
      {
        id: "s-1",
        parent_type: "quote_revision",
        parent_id: REV_ID,
        title: "Cabinet build",
        body: null,
        ordering: 0,
        created_at: "2026-05-17T00:00:00Z",
        updated_at: "2026-05-17T00:00:00Z",
      },
    ],
    inclusions: [],
    exclusions: [],
    assumptions: [],
    line_items: [
      {
        id: "li-1",
        parent_type: "quote_revision",
        parent_id: REV_ID,
        category: "labour",
        description: "Engineering",
        qty: null,
        unit: null,
        unit_price: null,
        hours: "10",
        hour_rate: "180",
        hour_rate_multiplier: "1",
        subtotal: null,
        show_in_customer_doc: true,
        customer_doc_label: null,
        ordering: 0,
        created_at: "2026-05-17T00:00:00Z",
        updated_at: "2026-05-17T00:00:00Z",
      },
    ],
    commercial: {
      id: "ct-1",
      parent_type: "quote_revision",
      parent_id: REV_ID,
      payment_schedule: "30/60/10",
      validity: "30 days",
      gst_treatment: "Excludes GST",
      currency: "AUD",
      notes: null,
      created_at: "2026-05-17T00:00:00Z",
      updated_at: "2026-05-17T00:00:00Z",
    },
    tnc_selection: {
      id: "sel-1",
      parent_type: "quote_revision",
      parent_id: REV_ID,
      template_id: TEMPLATE_ID,
      omitted_clause_ids: [],
      added_custom_clauses: [],
      created_at: "2026-05-17T00:00:00Z",
      updated_at: "2026-05-17T00:00:00Z",
    },
    tnc_override: null,
    tnc_template: {
      id: TEMPLATE_ID,
      name: "Pac Standard",
      version: 1,
      status: "active",
      is_default: true,
    },
    tnc_clauses: [
      {
        id: "c-1",
        template_id: TEMPLATE_ID,
        clause_number: "1",
        title: "Validity",
        body_markdown: "Valid 30 days.",
        ordering: 0,
      },
    ],
    ...overrides,
  };
}

function chainResolving(value: unknown) {
  return {
    single: () => Promise.resolve({ data: value, error: null }),
    maybeSingle: () => Promise.resolve({ data: value, error: null }),
    order: () => Promise.resolve({ data: value, error: null }),
  };
}

const tableHandlers: Record<string, () => unknown> = {
  quote_revisions: () => ({
    select: () => ({ eq: () => chainResolving(state.rev) }),
  }),
  quotes: () => ({
    select: () => ({ eq: () => chainResolving(state.quote) }),
  }),
  projects: () => ({
    select: () => ({ eq: () => chainResolving(state.project) }),
  }),
  customers: () => ({
    select: () => ({ eq: () => chainResolving(state.customer) }),
  }),
  doc_scope_items: () => ({
    select: () => ({
      eq: () => ({ eq: () => chainResolving(state.scope) }),
    }),
  }),
  doc_inclusions: () => ({
    select: () => ({
      eq: () => ({ eq: () => chainResolving(state.inclusions) }),
    }),
  }),
  doc_exclusions: () => ({
    select: () => ({
      eq: () => ({ eq: () => chainResolving(state.exclusions) }),
    }),
  }),
  doc_assumptions: () => ({
    select: () => ({
      eq: () => ({ eq: () => chainResolving(state.assumptions) }),
    }),
  }),
  doc_line_items: () => ({
    select: () => ({
      eq: () => ({ eq: () => chainResolving(state.line_items) }),
    }),
  }),
  doc_commercial_terms: () => ({
    select: () => ({
      eq: () => ({ eq: () => chainResolving(state.commercial) }),
    }),
  }),
  doc_tnc_selections: () => ({
    select: () => ({
      eq: () => ({ eq: () => chainResolving(state.tnc_selection) }),
    }),
  }),
  doc_tnc_override: () => ({
    select: () => ({
      eq: () => ({ eq: () => chainResolving(state.tnc_override) }),
    }),
  }),
  tnc_templates: () => ({
    select: () => ({ eq: () => chainResolving(state.tnc_template) }),
  }),
  tnc_clauses: () => ({
    select: () => ({ eq: () => chainResolving(state.tnc_clauses) }),
  }),
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (name: string) => {
      const h = tableHandlers[name];
      if (!h) throw new Error(`unhandled table: ${name}`);
      return h();
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
    rpc: (...args: unknown[]) => rpcMock(...args),
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
  state = makeState();
  rpcMock.mockReset();
  vi.stubEnv("VITE_SUPABASE_URL", "https://supa.test");

  // Default fetch: PDF render returns storage_key.
  globalThis.fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ storage_key: "quote-revisions/rev-1/x.pdf" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
  ) as unknown as typeof fetch;

  rpcMock.mockResolvedValue({
    data: { ...state.rev, status: "issued", pdf_storage_key: "quote-revisions/rev-1/x.pdf" },
    error: null,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("useIssueRevision", () => {
  it("runs validation → render → rpc and returns the rev + snapshot + storage_key", async () => {
    const { result } = renderHook(() => useIssueRevision(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ revId: REV_ID });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Render fetched once with dry_run:false and a bearer token.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(calledUrl).toBe("https://supa.test/functions/v1/quote-render-pdf");
    const body = JSON.parse(init.body as string);
    expect(body.dry_run).toBe(false);
    expect(body.rev_id).toBe(REV_ID);
    expect(body.filename).toBe("CVL-2129-Q01-Rev1.pdf");
    expect(body.snapshot.totals.grand_total).toBe(1800);

    // RPC called once with the right shape.
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [rpcName, rpcArgs] = rpcMock.mock.calls[0];
    expect(rpcName).toBe("issue_quote_revision");
    expect(rpcArgs._rev_id).toBe(REV_ID);
    expect(rpcArgs._storage_key).toBe("quote-revisions/rev-1/x.pdf");
    expect(rpcArgs._snapshot.quote_number).toBe("CVL-2129-Q01");

    expect(result.current.data?.revision.status).toBe("issued");
  });

  it("throws kind=validation when validation fails and never calls render or rpc", async () => {
    // Empty scope causes validation failure.
    state = makeState({ scope: [] });

    const { result } = renderHook(() => useIssueRevision(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ revId: REV_ID }),
      ).rejects.toMatchObject({ kind: "validation" });
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("throws kind=render when the edge function returns 500 and never calls rpc", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("upstream blew up", { status: 502 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useIssueRevision(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ revId: REV_ID }),
      ).rejects.toMatchObject({ kind: "render" });
    });

    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("throws kind=db when the rpc returns an error", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "revision is not in draft status" },
    });

    const { result } = renderHook(() => useIssueRevision(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ revId: REV_ID }),
      ).rejects.toMatchObject({
        kind: "db",
        message: "revision is not in draft status",
      });
    });
  });

  it("snapshot total comes from line items (hours × rate × multiplier)", async () => {
    const { result } = renderHook(() => useIssueRevision(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ revId: REV_ID });
    });

    const rpcArgs = rpcMock.mock.calls[0][1];
    expect(rpcArgs._snapshot.totals.grand_total).toBe(1800);
    expect(rpcArgs._snapshot.tnc.kind).toBe("structured");
    expect(rpcArgs._snapshot.tnc.template_name).toBe("Pac Standard");
  });
});
