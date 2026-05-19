import { Link } from "react-router";
import { FileText, Pencil, Eye } from "lucide-react";
import type {
  Customer,
  Project,
  Quote,
  QuoteRevision,
  QuoteStatus,
} from "@/types";
import { cn } from "@/lib/utils";

interface QuoteCardProps {
  quote: Quote;
  project?: Project;
  customer?: Customer;
  revisions: QuoteRevision[];
}

const STATUS_STYLES: Record<QuoteStatus, string> = {
  draft: "bg-zinc-800 text-zinc-300 border-zinc-700",
  issued: "bg-[#3050A0]/30 text-[#94AEDF] border-[#3050A0]",
  superseded: "bg-zinc-800 text-zinc-500 border-zinc-700",
  awarded: "bg-emerald-900/40 text-emerald-300 border-emerald-800",
  lost: "bg-red-900/30 text-red-300 border-red-900",
};

export function QuoteCard({ quote, project, customer, revisions }: QuoteCardProps) {
  const sortedRevs = [...revisions].sort((a, b) => b.rev_number - a.rev_number);
  const latest = sortedRevs[0];
  const editTarget = sortedRevs.find((r) => r.status === "draft");

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-zinc-400" />
            <span className="font-mono text-sm text-zinc-100">{quote.number}</span>
            <span
              className={cn(
                "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border",
                STATUS_STYLES[quote.status],
              )}
            >
              {quote.status}
            </span>
          </div>
          <div className="mt-1 text-xs font-mono text-zinc-400 truncate">
            {project?.project_name ?? project?.project_number ?? "Project"}
            {customer ? ` · ${customer.name}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {editTarget && quote.status !== "awarded" && (
            <Link
              to={`/quotes/${editTarget.id}/edit`}
              className="inline-flex items-center gap-1 text-xs font-mono px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              <Pencil className="h-3 w-3" />
              Edit draft
            </Link>
          )}
          {latest && latest.status !== "draft" && (
            <Link
              to={`/quotes/${latest.id}/view`}
              className="inline-flex items-center gap-1 text-xs font-mono px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              <Eye className="h-3 w-3" />
              View Rev {latest.rev_number}
            </Link>
          )}
        </div>
      </div>

      {sortedRevs.length > 0 ? (
        <ul className="grid grid-cols-1 gap-1 text-xs font-mono">
          {sortedRevs.slice(0, 4).map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3">
              <Link
                to={
                  r.status === "draft"
                    ? `/quotes/${r.id}/edit`
                    : `/quotes/${r.id}/view`
                }
                className="text-zinc-300 hover:text-white"
              >
                Rev {r.rev_number}
              </Link>
              <span className="text-zinc-500">
                {r.status}
                {r.issued_at
                  ? ` · ${new Date(r.issued_at).toLocaleDateString()}`
                  : ""}
              </span>
            </li>
          ))}
          {sortedRevs.length > 4 && (
            <li className="text-zinc-500">+ {sortedRevs.length - 4} more</li>
          )}
        </ul>
      ) : (
        <p className="text-xs font-mono text-zinc-500">No revisions yet.</p>
      )}
    </div>
  );
}
