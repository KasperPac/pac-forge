import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { useIssueVariation } from "@/hooks/use-issue-variation";

const VARIATION_ID = "var-1";
const PROJECT_ID = "p-1";
const CUSTOMER_ID = "c-1";
const TEMPLATE_ID = "tpl-1";

interface MockState {
  variation: Record<string, unknown>;
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
  citations: Array<Record<string, unknown>>;
}

let state: MockState;
const rpcMock = vi.fn();

function makeState(overrides: Partial<MockState> = {}): MockState {
  return {
    variation: {
      id: VARIATION_ID,
      project_id: PROJECT_ID,
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
    project: {
      id: PROJECT_ID,
      customer_id: CUSTOMER_ID,
      job_code: "CVL-2129",
      project_name: "Infeed Conveyor Replacement",
      stage: "awarded",
    },
    customer: {
      id: CUSTOMER_ID,
      name: "Conveyor Logistics",
      display_code: "CVL",
    },
    scope: [
      {
        id: "s-1",
        parent_type: "variation",
        parent_id: VARIATION_ID,
        title: "Revised cabinet build",
        body: null,
        ordering: 0,
        created_at: "2026-05-18T00:00:00Z",
        updated_at: "2026-05-18T00:00:00Z",
      },
    ],
    inclusions: [],
    exclusions: [],
    assumptions: [],
    line_items: [
      {
        id: "li-1",
        parent_type: "variation",
        parent_id: VARIATION_ID,
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
        created_at: "2026-05-18T00:00:00Z",
        updated_at: "2026-05-18T00:00:00Z",
      },
    ],
    commercial: {
      id: "ct-1",
      parent_type: "variation",
      parent_id: VARIATION_ID,
      payment_schedule: "30/60/10",
      validity: "30 days",
      gst_treatment: "Excludes GST",
      currency: "AUD",
      notes: null,
      created_at: "2026-05-18T00:00:00Z",
      updated_at: "2026-05-18T00:00:00Z",
    },
    tnc_selection: {
      id: "sel-1",
      parent_type: "variation",
      parent_id: VARIATION_ID,
      template_id: TEMPLATE_ID,
      omitted_clause_ids: [],
      added_custom_clauses: [],
      created_at: "2026-05-18T00:00:00Z",
      updated_at: "2026-05-18T00:00:00Z",
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
    citations: [],
    ...overrides,
  };
}

function chainResolving(value: unknown) {
  return {
    single: () => Promise.resolve({ data: value, error: null }),
    maybeSingle: () => Promise.resolve({ data: value, error: null }),
    order: () => Promise.resolve({ data: value, error: null }),
    in: () => Promise.resolve({ data: value, error: null }),
  };
}

const tableHandlers: Record<string, () => unknown> = {
  variations: () => ({
    select: () => ({ eq: () => chainResolving(state.variation) }),
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
  variation_citations: () => ({
    select: () => ({
      eq: () => ({ order: () => Promise.resolve({ data: state.citations, error: null }) }),
    }),
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

  globalThis.fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ storage_key: "variations/var-1/x.pdf" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  ) as unknown as typeof fetch;

  rpcMock.mockResolvedValue({
    data: {
      ...state.variation,
      status: "issued",
      pdf_storage_key: "variations/var-1/x.pdf",
    },
    error: null,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("useIssueVariation", () => {
  it("runs validation → render → rpc and returns variation + snapshot + storage_key", async () => {
    const { result } = renderHook(() => useIssueVariation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ variationId: VARIATION_ID });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = (
      globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(calledUrl).toBe("https://supa.test/functions/v1/quote-render-pdf");
    const body = JSON.parse(init.body as string);
    expect(body.dry_run).toBe(false);
    expect(body.rev_id).toBe(VARIATION_ID);
    expect(body.filename).toBe("CVL-2129-V1.pdf");
    expect(body.snapshot.totals.grand_total).toBe(1800);
    expect(body.snapshot.kind).toBe("variation");

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [rpcName, rpcArgs] = rpcMock.mock.calls[0];
    expect(rpcName).toBe("issue_variation");
    expect(rpcArgs._variation_id).toBe(VARIATION_ID);
    expect(rpcArgs._storage_key).toBe("variations/var-1/x.pdf");
    expect(rpcArgs._snapshot.kind).toBe("variation");

    expect(result.current.data?.variation.status).toBe("issued");
  });

  it("throws kind=validation when project.stage=quoting and never calls render or rpc", async () => {
    state = makeState({
      project: { ...makeState().project, stage: "quoting" },
    });

    const { result } = renderHook(() => useIssueVariation(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ variationId: VARIATION_ID }),
      ).rejects.toMatchObject({
        kind: "validation",
        errors: expect.arrayContaining([
          expect.objectContaining({ field: "project.stage" }),
        ]),
      });
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("throws kind=render when the edge function returns 502 and never calls rpc", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("upstream blew up", { status: 502 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useIssueVariation(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ variationId: VARIATION_ID }),
      ).rejects.toMatchObject({ kind: "render" });
    });

    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("throws kind=db when the rpc returns an error", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "variation is not in draft" },
    });

    const { result } = renderHook(() => useIssueVariation(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ variationId: VARIATION_ID }),
      ).rejects.toMatchObject({
        kind: "db",
        message: "variation is not in draft",
      });
    });
  });
});
