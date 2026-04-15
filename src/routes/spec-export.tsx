/**
 * Phase 5 — DOCX Export full-screen route.
 *
 * URL: /specs/:projectId/:specId/export
 */
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import {
  ArrowLeft,
  CheckCircle2,
  Cloud,
  Download,
  FileText,
  Loader2,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  useSpecProject,
  useSpecSections,
  useSpecExports,
} from "@/hooks/use-spec-projects";
import { useSpecExport } from "@/hooks/use-spec-export";
import { useProject } from "@/hooks/use-projects";
import {
  migrateSubsystemConfig,
  migrateOperatingStates,
} from "@/types/spec-builder";

export default function SpecExportPage() {
  const { projectId, specId } = useParams<{ projectId: string; specId: string }>();
  const { data: rawSpec, isLoading } = useSpecProject(specId);
  const { data: sections } = useSpecSections(specId);
  const { data: exports } = useSpecExports(specId);

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

  const { data: project } = useProject(spec?.project_id ?? undefined);
  const exporter = useSpecExport(spec);

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

  const list = sections ?? [];
  const hasDropboxFolder = !!project?.dropbox_folder_path;
  const allApproved = list.length > 0 && list.every((s) => s.approved);
  const approvedCount = list.filter((s) => s.approved).length;
  const busy = exporter.status.phase === "rendering" || exporter.status.phase === "uploading";
  const revisionLabel = (spec as unknown as { latest_approved_revision_id?: string | null })
    ?.latest_approved_revision_id;

  return (
    <div className="flex h-full flex-col -m-4">
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
        <Badge variant="outline" className="text-[10px] ml-auto">Phase 5 — Export</Badge>
        <Badge variant="outline" className="text-[10px]">Rev {spec.revision}</Badge>
        {revisionLabel && (
          <Badge variant="secondary" className="text-[10px]" title={revisionLabel}>
            Approved
          </Badge>
        )}
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5 max-w-3xl w-full mx-auto">
        {list.length === 0 ? (
          <Card className="p-5 text-sm text-muted-foreground">
            No sections to export yet. Generate them in Phase 3.
          </Card>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Render the spec to a Word document.{" "}
              {allApproved
                ? "All sections approved."
                : `${approvedCount}/${list.length} sections approved — unapproved sections will still be included but flagged.`}
            </p>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                onClick={() => exporter.exportDocx(list, { uploadToDropbox: false })}
                disabled={busy}
              >
                {busy && exporter.status.phase === "rendering" ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                )}
                Download DOCX
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => exporter.exportDocx(list, { uploadToDropbox: true })}
                disabled={busy || !hasDropboxFolder}
                title={!hasDropboxFolder ? "Project has no Dropbox folder" : undefined}
              >
                {busy && exporter.status.phase === "uploading" ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Cloud className="h-3.5 w-3.5 mr-1.5" />
                )}
                Save to Dropbox
              </Button>
            </div>

            {exporter.status.phase === "error" && (
              <Card className="p-3 border-destructive/50 bg-destructive/10">
                <div className="flex items-start gap-2">
                  <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                  <p className="text-sm text-destructive">{exporter.status.message}</p>
                </div>
              </Card>
            )}

            {exporter.status.phase === "complete" && (
              <Card className="p-3 border-green-500/30 bg-green-500/5">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-green-400 font-mono break-all">
                    {exporter.status.message}
                  </p>
                </div>
              </Card>
            )}

            {exports && exports.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold text-muted-foreground">Export History</h4>
                <div className="space-y-1">
                  {exports.slice(0, 20).map((ex) => (
                    <div
                      key={ex.id}
                      className="flex items-center gap-2 text-xs p-2 border rounded-md"
                    >
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <Badge variant="outline" className="text-[10px]">
                        Rev {ex.revision}
                      </Badge>
                      <span className="font-mono text-muted-foreground truncate flex-1">
                        {ex.storage_path ?? "(local download)"}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {new Date(ex.exported_at).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
