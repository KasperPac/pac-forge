import { useMemo } from "react";
import { Plus } from "lucide-react";
import {
  useQuotesForProject,
  useCreateQuote,
} from "@/hooks/use-quotes";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useNavigate } from "react-router";
import { QuoteCard } from "@/components/quotes/quote-card";
import { useCustomer } from "@/hooks/use-customers";
import type { QuoteRevision, Project } from "@/types";

interface Props {
  project: Project;
}

function useProjectRevisions(projectId: string | undefined, quoteIds: string[]) {
  return useQuery({
    queryKey: ["quote-revisions", "for-project", projectId, quoteIds],
    enabled: !!projectId && quoteIds.length > 0,
    queryFn: async (): Promise<QuoteRevision[]> => {
      const { data, error } = await supabase
        .from("quote_revisions")
        .select("*")
        .in("quote_id", quoteIds);
      if (error) throw error;
      return data as QuoteRevision[];
    },
  });
}

export function ProjectCommercialTab({ project }: Props) {
  const navigate = useNavigate();
  const { data: customer } = useCustomer(project.customer_id ?? undefined);
  const { data: quotes = [], isLoading } = useQuotesForProject(project.id);
  const quoteIds = useMemo(() => quotes.map((q) => q.id), [quotes]);
  const { data: revisions = [] } = useProjectRevisions(project.id, quoteIds);
  const createQuote = useCreateQuote();

  const revsByQuote = useMemo(() => {
    const m = new Map<string, QuoteRevision[]>();
    for (const r of revisions) {
      const arr = m.get(r.quote_id) ?? [];
      arr.push(r);
      m.set(r.quote_id, arr);
    }
    return m;
  }, [revisions]);

  async function createNewQuote() {
    if (project.stage === "awarded") return;
    const seq = quotes.length + 1;
    const number = `${project.job_code ?? "PRJ"}-Q${String(seq).padStart(2, "0")}`;
    const { quote, rev } = await createQuote.mutateAsync({
      project_id: project.id,
      number,
    });
    navigate(`/quotes/${rev.id}/edit`, { state: { quoteId: quote.id } });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">Quotes</h2>
          <p className="text-xs font-mono text-zinc-500 mt-0.5">
            One quote per opportunity; multiple revisions per quote.
          </p>
        </div>
        <button
          type="button"
          onClick={createNewQuote}
          disabled={
            createQuote.isPending || project.stage === "awarded" || !project.job_code
          }
          title={
            !project.job_code
              ? "Project needs a job_code before a quote can be created"
              : project.stage === "awarded"
                ? "Project already awarded"
                : undefined
          }
          className="inline-flex items-center gap-1 text-xs font-mono px-3 py-1.5 rounded bg-[#3050A0] text-white hover:bg-[#3F61B0] disabled:opacity-50"
        >
          <Plus className="h-3 w-3" />
          {createQuote.isPending ? "Creating…" : "New quote"}
        </button>
      </div>

      {isLoading ? (
        <p className="text-xs font-mono text-zinc-500">Loading…</p>
      ) : quotes.length === 0 ? (
        <p className="text-sm font-mono text-zinc-500 rounded-md border border-dashed border-zinc-700 bg-zinc-900/40 p-6">
          No quotes yet on this project.
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {quotes.map((q) => (
            <QuoteCard
              key={q.id}
              quote={q}
              project={project}
              customer={customer}
              revisions={revsByQuote.get(q.id) ?? []}
            />
          ))}
        </div>
      )}

      <div className="border-t border-zinc-800 pt-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
        <PlaceholderCard
          title="Variations"
          description="Issued change-order documents off the awarded quote."
        />
        <PlaceholderCard
          title="Legacy documents"
          description="Imported PDFs from before Pac-Quote."
        />
      </div>
    </div>
  );
}

function PlaceholderCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
        <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700">
          v2
        </span>
      </div>
      <p className="text-xs font-mono text-zinc-500 mt-1">{description}</p>
    </div>
  );
}
