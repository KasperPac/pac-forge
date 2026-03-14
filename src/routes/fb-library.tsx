import { useState, useCallback } from "react";
import {
  Plus,
  Trash2,
  Pencil,
  Clock,
  Tag,
  Loader2,
  Layers,
  Upload,
  History,
  RotateCcw,
  X,
  FolderInput,
  Sparkles,
  GitBranch,
  ChevronDown,
} from "lucide-react";
import { CategoryIcon } from "@/components/fb-category-icons";
import Editor from "@monaco-editor/react";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  useFbTemplateHistory,
  useRevertFbTemplateVersion,
} from "@/hooks/use-fb-templates";
import { useGenerateFbSummary } from "@/hooks/use-generate-fb-summary";
import { useGenerateFbDiagram } from "@/hooks/use-fb-diagram-generate";
import { MermaidDiagram } from "@/components/ui/mermaid-diagram";
import {
  useFbDeviceCategories,
  useCreateFbDeviceCategory,
  useDeleteFbDeviceCategory,
} from "@/hooks/use-fb-categories";
import { useDesignProfiles } from "@/hooks/use-design-profiles";
import { useExportFromTia } from "@/hooks/use-export-from-tia";
import { splitSclBlocks } from "@/lib/scl-block-parser";
import { callNonStreaming } from "@/hooks/use-generation";
import { registerSclLanguage, SCL_LANGUAGE_ID } from "@/lib/monaco-scl";
import { useUiStore } from "@/stores/ui-store";
import type {
  FbTemplate,
  FbTemplateCreate,
  FbTemplateVersion,
  FbBlockType,
} from "@/types";

const BLOCK_TYPE_LABELS: Record<FbBlockType, string> = {
  FB: "FB",
  FC: "FC",
  UDT: "UDT",
  DB: "DB",
  OB: "OB",
};

interface BlockFormEntry {
  block_name: string;
  block_type: FbBlockType;
  scl_code: string;
  sort_order: number;
}

interface FormState {
  name: string;
  device_category: string;
  plc_brand: string;
  description: string;
  tags: string[];
  blocks: BlockFormEntry[];
  profile_ids: string[];
}

const EMPTY_BLOCK: BlockFormEntry = {
  block_name: "NewBlock",
  block_type: "FB",
  scl_code: "",
  sort_order: 0,
};

function emptyForm(): FormState {
  return {
    name: "",
    device_category: "",
    plc_brand: "SIEMENS_TIA",
    description: "",
    tags: [],
    blocks: [{ ...EMPTY_BLOCK }],
    profile_ids: [],
  };
}

export default function FbLibraryPage() {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<FbTemplate | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [tagInput, setTagInput] = useState("");
  const [activeBlockIdx, setActiveBlockIdx] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTemplateId, setHistoryTemplateId] = useState<string | undefined>();
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryDisplay, setNewCategoryDisplay] = useState("");
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [inputMethod, setInputMethod] = useState<"manual" | "upload" | "tia">("manual");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [generatingDesc, setGeneratingDesc] = useState(false);
  const resolvedTheme = useUiStore((s) => s.resolvedTheme);

  const { data: templates, isLoading } = useFbTemplates(activeCategory ?? undefined);
  const { data: categories, isLoading: catsLoading } = useFbDeviceCategories();
  const { data: profiles } = useDesignProfiles();
  const createTemplate = useCreateFbTemplate();
  const updateTemplate = useUpdateFbTemplate();
  const deleteTemplate = useDeleteFbTemplate();
  const createCategory = useCreateFbDeviceCategory();
  const deleteCategory = useDeleteFbDeviceCategory();
  const exportFromTia = useExportFromTia();

  function openCreate() {
    setEditingTemplate(null);
    const f = emptyForm();
    if (categories && categories.length > 0) {
      f.device_category = categories[0].name;
    }
    setForm(f);
    setTagInput("");
    setActiveBlockIdx(0);
    setInputMethod("manual");
    setDialogOpen(true);
  }

  function openEdit(template: FbTemplate) {
    setEditingTemplate(template);
    setForm({
      name: template.name,
      device_category: template.device_category,
      plc_brand: template.plc_brand,
      description: template.description ?? "",
      tags: template.tags,
      blocks:
        template.blocks && template.blocks.length > 0
          ? template.blocks.map((b) => ({
              block_name: b.block_name,
              block_type: b.block_type as FbBlockType,
              scl_code: b.scl_code,
              sort_order: b.sort_order,
            }))
          : [{ ...EMPTY_BLOCK }],
      profile_ids: template.profile_ids ?? [],
    });
    setTagInput(template.tags.join(", "));
    setActiveBlockIdx(0);
    setInputMethod("manual");
    setDialogOpen(true);
  }

  function handleSave() {
    setSaveError(null);
    const tags = tagInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const payload: FbTemplateCreate = {
      name: form.name,
      device_category: form.device_category,
      plc_brand: form.plc_brand,
      description: form.description || null,
      tags,
      blocks: form.blocks.map((b, i) => ({
        block_name: b.block_name,
        block_type: b.block_type,
        scl_code: b.scl_code,
        sort_order: i,
      })),
      profile_ids: form.profile_ids,
    };

    const errorHandler = (err: Error) => {
      setSaveError(err.message);
      console.error("FB template save error:", err);
    };

    if (editingTemplate) {
      updateTemplate.mutate(
        { id: editingTemplate.id, updates: payload },
        { onSuccess: () => setDialogOpen(false), onError: errorHandler },
      );
    } else {
      createTemplate.mutate(payload, {
        onSuccess: () => setDialogOpen(false),
        onError: errorHandler,
      });
    }
  }

  function addBlock() {
    setForm((f) => ({
      ...f,
      blocks: [...f.blocks, { ...EMPTY_BLOCK, sort_order: f.blocks.length }],
    }));
    setActiveBlockIdx(form.blocks.length);
  }

  function removeBlock(idx: number) {
    setForm((f) => {
      const blocks = f.blocks.filter((_, i) => i !== idx);
      return { ...f, blocks };
    });
    setActiveBlockIdx((prev) => Math.max(0, Math.min(prev, form.blocks.length - 2)));
  }

  function updateBlock(idx: number, updates: Partial<BlockFormEntry>) {
    setForm((f) => ({
      ...f,
      blocks: f.blocks.map((b, i) => (i === idx ? { ...b, ...updates } : b)),
    }));
  }

  // Handle .scl file upload (supports multiple files, appends to existing blocks)
  const handleSclUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList || fileList.length === 0) return;

      // Snapshot the files before resetting the input
      const files = Array.from(fileList);
      e.target.value = "";

      // Read all files with promises, then merge
      const readFile = (file: File): Promise<BlockFormEntry[]> =>
        new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const text = reader.result as string;
            const parsed = splitSclBlocks(text);
            if (parsed.length === 0) {
              resolve([{
                block_name: file.name.replace(/\.scl$/i, ""),
                block_type: "FB" as FbBlockType,
                scl_code: text,
                sort_order: 0,
              }]);
            } else {
              resolve(parsed.map((b) => ({
                block_name: b.blockName,
                block_type: b.blockType as FbBlockType,
                scl_code: b.sclCode,
                sort_order: 0,
              })));
            }
          };
          reader.onerror = () => resolve([]);
          reader.readAsText(file);
        });

      Promise.all(files.map(readFile)).then((results) => {
        const newBlocks = results.flat();
        if (newBlocks.length === 0) return;

        setForm((f) => {
          const existing = f.blocks.filter((b) => b.scl_code.trim() !== "");
          const merged = [...existing, ...newBlocks].map((b, i) => ({
            ...b,
            sort_order: i,
          }));
          return { ...f, blocks: merged };
        });
        setInputMethod("manual");
      });
    },
    [],
  );

  // Handle TIA import
  function handleTiaImport() {
    exportFromTia.mutate(undefined, {
      onSuccess: (data) => {
        if (!data.sources || Object.keys(data.sources).length === 0) return;

        const parsed = splitSclBlocks(
          Object.values(data.sources).join("\n\n"),
        );
        if (parsed.length > 0) {
          setForm((f) => ({
            ...f,
            blocks: [
              ...f.blocks.filter((b) => b.scl_code.trim() !== ""),
              ...parsed.map((b, i) => ({
                block_name: b.blockName,
                block_type: b.blockType,
                scl_code: b.sclCode,
                sort_order: f.blocks.length + i,
              })),
            ],
          }));
        }
        setInputMethod("manual");
      },
    });
  }

  function toggleProfileId(profileId: string) {
    setForm((f) => {
      const ids = new Set(f.profile_ids);
      if (ids.has(profileId)) {
        ids.delete(profileId);
      } else {
        ids.add(profileId);
      }
      return { ...f, profile_ids: Array.from(ids) };
    });
  }

  function handleAddCategory() {
    if (!newCategoryName.trim() || !newCategoryDisplay.trim()) return;
    createCategory.mutate(
      { name: newCategoryName.trim(), display_name: newCategoryDisplay.trim() },
      {
        onSuccess: () => {
          setAddCategoryOpen(false);
          setNewCategoryName("");
          setNewCategoryDisplay("");
        },
      },
    );
  }

  async function handleGenerateDescription() {
    const code = form.blocks
      .filter((b) => b.scl_code.trim())
      .map((b) => `// ${b.block_type}: ${b.block_name}\n${b.scl_code}`)
      .join("\n\n");
    if (!code) return;

    setGeneratingDesc(true);
    try {
      const abort = new AbortController();
      const { content } = await callNonStreaming(
        "You are a technical documentation assistant for PLC (Siemens TIA Portal) Function Blocks. Write a concise description (2-4 sentences) of the provided SCL code. Focus on: what the block does, key features (states, alarms, timers, safety), and typical use case. Do not include code snippets. Write in plain English.",
        [{ role: "user", content: `Describe this FB template:\n\n${code}` }],
        abort.signal,
      );
      setForm((f) => ({ ...f, description: content.trim() }));
    } catch (err) {
      console.error("Failed to generate description:", err);
    } finally {
      setGeneratingDesc(false);
    }
  }

  const { generate: generateSummary, loadingId: summaryLoadingId } = useGenerateFbSummary();
  const { generate: generateDiagram, loadingId: diagramLoadingId } = useGenerateFbDiagram();

  const isSaving = createTemplate.isPending || updateTemplate.isPending;
  const hasBlocks = form.blocks.some((b) => b.scl_code.trim() !== "");

  // Group templates by category for count badges
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
            Reusable multi-block templates injected into generation prompts.
            Templates can include FBs, UDTs, DBs, and more.
          </p>
        </div>
        <Button size="sm" onClick={openCreate} className="mt-4 gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          New Template
        </Button>
      </div>

      <Separator />

      {/* Category filter */}
      <div className="flex flex-wrap items-center gap-1">
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
        {catsLoading ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        ) : (
          categories?.map((cat) => (
            <span
              key={cat.id}
              className={`group/cat relative inline-flex items-center rounded-md font-mono text-xs transition-colors ${
                activeCategory === cat.name
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              <button
                onClick={() => setActiveCategory(cat.name)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1"
              >
                <CategoryIcon category={cat.name} className="h-3.5 w-3.5 shrink-0" />
                {cat.display_name}
                {categoryCounts.has(cat.name) && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">
                    {categoryCounts.get(cat.name)}
                  </Badge>
                )}
              </button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    className="mr-1 rounded p-0.5 opacity-0 hover:bg-destructive/20 group-hover/cat:opacity-100"
                    title="Delete category"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete category?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete the &quot;{cat.display_name}&quot; category.
                      Categories with existing templates cannot be deleted.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        deleteCategory.mutate(cat.id, {
                          onError: (err) => {
                            alert(err.message);
                          },
                          onSuccess: () => {
                            if (activeCategory === cat.name) setActiveCategory(null);
                          },
                        });
                      }}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </span>
          ))
        )}
        <button
          onClick={() => setAddCategoryOpen(true)}
          className="rounded-md px-2 py-1 font-mono text-xs text-muted-foreground hover:bg-accent/50"
        >
          <Plus className="inline h-3 w-3" /> Add
        </button>
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
              ? "No templates in this category yet."
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
              onViewHistory={(id) => {
                setHistoryTemplateId(id);
                setHistoryOpen(true);
              }}
              onGenerateSummary={generateSummary}
              summaryLoading={summaryLoadingId === template.id}
              onGenerateDiagram={generateDiagram}
              diagramLoading={diagramLoadingId === template.id}
            />
          ))}
        </div>
      )}

      {/* Create/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-mono">
              {editingTemplate ? "Edit Template" : "New FB Template"}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
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
                  onValueChange={(v) => setForm((f) => ({ ...f, device_category: v }))}
                >
                  <SelectTrigger className="font-mono text-sm">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories?.map((cat) => (
                      <SelectItem key={cat.id} value={cat.name} className="font-mono text-sm">
                        {cat.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Description + Tags */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="font-mono text-xs text-muted-foreground">Description</label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 gap-1 px-1.5 font-mono text-[10px] text-muted-foreground"
                    onClick={handleGenerateDescription}
                    disabled={generatingDesc || !form.blocks.some((b) => b.scl_code.trim())}
                    title="Generate description from code using AI"
                  >
                    {generatingDesc ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                    {generatingDesc ? "Generating..." : "Generate"}
                  </Button>
                </div>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="What does this template do?"
                  className="min-h-[48px] resize-none font-mono text-sm"
                  rows={2}
                />
              </div>
              <div className="space-y-1">
                <label className="font-mono text-xs text-muted-foreground">Tags (comma-separated)</label>
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder="e.g. safety, basic, three-phase"
                  className="font-mono text-sm"
                />
                {/* Profile scope */}
                <label className="font-mono text-xs text-muted-foreground">Profile Scope</label>
                <div className="flex flex-wrap gap-1.5 mt-0.5">
                  <Badge
                    variant={form.profile_ids.length === 0 ? "default" : "outline"}
                    className="cursor-pointer font-mono text-[10px]"
                    onClick={() => setForm((f) => ({ ...f, profile_ids: [] }))}
                  >
                    Global
                  </Badge>
                  {profiles?.map((p) => (
                    <Badge
                      key={p.id}
                      variant={form.profile_ids.includes(p.id) ? "default" : "outline"}
                      className="cursor-pointer font-mono text-[10px]"
                      onClick={() => toggleProfileId(p.id)}
                    >
                      {p.name}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            {/* Input method tabs */}
            <Tabs value={inputMethod} onValueChange={(v) => setInputMethod(v as typeof inputMethod)}>
              <TabsList className="h-8">
                <TabsTrigger value="manual" className="font-mono text-xs h-6 px-3">Manual</TabsTrigger>
                <TabsTrigger value="upload" className="font-mono text-xs h-6 px-3">
                  <Upload className="mr-1 h-3 w-3" />Upload .scl
                </TabsTrigger>
                <TabsTrigger value="tia" className="font-mono text-xs h-6 px-3">
                  <FolderInput className="mr-1 h-3 w-3" />TIA Import
                </TabsTrigger>
              </TabsList>

              <TabsContent value="upload" className="mt-2">
                <div className="flex items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed px-3 py-2 font-mono text-xs text-muted-foreground hover:bg-accent/30">
                    <Upload className="h-3.5 w-3.5" />
                    Choose .scl files
                    <input
                      type="file"
                      accept=".scl,.txt"
                      multiple
                      className="hidden"
                      onChange={handleSclUpload}
                    />
                  </label>
                  <span className="text-xs text-muted-foreground">
                    Select multiple files · multi-block files auto-split · appends to existing blocks
                  </span>
                </div>
              </TabsContent>

              <TabsContent value="tia" className="mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 font-mono text-xs"
                  onClick={handleTiaImport}
                  disabled={exportFromTia.isPending}
                >
                  {exportFromTia.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <FolderInput className="h-3 w-3" />
                  )}
                  Import from TIA Portal
                </Button>
                {exportFromTia.isError && (
                  <p className="mt-1 text-xs text-destructive">
                    {exportFromTia.error.message}
                  </p>
                )}
              </TabsContent>
            </Tabs>

            {/* Block tabs + editor */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="font-mono text-xs text-muted-foreground">
                  Blocks ({form.blocks.length})
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 font-mono text-xs"
                  onClick={addBlock}
                >
                  <Plus className="h-3 w-3" /> Add Block
                </Button>
              </div>

              {/* Block tab bar */}
              <div className="flex flex-wrap gap-1 rounded-md border bg-muted/30 p-1">
                {form.blocks.map((block, idx) => (
                  <button
                    key={idx}
                    onClick={() => setActiveBlockIdx(idx)}
                    className={`group relative flex items-center gap-1 rounded px-2 py-1 font-mono text-xs transition-colors ${
                      idx === activeBlockIdx
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Badge variant="outline" className="h-4 px-1 text-[10px]">
                      {block.block_type}
                    </Badge>
                    <span className="max-w-[100px] truncate">{block.block_name}</span>
                    {form.blocks.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeBlock(idx);
                        }}
                        className="ml-0.5 opacity-0 group-hover:opacity-100"
                      >
                        <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                      </button>
                    )}
                  </button>
                ))}
              </div>

              {/* Active block metadata */}
              {form.blocks[activeBlockIdx] && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="font-mono text-[10px] text-muted-foreground">Block Name</label>
                    <Input
                      value={form.blocks[activeBlockIdx].block_name}
                      onChange={(e) => updateBlock(activeBlockIdx, { block_name: e.target.value })}
                      className="h-7 font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-mono text-[10px] text-muted-foreground">Block Type</label>
                    <Select
                      value={form.blocks[activeBlockIdx].block_type}
                      onValueChange={(v) => updateBlock(activeBlockIdx, { block_type: v as FbBlockType })}
                    >
                      <SelectTrigger className="h-7 font-mono text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(BLOCK_TYPE_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value} className="font-mono text-xs">
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {/* Monaco editor for active block */}
              <div className="h-56 overflow-hidden rounded-md border">
                <Editor
                  language={SCL_LANGUAGE_ID}
                  theme={resolvedTheme === "dark" ? "pac-dark" : "pac-light"}
                  value={form.blocks[activeBlockIdx]?.scl_code ?? ""}
                  onChange={(value) => updateBlock(activeBlockIdx, { scl_code: value ?? "" })}
                  onMount={(_editor, monaco) => registerSclLanguage(monaco)}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 12,
                    fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    wordWrap: "off",
                    padding: { top: 8 },
                    scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
                  }}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="flex-col items-end gap-1.5 sm:flex-col">
            {(!form.name.trim() || !form.device_category || !hasBlocks) && (
              <p className="w-full text-right font-mono text-xs text-destructive">
                {[
                  !form.name.trim() && "Name is required",
                  !form.device_category && "Category is required",
                  !hasBlocks && "At least one block with code is required",
                ].filter(Boolean).join(" · ")}
              </p>
            )}
            {saveError && (
              <p className="w-full text-right font-mono text-xs text-destructive">
                Error: {saveError}
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={!form.name.trim() || !form.device_category || !hasBlocks || isSaving}
              >
                {isSaving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                {editingTemplate ? "Save Changes" : "Create Template"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version history dialog */}
      <VersionHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        templateId={historyTemplateId}
      />

      {/* Add category dialog */}
      <Dialog open={addCategoryOpen} onOpenChange={setAddCategoryOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-mono">Add Category</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="space-y-1">
              <label className="font-mono text-xs text-muted-foreground">Internal Name</label>
              <Input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="e.g. Pneumatics"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="font-mono text-xs text-muted-foreground">Display Name</label>
              <Input
                value={newCategoryDisplay}
                onChange={(e) => setNewCategoryDisplay(e.target.value)}
                placeholder="e.g. Pneumatic Devices"
                className="font-mono text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddCategoryOpen(false)}>Cancel</Button>
            <Button
              onClick={handleAddCategory}
              disabled={!newCategoryName.trim() || !newCategoryDisplay.trim() || createCategory.isPending}
            >
              {createCategory.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Add
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
  onViewHistory,
  onGenerateSummary,
  summaryLoading,
  onGenerateDiagram,
  diagramLoading,
}: {
  template: FbTemplate;
  onEdit: (t: FbTemplate) => void;
  onDelete: (id: string) => void;
  onViewHistory: (id: string) => void;
  onGenerateSummary: (t: FbTemplate) => void;
  summaryLoading: boolean;
  onGenerateDiagram: (t: FbTemplate) => void;
  diagramLoading: boolean;
}) {
  const [diagramOpen, setDiagramOpen] = useState(false);
  const blocks = template.blocks ?? [];
  const previewBlock = blocks[0];
  const previewLines = previewBlock?.scl_code.split("\n").slice(0, 5) ?? [];
  const hasMore = (previewBlock?.scl_code.split("\n").length ?? 0) > 5;

  return (
    <Card className="group flex flex-col p-4 transition-colors hover:bg-accent/30">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1 flex items-start gap-2.5">
          <CategoryIcon category={template.device_category} className="mt-0.5 h-7 w-7 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h3 className="truncate font-mono text-sm font-semibold">{template.name}</h3>
            {template.description && (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                {template.description}
              </p>
            )}
            {template.ai_summary && (
              <p className="mt-1 line-clamp-3 text-xs text-violet-400/80">
                <Sparkles className="mr-0.5 inline h-2.5 w-2.5" />
                {template.ai_summary}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={() => onGenerateDiagram(template)}
            disabled={diagramLoading || !(template.blocks && template.blocks.length > 0)}
            title={template.diagram_chart ? "Regenerate logic diagram" : "Generate logic diagram"}
          >
            {diagramLoading ? (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            ) : (
              <GitBranch className={`h-3 w-3 ${template.diagram_chart ? "text-blue-400" : "text-muted-foreground"}`} />
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={() => onGenerateSummary(template)}
            disabled={summaryLoading || !(template.blocks && template.blocks.length > 0)}
            title={template.ai_summary ? "Regenerate AI summary" : "Generate AI summary"}
          >
            {summaryLoading ? (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            ) : (
              <Sparkles className={`h-3 w-3 ${template.ai_summary ? "text-violet-400" : "text-muted-foreground"}`} />
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={() => onViewHistory(template.id)}
            title="Version history"
          >
            <History className="h-3 w-3 text-muted-foreground" />
          </Button>
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
                  This will permanently delete &quot;{template.name}&quot;. This action cannot be undone.
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
        <Badge variant="outline" className="font-mono text-xs">
          v{template.version}
        </Badge>
        <Badge variant="outline" className="font-mono text-xs">
          {blocks.length} block{blocks.length !== 1 ? "s" : ""}
        </Badge>
        {template.tags.slice(0, 2).map((tag) => (
          <Badge key={tag} variant="outline" className="font-mono text-xs">
            <Tag className="mr-0.5 h-2.5 w-2.5" />
            {tag}
          </Badge>
        ))}
      </div>

      {/* Block type chips */}
      {blocks.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-0.5">
          {blocks.map((b) => (
            <span
              key={b.id}
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              {b.block_type}: {b.block_name}
            </span>
          ))}
        </div>
      )}

      {/* Code preview */}
      {previewLines.length > 0 && (
        <div className="mt-2 overflow-hidden rounded border bg-muted/50 px-2 py-1.5">
          <pre className="font-mono text-xs leading-relaxed text-muted-foreground">
            {previewLines.join("\n")}
            {hasMore && "\n..."}
          </pre>
        </div>
      )}

      {/* Logic diagram collapsible */}
      {template.diagram_chart && (
        <div className="mt-2 border-t border-border/40 pt-2">
          <button
            className="flex w-full items-center gap-1 font-mono text-xs text-blue-400/80 hover:text-blue-400"
            onClick={() => setDiagramOpen((o) => !o)}
          >
            <GitBranch className="h-3 w-3 shrink-0" />
            Logic Diagram
            <ChevronDown className={`ml-auto h-3 w-3 transition-transform ${diagramOpen ? "rotate-180" : ""}`} />
          </button>
          {diagramOpen && (
            <div className="mt-2 overflow-x-auto rounded border border-border/50 bg-muted/30 p-2">
              <MermaidDiagram chart={template.diagram_chart} className="text-xs" />
            </div>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center gap-1 font-mono text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        {new Date(template.updated_at).toLocaleDateString()}
      </div>
    </Card>
  );
}

// --- Version History Dialog ---

function VersionHistoryDialog({
  open,
  onOpenChange,
  templateId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string | undefined;
}) {
  const { data: history, isLoading } = useFbTemplateHistory(open ? templateId : undefined);
  const revertVersion = useRevertFbTemplateVersion();

  function handleRevert(version: number) {
    if (!templateId) return;
    revertVersion.mutate(
      { templateId, version },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono">
            <History className="h-4 w-4" />
            Version History
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !history || history.length === 0 ? (
          <p className="py-4 text-center font-mono text-xs text-muted-foreground">
            No version history yet.
          </p>
        ) : (
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-2 pr-3">
              {history.map((v) => (
                <VersionRow
                  key={v.id}
                  version={v}
                  onRevert={handleRevert}
                  isReverting={revertVersion.isPending}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

function VersionRow({
  version,
  onRevert,
  isReverting,
}: {
  version: FbTemplateVersion;
  onRevert: (v: number) => void;
  isReverting: boolean;
}) {
  const blockTypes = version.blocks.map((b) => `${b.block_type}: ${b.block_name}`);

  return (
    <div className="flex items-center justify-between rounded-md border p-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className="font-mono text-xs">
            v{version.version}
          </Badge>
          <span className="font-mono text-xs text-muted-foreground">
            {new Date(version.created_at).toLocaleString()}
          </span>
        </div>
        {version.notes && (
          <p className="mt-0.5 text-xs text-muted-foreground">{version.notes}</p>
        )}
        <div className="mt-0.5 flex flex-wrap gap-0.5">
          {blockTypes.map((bt, i) => (
            <span key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
              {bt}
            </span>
          ))}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 font-mono text-xs"
        onClick={() => onRevert(version.version)}
        disabled={isReverting}
      >
        <RotateCcw className="h-3 w-3" />
        Revert
      </Button>
    </div>
  );
}
