/**
 * Phase 3 — FDS Co-Author full-screen route.
 *
 * URL: /specs/:projectId/:specId/co-author
 */
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FdsCoAuthor } from "@/components/spec-builder/fds-co-author";
import {
  useSpecProject,
  useInstrumentRegister,
} from "@/hooks/use-spec-projects";
import { useUnconfirmedLock } from "@/hooks/use-unconfirmed-lock";
import { UnconfirmedLockBanner } from "@/components/spec-builder/migrate/unconfirmed-lock-banner";
import {
  migrateSubsystemConfig,
  migrateOperatingStates,
} from "@/types/spec-builder";

export default function SpecCoAuthorPage() {
  const { projectId, specId } = useParams<{ projectId: string; specId: string }>();
  const { isUnconfirmed, migrateHref } = useUnconfirmedLock(projectId ?? "", specId ?? "");
  const { data: rawSpec, isLoading } = useSpecProject(specId);
  const { data: register } = useInstrumentRegister(specId);

  const spec = useMemo(() => {
    if (!rawSpec) return null;
    return {
      ...rawSpec,
      confirmed_subsystems: rawSpec.confirmed_subsystems?.length
        ? migrateSubsystemConfig(rawSpec.confirmed_subsystems)
        : [],
      confirmed_states: rawSpec.confirmed_states?.length
        ? migrateOperatingStates(rawSpec.confirmed_states)
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
      {isUnconfirmed && <UnconfirmedLockBanner migrateHref={migrateHref} />}
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
        <Badge variant="outline" className="text-[10px] ml-auto">Phase 3 — Co-Author</Badge>
        <Badge variant="outline" className="text-[10px]">Rev {spec.revision}</Badge>
        {revisionLabel && (
          <Badge variant="secondary" className="text-[10px]" title={revisionLabel}>
            Approved
          </Badge>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <FdsCoAuthor spec={spec} register={register} fullScreen />
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
