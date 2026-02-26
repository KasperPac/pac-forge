import { useState } from "react";
import {
  Plus,
  Trash2,
  Pencil,
  Clock,
  Tag,
  Loader2,
  Layers,
} from "lucide-react";
import Editor from "@monaco-editor/react";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  useFbTemplates,
  useCreateFbTemplate,
  useUpdateFbTemplate,
  useDeleteFbTemplate,
} from "@/hooks/use-fb-templates";
import { registerSclLanguage, SCL_LANGUAGE_ID } from "@/lib/monaco-scl";
import { FB_DEVICE_CATEGORIES } from "@/types";
import type { FbTemplate, FbDeviceCategory, FbTemplateCreate } from "@/types";

const CATEGORY_LABELS: Record<FbDeviceCategory, string> = {
  Motor: "Motors",
  Sensor: "Sensors",
  Valve: "Valves",
  Pushbutton: "Pushbuttons",
  LightTower: "Light Towers",
  VFD: "VFDs",
  ConveyorSection: "Conveyor Sections",
  ZPASection: "ZPA Sections",
  Custom: "Custom",
};

const EMPTY_FORM: FbTemplateCreate = {
  name: "",
  device_category: "Motor",
  plc_brand: "SIEMENS_TIA",
  description: "",
  base_scl: "",
  parameters: {},
  tags: [],
};

export default function FbLibraryPage() {
  const [activeCategory, setActiveCategory] = useState<FbDeviceCategory | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<FbTemplate | null>(null);
  const [form, setForm] = useState<FbTemplateCreate>(EMPTY_FORM);
  const [tagInput, setTagInput] = useState("");

  const { data: templates, isLoading } = useFbTemplates(activeCategory ?? undefined);
  const createTemplate = useCreateFbTemplate();
  const updateTemplate = useUpdateFbTemplate();
  const deleteTemplate = useDeleteFbTemplate();

  const categories = Object.entries(FB_DEVICE_CATEGORIES) as [string, FbDeviceCategory][];

  function openCreate() {
    setEditingTemplate(null);
    setForm(EMPTY_FORM);
    setTagInput("");
    setDialogOpen(true);
  }

  function openEdit(template: FbTemplate) {
    setEditingTemplate(template);
    setForm({
      name: template.name,
      device_category: template.device_category,
      plc_brand: template.plc_brand,
      description: template.description ?? "",
      base_scl: template.base_scl,
      parameters: template.parameters,
      tags: template.tags,
    });
    setTagInput(template.tags.join(", "));
    setDialogOpen(true);
  }

  function handleSave() {
    const tags = tagInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const payload = { ...form, tags };

    if (editingTemplate) {
      updateTemplate.mutate(
        { id: editingTemplate.id, updates: payload },
        { onSuccess: () => setDialogOpen(false) },
      );
    } else {
      createTemplate.mutate(payload, {
        onSuccess: () => setDialogOpen(false),
      });
    }
  }

  const isSaving = createTemplate.isPending || updateTemplate.isPending;

  // Group templates by category for the count badges
  const categoryCounts = new Map<string, number>();
  if (!activeCategory && templates) {
    for (const t of templates) {
      categoryCounts.set(t.device_category, (categoryCounts.get(t.device_category) ?? 0) + 1);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-muted-foreground">CONFIGURATION</div>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Layers className="h-5 w-5" />
            FB Library
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Reusable function block templates injected into generation prompts.
            The Code Architect uses these as a starting point when generating
            blocks for matching device categories.
          </p>
        </div>
        <Button size="sm" onClick={openCreate} className="mt-4 gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          New Template
        </Button>
      </div>

      <Separator />

      {/* Category filter */}
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => setActiveCategory(null)}
          className={`rounded-md px-2.5 py-1 font-mono text-xs transition-colors ${
            activeCategory === null
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50"
          }`}
        >
          All
        </button>
        {categories.map(([key, value]) => (
          <button
            key={key}
            onClick={() => setActiveCategory(value)}
            className={`rounded-md px-2.5 py-1 font-mono text-xs transition-colors ${
              activeCategory === value
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50"
            }`}
          >
            {CATEGORY_LABELS[value]}
            {categoryCounts.has(value) && (
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">
                {categoryCounts.get(value)}
              </Badge>
            )}
          </button>
        ))}
      </div>

      {/* Template grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : templates?.length === 0 ? (
        <div className="rounded-md border border-dashed px-4 py-12 text-center">
          <div className="font-mono text-sm text-muted-foreground">
            {activeCategory
              ? `No ${CATEGORY_LABELS[activeCategory].toLowerCase()} templates yet.`
              : "No templates yet. Create one to get started."}
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates?.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onEdit={openEdit}
              onDelete={(id) => deleteTemplate.mutate(id)}
            />
          ))}
        </div>
      )}

      {/* Create/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-mono">
              {editingTemplate ? "Edit Template" : "New FB Template"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {/* Row 1: Name + Category */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="font-mono text-xs text-muted-foreground">Name</label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Motor_DOL"
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="font-mono text-xs text-muted-foreground">Category</label>
                <Select
                  value={form.device_category}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, device_category: v as FbDeviceCategory }))
                  }
                >
                  <SelectTrigger className="font-mono text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(([key, value]) => (
                      <SelectItem key={key} value={value} className="font-mono text-sm">
                        {CATEGORY_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1">
              <label className="font-mono text-xs text-muted-foreground">Description</label>
              <Textarea
                value={form.description ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="What does this FB do?"
                className="min-h-[48px] resize-none font-mono text-sm"
                rows={2}
              />
            </div>

            {/* Tags */}
            <div className="space-y-1">
              <label className="font-mono text-xs text-muted-foreground">
                Tags (comma-separated)
              </label>
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="e.g. safety, basic, three-phase"
                className="font-mono text-sm"
              />
            </div>

            {/* SCL Editor */}
            <div className="space-y-1">
              <label className="font-mono text-xs text-muted-foreground">Base SCL Code</label>
              <div className="h-64 overflow-hidden rounded-md border">
                <Editor
                  language={SCL_LANGUAGE_ID}
                  theme="pac-dark"
                  value={form.base_scl}
                  onChange={(value) => setForm((f) => ({ ...f, base_scl: value ?? "" }))}
                  onMount={(_editor, monaco) => registerSclLanguage(monaco)}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 12,
                    fontFamily:
                      "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    wordWrap: "off",
                    padding: { top: 8 },
                    scrollbar: {
                      verticalScrollbarSize: 8,
                      horizontalScrollbarSize: 8,
                    },
                  }}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!form.name.trim() || !form.base_scl.trim() || isSaving}
            >
              {isSaving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {editingTemplate ? "Save Changes" : "Create Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Template Card ---

function TemplateCard({
  template,
  onEdit,
  onDelete,
}: {
  template: FbTemplate;
  onEdit: (t: FbTemplate) => void;
  onDelete: (id: string) => void;
}) {
  const previewLines = template.base_scl.split("\n").slice(0, 6);
  const hasMore = template.base_scl.split("\n").length > 6;

  return (
    <Card className="group flex flex-col p-4 transition-colors hover:bg-accent/30">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-mono text-sm font-semibold">{template.name}</h3>
          {template.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {template.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={() => onEdit(template)}
          >
            <Pencil className="h-3 w-3 text-muted-foreground" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                <Trash2 className="h-3 w-3 text-muted-foreground" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete template?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete "{template.name}". This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => onDelete(template.id)}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        <Badge variant="secondary" className="font-mono text-xs">
          {template.device_category}
        </Badge>
        {template.tags.slice(0, 3).map((tag) => (
          <Badge key={tag} variant="outline" className="font-mono text-xs">
            <Tag className="mr-0.5 h-2.5 w-2.5" />
            {tag}
          </Badge>
        ))}
      </div>

      {/* Code preview */}
      <div className="mt-2 overflow-hidden rounded border bg-black/20 px-2 py-1.5">
        <pre className="font-mono text-xs leading-relaxed text-muted-foreground">
          {previewLines.join("\n")}
          {hasMore && "\n..."}
        </pre>
      </div>

      <div className="mt-2 flex items-center gap-1 font-mono text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        {new Date(template.updated_at).toLocaleDateString()}
      </div>
    </Card>
  );
}
