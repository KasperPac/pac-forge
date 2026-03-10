import { useState, useMemo, useCallback } from "react";
import { Check, ChevronRight, ArrowRight, Plus, Minus, AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { IoEntry } from "@/types";

interface IoComparisonPanelProps {
  existingIoList: IoEntry[];
  suggestedIoList: IoEntry[];
  summaryText: string | null;
  onApply: (mergedIoList: IoEntry[]) => void;
  onDismiss: () => void;
}

type DiffStatus = "match" | "modified" | "added" | "removed";

interface IoComparisonRow {
  status: DiffStatus;
  existing: IoEntry | null;
  suggested: IoEntry | null;
  selected: boolean;
}

/**
 * Match existing and suggested IO entries by address.
 * Produces a unified diff view showing matches, modifications, additions, and removals.
 */
function buildComparisonRows(existing: IoEntry[], suggested: IoEntry[]): IoComparisonRow[] {
  const rows: IoComparisonRow[] = [];
  const existingByAddr = new Map<string, IoEntry>();
  const suggestedByAddr = new Map<string, IoEntry>();

  for (const e of existing) existingByAddr.set(e.address, e);
  for (const s of suggested) suggestedByAddr.set(s.address, s);

  // Process all existing entries
  const processedAddresses = new Set<string>();
  for (const e of existing) {
    const s = suggestedByAddr.get(e.address);
    if (s) {
      const isModified =
        e.tag_name !== s.tag_name ||
        e.data_type !== s.data_type ||
        e.description !== s.description ||
        e.module !== s.module ||
        e.slot !== s.slot;
      rows.push({
        status: isModified ? "modified" : "match",
        existing: e,
        suggested: s,
        selected: false,
      });
    } else {
      rows.push({
        status: "removed",
        existing: e,
        suggested: null,
        selected: false,
      });
    }
    processedAddresses.add(e.address);
  }

  // Process suggested entries not in existing (new additions)
  for (const s of suggested) {
    if (!processedAddresses.has(s.address)) {
      rows.push({
        status: "added",
        existing: null,
        suggested: s,
        selected: true, // Auto-select new entries
      });
    }
  }

  // Sort: matched first, then modified, then added, then removed
  const order: Record<DiffStatus, number> = { match: 0, modified: 1, added: 2, removed: 3 };
  rows.sort((a, b) => order[a.status] - order[b.status]);

  return rows;
}

const STATUS_COLORS: Record<DiffStatus, string> = {
  match: "text-muted-foreground",
  modified: "text-amber-400",
  added: "text-green-400",
  removed: "text-red-400",
};

const STATUS_LABELS: Record<DiffStatus, string> = {
  match: "Unchanged",
  modified: "Modified",
  added: "New",
  removed: "Removed",
};

const STATUS_BG: Record<DiffStatus, string> = {
  match: "",
  modified: "bg-amber-950/10",
  added: "bg-green-950/10",
  removed: "bg-red-950/10",
};

export function IoComparisonPanel({
  existingIoList,
  suggestedIoList,
  summaryText,
  onApply,
  onDismiss,
}: IoComparisonPanelProps) {
  const isComparisonMode = existingIoList.length > 0;
  const initialRows = useMemo(
    () => buildComparisonRows(existingIoList, suggestedIoList),
    [existingIoList, suggestedIoList],
  );

  const [rows, setRows] = useState(initialRows);
  const [filter, setFilter] = useState<DiffStatus | "all">("all");

  const counts = useMemo(() => {
    const c = { match: 0, modified: 0, added: 0, removed: 0 };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  const filteredRows = useMemo(
    () => filter === "all" ? rows : rows.filter((r) => r.status === filter),
    [rows, filter],
  );

  const toggleRow = useCallback((idx: number) => {
    setRows((prev) => prev.map((r, i) =>
      i === idx ? { ...r, selected: !r.selected } : r,
    ));
  }, []);

  const selectAll = useCallback((status: DiffStatus) => {
    setRows((prev) => prev.map((r) =>
      r.status === status ? { ...r, selected: true } : r,
    ));
  }, []);

  const deselectAll = useCallback((status: DiffStatus) => {
    setRows((prev) => prev.map((r) =>
      r.status === status ? { ...r, selected: false } : r,
    ));
  }, []);

  const handleApply = useCallback(() => {
    const merged: IoEntry[] = [];

    for (const row of rows) {
      if (row.status === "match") {
        // Keep existing unchanged entries
        merged.push(row.existing!);
      } else if (row.status === "modified") {
        // Use suggested version if selected, otherwise keep existing
        merged.push(row.selected ? row.suggested! : row.existing!);
      } else if (row.status === "added" && row.selected) {
        // Add new entries only if selected
        merged.push(row.suggested!);
      } else if (row.status === "removed" && !row.selected) {
        // Keep removed entries only if NOT selected for removal
        merged.push(row.existing!);
      }
      // If removed and selected → don't include (user confirms removal)
    }

    onApply(merged);
  }, [rows, onApply]);

  const selectedModified = rows.filter((r) => r.status === "modified" && r.selected).length;
  const selectedAdded = rows.filter((r) => r.status === "added" && r.selected).length;
  const selectedRemoved = rows.filter((r) => r.status === "removed" && r.selected).length;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div>
          <div className="font-mono text-sm font-medium">
            {isComparisonMode ? "IO List Comparison" : "Generated IO List"}
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">
            {isComparisonMode
              ? "Review AI-suggested changes to the IO list"
              : "Review AI-generated IO list before saving to project"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
          <Button size="sm" onClick={handleApply}>
            <Check className="mr-1.5 h-3 w-3" />
            {isComparisonMode
              ? `Apply (${selectedModified + selectedAdded} changes)`
              : `Save IO List (${selectedAdded} entries)`}
          </Button>
        </div>
      </div>

      {/* Summary */}
      {summaryText && (
        <div className="border-b bg-accent/20 px-4 py-2">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-400" />
            <div className="font-mono text-[11px] text-muted-foreground whitespace-pre-wrap">
              {summaryText.slice(0, 500)}
              {summaryText.length > 500 && "..."}
            </div>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-1 border-b px-3 py-1">
        <FilterTab label="All" count={rows.length} active={filter === "all"} onClick={() => setFilter("all")} />
        {counts.modified > 0 && (
          <FilterTab label="Modified" count={counts.modified} active={filter === "modified"} color="text-amber-400" onClick={() => setFilter("modified")} />
        )}
        {counts.added > 0 && (
          <FilterTab label="New" count={counts.added} active={filter === "added"} color="text-green-400" onClick={() => setFilter("added")} />
        )}
        {counts.removed > 0 && (
          <FilterTab label="Removed" count={counts.removed} active={filter === "removed"} color="text-red-400" onClick={() => setFilter("removed")} />
        )}
        {counts.match > 0 && (
          <FilterTab label="Unchanged" count={counts.match} active={filter === "match"} color="text-muted-foreground" onClick={() => setFilter("match")} />
        )}

        {/* Bulk actions */}
        {filter !== "all" && filter !== "match" && (
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 font-mono text-[10px]"
              onClick={() => selectAll(filter)}
            >
              Select all
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 font-mono text-[10px]"
              onClick={() => deselectAll(filter)}
            >
              Deselect all
            </Button>
          </div>
        )}
      </div>

      {/* Comparison table */}
      <ScrollArea className="min-h-0 flex-1">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b font-mono text-[10px] text-muted-foreground">
              <th className="w-8 px-1 py-1" />
              <th className="w-16 px-2 py-1 text-left">Status</th>
              <th className="px-2 py-1 text-left">Address</th>
              <th className="px-2 py-1 text-left">Existing Tag</th>
              <th className="w-6 px-0 py-1" />
              <th className="px-2 py-1 text-left">Suggested Tag</th>
              <th className="px-2 py-1 text-left">Type</th>
              <th className="px-2 py-1 text-left">Description</th>
              <th className="px-2 py-1 text-left">Module</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, idx) => {
              const globalIdx = rows.indexOf(row);
              const isSelectable = row.status !== "match";

              return (
                <tr
                  key={`${row.existing?.address ?? ""}-${row.suggested?.address ?? ""}-${idx}`}
                  className={cn(
                    "border-b border-border/30 transition-colors",
                    STATUS_BG[row.status],
                    isSelectable && "cursor-pointer hover:bg-accent/20",
                    row.selected && isSelectable && "ring-1 ring-inset ring-primary/30",
                  )}
                  onClick={() => isSelectable && toggleRow(globalIdx)}
                >
                  {/* Selection checkbox */}
                  <td className="px-1 py-1 text-center">
                    {isSelectable && (
                      <div
                        className={cn(
                          "mx-auto flex h-4 w-4 items-center justify-center rounded border",
                          row.selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/30",
                        )}
                      >
                        {row.selected && <Check className="h-3 w-3" />}
                      </div>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-2 py-1">
                    <div className={cn("flex items-center gap-1 font-mono text-[10px]", STATUS_COLORS[row.status])}>
                      {row.status === "added" && <Plus className="h-3 w-3" />}
                      {row.status === "removed" && <Minus className="h-3 w-3" />}
                      {row.status === "modified" && <AlertTriangle className="h-3 w-3" />}
                      {STATUS_LABELS[row.status]}
                    </div>
                  </td>

                  {/* Address */}
                  <td className="px-2 py-1 font-mono text-xs">
                    {row.existing?.address ?? row.suggested?.address ?? ""}
                  </td>

                  {/* Existing tag name */}
                  <td className={cn("px-2 py-1 font-mono text-xs", !row.existing && "text-muted-foreground/50")}>
                    {row.existing?.tag_name ?? "—"}
                  </td>

                  {/* Arrow */}
                  <td className="px-0 py-1">
                    {row.status === "modified" && (
                      <ArrowRight className="h-3 w-3 text-amber-400" />
                    )}
                  </td>

                  {/* Suggested tag name */}
                  <td className={cn(
                    "px-2 py-1 font-mono text-xs",
                    !row.suggested && "text-muted-foreground/50",
                    row.status === "modified" && row.existing?.tag_name !== row.suggested?.tag_name && "text-amber-300 font-semibold",
                  )}>
                    {row.suggested?.tag_name ?? "—"}
                  </td>

                  {/* Data type */}
                  <td className={cn(
                    "px-2 py-1 font-mono text-[10px]",
                    row.status === "modified" && row.existing?.data_type !== row.suggested?.data_type && "text-amber-300",
                  )}>
                    {row.status === "modified" && row.existing?.data_type !== row.suggested?.data_type
                      ? `${row.existing?.data_type} → ${row.suggested?.data_type}`
                      : (row.existing?.data_type ?? row.suggested?.data_type ?? "")}
                  </td>

                  {/* Description */}
                  <td className="max-w-[200px] truncate px-2 py-1 text-[11px] text-muted-foreground">
                    {row.status === "modified"
                      ? (row.suggested?.description ?? row.existing?.description ?? "")
                      : (row.existing?.description ?? row.suggested?.description ?? "")}
                  </td>

                  {/* Module */}
                  <td className="px-2 py-1 font-mono text-[10px] text-muted-foreground">
                    {row.existing?.module ?? row.suggested?.module ?? ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollArea>

      {/* Footer summary */}
      <div className="flex items-center gap-3 border-t px-4 py-1.5 font-mono text-[10px] text-muted-foreground">
        <span>Existing: {existingIoList.length}</span>
        <span>Suggested: {suggestedIoList.length}</span>
        <span className="text-amber-400">{selectedModified} update{selectedModified !== 1 ? "s" : ""}</span>
        <span className="text-green-400">{selectedAdded} addition{selectedAdded !== 1 ? "s" : ""}</span>
        {selectedRemoved > 0 && (
          <span className="text-red-400">{selectedRemoved} removal{selectedRemoved !== 1 ? "s" : ""}</span>
        )}
        <ChevronRight className="h-3 w-3" />
        <span>Result: {rows.filter((r) =>
          r.status === "match" ||
          (r.status === "modified") ||
          (r.status === "added" && r.selected) ||
          (r.status === "removed" && !r.selected)
        ).length} entries</span>
      </div>
    </div>
  );
}

function FilterTab({
  label,
  count,
  active,
  color,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  color?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[10px] transition-colors",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
        color,
      )}
    >
      {label}
      <Badge variant="outline" className="px-1 py-0 text-[9px]">{count}</Badge>
    </button>
  );
}
