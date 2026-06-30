import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { CodeBuilderArtifactView } from "@/types/code-builder";

export function ArtifactPanel({
  artifact, editing, onEdit, onSave, onApprove, saving, approving, approveDisabled = false,
}: {
  artifact: CodeBuilderArtifactView | null;
  editing: boolean;
  onEdit: () => void;
  onSave: () => void;
  onApprove: () => void;
  saving: boolean;
  approving: boolean;
  approveDisabled?: boolean;
}) {
  if (!artifact) {
    return <div className="p-3 text-[11px] text-muted-foreground">No selection.</div>;
  }
  return (
    <div className="flex flex-col gap-2 p-3 text-[11px]" data-testid="artifact-panel">
      <div className="font-mono font-semibold">{artifact.artifact_name}</div>
      <div className="text-muted-foreground">{artifact.type} · SCL</div>
      {artifact.drift && <Badge variant="destructive" className="w-fit text-[9px]">FDS changed since review</Badge>}
      <div>Folder: <span className="font-mono">{artifact.folder}</span></div>
      <div>Deps: <span className="font-mono">{artifact.dependencies.join(", ") || "—"}</span></div>
      <div className="mt-2 flex gap-2">
        {editing ? (
          <Button size="sm" className="h-7 text-[11px]" disabled={saving} onClick={onSave}>Save</Button>
        ) : (
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onEdit}>Edit</Button>
        )}
        <Button
          size="sm"
          className="h-7 text-[11px]"
          disabled={approving || approveDisabled || artifact.status === "approved"}
          onClick={onApprove}
        >
          {artifact.status === "approved" ? "Approved" : "Approve"}
        </Button>
      </div>
    </div>
  );
}
