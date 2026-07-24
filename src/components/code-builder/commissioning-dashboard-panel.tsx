/**
 * Commissioning Dashboard panel (G7-9) — Code Builder shell toolbar action.
 * Packs the deterministic commissioning-dashboard bundle (static runtime +
 * generated model/README) for this spec revision into a zip and downloads it.
 *
 * Sits directly in the header toolbar (like SendToTiaPanel / HmiBuildPanel)
 * rather than behind a Dialog — it's a single one-shot action, not a
 * multi-step review flow, so there is nothing to preview before committing.
 *
 * Guards Generate against firing before FB templates have loaded: the
 * underlying `useGenerateDashboard` hook compiles against whatever
 * `useFbTemplates` currently holds, so a click during the initial load would
 * silently compile against `[]` and produce a wrong bundle (Task 8 review
 * finding). We read `useFbTemplates` here too — cheap, already cached by
 * React Query — and disable the button with a hint until `data` is defined.
 */
import { LayoutDashboard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGenerateDashboard } from "@/hooks/use-generate-dashboard";
import { useFbTemplates } from "@/hooks/use-fb-templates";

interface CommissioningDashboardPanelProps {
  specId: string;
  projectName: string;
  revision: number;
}

export function CommissioningDashboardPanel({ specId, projectName, revision }: CommissioningDashboardPanelProps) {
  const { generate, isGenerating, warnings } = useGenerateDashboard();
  const { data: templates } = useFbTemplates();
  const templatesReady = templates !== undefined;

  async function onGenerate() {
    const blob = await generate(specId, {
      name: projectName,
      revision,
      generatedNote: `Generated for ${projectName} rev ${revision}.`,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectName.replace(/[^A-Za-z0-9]/g, "_")}-commissioning-hmi.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 px-2.5 text-[11px]"
        disabled={isGenerating || !templatesReady}
        title={
          templatesReady
            ? "Generate a portable web dashboard for this project — connect it to the PLCSIM sim (bridge) or a real PLC (Web API)."
            : "Waiting for FB templates to load…"
        }
        onClick={onGenerate}
      >
        {isGenerating ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <LayoutDashboard className="h-3.5 w-3.5" />
        )}
        {isGenerating ? "Generating…" : "Generate & Download"}
      </Button>
      {!templatesReady && !isGenerating && (
        <span className="text-[10px] text-muted-foreground">Loading templates…</span>
      )}
      {warnings.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {warnings.map((w, i) => (
            <span key={i} className="text-[10px] text-amber-700">
              {w}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
