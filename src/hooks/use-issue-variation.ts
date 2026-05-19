import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  buildSnapshot,
  type BuildSnapshotTnc,
  type BuildSnapshotCitation,
} from "@/lib/quote-snapshot";
import { validateForIssue, type ValidationError } from "@/lib/quote-validation";
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
  QuoteSnapshotV1,
  TncClause,
  TncTemplate,
  Variation,
  VariationCitation,
} from "@/types";

export type IssueError =
  | { kind: "validation"; errors: ValidationError[] }
  | { kind: "render"; message: string }
  | { kind: "db"; message: string };

export interface IssueVariationInput {
  variationId: string;
}

export interface IssueVariationResult {
  variation: Variation;
  snapshot: QuoteSnapshotV1;
  storage_key: string;
}

interface Bundle {
  variation: Variation;
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
  citations: VariationCitation[];
  sourceLabels: Map<string, string>;
}

const SECTION_TABLE: Record<string, string> = {
  scope: "doc_scope_items",
  inclusion: "doc_inclusions",
  exclusion: "doc_exclusions",
  assumption: "doc_assumptions",
  line_item: "doc_line_items",
};

async function buildSourceLabels(
  citations: VariationCitation[],
  project: Project,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!citations.length) return map;

  const revIds = [
    ...new Set(
      citations
        .filter((c) => c.source_kind === "quote_revision")
        .map((c) => c.source_id),
    ),
  ];
  const varIds = [
    ...new Set(
      citations
        .filter((c) => c.source_kind === "variation")
        .map((c) => c.source_id),
    ),
  ];
  const itemIds = [
    ...new Set(
      citations.map((c) => c.source_item_id).filter(Boolean) as string[],
    ),
  ];

  type RevRow = { id: string; rev_number: number; quote_number: string };

  const [revDocs, varDocsRes, ...sectionResults] = await Promise.all([
    revIds.length
      ? supabase
          .from("quote_revisions")
          .select("id, rev_number, quote_id")
          .in("id", revIds)
          .then(async (rr) => {
            if (rr.error || !rr.data?.length) return [] as RevRow[];
            const rows = rr.data as Array<{
              id: string;
              rev_number: number;
              quote_id: string;
            }>;
            const qIds = [...new Set(rows.map((r) => r.quote_id))];
            const qr = await supabase
              .from("quotes")
              .select("id, number")
              .in("id", qIds);
            const qMap = new Map(
              (qr.data ?? []).map(
                (q: { id: string; number: string }) => [q.id, q.number] as const,
              ),
            );
            return rows.map((r) => ({
              id: r.id,
              rev_number: r.rev_number,
              quote_number: qMap.get(r.quote_id) ?? r.quote_id,
            }));
          })
      : Promise.resolve([] as RevRow[]),
    varIds.length
      ? supabase
          .from("variations")
          .select("id, variation_number")
          .in("id", varIds)
      : Promise.resolve({
          data: [] as Array<{ id: string; variation_number: number }>,
          error: null,
        }),
    ...Object.values(SECTION_TABLE).map((table) => {
      const ids = citations
        .filter(
          (c) =>
            SECTION_TABLE[c.source_section] === table && c.source_item_id,
        )
        .map((c) => c.source_item_id as string);
      return ids.length
        ? supabase.from(table).select("id, ordering").in("id", ids)
        : Promise.resolve({
            data: [] as Array<{ id: string; ordering: number }>,
            error: null,
          });
    }),
  ]);

  const revDocMap = new Map(
    (revDocs as RevRow[]).map((r) => [r.id, r]),
  );
  const varDocMap = new Map(
    (
      (
        varDocsRes as {
          data: Array<{ id: string; variation_number: number }> | null;
        }
      ).data ?? []
    ).map((v) => [v.id, v]),
  );

  const itemOrderingMap = new Map<string, number>();
  for (const res of sectionResults as Array<{
    data: Array<{ id: string; ordering: number }> | null;
  }>) {
    for (const row of res.data ?? []) {
      itemOrderingMap.set(row.id, row.ordering);
    }
  }

  // Unused but typed for safety
  void itemIds;

  for (const c of citations) {
    const ordering = c.source_item_id
      ? (itemOrderingMap.get(c.source_item_id) ?? 0)
      : 0;
    const itemNum = ordering + 1;
    let docLabel: string;
    if (c.source_kind === "quote_revision") {
      const doc = revDocMap.get(c.source_id);
      docLabel = doc
        ? `${doc.quote_number} Rev ${doc.rev_number}`
        : c.source_id;
    } else {
      const doc = varDocMap.get(c.source_id);
      docLabel = doc
        ? `${project.job_code} Variation V${doc.variation_number}`
        : c.source_id;
    }
    map.set(c.id, `${docLabel}, item ${itemNum}`);
  }

  return map;
}

async function fetchBundle(variationId: string): Promise<Bundle> {
  const varRes = await supabase
    .from("variations")
    .select("*")
    .eq("id", variationId)
    .single();
  if (varRes.error)
    throw new Error(`load variation: ${varRes.error.message}`);
  const variation = varRes.data as Variation;

  const projRes = await supabase
    .from("projects")
    .select("*")
    .eq("id", variation.project_id)
    .single();
  if (projRes.error) throw new Error(`load project: ${projRes.error.message}`);
  const project = projRes.data as Project;

  if (!project.customer_id) {
    throw new Error("project has no customer assigned");
  }
  const custRes = await supabase
    .from("customers")
    .select("*")
    .eq("id", project.customer_id)
    .single();
  if (custRes.error)
    throw new Error(`load customer: ${custRes.error.message}`);
  const customer = custRes.data as Customer;

  const filterVar = (table: string) =>
    supabase
      .from(table)
      .select("*")
      .eq("parent_type", "variation")
      .eq("parent_id", variationId);

  const [scopeRes, incRes, excRes, asmRes, liRes] = await Promise.all([
    filterVar("doc_scope_items").order("ordering"),
    filterVar("doc_inclusions").order("ordering"),
    filterVar("doc_exclusions").order("ordering"),
    filterVar("doc_assumptions").order("ordering"),
    filterVar("doc_line_items").order("ordering"),
  ]);

  const [ctRes, selRes, ovrRes, citRes] = await Promise.all([
    supabase
      .from("doc_commercial_terms")
      .select("*")
      .eq("parent_type", "variation")
      .eq("parent_id", variationId)
      .maybeSingle(),
    supabase
      .from("doc_tnc_selections")
      .select("*")
      .eq("parent_type", "variation")
      .eq("parent_id", variationId)
      .maybeSingle(),
    supabase
      .from("doc_tnc_override")
      .select("*")
      .eq("parent_type", "variation")
      .eq("parent_id", variationId)
      .maybeSingle(),
    supabase
      .from("variation_citations")
      .select("*")
      .eq("variation_id", variationId)
      .order("created_at"),
  ]);

  for (const res of [
    scopeRes,
    incRes,
    excRes,
    asmRes,
    liRes,
    ctRes,
    selRes,
    ovrRes,
    citRes,
  ]) {
    if (res.error) throw new Error(`load content: ${res.error.message}`);
  }

  const citations = (citRes.data as VariationCitation[]) ?? [];
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
    if (tplRes.error)
      throw new Error(`load tnc template: ${tplRes.error.message}`);
    if (clRes.error)
      throw new Error(`load tnc clauses: ${clRes.error.message}`);
    template = tplRes.data as TncTemplate;
    clauses = (clRes.data as TncClause[]) ?? [];
  }

  const sourceLabels = await buildSourceLabels(citations, project);

  return {
    variation,
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
    citations,
    sourceLabels,
  };
}

function buildTncForSnap(b: Bundle): BuildSnapshotTnc {
  if (b.override) return { override: b.override };
  if (b.selection && b.template) {
    return { template: b.template, clauses: b.clauses, selection: b.selection };
  }
  return null;
}

function safeFilename(snapshot: QuoteSnapshotV1, variation: Variation): string {
  const base = `${snapshot.project.job_code}-V${variation.variation_number}`;
  return `${base.replace(/[^A-Za-z0-9_.-]/g, "_")}.pdf`;
}

async function getAccessToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not authenticated");
  return token;
}

export function useIssueVariation() {
  const qc = useQueryClient();

  return useMutation<IssueVariationResult, IssueError, IssueVariationInput>({
    mutationFn: async ({ variationId }) => {
      const bundle = await fetchBundle(variationId).catch((e) => {
        throw {
          kind: "db",
          message: e instanceof Error ? e.message : String(e),
        } satisfies IssueError;
      });

      const userRes = await supabase.auth.getUser();
      const issuedByEmail = userRes.data.user?.email ?? null;

      const citationsForBuild: BuildSnapshotCitation[] = bundle.citations.map(
        (c) => ({
          row: c,
          source_label: bundle.sourceLabels.get(c.id) ?? "",
        }),
      );

      const snapshot = buildSnapshot({
        rev: {
          id: bundle.variation.id,
          quote_id: bundle.variation.project_id,
          rev_number: bundle.variation.variation_number,
          status: "draft",
          summary: bundle.variation.summary,
          issued_at: null,
          issued_by: null,
          snapshot_json: null,
          pdf_storage_key: null,
          dropbox_content_hash: null,
          created_at: bundle.variation.created_at,
          updated_at: bundle.variation.updated_at,
          created_by: null,
        },
        quote: {
          id: bundle.variation.project_id,
          project_id: bundle.variation.project_id,
          number: `${bundle.project.job_code}-V${bundle.variation.variation_number}`,
          status: "draft",
          created_at: bundle.variation.created_at,
          updated_at: bundle.variation.updated_at,
          created_by: null,
        },
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
        kind: "variation",
        citations: citationsForBuild,
      });

      if (!["awarded", "in_progress"].includes(bundle.project.stage)) {
        throw {
          kind: "validation",
          errors: [
            {
              field: "project.stage",
              message:
                "Variations require an awarded or in-progress project.",
            },
          ],
        } satisfies IssueError;
      }

      const verdict = validateForIssue({
        project: {
          customer_id: bundle.project.customer_id,
          job_code: bundle.project.job_code,
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

      const filename = safeFilename(snapshot, bundle.variation);
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
            rev_id: variationId,
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

      const { data, error } = await supabase.rpc("issue_variation", {
        _variation_id: variationId,
        _snapshot: snapshot,
        _storage_key: storage_key,
      });
      if (error) {
        throw { kind: "db", message: error.message } satisfies IssueError;
      }

      return { variation: data as Variation, snapshot, storage_key };
    },
    onSuccess: (_, { variationId }) => {
      qc.invalidateQueries({ queryKey: ["variations"] });
      qc.invalidateQueries({ queryKey: ["variations", "by-id", variationId] });
      qc.invalidateQueries({
        queryKey: ["variation-citations", variationId],
      });
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
