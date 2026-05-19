import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { buildSnapshot, type BuildSnapshotTnc } from "@/lib/quote-snapshot";
import {
  validateForIssue,
  type ValidationError,
} from "@/lib/quote-validation";
import type {
  Customer,
  DocAssumption,
  DocCommercialTerms,
  DocExclusion,
  DocInclusion,
  DocLineItem,
  DocScopeItem,
  DocTncOverride,
  DocTncSelection,
  Project,
  Quote,
  QuoteRevision,
  QuoteSnapshotV1,
  TncClause,
  TncTemplate,
} from "@/types";

/**
 * Discriminated union returned via `throw` so callers can branch on the
 * failure mode. The mutation never resolves — all failures are throws.
 */
export type IssueError =
  | { kind: "validation"; errors: ValidationError[] }
  | { kind: "render"; message: string }
  | { kind: "db"; message: string };

export interface IssueRevisionInput {
  revId: string;
}

export interface IssueRevisionResult {
  revision: QuoteRevision;
  snapshot: QuoteSnapshotV1;
  storage_key: string;
}

interface Bundle {
  rev: QuoteRevision;
  quote: Quote;
  project: Project;
  customer: Customer;
  scope: DocScopeItem[];
  inclusions: DocInclusion[];
  exclusions: DocExclusion[];
  assumptions: DocAssumption[];
  line_items: DocLineItem[];
  commercial: DocCommercialTerms | null;
  selection: DocTncSelection | null;
  override: DocTncOverride | null;
  template: TncTemplate | null;
  clauses: TncClause[];
}

async function fetchBundle(revId: string): Promise<Bundle> {
  const revRes = await supabase
    .from("quote_revisions")
    .select("*")
    .eq("id", revId)
    .single();
  if (revRes.error) throw new Error(`load revision: ${revRes.error.message}`);
  const rev = revRes.data as QuoteRevision;

  const quoteRes = await supabase
    .from("quotes")
    .select("*")
    .eq("id", rev.quote_id)
    .single();
  if (quoteRes.error) throw new Error(`load quote: ${quoteRes.error.message}`);
  const quote = quoteRes.data as Quote;

  const projectRes = await supabase
    .from("projects")
    .select("*")
    .eq("id", quote.project_id)
    .single();
  if (projectRes.error) throw new Error(`load project: ${projectRes.error.message}`);
  const project = projectRes.data as Project;

  if (!project.customer_id) {
    throw new Error("project has no customer assigned");
  }
  const customerRes = await supabase
    .from("customers")
    .select("*")
    .eq("id", project.customer_id)
    .single();
  if (customerRes.error) throw new Error(`load customer: ${customerRes.error.message}`);
  const customer = customerRes.data as Customer;

  // Fetch all polymorphic children + tnc rows in parallel.
  const filter = (table: string) =>
    supabase
      .from(table)
      .select("*")
      .eq("parent_type", "quote_revision")
      .eq("parent_id", revId);

  const [scopeRes, incRes, excRes, asmRes, liRes] = await Promise.all([
    filter("doc_scope_items").order("ordering"),
    filter("doc_inclusions").order("ordering"),
    filter("doc_exclusions").order("ordering"),
    filter("doc_assumptions").order("ordering"),
    filter("doc_line_items").order("ordering"),
  ]);

  const [ctRes, selRes, ovrRes] = await Promise.all([
    supabase
      .from("doc_commercial_terms")
      .select("*")
      .eq("parent_type", "quote_revision")
      .eq("parent_id", revId)
      .maybeSingle(),
    supabase
      .from("doc_tnc_selections")
      .select("*")
      .eq("parent_type", "quote_revision")
      .eq("parent_id", revId)
      .maybeSingle(),
    supabase
      .from("doc_tnc_override")
      .select("*")
      .eq("parent_type", "quote_revision")
      .eq("parent_id", revId)
      .maybeSingle(),
  ]);

  for (const res of [scopeRes, incRes, excRes, asmRes, liRes, ctRes, selRes, ovrRes]) {
    if (res.error) throw new Error(`load content: ${res.error.message}`);
  }

  const selection = (selRes.data as DocTncSelection | null) ?? null;
  let template: TncTemplate | null = null;
  let clauses: TncClause[] = [];
  if (selection?.template_id) {
    const [tplRes, clRes] = await Promise.all([
      supabase
        .from("tnc_templates")
        .select("*")
        .eq("id", selection.template_id)
        .single(),
      supabase
        .from("tnc_clauses")
        .select("*")
        .eq("template_id", selection.template_id)
        .order("ordering"),
    ]);
    if (tplRes.error) throw new Error(`load tnc template: ${tplRes.error.message}`);
    if (clRes.error) throw new Error(`load tnc clauses: ${clRes.error.message}`);
    template = tplRes.data as TncTemplate;
    clauses = (clRes.data as TncClause[]) ?? [];
  }

  return {
    rev,
    quote,
    project,
    customer,
    scope: (scopeRes.data as DocScopeItem[]) ?? [],
    inclusions: (incRes.data as DocInclusion[]) ?? [],
    exclusions: (excRes.data as DocExclusion[]) ?? [],
    assumptions: (asmRes.data as DocAssumption[]) ?? [],
    line_items: (liRes.data as DocLineItem[]) ?? [],
    commercial: (ctRes.data as DocCommercialTerms | null) ?? null,
    selection,
    override: (ovrRes.data as DocTncOverride | null) ?? null,
    template,
    clauses,
  };
}

function buildTncForSnap(b: Bundle): BuildSnapshotTnc {
  if (b.override) return { override: b.override };
  if (b.selection && b.template) {
    return {
      template: b.template,
      clauses: b.clauses,
      selection: b.selection,
    };
  }
  return null;
}

async function getAccessToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not authenticated");
  return token;
}

function safeFilename(snapshot: QuoteSnapshotV1): string {
  const base = `${snapshot.quote_number}-Rev${snapshot.rev_number}`;
  return `${base.replace(/[^A-Za-z0-9_.-]/g, "_")}.pdf`;
}

export function useIssueRevision() {
  const qc = useQueryClient();

  return useMutation<IssueRevisionResult, IssueError, IssueRevisionInput>({
    mutationFn: async ({ revId }) => {
      // 1. Re-fetch everything from DB to avoid stale React state.
      const bundle = await fetchBundle(revId).catch((e) => {
        throw {
          kind: "db",
          message: e instanceof Error ? e.message : String(e),
        } satisfies IssueError;
      });

      const userRes = await supabase.auth.getUser();
      const issuedByEmail = userRes.data.user?.email ?? null;

      // 2. Build the snapshot.
      const snapshot = buildSnapshot({
        rev: bundle.rev,
        quote: bundle.quote,
        project: bundle.project,
        customer: bundle.customer,
        issued_by_email: issuedByEmail,
        issued_at: new Date().toISOString(),
        scope: bundle.scope,
        inclusions: bundle.inclusions,
        exclusions: bundle.exclusions,
        assumptions: bundle.assumptions,
        line_items: bundle.line_items,
        commercial: bundle.commercial,
        tnc: buildTncForSnap(bundle),
      });

      // 3. Validate against the fresh bundle.
      const verdict = validateForIssue({
        project: {
          customer_id: bundle.project.customer_id,
          project_number: bundle.project.project_number,
          project_name: bundle.project.project_name,
        },
        scope: bundle.scope.map((s) => ({ title: s.title })),
        lineItems: bundle.line_items,
        tncSelection: bundle.selection
          ? { template_id: bundle.selection.template_id }
          : null,
        tncOverride: bundle.override
          ? { body_markdown: bundle.override.body_markdown }
          : null,
        commercial: bundle.commercial
          ? { payment_schedule: bundle.commercial.payment_schedule }
          : null,
      });
      if (!verdict.ok) {
        throw {
          kind: "validation",
          errors: verdict.errors,
        } satisfies IssueError;
      }

      // 4. Render PDF + upload via edge function (non-dry_run).
      const filename = safeFilename(snapshot);
      let token: string;
      try {
        token = await getAccessToken();
      } catch (e) {
        throw {
          kind: "db",
          message: e instanceof Error ? e.message : String(e),
        } satisfies IssueError;
      }
      const renderRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/quote-render-pdf`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            snapshot,
            rev_id: revId,
            filename,
            dry_run: false,
          }),
        },
      ).catch((e) => {
        throw {
          kind: "render",
          message: e instanceof Error ? e.message : String(e),
        } satisfies IssueError;
      });
      if (!renderRes.ok) {
        const detail = await renderRes.text().catch(() => "");
        throw {
          kind: "render",
          message: `render service error (${renderRes.status}): ${detail}`,
        } satisfies IssueError;
      }
      let storage_key: string;
      try {
        const json = (await renderRes.json()) as { storage_key?: string };
        if (!json.storage_key) {
          throw new Error("missing storage_key in render response");
        }
        storage_key = json.storage_key;
      } catch (e) {
        throw {
          kind: "render",
          message: e instanceof Error ? e.message : String(e),
        } satisfies IssueError;
      }

      // 5. Call the atomic RPC. If this fails after the PDF was uploaded,
      // the PDF is orphaned in storage — documented & accepted in v1.
      const { data, error } = await supabase.rpc("issue_quote_revision", {
        _rev_id: revId,
        _snapshot: snapshot,
        _storage_key: storage_key,
      });
      if (error) {
        throw { kind: "db", message: error.message } satisfies IssueError;
      }

      return {
        revision: data as QuoteRevision,
        snapshot,
        storage_key,
      };
    },
    onSuccess: (_, { revId }) => {
      qc.invalidateQueries({ queryKey: ["quote-revisions"] });
      qc.invalidateQueries({ queryKey: ["quote-revisions", "by-id", revId] });
      qc.invalidateQueries({ queryKey: ["quotes"] });
    },
  });
}

export function isIssueError(err: unknown): err is IssueError {
  return (
    typeof err === "object" &&
    err !== null &&
    "kind" in err &&
    typeof (err as { kind: unknown }).kind === "string"
  );
}
