/**
 * Phase 4 — Structured Spec Editor full-screen route.
 *
 * URL: /specs/:projectId/:specId/editor
 */
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SpecEditor } from "@/components/spec-builder/spec-editor";
import {
  useSpecProject,
  useSpecSections,
} from "@/hooks/use-spec-projects";
import {
  migrateUnitConfig,
  migrateOperatingStates,
} from "@/types/spec-builder";
import { useUnconfirmedLock } from "@/hooks/use-unconfirmed-lock";
import { UnconfirmedLockBanner } from "@/components/spec-builder/unconfirmed-lock-banner";

export default function SpecEditorRoute() {
  const { projectId, specId } = useParams<{ projectId: string; specId: string }>();
  const { isUnconfirmed, migrateHref } = useUnconfirmedLock(projectId ?? "", specId ?? "");
  const { data: rawSpec, isLoading } = useSpecProject(specId);
  const { data: sections } = useSpecSections(specId);

  const spec = useMemo(() => {
    if (!rawSpec) return null;
    return {
      ...rawSpec,
      confirmed_units: rawSpec.confirmed_units?.length
        ? migrateUnitConfig(rawSpec.confirmed_units)
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
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="max-w-md p-6 space-y-3">
          <h2 className="text-sm font-semibold">Spec not found</h2>
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

  const revisionLabel = (spec as unknown as { latest_approved_revision_id?: string | null })
    ?.latest_approved_revision_id;
  const list = sections ?? [];
  const approved = list.filter((s) => s.approved).length;

  return (
    <div className="flex h-full flex-col -m-4">
      {isUnconfirmed && <UnconfirmedLockBanner migrateHref={migrateHref} />}
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
        <Badge variant="outline" className="text-[10px] ml-auto">Phase 4 — Editor</Badge>
        <Badge variant="outline" className="text-[10px]">
          {approved}/{list.length} approved
        </Badge>
        <Badge variant="outline" className="text-[10px]">Rev {spec.revision}</Badge>
        {revisionLabel && (
          <Badge variant="secondary" className="text-[10px]" title={revisionLabel}>
            Approved
          </Badge>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {list.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No sections yet — generate them in Phase 3.
          </div>
        ) : (
          <SpecEditor spec={spec} sections={list} fullScreen />
        )}
      </div>
    </div>
  );
}
