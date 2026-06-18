import { useState } from "react";
import { useParams, useNavigate } from "react-router";
import { ArrowLeft, Play, Save, Plus, Trash2, ChevronDown, ChevronRight, X, Cpu, Wand2, FolderOpen, Pencil, Check, ClipboardList, Receipt } from "lucide-react";
import { ProjectCommercialTab } from "@/components/quotes/project-commercial-tab";
import { DropboxFolderDialog } from "@/components/dropbox-folder-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useProject, useUpdateProject } from "@/hooks/use-projects";
import { useDesignProfile } from "@/hooks/use-design-profiles";
import ProjectDocuments from "@/components/project-documents/project-documents";
import { ProjectForm } from "@/components/project-form";
import { IoListEditor } from "@/components/io-list-editor";
import { HardwareConfigEditor } from "@/components/hardware-config-editor";
import { GitHubRepoCard } from "@/components/github-repo-card";
import { TiaVersionMismatchBanner } from "@/components/tia-version-mismatch-banner";
import type { IoEntry, RackSlotLayout, TagDbDefinition, ProjectUpdate } from "@/types";
import type { Project } from "@/types/project";

const TAG_DATA_TYPES = ["BOOL", "INT", "DINT", "REAL", "STRING", "TIME", "WORD", "DWORD", "BYTE"] as const;

function TagDbEditor({
  value,
  onChange,
  saving,
}: {
  value: TagDbDefinition[];
  onChange: (defs: TagDbDefinition[]) => void;
  saving: boolean;
}) {
  const [localDefs, setLocalDefs] = useState<TagDbDefinition[]>(value);
  const [collapsedTables, setCollapsedTables] = useState<Set<number>>(new Set());

  const toggleCollapse = (idx: number) => {
    setCollapsedTables((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const addTable = () => {
    setLocalDefs((prev) => [...prev, { name: `TagTable_${prev.length + 1}`, tags: [] }]);
  };

  const removeTable = (idx: number) => {
    setLocalDefs((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateTableName = (idx: number, name: string) => {
    setLocalDefs((prev) => prev.map((d, i) => (i === idx ? { ...d, name } : d)));
  };

  const addTag = (tableIdx: number) => {
    setLocalDefs((prev) =>
      prev.map((d, i) =>
        i === tableIdx
          ? { ...d, tags: [...d.tags, { name: "", data_type: "BOOL", default_value: "", comment: "" }] }
          : d
      )
    );
  };

  const removeTag = (tableIdx: number, tagIdx: number) => {
    setLocalDefs((prev) =>
      prev.map((d, i) =>
        i === tableIdx ? { ...d, tags: d.tags.filter((_, j) => j !== tagIdx) } : d
      )
    );
  };

  const updateTag = (tableIdx: number, tagIdx: number, field: string, val: string) => {
    setLocalDefs((prev) =>
      prev.map((d, i) =>
        i === tableIdx
          ? {
              ...d,
              tags: d.tags.map((t, j) => (j === tagIdx ? { ...t, [field]: val } : t)),
            }
          : d
      )
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-sm font-medium">
          Tag DB Definitions
          <Badge variant="secondary" className="ml-2 font-mono text-[10px]">
            {localDefs.length} table{localDefs.length !== 1 ? "s" : ""}
          </Badge>
        </h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={addTable}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add Table
          </Button>
          <Button
            size="sm"
            onClick={() => onChange(localDefs)}
            disabled={saving}
          >
            <Save className="mr-1 h-3.5 w-3.5" />
            Save
          </Button>
        </div>
      </div>

      {localDefs.length === 0 && (
        <Card className="p-4">
          <p className="font-mono text-sm text-muted-foreground">
            No tag tables defined. Click "Add Table" to create one.
          </p>
        </Card>
      )}

      {localDefs.map((table, tableIdx) => (
        <Card key={tableIdx} className="overflow-hidden">
          {/* Table header */}
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <button onClick={() => toggleCollapse(tableIdx)} className="text-muted-foreground hover:text-foreground">
              {collapsedTables.has(tableIdx) ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
            <Input
              value={table.name}
              onChange={(e) => updateTableName(tableIdx, e.target.value)}
              className="h-7 flex-1 font-mono text-xs"
              placeholder="Table name"
            />
            <Badge variant="outline" className="font-mono text-[10px]">
              {table.tags.length} tag{table.tags.length !== 1 ? "s" : ""}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => removeTable(tableIdx)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Table body */}
          {!collapsedTables.has(tableIdx) && (
            <div className="p-3">
              {table.tags.length > 0 && (
                <div className="mb-1 grid grid-cols-[1fr_120px_100px_1fr_32px] gap-1 font-mono text-[9px] text-muted-foreground">
                  <span>NAME</span>
                  <span>DATA TYPE</span>
                  <span>DEFAULT</span>
                  <span>COMMENT</span>
                  <span />
                </div>
              )}
              {table.tags.map((tag, tagIdx) => (
                <div key={tagIdx} className="mb-1 grid grid-cols-[1fr_120px_100px_1fr_32px] gap-1">
                  <Input
                    value={tag.name}
                    onChange={(e) => updateTag(tableIdx, tagIdx, "name", e.target.value)}
                    className="h-7 font-mono text-xs"
                    placeholder="Tag name"
                  />
                  <Select
                    value={tag.data_type}
                    onValueChange={(v) => updateTag(tableIdx, tagIdx, "data_type", v)}
                  >
                    <SelectTrigger className="h-7 font-mono text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TAG_DATA_TYPES.map((dt) => (
                        <SelectItem key={dt} value={dt} className="font-mono text-xs">
                          {dt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={tag.default_value ?? ""}
                    onChange={(e) => updateTag(tableIdx, tagIdx, "default_value", e.target.value)}
                    className="h-7 font-mono text-xs"
                    placeholder="Default"
                  />
                  <Input
                    value={tag.comment ?? ""}
                    onChange={(e) => updateTag(tableIdx, tagIdx, "comment", e.target.value)}
                    className="h-7 font-mono text-xs"
                    placeholder="Comment"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => removeTag(tableIdx, tagIdx)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <Button variant="ghost" size="sm" className="mt-1 h-7 font-mono text-xs" onClick={() => addTag(tableIdx)}>
                <Plus className="mr-1 h-3 w-3" />
                Add Tag
              </Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function DropboxSection({
  project,
  onSavePath,
}: {
  project: Project;
  onSavePath: (path: string | null) => void;
}) {
  const [setupOpen, setSetupOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [manualPath, setManualPath] = useState("");

  function openLinkDialog() {
    setManualPath(project.dropbox_folder_path ?? "");
    setLinkOpen(true);
  }

  function commitLink() {
    onSavePath(manualPath.trim() || null);
    setLinkOpen(false);
  }

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-primary" />
              <h3 className="font-mono text-sm font-medium">Dropbox Folder</h3>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Job folder in Dropbox — used to derive the TIA project path in the Forge wizard.
            </p>
          </div>
          {project.dropbox_folder_path && (
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground" onClick={openLinkDialog}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* Link existing dialog */}
        {linkOpen && (
          <div className="rounded-lg border border-border/70 bg-background/40 p-4 space-y-3">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Link Existing Folder
            </div>
            <p className="text-xs text-muted-foreground">
              Open the job folder in Windows Explorer, click the address bar to select the full path, then paste it here.
            </p>
            <Input
              className="font-mono text-xs"
              placeholder="C:\Users\kaspe\Pac Technologies Dropbox\Pac\Jobs\Client\PAC-XXXX - Description"
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitLink(); if (e.key === "Escape") setLinkOpen(false); }}
              autoFocus
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={commitLink} disabled={!manualPath.trim()}>
                <Check className="h-3.5 w-3.5" />
                Save Path
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setLinkOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {project.dropbox_folder_path ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-background/40 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-mono text-sm">{project.dropbox_folder_path}</div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                TIA path: {project.dropbox_folder_path}\50 PLC\NN {project.description_short || "{Project Name}"}
              </div>
            </div>
            <Badge variant="outline" className="font-mono text-[10px] text-green-400 border-green-600/40 shrink-0">
              Linked
            </Badge>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border/70 bg-background/40 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm text-muted-foreground">No Dropbox folder linked.</div>
                <div className="text-xs text-muted-foreground/70">
                  Set up a new job folder or link an existing one to enable auto TIA path derivation.
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" onClick={() => setSetupOpen(true)}>
                  <FolderOpen className="h-4 w-4" />
                  Setup Folder
                </Button>
                <Button size="sm" variant="outline" onClick={openLinkDialog}>
                  <Pencil className="h-4 w-4" />
                  Link Existing
                </Button>
              </div>
            </div>
          </div>
        )}

        <DropboxFolderDialog
          open={setupOpen}
          onOpenChange={setSetupOpen}
          projectId={project.id}
          clientName={project.client_name}
          projectNumber={project.project_number ?? ""}
          descriptionShort={project.description_short ?? ""}
        />
      </div>
    </Card>
  );
}

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

  function handleHardwareConfigSave(layout: RackSlotLayout[], ioEntries?: IoEntry[]) {
    const updates: ProjectUpdate = { rack_slot_layout: layout };
    if (ioEntries) {
      updates.io_lists = ioEntries;
    }
    updateProject.mutate({ id: project!.id, updates });
  }

  return (
    <div className="space-y-4">
      <TiaVersionMismatchBanner projectVersion={project.tia_version} />
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
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate(`/specs?projectId=${project.id}`)}
            className="gap-1.5"
          >
            <ClipboardList className="h-4 w-4" />
            Spec Builder
          </Button>
          <Button
            size="sm"
            onClick={() => navigate(`/forge?projectId=${project.id}`)}
            className="gap-1.5"
          >
            <Wand2 className="h-4 w-4" />
            Launch Wizard
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate(`/pac-st?project=${project.id}`)}
          >
            <Play className="mr-1 h-4 w-4" />
            Open Pac-ST Session
          </Button>
        </div>
      </div>

      <Separator />

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview" className="font-mono text-xs">
            Overview
          </TabsTrigger>
          <TabsTrigger value="hardware-config" className="font-mono text-xs">
            <Cpu className="mr-1 h-3 w-3" />
            Hardware Config
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
          <TabsTrigger value="commercial" className="font-mono text-xs">
            <Receipt className="mr-1 h-3 w-3" />
            Commercial
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

                {/* Dropbox link status */}
                <DropboxSection project={project} onSavePath={(path) => handleUpdate({ dropbox_folder_path: path })} />

                {project.safety_notes && (
                  <div className="font-mono text-sm">
                    <div className="text-xs text-muted-foreground">Safety Notes</div>
                    <div className="mt-1 whitespace-pre-wrap text-xs">{project.safety_notes}</div>
                  </div>
                )}
                <GitHubRepoCard project={project} />
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  Edit Project
                </Button>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* Hardware Config */}
        <TabsContent value="hardware-config">
          <HardwareConfigEditor
            cpuType={project.cpu_type}
            rackSlotLayout={project.rack_slot_layout ?? []}
            onSave={handleHardwareConfigSave}
            existingIoEntries={project.io_lists ?? []}
            saving={updateProject.isPending}
          />
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
          <TagDbEditor
            value={project.tag_db_definitions}
            onChange={(defs) => handleUpdate({ tag_db_definitions: defs })}
            saving={updateProject.isPending}
          />
        </TabsContent>

        {/* Documents */}
        <TabsContent value="documents">
          <ProjectDocuments project={project} />
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

        {/* Commercial */}
        <TabsContent value="commercial">
          <Card className="p-4">
            <ProjectCommercialTab project={project} />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
