import { useState } from "react";
import { Button } from "@/components/ui/button";
import { computeDiff } from "@/lib/diff-engine";
import type { CodeBuilderVersionRow } from "@/types/code-builder";

/** Pull this FB's snapshot content out of a version payload by name. */
function fbContent(v: CodeBuilderVersionRow, fbName: string): string {
  return v.payload.artifacts.find((a) => a.artifact_name === fbName)?.content ?? "";
}

export function FbVersionHistory({
  fbName, currentContent, versions, saving, restoring, onSaveVersion, onRestore,
}: {
  fbName: string;
  currentContent: string;
  versions: CodeBuilderVersionRow[];
  saving: boolean;
  restoring: boolean;
  onSaveVersion: () => void;
  onRestore: (version: CodeBuilderVersionRow) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = versions.find((v) => v.id === selectedId) ?? null;
  const diff = selected ? computeDiff(fbContent(selected, fbName), currentContent) : null;

  return (
    <div className="flex flex-col gap-2 p-3 text-[11px]" data-testid="version-history">
      <div className="flex items-center gap-2">
        <span className="font-semibold">Versions</span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-6 text-[9px]"
          data-testid="save-version"
          disabled={saving}
          onClick={onSaveVersion}
        >
          {saving ? "Saving…" : "Save version"}
        </Button>
      </div>

      {versions.length === 0 ? (
        <div className="text-muted-foreground">No versions yet.</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {versions.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                data-testid={`version-${v.id}`}
                onClick={() => setSelectedId(v.id)}
                className={`w-full rounded border px-2 py-1 text-left ${selectedId === v.id ? "bg-muted" : ""}`}
              >
                <div className="font-mono text-[9px] text-muted-foreground">{new Date(v.created_at).toLocaleString()}</div>
                <div>{v.note || "(no note)"}</div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && diff && (
        <div className="flex flex-col gap-1 rounded border p-2" data-testid="version-diff">
          <div className="text-muted-foreground">
            vs current: <span className="text-green-600">+{diff.addedCount}</span>{" "}
            <span className="text-red-600">-{diff.removedCount}</span>
          </div>
          <Button
            size="sm"
            className="h-6 w-fit text-[9px]"
            data-testid={`restore-${selected.id}`}
            disabled={restoring}
            onClick={() => onRestore(selected)}
          >
            {restoring ? "Restoring…" : "Restore this version"}
          </Button>
        </div>
      )}
    </div>
  );
}
