/**
 * Phase 4 — Code Builder full-screen route.
 * URL: /specs/:projectId/:specId/code-builder
 */
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useSpecProject } from "@/hooks/use-spec-projects";
import { useCodeBuilder } from "@/hooks/use-code-builder";
import { BuilderStepper } from "@/components/code-builder/builder-stepper";
import { ControlModuleList } from "@/components/code-builder/control-module-list";
import { ArtifactViewer } from "@/components/code-builder/artifact-viewer";
import { ArtifactPanel } from "@/components/code-builder/artifact-panel";
import { FbQualityGates } from "@/components/code-builder/fb-quality-gates";
import { FbVersionHistory } from "@/components/code-builder/fb-version-history";
import { HmiBuildPanel } from "@/components/code-builder/hmi-build-panel";
import { useCodeBuilderVersions } from "@/hooks/use-code-builder-versions";
import { useEmStandardsReview, type EmReviewArtifact } from "@/hooks/use-em-standards-review";
import { evaluateSafetyGate } from "@/lib/spec-builder/fb-quality-gate";
import type { CodegenLayer } from "@/lib/spec-builder/codegen";

export default function CodeBuilderPage() {
  const { projectId, specId } = useParams<{ projectId: string; specId: string }>();
  const { data: spec } = useSpecProject(specId);
  const [activeLayer, setActiveLayer] = useState<CodegenLayer>("device");
  const { artifacts, approve, saveEdit, acknowledgeWarning, saveReview, revision, unitGroups = [], emById = {} } = useCodeBuilder(specId, activeLayer);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>("");

  const views = artifacts.data ?? [];
  const current = useMemo(
    () => views.find((v) => v.artifact_name === selected) ?? null,
    [views, selected],
  );
  const related = useMemo(
    () => (current ? views.filter((v) => v.owner_id && v.owner_id === current.owner_id) : []),
    [views, current],
  );
  const emInfo = current?.owner_id ? emById[current.owner_id] : undefined;

  const isEmFb = current?.layer === "em" && current.type === "FB";
  const gate = useMemo(
    () =>
      isEmFb && current
        ? evaluateSafetyGate(
            current.artifact_name,
            current.type,
            current.edited_content ?? current.generated_content,
            current.acknowledged_warnings,
          )
        : { warnings: [], blocked: false },
    [isEmFb, current],
  );

  const { versions, saveVersion, restoreVersion } = useCodeBuilderVersions(
    specId, revision, current?.owner_id, activeLayer,
  );
  const { review: runStandardsReview, loading: reviewing } = useEmStandardsReview();

  const snapshotArtifacts = () =>
    related.map((r) => ({ artifact_name: r.artifact_name, content: r.edited_content ?? r.generated_content }));

  if (spec && spec.confirmation_status !== "confirmed") {
    return (
      <div className="flex h-full items-center justify-center p-6" data-testid="code-builder-locked">
        <Card className="max-w-md space-y-3 p-6">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Lock className="h-4 w-4" /> Spec not confirmed
          </div>
          <p className="text-xs text-muted-foreground">
            Confirm the FDS in the Co-Author before building code.
          </p>
          <Link to={`/specs/${projectId}/${specId}/co-author`} className="text-xs underline">
            Back to Co-Author
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="-m-4 flex h-full flex-col" data-testid="code-builder-page">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <Button asChild variant="ghost" size="icon" className="h-7 w-7" title="Back to Co-Author">
          <Link to={`/specs/${projectId}/${specId}/co-author`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="font-mono text-sm font-semibold">{spec?.doc_code}</h1>
        <div className="ml-4">
          <BuilderStepper
            active={activeLayer === "em" ? "em" : "device"}
            onSelect={(step) => {
              if (step === "device" || step === "em") {
                setActiveLayer(step);
                setSelected(null);
                setEditing(false);
              }
            }}
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          {specId && <HmiBuildPanel specId={specId} projectName={spec?.title} />}
          <Badge variant="outline" className="text-[10px]">
            Phase 4 — Code Builder
          </Badge>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[28%_44%_28%]">
        <div className="min-h-0 overflow-auto border-r">
          <ControlModuleList
            artifacts={views}
            layer={activeLayer}
            unitGroups={unitGroups}
            selected={selected}
            onSelect={(n) => {
              setSelected(n);
              setEditing(false);
            }}
          />
        </div>
        <div className="min-h-0 border-r">
          <ArtifactViewer
            artifact={current}
            related={related}
            editable={editing}
            onContentChange={setDraft}
            states={emInfo?.states}
            transitions={emInfo?.transitions}
          />
        </div>
        <div className="min-h-0 overflow-auto">
          <ArtifactPanel
            artifact={current}
            editing={editing}
            saving={saveEdit.isPending}
            approving={approve.isPending}
            approveDisabled={gate.blocked}
            onEdit={() => {
              setDraft(current?.edited_content ?? current?.generated_content ?? "");
              setEditing(true);
            }}
            onSave={() => {
              if (current) {
                saveEdit.mutate({ artifactName: current.artifact_name, content: draft });
                setEditing(false);
              }
            }}
            onApprove={() => {
              if (!current || gate.blocked) return;
              saveVersion.mutate({ artifacts: snapshotArtifacts(), note: `Approved ${current.artifact_name}` });
              approve.mutate(current.artifact_name);
            }}
          />
          {isEmFb && current && (
            <>
              <FbQualityGates
                warnings={gate.warnings}
                blocked={gate.blocked}
                acknowledged={current.acknowledged_warnings}
                reviewStatus={current.review_status}
                findings={current.review_findings}
                reviewing={reviewing}
                onAcknowledge={(key) =>
                  acknowledgeWarning.mutate({
                    artifactName: current.artifact_name,
                    warningKeys: [...current.acknowledged_warnings, key],
                  })
                }
                onRunReview={async () => {
                  const fb: EmReviewArtifact = {
                    name: current.artifact_name,
                    type: current.type,
                    content: current.edited_content ?? current.generated_content,
                  };
                  const result = await runStandardsReview(fb);
                  saveReview.mutate({
                    artifactName: current.artifact_name,
                    status: result.findings.length > 0 ? "findings" : "pass",
                    findings: result.findings,
                  });
                }}
              />
              <FbVersionHistory
                fbName={current.artifact_name}
                currentContent={current.edited_content ?? current.generated_content}
                versions={versions.data ?? []}
                saving={saveVersion.isPending}
                restoring={restoreVersion.isPending}
                onSaveVersion={() =>
                  saveVersion.mutate({ artifacts: snapshotArtifacts(), note: `Manual snapshot ${current.artifact_name}` })
                }
                onRestore={(v) => restoreVersion.mutate(v)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
