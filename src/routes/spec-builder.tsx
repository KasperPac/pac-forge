import { useState, useMemo, useRef } from "react";
import { useSearchParams, useNavigate, Link } from "react-router";
import {
  FileText,
  Plus,
  Trash2,
  Loader2,
  ChevronRight,
  ChevronDown,
  Clock,
  CheckCircle2,
  Pencil,
  Cog,
  FolderOpen,
  Dices,
  Upload,
  ArrowDownToLine,
  History,
  MoreVertical,
  Lock,
} from "lucide-react";
import { useSpecIngest } from "@/hooks/use-spec-ingest";
import { RevisionsPanel } from "@/components/spec-builder/revisions-panel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useSpecSections, useSpecExports } from "@/hooks/use-spec-projects";
import { useFdsSessionsForProject, useFdsOrchestrationsForProject, useComposeFds } from "@/hooks/use-fds-session";
import {
  computeCoAuthorStatus,
  computeEditorStatus,
  computeExportStatus,
} from "@/components/spec-builder/spec-phase-status";
import type { SpecProject } from "@/types/spec-builder";
import { migrateSubsystemConfig, migrateOperatingStates } from "@/types/spec-builder";
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
  const initialSpecId = searchParams.get("specId");
  const { data: project } = useProject(projectId);
  const { data: specs, isLoading: specsLoading } = useSpecProjectsForProject(projectId);
  const [selectedId, setSelectedId] = useState<string | null>(initialSpecId);
  const [showCreate, setShowCreate] = useState(false);
  const [showRandom, setShowRandom] = useState(false);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const navigate = useNavigate();

  const selectedSpec = specs?.find((p) => p.id === selectedId);

  // DOCX ingest (markup + foreign). The dispatcher inside `ingestDocx`
  // detects the pac-forge sentinel and chooses deterministic vs AI path —
  // the two buttons are semantically identical today.
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const { ingest, loading: ingestLoading } = useSpecIngest(selectedId ?? undefined, {
    onReviewRequired: () =>
      navigate(`/specs/ingest-review?projectId=${selectedId ?? ""}`),
  });
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) ingest(file);
    e.target.value = "";
  };

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
              {ingestLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Dices className="h-4 w-4" />
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  title="More actions"
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={!selectedId || ingestLoading}
                >
                  <Upload className="h-3.5 w-3.5 mr-2" />
                  Upload marked-up DOCX
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => importInputRef.current?.click()}
                  disabled={!selectedId || ingestLoading}
                >
                  <ArrowDownToLine className="h-3.5 w-3.5 mr-2" />
                  Import foreign spec
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setRevisionsOpen(true)}
                  disabled={!selectedId}
                >
                  <History className="h-3.5 w-3.5 mr-2" />
                  Revisions
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              ref={uploadInputRef}
              type="file"
              accept=".docx"
              className="hidden"
              onChange={handleFile}
            />
            <input
              ref={importInputRef}
              type="file"
              accept=".docx"
              className="hidden"
              onChange={handleFile}
            />
            <RevisionsPanel
              specProjectId={selectedId ?? undefined}
              open={revisionsOpen}
              onOpenChange={setRevisionsOpen}
            />
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
  // FDS Engine Phase 1 — confirmation_status column exists on spec_projects
  // (migration 088). Not yet in the SpecProject type; read via cast until the
  // type is updated in a follow-up.
  const confirmationStatus = (spec as unknown as { confirmation_status?: string })
    .confirmation_status;
  const isUnconfirmed = confirmationStatus === "unconfirmed";

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
        <div className="flex items-center gap-1.5">
          <p className="font-mono text-xs font-medium truncate">
            {spec.doc_code}
          </p>
          {isUnconfirmed && spec.project_id && (
            <Badge
              variant="outline"
              className="border-amber-300 text-amber-900 text-[10px] px-1 py-0 shrink-0"
            >
              V1 —{" "}
              <Link
                to={`/specs/${spec.project_id}/${spec.id}/migrate`}
                className="underline ml-1"
                onClick={(e) => e.stopPropagation()}
              >
                migrate
              </Link>
            </Badge>
          )}
        </div>
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
  const { data: exports } = useSpecExports(spec.id);
  const { data: fdsSessions } = useFdsSessionsForProject(spec.id);
  const { data: orchestrations } = useFdsOrchestrationsForProject(spec.id);
  const composeFds = useComposeFds();
  const hasRegister = !!register && (register.tags?.length ?? 0) > 0;
  const hasWizardData = spec.confirmed_subsystems.length > 0 && spec.confirmed_states.length > 0;
  const hasSections = (sections?.length ?? 0) > 0;
  const allApproved = hasSections && (sections ?? []).every((s) => s.approved);
  const hasExports = (exports?.length ?? 0) > 0;
  const states = useMemo(() => migrateOperatingStates(spec.confirmed_states), [spec.confirmed_states]);

  // All assemblies complete when every session across all subsystems is "complete"
  const totalAssemblies = spec.confirmed_subsystems.reduce((n, s) => n + (s.assemblies?.length ?? 0), 0);
  const completedSessions = (fdsSessions ?? []).filter((s) => s.status === "complete").length;
  const allSessionsComplete = totalAssemblies > 0 && completedSessions >= totalAssemblies;

  const handleCompose = async () => {
    for (const subsystem of spec.confirmed_subsystems) {
      const sessions = (fdsSessions ?? []).filter((s) => s.subsystem_id === subsystem.subsystem_id);
      const orchestration = (orchestrations ?? []).find((o) => o.subsystem_id === subsystem.subsystem_id) ?? null;
      await composeFds.mutateAsync({ spec_project_id: spec.id, subsystem, sessions, orchestration, allStates: states });
    }
  };

  // Collapse register section once uploaded — engineer doesn't need to see the full tag list while working through later phases
  const [registerExpanded, setRegisterExpanded] = useState(!hasRegister);

  const projectIdForNav = spec.project_id ?? "";

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
      <div className="flex items-center justify-between">
        <PhaseHeader number={1} title="Instrument Register" done={hasRegister} />
        {hasRegister && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground"
            onClick={() => setRegisterExpanded((v) => !v)}
          >
            {registerExpanded ? <ChevronDown className="h-3.5 w-3.5 mr-1" /> : <ChevronRight className="h-3.5 w-3.5 mr-1" />}
            {registerExpanded ? "Collapse" : `${register?.tags?.length ?? 0} tags`}
          </Button>
        )}
      </div>
      {(!hasRegister || registerExpanded) && (
        <>
          <p className="text-xs text-muted-foreground">
            Upload the instrument register (Excel/CSV) to extract tags and subsystems.
          </p>
          <InstrumentRegisterUpload specProjectId={spec.id} onParsed={() => setRegisterExpanded(false)} />
        </>
      )}

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
        <PhaseStub number={2} title="Spec Skeleton Wizard" locked lockedReason="Upload instrument register first" />
      )}

      {/* Phase 3 — FDS Authoring */}
      <Separator />
      {hasWizardData && register ? (
        <PhaseLaunchCard
          number={3}
          title="FDS Authoring"
          description="Co-Author each assembly through static + sequential state building."
          status={computeCoAuthorStatus(spec, fdsSessions)}
          done={allSessionsComplete}
          ctaLabel="Open Co-Author"
          to={`/specs/${projectIdForNav}/${spec.id}/co-author`}
        />
      ) : (
        <PhaseStub number={3} title="FDS Authoring" locked lockedReason="Complete the Skeleton Wizard first" />
      )}

      {/* Phase 4 — System Orchestration (before compose — orchestration data feeds into sections) */}
      <Separator />
      {hasWizardData ? (
        <PhaseLaunchCard
          number={4}
          title="System Orchestration"
          description="Define cross-subsystem interlocks, shared permissives and startup order."
          status={spec.confirmed_subsystems.length > 1 ? `${spec.confirmed_subsystems.length} subsystems` : "No subsystems yet"}
          ctaLabel="Open Orchestration"
          to={`/specs/${projectIdForNav}/${spec.id}/system-orchestration`}
        />
      ) : (
        <PhaseStub number={4} title="System Orchestration" locked lockedReason="Complete the Skeleton Wizard first" />
      )}

      {/* Phase 5 — Structured Spec Editor (unlocked after sections composed) */}
      <Separator />
      {allSessionsComplete && hasWizardData && (
        <>
          {!hasSections && (
            <Button
              size="sm"
              className="mb-2"
              onClick={handleCompose}
              disabled={composeFds.isPending}
            >
              {composeFds.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <ArrowDownToLine className="h-3.5 w-3.5 mr-1.5" />
              )}
              {composeFds.isPending ? "Generating sections…" : "Generate Spec Sections"}
            </Button>
          )}
        </>
      )}
      {hasSections ? (
        <PhaseLaunchCard
          number={5}
          title="Structured Spec Editor"
          description="Review and edit each section. Approve before export."
          status={computeEditorStatus(sections)}
          done={allApproved}
          ctaLabel="Open Editor"
          to={`/specs/${projectIdForNav}/${spec.id}/editor`}
        />
      ) : (
        <PhaseStub number={5} title="Structured Spec Editor" locked={!hasSections} lockedReason="Complete FDS authoring then Generate Spec Sections" />
      )}

      {/* Phase 6 — DOCX Export */}
      <Separator />
      {hasSections ? (
        <PhaseLaunchCard
          number={6}
          title="DOCX Export"
          description="Render the spec to Word. Optionally upload to Dropbox."
          status={computeExportStatus(exports)}
          done={hasExports}
          ctaLabel="Open Export"
          to={`/specs/${projectIdForNav}/${spec.id}/export`}
        />
      ) : (
        <PhaseStub number={6} title="DOCX Export" locked lockedReason="Complete FDS authoring first" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase launch card — replaces inline Phase 3/4/5 rendering
// ---------------------------------------------------------------------------

function PhaseLaunchCard({
  number,
  title,
  description,
  status,
  done,
  ctaLabel,
  to,
}: {
  number: number;
  title: string;
  description: string;
  status: string;
  done?: boolean;
  ctaLabel: string;
  to: string;
}) {
  return (
    <Card className="p-4 flex items-center gap-4">
      <div className="flex items-center justify-center h-9 w-9 rounded-full bg-muted text-sm font-semibold shrink-0">
        {done ? (
          <CheckCircle2 className="h-5 w-5 text-green-400" />
        ) : (
          <span className="font-mono text-xs">{number}</span>
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-0.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground truncate">{description}</p>
        <p className="text-[11px] text-muted-foreground font-mono">{status}</p>
      </div>
      <Button asChild size="sm" variant={done ? "outline" : "default"}>
        <Link to={to}>
          {ctaLabel}
          <ChevronRight className="h-3.5 w-3.5 ml-1" />
        </Link>
      </Button>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Phase 3 / 4 / 5 now live on dedicated routes:
//   /specs/:projectId/:specId/co-author
//   /specs/:projectId/:specId/editor
//   /specs/:projectId/:specId/export
// See PhaseLaunchCard above for the dashboard launcher.
// ---------------------------------------------------------------------------

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

function PhaseStub({ title, locked, lockedReason }: { number?: number; title: string; locked?: boolean; lockedReason?: string }) {
  return (
    <div
      className={cn("flex items-center gap-2.5 py-2 cursor-not-allowed select-none", locked ? "opacity-30" : "opacity-50")}
      title={locked && lockedReason ? lockedReason : undefined}
    >
      {locked && <Lock className="h-3 w-3 text-muted-foreground shrink-0" />}
      <span className="text-sm">{title}</span>
      {lockedReason && (
        <span className="text-[10px] text-muted-foreground ml-1">— {lockedReason}</span>
      )}
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
