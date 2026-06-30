import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAllQuotes } from "@/hooks/use-quotes";
import { useProjects } from "@/hooks/use-projects";
import { useCustomers } from "@/hooks/use-customers";
import { QuoteCard } from "@/components/quotes/quote-card";
import type { QuoteRevision, QuoteStatus, ProjectStage } from "@/types";
import { QUOTE_STATUSES, PROJECT_STAGES } from "@/types";

function useAllRevisions() {
  return useQuery({
    queryKey: ["quote-revisions", "all"],
    queryFn: async (): Promise<QuoteRevision[]> => {
      const { data, error } = await supabase
        .from("quote_revisions")
        .select("*")
        .order("rev_number");
      if (error) throw error;
      return data as QuoteRevision[];
    },
  });
}

export default function QuotesRoute() {
  const { data: quotes = [], isLoading } = useAllQuotes();
  const { data: revisions = [] } = useAllRevisions();
  const { data: projects = [] } = useProjects();
  const { data: customers = [] } = useCustomers();

  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );
  const customerMap = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers],
  );
  const revsByQuote = useMemo(() => {
    const m = new Map<string, QuoteRevision[]>();
    for (const r of revisions) {
      const arr = m.get(r.quote_id) ?? [];
      arr.push(r);
      m.set(r.quote_id, arr);
    }
    return m;
  }, [revisions]);

  const [statusFilter, setStatusFilter] = useState<QuoteStatus | "all">("all");
  const [stageFilter, setStageFilter] = useState<ProjectStage | "all">("all");
  const [customerFilter, setCustomerFilter] = useState<string>("all");

  const visible = quotes.filter((q) => {
    if (statusFilter !== "all" && q.status !== statusFilter) return false;
    const project = projectMap.get(q.project_id);
    if (!project) return false;
    if (stageFilter !== "all" && project.stage !== stageFilter) return false;
    if (customerFilter !== "all" && project.customer_id !== customerFilter)
      return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-foreground">Quotes</h1>
        <p className="text-xs font-mono text-muted-foreground mt-1">
          All quotes across projects. Filter by status / stage / customer.
        </p>
      </header>

      <div className="flex flex-wrap gap-3 items-end p-3 rounded-md border border-border bg-card">
        <Filter
          label="Quote status"
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as QuoteStatus | "all")}
          options={[
            { value: "all", label: "All" },
            ...QUOTE_STATUSES.map((s) => ({ value: s, label: s })),
          ]}
        />
        <Filter
          label="Project stage"
          value={stageFilter}
          onChange={(v) => setStageFilter(v as ProjectStage | "all")}
          options={[
            { value: "all", label: "All" },
            ...PROJECT_STAGES.map((s) => ({ value: s, label: s })),
          ]}
        />
        <Filter
          label="Customer"
          value={customerFilter}
          onChange={setCustomerFilter}
          options={[
            { value: "all", label: "All" },
            ...customers.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <div className="ml-auto text-[11px] font-mono text-muted-foreground pb-1">
          Showing {visible.length} of {quotes.length}
        </div>
      </div>

      {isLoading ? (
        <p className="text-xs font-mono text-muted-foreground">Loading quotes…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm font-mono text-muted-foreground rounded-md border border-dashed border-border bg-muted/40 p-6">
          No quotes match these filters.
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {visible.map((quote) => {
            const project = projectMap.get(quote.project_id);
            const customer = project?.customer_id
              ? customerMap.get(project.customer_id)
              : undefined;
            const revs = revsByQuote.get(quote.id) ?? [];
            return (
              <QuoteCard
                key={quote.id}
                quote={quote}
                project={project}
                customer={customer}
                revisions={revs}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-background border border-border rounded px-2 py-1 text-xs font-mono text-foreground focus:border-pac-blue-600 outline-none min-w-[140px]"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
