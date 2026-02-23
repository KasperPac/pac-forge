import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useProjects, useCreateProject, useDeleteProject } from "@/hooks/use-projects";
import { ProjectCard } from "@/components/project-card";
import { ProjectForm } from "@/components/project-form";
import type { ProjectCreate } from "@/types";

export default function ProjectsPage() {
  const { data: projects, isLoading, error } = useProjects();
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const [createOpen, setCreateOpen] = useState(false);

  function handleCreate(data: ProjectCreate | Record<string, unknown>) {
    createProject.mutate(data as ProjectCreate, {
      onSuccess: () => setCreateOpen(false),
    });
  }

  function handleDelete(id: string) {
    if (window.confirm("Delete this project? This cannot be undone.")) {
      deleteProject.mutate(id);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-xs text-muted-foreground">PAC-FORGE</div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Projects</h1>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          New Project
        </Button>
      </div>

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

      {projects && projects.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onDelete={handleDelete}
            />
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
    </div>
  );
}
