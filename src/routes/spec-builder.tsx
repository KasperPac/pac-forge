import { useState, useMemo } from "react";
import { useSearchParams, useNavigate, Link } from "react-router";
import {
  FileText,
  Plus,
  Trash2,
  Loader2,
  ChevronRight,
  Clock,
  CheckCircle2,
  Pencil,
  Cog,
  FolderOpen,
  Play,
  XCircle,
  AlertTriangle,
  Download,
  Cloud,
  MessageSquareText,
  Zap,
  Dices,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  useSpecProjectsForProject,
  useCreateSpecProject,
  useDeleteSpecProject,
  useInstrumentRegister,
} from "@/hooks/use-spec-projects";
import { useProjects, useProject } from "@/hooks/use-projects";
import { InstrumentRegisterUpload } from "@/components/spec-builder/instrument-register-upload";
import { SpecSkeletonWizard } from "@/components/spec-builder/spec-skeleton-wizard";
import { useNextSpecDocCode } from "@/hooks/use-spec-doc-number";
import { useSpecGenerate } from "@/hooks/use-spec-generate";
import { useSpecSections, useSpecExports } from "@/hooks/use-spec-projects";
import { useSpecExport } from "@/hooks/use-spec-export";
import { SpecEditor } from "@/components/spec-builder/spec-editor";
import { FdsCoAuthor } from "@/components/spec-builder/fds-co-author";
import { Progress } from "@/components/ui/progress";
import type { SpecProject, InstrumentRegister } from "@/types/spec-builder";
import { migrateSubsystemConfig, migrateOperatingStates } from "@/types/spec-builder";
import type { Project } from "@/types/project";
import { RandomFdsDialog } from "@/components/spec-builder/random-fds-dialog";
import { cn } from "@/lib/utils";

const STATUS_CONFIG = {
  draft: { label: "Draft", color: "text-muted-foreground", icon: Pencil },
  generating: { label: "Generating", color: "text-blue-400", icon: Cog },
  review: { label: "Review", color: "text-amber-400", icon: Clock },
  complete: { label: "Complete", color: "text-green-400", icon: CheckCircle2 },
} as const;

export default function SpecBuilderPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = searchParams.get("projectId") ?? undefined;
  const { data: project } = useProject(projectId);
  const { data: specs, isLoading: specsLoading } = useSpecProjectsForProject(projectId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showRandom, setShowRandom] = useState(false);

  const selectedSpec = specs?.find((p) => p.id === selectedId);

  // No project selected — show project picker
  if (!projectId) {
    return <ProjectPicker />;
  }

  return (
    <div className="flex h-full -m-4">
      {/* Left panel — spec list */}
      <div className="w-72 border-r flex flex-col shrink-0">
        <div className="p-3 border-b space-y-1">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={() => setSearchParams({})}
              title="Change project"
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </Button>
            <h2 className="text-sm font-semibold flex items-center gap-2 flex-1 min-w-0">
              <FileText className="h-4 w-4 shrink-0" />
              <span className="truncate">Spec Builder</span>
            </h2>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => setShowRandom(true)}
              title="Generate Random FDS"
            >
              <Dices className="h-4 w-4" />
            </Button>
            <Dialog open={showCreate} onOpenChange={setShowCreate}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                  <Plus className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              {projectId && project && (
                <CreateSpecDialog
                  projectId={projectId}
                  clientName={project.client_name ?? ""}
                  projectNumber={project.project_number ?? ""}
                  dropboxFolderPath={project.dropbox_folder_path ?? null}
                  onCreated={(id) => {
                    setSelectedId(id);
                    setShowCreate(false);
                  }}
                />
              )}
            </Dialog>
            {projectId && (
              <RandomFdsDialog
                open={showRandom}
                onOpenChange={setShowRandom}
                projectId={projectId}
                projectNumber={project?.project_number ?? undefined}
                clientName={project?.client_name ?? undefined}
                onCreated={(id) => {
                  setSelectedId(id);
                }}
              />
            )}
          </div>
          {project && (
            <p className="text-xs text-muted-foreground truncate pl-6">
              {project.client_name}
              {project.project_number && ` — ${project.project_number}`}
            </p>
          )}
        </div>
        <ScrollArea className="flex-1">
          {specsLoading ? (
            <div className="p-4 text-center">
              <Loader2 className="h-4 w-4 animate-spin mx-auto" />
            </div>
          ) : !specs?.length ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No specs yet. Create one to get started.
            </div>
          ) : (
            <div className="p-1.5 space-y-0.5">
              {specs.map((s) => (
                <SpecListItem
                  key={s.id}
                  spec={s}
                  selected={s.id === selectedId}
                  onClick={() => setSelectedId(s.id)}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Right panel — spec detail */}
      <div className="flex-1 overflow-auto">
        {selectedSpec ? (
          <SpecDetail spec={selectedSpec} />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Select or create a specification
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project picker — shown when no projectId in query params
// ---------------------------------------------------------------------------

function ProjectPicker() {
  const { data: projects, isLoading } = useProjects();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const filtered = projects?.filter((p) => {
    const q = search.toLowerCase();
    return (
      !q ||
      p.client_name?.toLowerCase().includes(q) ||
      p.project_number?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex items-center justify-center h-full">
      <Card className="w-full max-w-md p-6 space-y-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Select a Project</h2>
          <p className="text-xs text-muted-foreground">
            Functional specifications are linked to a project. Choose which project to work on.
          </p>
        </div>
        <Input
          placeholder="Search projects..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="text-sm"
        />
        <ScrollArea className="max-h-64">
          {isLoading ? (
            <div className="py-8 text-center">
              <Loader2 className="h-4 w-4 animate-spin mx-auto" />
            </div>
          ) : !filtered?.length ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {search ? "No matching projects" : "No projects found"}
            </p>
          ) : (
            <div className="space-y-1">
              {filtered.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-md px-3 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => navigate(`/specs?projectId=${p.id}`)}
                >
                  <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {p.client_name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {p.project_number ?? "No project number"}
                    </p>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spec list item
// ---------------------------------------------------------------------------

function SpecListItem({
  spec,
  selected,
  onClick,
}: {
  spec: SpecProject;
  selected: boolean;
  onClick: () => void;
}) {
  const cfg = STATUS_CONFIG[spec.status];
  const StatusIcon = cfg.icon;
  const deleteSpec = useDeleteSpecProject();

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md px-2.5 py-2 cursor-pointer text-sm transition-colors",
        selected
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50"
      )}
      onClick={onClick}
    >
      <StatusIcon className={cn("h-3.5 w-3.5 shrink-0", cfg.color)} />
      <div className="flex-1 min-w-0">
        <p className="font-mono text-xs font-medium truncate">
          {spec.doc_code}
        </p>
        <p className="text-xs text-muted-foreground truncate">{spec.title}</p>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {spec.doc_code}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the spec and all its sections.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteSpec.mutate({ id: spec.id, projectId: spec.project_id ?? "" })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spec detail — Phase 1: instrument register upload
// ---------------------------------------------------------------------------

function SpecDetail({ spec: rawSpec }: { spec: SpecProject }) {
  // Migrate legacy subsystem/state formats to current schema
  const spec = useMemo(() => ({
    ...rawSpec,
    confirmed_subsystems: rawSpec.confirmed_subsystems?.length
      ? migrateSubsystemConfig(rawSpec.confirmed_subsystems)
      : [],
    confirmed_states: rawSpec.confirmed_states?.length
      ? migrateOperatingStates(rawSpec.confirmed_states)
      : [],
    scope_exclusions: rawSpec.scope_exclusions ?? [],
    design_principles: rawSpec.design_principles ?? [],
  }), [rawSpec]);

  const { data: register } = useInstrumentRegister(spec.id);
  const { data: sections } = useSpecSections(spec.id);
  const generator = useSpecGenerate();
  const hasRegister = !!register && (register.tags?.length ?? 0) > 0;
  const hasWizardData = spec.confirmed_subsystems.length > 0 && spec.confirmed_states.length > 0;
  const hasSections = (sections?.length ?? 0) > 0;
  const isGenerating = spec.status === "generating" || generator.running;


  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold font-mono">{spec.doc_code}</h1>
          <Badge variant="outline" className="text-xs">
            Rev {spec.revision}
          </Badge>
          <Badge
            variant="outline"
            className={cn("text-xs", STATUS_CONFIG[spec.status].color)}
          >
            {STATUS_CONFIG[spec.status].label}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{spec.title}</p>
      </div>

      <Separator />

      {/* Phase 1 — Instrument Register */}
      <PhaseHeader number={1} title="Instrument Register" done={hasRegister} />
      <p className="text-xs text-muted-foreground">
        Upload the instrument register (Excel/CSV) to extract tags and subsystems.
      </p>
      <InstrumentRegisterUpload specProjectId={spec.id} />

      {/* Phase 2 — Spec Skeleton Wizard (only after register uploaded) */}
      <Separator />
      {hasRegister && register ? (
        <>
          <PhaseHeader number={2} title="Spec Skeleton Wizard" done={hasWizardData} />
          <SpecSkeletonWizard
            spec={spec}
            register={register}
            onComplete={() => {
              // Wizard saved, will re-render with updated spec
            }}
          />
        </>
      ) : (
        <PhaseStub number={2} title="Spec Skeleton Wizard" locked />
      )}

      {/* Phase 3 — FDS Authoring */}
      <Separator />
      {hasWizardData && register ? (
        <Phase3Authoring spec={spec} register={register} generator={generator} sections={sections ?? []} hasSections={hasSections} isGenerating={isGenerating} />
      ) : (
        <PhaseStub number={3} title="FDS Authoring" locked />
      )}

      {/* Phase 4 — Structured Spec Editor */}
      <Separator />
      {hasSections && sections ? (
        <>
          <PhaseHeader
            number={4}
            title="Structured Spec Editor"
            done={sections.every((s) => s.approved)}
          />
          <p className="text-xs text-muted-foreground">
            Review and edit each section. Approve sections before export.
          </p>
          <SpecEditor spec={spec} sections={sections} />
        </>
      ) : (
        <PhaseStub number={4} title="Structured Spec Editor" locked={!hasSections} />
      )}

      {/* Phase 5 — DOCX Export */}
      <Separator />
      {hasSections && sections ? (
        <ExportPhase spec={spec} sections={sections} />
      ) : (
        <PhaseStub number={5} title="DOCX Export" locked />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase 3 — FDS Authoring (Co-Author + Quick Draft)
// ---------------------------------------------------------------------------

function Phase3Authoring({
  spec,
  register,
  generator,
  sections,
  hasSections,
  isGenerating,
}: {
  spec: SpecProject;
  register: InstrumentRegister;
  generator: ReturnType<typeof useSpecGenerate>;
  sections: NonNullable<ReturnType<typeof useSpecSections>["data"]>;
  hasSections: boolean;
  isGenerating: boolean;
}) {
  const [mode, setMode] = useState<"co-author" | "quick-draft">("co-author");

  return (
    <>
      <PhaseHeader number={3} title="FDS Authoring" done={hasSections && !isGenerating} />

      {/* Mode toggle */}
      <div className="flex gap-1 p-0.5 bg-muted rounded-lg w-fit">
        <button
          onClick={() => setMode("co-author")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            mode === "co-author"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <MessageSquareText className="h-3.5 w-3.5" />
          Co-Author
        </button>
        <button
          onClick={() => setMode("quick-draft")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            mode === "quick-draft"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Zap className="h-3.5 w-3.5" />
          Quick Draft
        </button>
      </div>

      {mode === "co-author" ? (
        <FdsCoAuthor spec={spec} register={register} />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Generate all sections in one pass. AI infers operational behavior from tag names — best for simple systems or as a starting point to edit.
          </p>
          {generator.running && generator.progress ? (
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-sm font-medium">{generator.progress.phase}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={generator.cancel}>
                  <XCircle className="h-3.5 w-3.5 mr-1" />
                  Cancel
                </Button>
              </div>
              <Progress
                value={Math.round(
                  (generator.progress.current / Math.max(generator.progress.total, 1)) * 100
                )}
              />
              <p className="text-xs text-muted-foreground">
                {generator.progress.detail} ({generator.progress.current}/{generator.progress.total})
              </p>
            </Card>
          ) : (
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                onClick={() => generator.run(spec, register)}
                disabled={isGenerating}
              >
                <Play className="h-3.5 w-3.5 mr-1.5" />
                {hasSections ? "Regenerate All Sections" : "Generate Sections"}
              </Button>
              {hasSections && (
                <Badge variant="secondary" className="text-xs">
                  {sections.length} sections generated
                </Badge>
              )}
            </div>
          )}

          {generator.error && (
            <Card className="p-3 border-destructive/50 bg-destructive/10">
              <div className="flex items-start gap-2">
                <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <p className="text-sm text-destructive">{generator.error}</p>
              </div>
            </Card>
          )}

          {generator.result && (
            <Card className="p-3 space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-400" />
                <span className="text-sm font-medium">Generation complete</span>
                <Badge variant="outline" className="text-xs ml-auto">
                  {generator.result.totalUsage.total?.toLocaleString()} tokens
                </Badge>
              </div>
              {generator.result.errors.length > 0 && (
                <div className="space-y-1">
                  {generator.result.errors.map((err, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs text-amber-400">
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                      {err}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Phase 5 — DOCX Export
// ---------------------------------------------------------------------------

function ExportPhase({ spec, sections }: { spec: SpecProject; sections: NonNullable<ReturnType<typeof useSpecSections>["data"]> }) {
  const exporter = useSpecExport(spec);
  const { data: exports } = useSpecExports(spec.id);
  const { data: project } = useProject(spec.project_id ?? undefined);
  const hasDropboxFolder = !!project?.dropbox_folder_path;
  const allApproved = sections.every((s) => s.approved);
  const approvedCount = sections.filter((s) => s.approved).length;

  const busy = exporter.status.phase === "rendering" || exporter.status.phase === "uploading";

  return (
    <>
      <PhaseHeader number={5} title="DOCX Export" done={(exports?.length ?? 0) > 0} />
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Render the spec to a Word document.{" "}
          {allApproved
            ? "All sections approved."
            : `${approvedCount}/${sections.length} sections approved — unapproved sections will still be included but flagged.`}
        </p>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            onClick={() => exporter.exportDocx(sections, { uploadToDropbox: false })}
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
            onClick={() => exporter.exportDocx(sections, { uploadToDropbox: true })}
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
              {exports.slice(0, 5).map((ex) => (
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
      </div>
    </>
  );
}

function PhaseHeader({ title, done }: { number?: number; title: string; done?: boolean }) {
  return (
    <h2 className="text-sm font-semibold flex items-center gap-2">
      {done && (
        <span className="flex items-center justify-center h-5 w-5 rounded-full bg-green-500/20 text-green-400">
          <CheckCircle2 className="h-3 w-3" />
        </span>
      )}
      {title}
    </h2>
  );
}

function PhaseStub({ title, locked }: { number?: number; title: string; locked?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3 py-2", locked ? "opacity-30" : "opacity-50")}>
      <span className="text-sm">{title}</span>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create dialog
// ---------------------------------------------------------------------------

function CreateSpecDialog({
  projectId,
  clientName,
  projectNumber,
  dropboxFolderPath,
  onCreated,
}: {
  projectId: string;
  clientName: string;
  projectNumber: string;
  dropboxFolderPath: string | null;
  onCreated: (id: string) => void;
}) {
  const create = useCreateSpecProject();
  const { data: suggestedCode } = useNextSpecDocCode(projectNumber, dropboxFolderPath);

  const [form, setForm] = useState({
    doc_code: "",
    title: "",
    revision: "01",
  });

  // Update doc_code when suggestion arrives (only if user hasn't typed anything)
  const [userEdited, setUserEdited] = useState(false);
  if (suggestedCode && !form.doc_code && !userEdited) {
    setForm((f) => ({ ...f, doc_code: suggestedCode }));
  }

  const canSubmit = form.doc_code.trim() && form.title.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const result = await create.mutateAsync({
      project_id: projectId,
      doc_code: form.doc_code,
      title: form.title,
      client_name: clientName,
      project_number: projectNumber || undefined,
      revision: form.revision || "01",
    });
    onCreated(result.id);
  };

  return (
    <DialogContent className="sm:max-w-md">
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle>New Functional Specification</DialogTitle>
          <DialogDescription>
            Create a spec for {clientName || "this project"}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-4">
          <div className="grid gap-1.5">
            <Label htmlFor="doc_code" className="text-xs">
              Document Code *
            </Label>
            <Input
              id="doc_code"
              placeholder={projectNumber ? `${projectNumber}-500801` : "e.g. PAC-2614-500801"}
              className="font-mono"
              value={form.doc_code}
              onChange={(e) => {
                setUserEdited(true);
                setForm((f) => ({ ...f, doc_code: e.target.value }));
              }}
            />
            {projectNumber && (
              <p className="text-[10px] text-muted-foreground font-mono">
                Format: {projectNumber}-5008xx (50=folder, 08=subfolder, xx=doc#)
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="title" className="text-xs">
              Title *
            </Label>
            <Input
              id="title"
              placeholder="e.g. Cathode Handling System"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="revision" className="text-xs">
              Revision
            </Label>
            <Input
              id="revision"
              placeholder="01"
              className="font-mono w-24"
              value={form.revision}
              onChange={(e) => setForm((f) => ({ ...f, revision: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="submit" disabled={!canSubmit || create.isPending}>
            {create.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
