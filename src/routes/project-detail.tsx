import { useState } from "react";
import { useParams, useNavigate } from "react-router";
import { ArrowLeft, Play, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useProject, useUpdateProject } from "@/hooks/use-projects";
import { useDesignProfile } from "@/hooks/use-design-profiles";
import { ProjectForm } from "@/components/project-form";
import { IoListEditor } from "@/components/io-list-editor";
import type { IoEntry, ProjectUpdate } from "@/types";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: project, isLoading, error } = useProject(id);
  const updateProject = useUpdateProject();
  const { data: designProfile } = useDesignProfile(project?.design_profile_id ?? undefined);
  const [editing, setEditing] = useState(false);

  if (isLoading) {
    return (
      <div className="py-12 text-center font-mono text-sm text-muted-foreground">
        Loading project...
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive">
          {error ? `Failed to load project: ${error.message}` : "Project not found"}
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/projects")}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Projects
        </Button>
      </div>
    );
  }

  function handleUpdate(updates: ProjectUpdate | Record<string, unknown>) {
    updateProject.mutate(
      { id: project!.id, updates: updates as ProjectUpdate },
      { onSuccess: () => setEditing(false) }
    );
  }

  function handleIoListChange(entries: IoEntry[]) {
    updateProject.mutate({
      id: project!.id,
      updates: { io_lists: entries },
    });
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="mb-2 -ml-2"
            onClick={() => navigate("/projects")}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Projects
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">
            {project.client_name}
          </h1>
          {project.project_number && (
            <div className="mt-0.5 font-mono text-xs text-muted-foreground">
              {project.project_number}
            </div>
          )}
          <div className="mt-1 flex items-center gap-2">
            <Badge variant="secondary" className="font-mono text-[10px]">
              {project.plc_brand}
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px]">
              {project.cpu_type}
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px]">
              {project.tia_version}
            </Badge>
            {project.safety_level && project.safety_level !== "None" && (
              <Badge variant="destructive" className="font-mono text-[10px]">
                {project.safety_level}
              </Badge>
            )}
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => navigate(`/pac-st?project=${project.id}`)}
        >
          <Play className="mr-1 h-4 w-4" />
          Open Pac-ST Session
        </Button>
      </div>

      <Separator />

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview" className="font-mono text-xs">
            Overview
          </TabsTrigger>
          <TabsTrigger value="io-lists" className="font-mono text-xs">
            IO Lists
          </TabsTrigger>
          <TabsTrigger value="tag-db" className="font-mono text-xs">
            Tag DB
          </TabsTrigger>
          <TabsTrigger value="documents" className="font-mono text-xs">
            Documents
          </TabsTrigger>
          <TabsTrigger value="revision-log" className="font-mono text-xs">
            Revision Log
          </TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview">
          <Card className="p-4">
            {editing ? (
              <ProjectForm
                mode="edit"
                initialValues={project}
                onSubmit={handleUpdate}
                onCancel={() => setEditing(false)}
                submitting={updateProject.isPending}
              />
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 font-mono text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Client</div>
                    <div>{project.client_name}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">PLC Brand</div>
                    <div>{project.plc_brand}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">TIA Version</div>
                    <div>{project.tia_version}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">CPU Type</div>
                    <div>{project.cpu_type}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Safety Level</div>
                    <div>{project.safety_level || "None"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Design Profile</div>
                    <div>{designProfile?.name ?? "None"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Created</div>
                    <div>{new Date(project.created_at).toLocaleString()}</div>
                  </div>
                </div>
                {project.safety_notes && (
                  <div className="font-mono text-sm">
                    <div className="text-xs text-muted-foreground">Safety Notes</div>
                    <div className="mt-1 whitespace-pre-wrap text-xs">{project.safety_notes}</div>
                  </div>
                )}
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  Edit Project
                </Button>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* IO Lists */}
        <TabsContent value="io-lists">
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-mono text-sm font-medium">IO List</h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleIoListChange(project.io_lists)}
                disabled={updateProject.isPending}
              >
                <Save className="mr-1 h-3.5 w-3.5" />
                Save
              </Button>
            </div>
            <IoListEditor
              value={project.io_lists}
              onChange={handleIoListChange}
            />
          </Card>
        </TabsContent>

        {/* Tag DB */}
        <TabsContent value="tag-db">
          <Card className="p-4">
            <p className="font-mono text-sm text-muted-foreground">
              Tag DB editor will be implemented in a future phase.
            </p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {project.tag_db_definitions.length} tag table(s) defined.
            </p>
          </Card>
        </TabsContent>

        {/* Documents */}
        <TabsContent value="documents">
          <Card className="p-4">
            <p className="font-mono text-sm text-muted-foreground">
              Document upload will be implemented in a future phase.
            </p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {project.uploaded_docs.length} document(s) attached.
            </p>
          </Card>
        </TabsContent>

        {/* Revision Log */}
        <TabsContent value="revision-log">
          <Card className="p-4">
            {project.revision_log.length === 0 ? (
              <p className="font-mono text-sm text-muted-foreground">
                No revision history yet.
              </p>
            ) : (
              <div className="space-y-2">
                {project.revision_log.map((entry, idx) => (
                  <div key={idx} className="border-b border-border/50 pb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {entry.version}
                      </Badge>
                      <span className="font-mono text-xs text-muted-foreground">
                        {entry.author}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-1 text-xs">{entry.description}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
