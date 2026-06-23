import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { CodeBuilderArtifactView } from "@/types/code-builder";

type Pill = "matched" | "stub" | "pending" | "approved";

function pillFor(a: CodeBuilderArtifactView): Pill {
  if (a.status === "approved") return "approved";
  // A stub FB names itself CM_<name>; a matched template instance DB names itself <Block>_<name>_DB.
  if (a.type === "FB") return "stub";
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
  // Show one row per FB-or-DB device artifact, grouped by owner name.
  const rows = artifacts.filter((a) => a.layer === "device");
  return (
    <div className="flex flex-col divide-y" data-testid="cm-list">
      {rows.map((a) => {
        const pill = pillFor(a);
        return (
          <button
            key={a.artifact_name}
            type="button"
            onClick={() => onSelect(a.artifact_name)}
            className={cn(
              "flex items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-accent",
              selected === a.artifact_name && "bg-accent border-l-2 border-primary",
            )}
          >
            <span className="font-mono truncate">{a.owner_name ?? a.artifact_name}</span>
            <span className={cn("ml-auto rounded-full px-1.5 py-0.5 text-[9px]", PILL_STYLE[pill])}>{pill}</span>
            {a.drift && <Badge variant="destructive" className="text-[9px] px-1">drift</Badge>}
          </button>
        );
      })}
      {rows.length === 0 && (
        <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">No device artifacts.</div>
      )}
    </div>
  );
}
