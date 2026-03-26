import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Plus, FolderOpen, Wand2, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useProjects, useCreateProject, useDeleteProject } from "@/hooks/use-projects";
import { useClients } from "@/hooks/use-clients";
import { useDropboxConnection } from "@/hooks/use-dropbox";
import { ProjectCard } from "@/components/project-card";
import { ProjectForm } from "@/components/project-form";
import { DropboxFolderDialog } from "@/components/dropbox-folder-dialog";
import { toast } from "@/hooks/use-toast";
import type { Project, ProjectCreate } from "@/types";

export default function ProjectsPage() {
  const navigate = useNavigate();
  const { data: projects, isLoading, error } = useProjects();
  const { data: clients } = useClients();
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const { data: dropboxConn } = useDropboxConnection();
  const [createOpen, setCreateOpen] = useState(false);
  const [folderDialogProject, setFolderDialogProject] = useState<Project | null>(null);

  // Group projects by client
  const grouped = useMemo(() => {
    if (!projects) return [];
    const clientMap = new Map<string | null, { name: string; projects: Project[] }>();

    for (const project of projects) {
      const key = project.client_id;
      if (!clientMap.has(key)) {
        const clientName = key
          ? (clients?.find((c) => c.id === key)?.name ?? project.client_name)
          : project.client_name || "No Client";
        clientMap.set(key, { name: clientName, projects: [] });
      }
      clientMap.get(key)!.projects.push(project);
    }

    // Sort: named clients first (alphabetical), "No Client" last
    return [...clientMap.entries()]
      .sort(([aKey, a], [bKey, b]) => {
        if (!aKey && bKey) return 1;
        if (aKey && !bKey) return -1;
        return a.name.localeCompare(b.name);
      })
      .map(([, group]) => group);
  }, [projects, clients]);

  function handleCreate(data: ProjectCreate | Record<string, unknown>) {
    createProject.mutate(data as ProjectCreate, {
      onSuccess: (created) => {
        setCreateOpen(false);
        const proj = created as Project;
        if (
          dropboxConn?.connected &&
          proj.project_number &&
          proj.description_short
        ) {
          setFolderDialogProject(proj);
        }
      },
    });
  }

  function handleDelete(id: string) {
    if (window.confirm("Delete this project? This cannot be undone.")) {
      deleteProject.mutate(id, {
        onError: (err) => {
          const msg = err instanceof Error ? err.message : JSON.stringify(err);
          toast({ title: "Failed to delete project", description: msg, variant: "destructive" });
        },
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-muted-foreground">PAC-FORGE</div>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <FolderOpen className="h-5 w-5" />
            Projects
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your PLC projects. Each project links to a design profile,
            IO list, and generation sessions.
          </p>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate("/forge")} className="gap-1.5">
            <Wand2 className="h-4 w-4" />
            Open Wizard
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        </div>
      </div>

      <Separator />

      {isLoading && (
        <div className="py-12 text-center font-mono text-sm text-muted-foreground">
          Loading projects...
        </div>
      )}

      {error && (
        <div className="rounded-md bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive">
          Failed to load projects: {error.message}
        </div>
      )}

      {projects && projects.length === 0 && (
        <div className="py-12 text-center">
          <p className="font-mono text-sm text-muted-foreground">No projects yet.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => setCreateOpen(true)}
          >
            Create your first project
          </Button>
        </div>
      )}

      {grouped.length > 0 && (
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.name}>
              <div className="mb-2 flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-mono text-sm font-medium text-muted-foreground">{group.name}</h2>
                <span className="font-mono text-xs text-muted-foreground/60">{group.projects.length}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.projects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
          </DialogHeader>
          <ProjectForm
            mode="create"
            onSubmit={handleCreate}
            onCancel={() => setCreateOpen(false)}
            submitting={createProject.isPending}
          />
        </DialogContent>
      </Dialog>

      {folderDialogProject && (
        <DropboxFolderDialog
          open={!!folderDialogProject}
          onOpenChange={(open) => {
            if (!open) setFolderDialogProject(null);
          }}
          projectId={folderDialogProject.id}
          clientName={folderDialogProject.client_name}
          projectNumber={folderDialogProject.project_number!}
          descriptionShort={folderDialogProject.description_short!}
        />
      )}
    </div>
  );
}
