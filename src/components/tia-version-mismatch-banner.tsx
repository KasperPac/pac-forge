import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTiaVersionMismatch } from "@/hooks/use-tia-version-mismatch";

interface TiaVersionMismatchBannerProps {
  projectVersion: string | null | undefined;
}

/**
 * Non-blocking amber warning shown when a project's stored TIA version does not match
 * the TIA Portal version detected by the bridge. Dismissible per page load — reappears
 * on next render if the mismatch persists (intentional, acts as a guardrail, not a toast).
 */
export function TiaVersionMismatchBanner({ projectVersion }: TiaVersionMismatchBannerProps) {
  const { mismatch, bridgeVersion } = useTiaVersionMismatch(projectVersion);
  const [dismissed, setDismissed] = useState(false);

  if (!mismatch || dismissed) return null;

  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
          <div className="min-w-0 space-y-0.5">
            <div className="font-mono text-xs font-medium text-amber-400">
              TIA Portal version mismatch
            </div>
            <div className="text-xs text-muted-foreground">
              Project targets{" "}
              <span className="font-mono text-amber-400">{projectVersion}</span> but the
              bridge has{" "}
              <span className="font-mono text-amber-400">{bridgeVersion}</span> installed.
              Generated SimaticML will be stamped with{" "}
              <span className="font-mono">{projectVersion}</span>, and any import via this
              bridge will upgrade the target project to{" "}
              <span className="font-mono">{bridgeVersion}</span> — it cannot be saved back
              to the original version.
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 shrink-0 p-0 text-muted-foreground hover:text-foreground"
          onClick={() => setDismissed(true)}
          title="Dismiss"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
