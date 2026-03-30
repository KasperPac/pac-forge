/**
 * Read-only LAD (Ladder Logic) viewer for FB Library template cards.
 * Parses SimaticML XML and renders using the existing LAD canvas.
 */

import { useMemo, useState } from "react";
import { parseLadXml } from "@/lib/lad-xml-parser";
import { LadCanvas } from "@/components/lad-editor/lad-canvas";
import { Loader2 } from "lucide-react";
import type { LadProgram } from "@/types/lad";

interface LadViewerProps {
  /** Raw SimaticML XML content */
  xml: string;
  /** Height class for the viewer container */
  className?: string;
}

export function LadViewer({ xml, className }: LadViewerProps) {
  const [_selected, _setSelected] = useState<string | null>(null);

  const parseResult = useMemo((): { program: LadProgram | null; error: string | null } => {
    try {
      const program = parseLadXml(xml);
      return { program, error: null };
    } catch (err) {
      return { program: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [xml]);

  if (parseResult.error) {
    return (
      <div className={`flex items-center justify-center rounded border border-destructive/30 bg-destructive/5 p-4 ${className ?? ""}`}>
        <p className="font-mono text-xs text-destructive">
          Failed to parse LAD XML: {parseResult.error}
        </p>
      </div>
    );
  }

  if (!parseResult.program) {
    return (
      <div className={`flex items-center justify-center p-4 ${className ?? ""}`}>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (parseResult.program.rungs.length === 0) {
    return (
      <div className={`flex items-center justify-center rounded border border-border/50 bg-muted/30 p-4 ${className ?? ""}`}>
        <p className="font-mono text-xs text-muted-foreground">
          No LAD networks found in this block
        </p>
      </div>
    );
  }

  return (
    <div className={`overflow-hidden rounded border border-border/50 ${className ?? ""}`}>
      <LadCanvas
        program={parseResult.program}
        selectedId={null}
        onSelectElement={() => {}}
      />
    </div>
  );
}
