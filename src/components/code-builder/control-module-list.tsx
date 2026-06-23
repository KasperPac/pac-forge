import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { CodeBuilderArtifactView } from "@/types/code-builder";

type Pill = "matched" | "stub" | "pending" | "approved";

/**
 * Per-owner group: stub devices emit FB + DB; matched devices emit only DB.
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
  matched: "bg-emerald-100 text-emerald-700",
  approved: "bg-emerald-100 text-emerald-700",
  stub: "bg-orange-100 text-orange-700",
  pending: "bg-muted text-muted-foreground",
};

export function ControlModuleList({
  artifacts, selected, onSelect,
}: {
  artifacts: CodeBuilderArtifactView[];
  selected: string | null;
  onSelect: (name: string) => void;
}) {
  // Group device-layer artifacts by owner_id (fall back to artifact_name).
  const deviceArtifacts = artifacts.filter((a) => a.layer === "device");

  const ownerMap = new Map<string, CodeBuilderArtifactView[]>();
  for (const a of deviceArtifacts) {
    const key = a.owner_id ?? a.artifact_name;
    const existing = ownerMap.get(key);
    if (existing) {
      existing.push(a);
    } else {
      ownerMap.set(key, [a]);
    }
  }

  // One row per owner: representative is the FB if present, else the first artifact.
  const rows = Array.from(ownerMap.values()).map((group) => {
    const rep = group.find((a) => a.type === "FB") ?? group[0];
    const pill = pillForGroup(group);
    const hasDrift = group.some((a) => a.drift);
    return { rep, pill, hasDrift };
  });

  return (
    <div className="flex flex-col divide-y" data-testid="cm-list">
      {rows.map(({ rep, pill, hasDrift }) => (
        <button
          key={rep.artifact_name}
          type="button"
          onClick={() => onSelect(rep.artifact_name)}
          className={cn(
            "flex items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-accent",
            selected === rep.artifact_name && "bg-accent border-l-2 border-primary",
          )}
        >
          <span className="font-mono truncate">{rep.owner_name ?? rep.artifact_name}</span>
          <span className={cn("ml-auto rounded-full px-1.5 py-0.5 text-[9px]", PILL_STYLE[pill])}>{pill}</span>
          {hasDrift && <Badge variant="destructive" className="text-[9px] px-1">drift</Badge>}
        </button>
      ))}
      {rows.length === 0 && (
        <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">No device artifacts.</div>
      )}
    </div>
  );
}
