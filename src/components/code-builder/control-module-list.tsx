import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { CodeBuilderArtifactView } from "@/types/code-builder";
import type { CodegenLayer } from "@/lib/spec-builder/codegen";
import type { CodeBuilderUnitGroup } from "@/lib/spec-builder/code-builder-em-ui-model";

type Pill = "matched" | "stub" | "pending" | "approved";

/**
 * approved → the representative artifact is approved
 * stub     → group contains a FB artifact (stub generated, needs editing)
 * matched  → group has no FB (library template matched; only instance DB emitted)
 * pending  → fallback
 */
function pillForGroup(group: CodeBuilderArtifactView[]): Pill {
  const rep = group.find((a) => a.type === "FB") ?? group[0];
  if (rep.status === "approved") return "approved";
  if (group.some((a) => a.type === "FB")) return "stub";
  if (group.every((a) => a.type === "DB")) return "matched";
  return "pending";
}

const PILL_STYLE: Record<Pill, string> = {
  matched: "bg-blue-100 text-blue-700",
  approved: "bg-emerald-100 text-emerald-700",
  stub: "bg-orange-100 text-orange-700",
  pending: "bg-muted text-muted-foreground",
};

interface Row {
  rep: CodeBuilderArtifactView;
  pill: Pill;
  hasDrift: boolean;
}

/** Collapse a layer's artifacts into one row per owner (rep = FB if present). */
function buildRows(views: CodeBuilderArtifactView[]): Row[] {
  const ownerMap = new Map<string, CodeBuilderArtifactView[]>();
  for (const a of views) {
    const key = a.owner_id ?? a.artifact_name;
    const existing = ownerMap.get(key);
    if (existing) existing.push(a);
    else ownerMap.set(key, [a]);
  }
  return Array.from(ownerMap.values()).map((group) => ({
    rep: group.find((a) => a.type === "FB") ?? group[0],
    pill: pillForGroup(group),
    hasDrift: group.some((a) => a.drift),
  }));
}

function RowButton({
  row, selected, onSelect,
}: {
  row: Row; selected: string | null; onSelect: (name: string) => void;
}) {
  const { rep, pill, hasDrift } = row;
  return (
    <button
      type="button"
      aria-current={selected === rep.artifact_name ? "true" : undefined}
      onClick={() => onSelect(rep.artifact_name)}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-accent",
        selected === rep.artifact_name && "bg-accent border-l-2 border-primary",
      )}
    >
      <span className="font-mono truncate">{rep.owner_name ?? rep.artifact_name}</span>
      <span className={cn("ml-auto rounded-full px-1.5 py-0.5 text-[9px]", PILL_STYLE[pill])}>{pill}</span>
      {hasDrift && <Badge variant="destructive" className="text-[9px] px-1">drift</Badge>}
    </button>
  );
}

export function ControlModuleList({
  artifacts, layer, unitGroups = [], selected, onSelect,
}: {
  artifacts: CodeBuilderArtifactView[];
  layer: CodegenLayer;
  unitGroups?: CodeBuilderUnitGroup[];
  selected: string | null;
  onSelect: (name: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const layerArtifacts = artifacts.filter((a) => a.layer === layer);
  const rows = buildRows(layerArtifacts);

  // Device layer: unchanged flat list.
  if (layer !== "em") {
    return (
      <div className="flex flex-col divide-y" data-testid="cm-list">
        {rows.map((row) => (
          <RowButton key={row.rep.artifact_name} row={row} selected={selected} onSelect={onSelect} />
        ))}
        {rows.length === 0 && (
          <div className="space-y-1.5 px-3 py-6 text-center text-[11px] text-muted-foreground">
            <p>No standalone device FBs in this project.</p>
            <p>
              All control modules are basic control inlined into their EM blocks
              and MAP_* FCs — see the <span className="font-semibold">EM step</span>.
            </p>
            <p>
              To get a standalone device FB, assign a library template in
              Controls Data → Engineering (fb_assignments).
            </p>
          </div>
        )}
      </div>
    );
  }

  // EM layer: bucket EM rows under their Unit.
  const rowByEm = new Map<string, Row>();
  for (const row of rows) rowByEm.set(row.rep.owner_id ?? row.rep.artifact_name, row);

  const claimed = new Set<string>();
  const sections = unitGroups.map((g) => {
    const groupRows = g.emIds.map((id) => rowByEm.get(id)).filter((r): r is Row => !!r);
    groupRows.forEach((r) => claimed.add(r.rep.owner_id ?? r.rep.artifact_name));
    return { id: g.unitId, name: g.unitName, rows: groupRows };
  });
  const ungrouped = rows.filter((r) => !claimed.has(r.rep.owner_id ?? r.rep.artifact_name));
  if (ungrouped.length) sections.push({ id: "__ungrouped__", name: "Ungrouped", rows: ungrouped });

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col" data-testid="cm-list">
      {sections.map((sec) => {
        const isCollapsed = collapsed.has(sec.id);
        return (
          <div key={sec.id} className="border-b">
            <button
              type="button"
              onClick={() => toggle(sec.id)}
              className="flex w-full items-center gap-1 bg-muted/40 px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted"
            >
              {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {sec.name}
            </button>
            {!isCollapsed && (
              <div className="flex flex-col divide-y">
                {sec.rows.map((row) => (
                  <RowButton key={row.rep.artifact_name} row={row} selected={selected} onSelect={onSelect} />
                ))}
                {sec.rows.length === 0 && (
                  <div className="px-3 py-3 text-center text-[10px] text-muted-foreground">No equipment modules.</div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {sections.length === 0 && (
        <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">No EM artifacts.</div>
      )}
    </div>
  );
}
