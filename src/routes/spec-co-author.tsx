/**
 * Phase 3 — FDS Co-Author full-screen route.
 *
 * URL: /specs/:projectId/:specId/co-author
 */
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Code2, Layers, Loader2, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FdsCoAuthor } from "@/components/spec-builder/fds-co-author";
import { ProcessModelPanel } from "@/components/spec-builder/process-model-panel";
import {
  useSpecProject,
  useInstrumentRegister,
} from "@/hooks/use-spec-projects";
import { useUnconfirmedLock } from "@/hooks/use-unconfirmed-lock";
import { UnconfirmedLockBanner } from "@/components/spec-builder/unconfirmed-lock-banner";
import { migrateUnitConfig } from "@/types/spec-builder";
import { useSpecCodegen } from "@/hooks/use-spec-codegen";
import { buildManifest } from "@/lib/manifest-builder";
import { downloadExportBundle } from "@/lib/tia-export";
import { supabase } from "@/lib/supabase";

type CoAuthorView = "fds" | "process-model";

export default function SpecCoAuthorPage() {
  const { projectId, specId } = useParams<{ projectId: string; specId: string }>();
  const { isUnconfirmed } = useUnconfirmedLock(projectId ?? "", specId ?? "");
  const { data: rawSpec, isLoading } = useSpecProject(specId);
  const { data: register } = useInstrumentRegister(specId);
  const [view, setView] = useState<CoAuthorView>("fds");
  const { generate, running: codegenRunning } = useSpecCodegen();

  const spec = useMemo(() => {
    if (!rawSpec) return null;
    return {
      ...rawSpec,
      confirmed_units: rawSpec.confirmed_units?.length
        ? migrateUnitConfig(rawSpec.confirmed_units)
        : [],
      scope_exclusions: rawSpec.scope_exclusions ?? [],
      design_principles: rawSpec.design_principles ?? [],
    };
  }, [rawSpec]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!projectId || !specId || !spec) {
    return <SpecNotFound projectId={projectId} specId={specId} />;
  }

  async function handleGenerate() {
    if (!specId || !spec) return;
    try {
      const { result, artifacts } = await generate(specId);
      const { data: { user } } = await supabase.auth.getUser();
      const { manifest } = buildManifest(artifacts, {
        projectId: specId,
        tiaVersion: "V18",
        cpuType: spec.plc_model ?? "CPU 1516",
        userId: user?.id ?? "",
        sessionId: specId,
      });
      await downloadExportBundle(artifacts, manifest, spec.doc_code);
      if (result.stubs.controlModules.length > 0 || result.stubs.equipmentModules.length > 0) {
        // TODO: surface stub summary in a toast when a toast utility is available
        console.warn("[useSpecCodegen] Stub summary:", result.stubs);
      }
    } catch (e) {
      console.error("[useSpecCodegen] Generation failed:", e);
    }
  }

  if (!register) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="max-w-md p-6 space-y-3">
          <h2 className="text-sm font-semibold">Instrument register required</h2>
          <p className="text-xs text-muted-foreground">
            Upload the instrument register in Phase 1 before using the co-author.
          </p>
          <Link
            to={`/specs?projectId=${projectId}`}
            className="text-xs underline"
          >
            Back to Spec Builder
          </Link>
        </Card>
      </div>
    );
  }

  const revisionLabel = (spec as unknown as { latest_approved_revision_id?: string | null })
    ?.latest_approved_revision_id;

  return (
    <div className="flex h-full flex-col -m-4">
      {isUnconfirmed && <UnconfirmedLockBanner />}
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-4 h-12 shrink-0">
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Back to Spec Builder"
        >
          <Link to={`/specs?projectId=${projectId}&specId=${specId}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-sm font-semibold font-mono">{spec.doc_code}</h1>
        <span className="text-xs text-muted-foreground truncate">{spec.title}</span>
        {/* View toggle */}
        <div className="flex items-center gap-1 ml-4 bg-muted rounded-md p-0.5">
          <Button
            variant={view === "fds" ? "secondary" : "ghost"}
            size="sm"
            className="h-6 text-[10px] gap-1 px-2"
            onClick={() => setView("fds")}
          >
            <MessageSquare className="h-3 w-3" />
            FDS Co-Author
          </Button>
          <Button
            variant={view === "process-model" ? "secondary" : "ghost"}
            size="sm"
            className="h-6 text-[10px] gap-1 px-2"
            onClick={() => setView("process-model")}
          >
            <Layers className="h-3 w-3" />
            Process Model
          </Button>
        </div>
        <Badge variant="outline" className="text-[10px] ml-auto">Phase 3 — Co-Author</Badge>
        <Badge variant="outline" className="text-[10px]">Rev {spec.revision}</Badge>
        {revisionLabel && (
          <Badge variant="secondary" className="text-[10px]" title={revisionLabel}>
            Approved
          </Badge>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px] gap-1.5 px-2.5"
          disabled={spec.confirmation_status !== "confirmed" || codegenRunning}
          onClick={() => { void handleGenerate(); }}
          title={spec.confirmation_status !== "confirmed" ? "Confirm the spec before generating SCL" : "Generate SCL and download as .zip"}
        >
          {codegenRunning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Code2 className="h-3.5 w-3.5" />
          )}
          {codegenRunning ? "Generating…" : "Generate SCL"}
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {view === "fds" ? (
          <FdsCoAuthor spec={spec} register={register} fullScreen />
        ) : (
          <ProcessModelPanel spec={spec} />
        )}
      </div>
    </div>
  );
}

function SpecNotFound({
  projectId,
  specId,
}: {
  projectId?: string;
  specId?: string;
}) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <Card className="max-w-md p-6 space-y-3">
        <h2 className="text-sm font-semibold">Spec not found</h2>
        <p className="text-xs text-muted-foreground font-mono">
          projectId: {projectId ?? "—"} · specId: {specId ?? "—"}
        </p>
        <Link
          to={projectId ? `/specs?projectId=${projectId}` : "/specs"}
          className="text-xs underline"
        >
          Back to Spec Builder
        </Link>
      </Card>
    </div>
  );
}
