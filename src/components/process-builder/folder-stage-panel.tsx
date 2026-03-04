import { useProcessBuilderStore } from "@/stores/process-builder-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FolderTree } from "lucide-react";

/** Shows the generated folder structure in the Folder stage. */
export function FolderStageContext() {
  const folderStructure = useProcessBuilderStore((s) => s.folderStructure);

  const folders = (folderStructure as { folders?: Array<{ path: string; description: string }> })
    ?.folders;

  if (!folders || folders.length === 0) {
    return (
      <div className="px-3 py-2 font-mono text-xs text-muted-foreground">
        Run the stage to generate a TIA Portal folder structure.
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
        <FolderTree className="h-3 w-3" />
        FOLDER STRUCTURE ({folders.length})
      </div>
      <ScrollArea className="max-h-48">
        <div className="space-y-0.5 px-3 pb-2">
          {folders.map((f, i) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded-sm bg-muted/50 px-2 py-1 font-mono text-[11px]"
            >
              <span className="font-medium">{f.path}</span>
              {f.description && (
                <span className="truncate text-muted-foreground">{f.description}</span>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
