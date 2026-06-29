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
import type { CodegenLayer } from "@/lib/spec-builder/codegen";

export default function CodeBuilderPage() {
  const { projectId, specId } = useParams<{ projectId: string; specId: string }>();
  const { data: spec } = useSpecProject(specId);
  const [activeLayer, setActiveLayer] = useState<CodegenLayer>("device");
  const { artifacts, approve, saveEdit, unitGroups = [], emById = {} } = useCodeBuilder(specId, activeLayer);
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
        <Badge variant="outline" className="ml-auto text-[10px]">
          Phase 4 — Code Builder
        </Badge>
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
              if (current) approve.mutate(current.artifact_name);
            }}
          />
        </div>
      </div>
    </div>
  );
}
