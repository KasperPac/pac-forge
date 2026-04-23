import { useState, useCallback, useMemo } from "react";
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
  FileText,
  Download,
  Search,
  ChevronDown as ChevronDownIcon,
} from "lucide-react";
import { CategoryIcon } from "@/components/fb-category-icons";
import Editor from "@monaco-editor/react";
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
  useSetLibraryEnabled,
} from "@/hooks/use-fb-templates";
import { Switch } from "@/components/ui/switch";
import { useGenerateFbSummary } from "@/hooks/use-generate-fb-summary";
import { useGenerateFbDocumentation } from "@/hooks/use-generate-fb-documentation";
import { useToast } from "@/hooks/use-toast";
import {
  useFbDeviceCategories,
  useCreateFbDeviceCategory,
  useDeleteFbDeviceCategory,
} from "@/hooks/use-fb-categories";
import { useDesignProfiles } from "@/hooks/use-design-profiles";
import { useExportFromTia } from "@/hooks/use-export-from-tia";
import { splitSclBlocks } from "@/lib/scl-block-parser";
import { callNonStreaming } from "@/hooks/use-generation";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import { registerSclLanguage, SCL_LANGUAGE_ID } from "@/lib/monaco-scl";
import { useUiStore } from "@/stores/ui-store";
import { useFbLibraryImport } from "@/hooks/use-fb-library-import";
import { useFbDocImport } from "@/hooks/use-fb-doc-import";
import type {
  FbTemplate,
  FbTemplateCreate,
  FbTemplateVersion,
  FbBlockType,
} from "@/types";
import {
  EMPTY_INTERFACE_CONTRACT,
  isContractPopulated,
  normaliseInterfaceContract,
  type FbInterfaceContract,
} from "@/types/fb-interface-contract";
import { InterfaceContractEditor } from "@/components/fb-library/interface-contract-editor";

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
  documentation: string;
  tags: string[];
  blocks: BlockFormEntry[];
  profile_ids: string[];
  is_assembly: boolean;
  interface_contract: FbInterfaceContract;
  deprecated: boolean;
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
    documentation: "",
    tags: [],
    blocks: [{ ...EMPTY_BLOCK }],
    profile_ids: [],
    is_assembly: false,
    interface_contract: { ...EMPTY_INTERFACE_CONTRACT },
    deprecated: false,
  };
}

export default function FbLibraryPage() {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [assemblyFilter, setAssemblyFilter] = useState<"all" | "device" | "assembly">("all");
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
  const bridgeBaseUrl = DEFAULT_BRIDGE_CONFIG.baseUrl;
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importProjectPath, setImportProjectPath] = useState("");
  const [importLibraryName, setImportLibraryName] = useState("");
  const [importCategory, setImportCategory] = useState("");
  const { importLibrary, loading: tiaImportLoading, progress: tiaImportProgress, error: tiaImportError } = useFbLibraryImport();
  const [importDocFiles, setImportDocFiles] = useState<File[]>([]);
  const { importDocumentation, loading: docImportLoading, progress: docImportProgress } = useFbDocImport();
  const { toast } = useToast();

  const { data: templates, isLoading } = useFbTemplates(activeCategory ?? undefined);
  const { data: allTemplates } = useFbTemplates(); // for library list (unfiltered)
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "library" | "custom">("all");
  const [langFilter, setLangFilter] = useState<"all" | "SCL" | "LAD">("all");

  // Search + filter
  const filteredTemplates = useMemo(() => {
    let list = templates ?? [];
    if (assemblyFilter !== "all") {
      list = list.filter((t) => assemblyFilter === "assembly" ? t.is_assembly : !t.is_assembly);
    }
    if (sourceFilter !== "all") {
      list = list.filter((t) => sourceFilter === "library" ? t.source === "library" : t.source !== "library");
    }
    if (langFilter !== "all") {
      list = list.filter((t) => (t.blocks ?? []).some((b) => b.programming_language === langFilter));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((t) =>
        t.name.toLowerCase().includes(q) ||
        t.device_category.toLowerCase().includes(q) ||
        (t.ai_summary ?? "").toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q)) ||
        (t.blocks ?? []).some((b) => b.block_name.toLowerCase().includes(q))
      );
    }
    return list;
  }, [templates, searchQuery, assemblyFilter, sourceFilter, langFilter]);
  const { data: categories, isLoading: catsLoading } = useFbDeviceCategories();
  const { data: profiles } = useDesignProfiles();
  const createTemplate = useCreateFbTemplate();
  const updateTemplate = useUpdateFbTemplate();
  const deleteTemplate = useDeleteFbTemplate();
  const createCategory = useCreateFbDeviceCategory();
  const deleteCategory = useDeleteFbDeviceCategory();
  const exportFromTia = useExportFromTia();
  const setLibraryEnabled = useSetLibraryEnabled();

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
      documentation: template.documentation ?? "",
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
      is_assembly: template.is_assembly ?? false,
      interface_contract: normaliseInterfaceContract(template.interface_contract),
      deprecated: template.deprecated ?? false,
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
      documentation: form.documentation || null,
      tags,
      blocks: form.blocks.map((b, i) => ({
        block_name: b.block_name,
        block_type: b.block_type,
        scl_code: b.scl_code,
        sort_order: i,
      })),
      profile_ids: form.profile_ids,
      is_assembly: form.is_assembly,
      interface_contract: form.interface_contract,
      deprecated: form.deprecated,
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
  const { generate: generateDocumentation, loadingId: documentationLoadingId } = useGenerateFbDocumentation();
  const [bulkSummaryLoading, setBulkSummaryLoading] = useState(false);
  // search/filter state moved above filteredTemplates useMemo

  const missingSummaryCount = (allTemplates ?? []).filter((t) => !t.ai_summary && (t.blocks?.length ?? 0) > 0).length;

  async function handleBulkGenerateSummaries() {
    const missing = (allTemplates ?? []).filter((t) => !t.ai_summary && (t.blocks?.length ?? 0) > 0);
    if (missing.length === 0) return;
    setBulkSummaryLoading(true);
    let done = 0;
    for (const t of missing) {
      try {
        await generateSummary(t);
        done++;
      } catch (err) {
        console.warn(`[bulk-summary] Failed for ${t.name}:`, err);
      }
    }
    setBulkSummaryLoading(false);
    toast({ title: "Summaries generated", description: `${done} of ${missing.length} templates updated.` });
  }

  const isSaving = createTemplate.isPending || updateTemplate.isPending;
  const hasBlocks = form.blocks.some((b) => b.scl_code.trim() !== "");

  // Group templates by category for count badges
  const categoryCounts = new Map<string, number>();
  if (!activeCategory && templates) {
    for (const t of templates) {
      categoryCounts.set(t.device_category, (categoryCounts.get(t.device_category) ?? 0) + 1);
    }
  }

  // Collect distinct libraries from ALL templates (ignore active category filter)
  const libraryMap = new Map<string, { count: number; enabled: boolean }>();
  for (const t of allTemplates ?? []) {
    if (t.source === "library" && t.library_name) {
      const existing = libraryMap.get(t.library_name);
      if (!existing) {
        libraryMap.set(t.library_name, { count: 1, enabled: t.is_enabled });
      } else {
        existing.count++;
        // Library is "enabled" if at least one of its templates is enabled
        if (t.is_enabled) existing.enabled = true;
      }
    }
  }
  const libraries = [...libraryMap.entries()].sort(([a], [b]) => a.localeCompare(b));

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
        <div className="flex items-center gap-2 mt-4">
          {missingSummaryCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleBulkGenerateSummaries}
              disabled={bulkSummaryLoading}
              className="gap-1.5"
            >
              {bulkSummaryLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Generate Summaries ({missingSummaryCount})
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setImportDialogOpen(true)} className="gap-1.5">
            <Download className="h-3.5 w-3.5" />
            Import Library
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={docImportLoading}
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = ".pdf,.txt";
              input.onchange = async (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (!file) return;
                try {
                  const result = await importDocumentation(file);
                  toast({
                    title: "Documentation imported",
                    description: `${result.matched} sections matched to templates, ${result.unmatched} unmatched.`,
                  });
                } catch (err) {
                  toast({
                    title: "Import failed",
                    description: err instanceof Error ? err.message : String(err),
                    variant: "destructive",
                  });
                }
              };
              input.click();
            }}
          >
            {docImportLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
            Import Docs PDF
          </Button>
          <Button size="sm" onClick={openCreate} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            New Template
          </Button>
        </div>
      </div>

      {/* Import progress banner */}
      {(tiaImportLoading || docImportLoading) && (
        <div className="flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-2.5">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <div className="text-sm">
            {tiaImportProgress?.phase ?? docImportProgress?.phase ?? "Importing..."}
            {(tiaImportProgress?.total ?? 0) > 0 && (
              <span className="ml-2 text-muted-foreground">
                ({tiaImportProgress?.current}/{tiaImportProgress?.total})
              </span>
            )}
          </div>
        </div>
      )}

      {/* Library Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import from TIA Global Library</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <label className="font-mono text-xs text-muted-foreground">Global Library Path (.al17–.al20 / .zal17–.zal20)</label>
              <div className="flex gap-1.5">
                <Input
                  value={importProjectPath}
                  onChange={(e) => setImportProjectPath(e.target.value)}
                  placeholder="C:\...\Open Library V19 PLC.al20"
                  className="flex-1 font-mono text-sm"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-1.5"
                  onClick={async () => {
                    try {
                      const res = await fetch(`${bridgeBaseUrl}/tia/browse-file`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          title: "Select TIA Global Library",
                          filter: "TIA Libraries|*.al17;*.al18;*.al19;*.al20;*.zal17;*.zal18;*.zal19;*.zal20|All Files|*.*",
                          initial_directory: importProjectPath ? importProjectPath.replace(/[/\\][^/\\]+$/, "") : "",
                        }),
                      });
                      if (res.ok) {
                        const data = await res.json();
                        if (data.success && data.file_path) {
                          setImportProjectPath(data.file_path);
                          // Auto-fill library name from file name if empty
                          if (!importLibraryName && data.file_name) {
                            const name = data.file_name.replace(/\.(zal|al)\d+$/i, "").trim();
                            setImportLibraryName(name);
                          }
                        }
                      }
                    } catch (err) {
                      console.warn("Browse failed (bridge may not be running):", err);
                    }
                  }}
                >
                  <FolderInput className="h-3.5 w-3.5" />
                  Browse
                </Button>
              </div>
              <p className="text-xs text-muted-foreground/60">
                The .al (unarchived) or .zal (archived) library file. TIA Portal must be open.
              </p>
            </div>
            <div className="space-y-1">
              <label className="font-mono text-xs text-muted-foreground">Library Name</label>
              <Input
                value={importLibraryName}
                onChange={(e) => setImportLibraryName(e.target.value)}
                placeholder="Siemens Open Library V5.0"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="font-mono text-xs text-muted-foreground">Default Device Category</label>
              <Select value={importCategory} onValueChange={setImportCategory}>
                <SelectTrigger className="font-mono text-sm">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories?.map((c) => (
                    <SelectItem key={c.name} value={c.name}>{c.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="font-mono text-xs text-muted-foreground">Documentation PDFs (optional — multi-select)</label>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".pdf,.txt";
                    input.multiple = true;
                    input.onchange = (e) => {
                      const files = Array.from((e.target as HTMLInputElement).files ?? []);
                      if (files.length > 0) setImportDocFiles(files);
                    };
                    input.click();
                  }}
                >
                  <FileText className="h-3.5 w-3.5" />
                  {importDocFiles.length > 0 ? `${importDocFiles.length} files` : "Upload PDFs"}
                </Button>
                {importDocFiles.length > 0 && (
                  <div className="flex flex-col text-xs text-muted-foreground">
                    {importDocFiles.map((f) => (
                      <span key={f.name} className="truncate max-w-[250px]">{f.name}</span>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground/60">
                Upload all library documentation PDFs. The key one is "Detailed Block Overview" — AI splits it per-FB. General docs (architecture, setup) are attached as library-wide reference.
              </p>
            </div>
            {tiaImportError && (
              <div className="text-sm text-destructive">{tiaImportError}</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={async () => {
                try {
                  const res = await importLibrary(importProjectPath, importLibraryName, importCategory, importDocFiles.length > 0 ? importDocFiles : undefined);
                  toast({
                    title: "Import complete",
                    description: `${res.imported} templates imported. Docs: ${res.docsMatched} matched, ${res.docsUnmatched} unmatched.`,
                  });
                  setImportDialogOpen(false);
                  setImportDocFiles([]);
                } catch {
                  // Error in tiaImportError
                }
              }}
              disabled={tiaImportLoading || !importProjectPath || !importLibraryName || !importCategory}
              className="gap-1.5"
            >
              {tiaImportLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* Imported libraries — enable/disable toggles + delete */}
      {libraries.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-border/50 bg-muted/20 px-3 py-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Libraries</span>
          {libraries.map(([name, { count, enabled }]) => (
            <div key={name} className="flex items-center gap-1.5">
              <Switch
                checked={enabled}
                onCheckedChange={(val) => setLibraryEnabled.mutate({ libraryName: name, enabled: val })}
                className="h-4 w-7 data-[state=checked]:bg-amber-500"
              />
              <span className={`font-mono text-xs ${enabled ? "text-foreground" : "text-muted-foreground line-through"}`}>
                {name}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">({count})</span>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button className="ml-0.5 rounded p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive" title={`Delete all ${count} templates from ${name}`}>
                    <Trash2 className="h-3 w-3" />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete entire library?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete all {count} templates from &quot;{name}&quot;. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={async () => {
                        const ids = (allTemplates ?? [])
                          .filter((t) => t.source === "library" && t.library_name === name)
                          .map((t) => t.id);
                        for (const id of ids) {
                          deleteTemplate.mutate(id);
                        }
                        toast({ title: "Library deleted", description: `${ids.length} templates removed from "${name}".` });
                      }}
                    >
                      Delete {count} templates
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </div>
      )}

      {/* Search + filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search templates..."
            className="h-8 pl-8 font-mono text-xs"
          />
        </div>
        <Select value={assemblyFilter} onValueChange={(v) => setAssemblyFilter(v as "all" | "device" | "assembly")}>
          <SelectTrigger className="h-8 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="device">Device FBs</SelectItem>
            <SelectItem value="assembly">Assembly FBs</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as "all" | "library" | "custom")}>
          <SelectTrigger className="h-8 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="library">Library</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>
        <Select value={langFilter} onValueChange={(v) => setLangFilter(v as "all" | "SCL" | "LAD")}>
          <SelectTrigger className="h-8 w-24 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All langs</SelectItem>
            <SelectItem value="SCL">SCL</SelectItem>
            <SelectItem value="LAD">LAD</SelectItem>
          </SelectContent>
        </Select>
        <span className="font-mono text-[10px] text-muted-foreground whitespace-nowrap">
          {filteredTemplates.length} / {templates?.length ?? 0}
        </span>
      </div>

      {/* Template list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="rounded-md border border-dashed px-4 py-12 text-center">
          <div className="font-mono text-sm text-muted-foreground">
            {searchQuery ? "No templates match your search." : activeCategory
              ? "No templates in this category yet."
              : "No templates yet. Create one to get started."}
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          {filteredTemplates.map((template) => (
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
              onGenerateDocumentation={generateDocumentation}
              summaryLoading={summaryLoadingId === template.id}
              documentationLoading={documentationLoadingId === template.id}
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

            {/* Assembly toggle */}
            <div className="flex items-center gap-2">
              <Switch
                checked={form.is_assembly}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, is_assembly: checked }))}
                id="is-assembly-toggle"
              />
              <label htmlFor="is-assembly-toggle" className="font-mono text-xs text-muted-foreground cursor-pointer">
                Assembly FB
              </label>
              <span className="font-mono text-[10px] text-muted-foreground/60">
                {form.is_assembly ? "Coordinates groups of devices (conveyor, lift table, press)" : "Controls a single physical device (motor, sensor, valve)"}
              </span>
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
                <label className="font-mono text-xs text-muted-foreground">Documentation (manufacturer/library docs)</label>
                <Textarea
                  value={form.documentation}
                  onChange={(e) => setForm((f) => ({ ...f, documentation: e.target.value }))}
                  placeholder="Paste manufacturer documentation here — wiring instructions, parameter descriptions, behaviour, status codes. This is injected verbatim into generation prompts."
                  className="min-h-[80px] resize-y font-mono text-xs"
                  rows={4}
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

            {/* Variable table (parsed from all blocks' SCL interface) */}
            {form.blocks.some((b) => b.scl_code.trim()) && (
              <div className="space-y-1">
                <label className="font-mono text-xs text-muted-foreground">Interface Variables (parsed from SCL)</label>
                <VariableTable blocks={form.blocks} />
              </div>
            )}

            {/* Interface contract editor (Phase 2) — structured declaration that
                drives the Spec Builder Co-Author wiring form when this template
                is bound to an assembly. */}
            <InterfaceContractEditor
              contract={form.interface_contract}
              onChange={(next) => setForm((f) => ({ ...f, interface_contract: next }))}
              sclBlocks={form.blocks}
            />

            {/* Deprecation toggle */}
            <div className="flex items-center gap-2 rounded-md border border-border/30 bg-muted/10 px-2 py-1.5">
              <Switch
                checked={form.deprecated}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, deprecated: checked }))}
                id="deprecated-toggle"
              />
              <label htmlFor="deprecated-toggle" className="font-mono text-xs text-muted-foreground cursor-pointer">
                Deprecated
              </label>
              <span className="font-mono text-[10px] text-muted-foreground/60">
                When on, new specs cannot bind to this template; existing bindings keep working.
              </span>
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

// --- Template Card (compact expandable) ---

function TemplateCard({
  template,
  onEdit,
  onDelete,
  onViewHistory,
  onGenerateSummary,
  onGenerateDocumentation,
  summaryLoading,
  documentationLoading,
}: {
  template: FbTemplate;
  onEdit: (t: FbTemplate) => void;
  onDelete: (id: string) => void;
  onViewHistory: (id: string) => void;
  onGenerateSummary: (t: FbTemplate) => void;
  onGenerateDocumentation: (t: FbTemplate) => void;
  summaryLoading: boolean;
  documentationLoading: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const blocks = template.blocks ?? [];
  const ladBlock = blocks.find((b) => b.block_xml && b.programming_language === "LAD");
  const hasLad = !!ladBlock;

  // Extract first line of AI summary for compact view
  const summaryPreview = template.ai_summary?.split("\n").find((l) => l.trim() && !l.startsWith("##") && !l.startsWith("SECTION"))?.trim() ?? null;

  return (
    <div className={`rounded border border-border/40 transition-colors hover:border-border/80 ${!template.is_enabled ? "opacity-50" : ""}`}>
      {/* Compact header row */}
      <div
        className="flex cursor-pointer items-center gap-2 px-3 py-2"
        onClick={() => setExpanded((e) => !e)}
      >
        <ChevronDownIcon className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-0" : "-rotate-90"}`} />
        <CategoryIcon category={template.device_category} className="h-5 w-5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-mono text-xs font-semibold">{template.name}</span>

        {/* Inline badges */}
        <Badge variant="secondary" className="shrink-0 font-mono text-[10px] px-1.5 py-0">
          {template.device_category}
        </Badge>
        {template.is_assembly && (
          <Badge variant="outline" className="shrink-0 font-mono text-[10px] px-1 py-0 border-blue-500/40 text-blue-400">
            assembly
          </Badge>
        )}
        {isContractPopulated(normaliseInterfaceContract(template.interface_contract)) && (
          <Badge variant="outline" className="shrink-0 font-mono text-[10px] px-1 py-0 border-emerald-500/40 text-emerald-400" title="Interface contract populated — Co-Author can render structured wiring form">
            iface
          </Badge>
        )}
        {template.deprecated && (
          <Badge variant="outline" className="shrink-0 font-mono text-[10px] px-1 py-0 border-orange-500/40 text-orange-400" title="Deprecated — new specs cannot bind to this template">
            deprecated
          </Badge>
        )}
        {template.source === "library" && (
          <Badge variant="outline" className="shrink-0 font-mono text-[10px] px-1 py-0 border-amber-500/40 text-amber-400">
            lib
          </Badge>
        )}
        {blocks.some((b) => b.programming_language && b.programming_language !== "SCL") && (
          <Badge variant="outline" className="shrink-0 font-mono text-[10px] px-1 py-0 border-green-500/40 text-green-400">
            {blocks.find((b) => b.programming_language !== "SCL")?.programming_language}
          </Badge>
        )}
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {blocks.length} block{blocks.length !== 1 ? "s" : ""}
        </span>

        {/* Summary preview (one line) */}
        {summaryPreview && !expanded && (
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/70">
            {summaryPreview}
          </span>
        )}

        {/* Actions (always visible, right side) */}
        <div className="ml-auto flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => onGenerateSummary(template)} disabled={summaryLoading} title="Generate AI summary">
            {summaryLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className={`h-3 w-3 ${template.ai_summary ? "text-violet-400" : "text-muted-foreground"}`} />}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => onGenerateDocumentation(template)}
            disabled={documentationLoading}
            title="Generate full documentation"
          >
            {documentationLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className={`h-3 w-3 ${template.documentation ? "text-blue-400" : "text-muted-foreground"}`} />}
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => onEdit(template)} title="Edit">
            <Pencil className="h-3 w-3 text-muted-foreground" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => onViewHistory(template.id)} title="History">
            <History className="h-3 w-3 text-muted-foreground" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Delete">
                <Trash2 className="h-3 w-3 text-muted-foreground" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete template?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete &quot;{template.name}&quot;.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => onDelete(template.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border/30 px-3 py-2 space-y-2">
          {/* AI Summary */}
          {template.ai_summary && (
            <div className="rounded bg-muted/30 px-2.5 py-2">
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">
                {template.ai_summary}
              </pre>
            </div>
          )}

          {/* Variable table — parsed from SCL interface */}
          <VariableTable blocks={blocks} />

          {/* Tags + metadata */}
          <div className="flex flex-wrap gap-1">
            <Badge variant="outline" className="font-mono text-[10px]">v{template.version}</Badge>
            {template.source === "library" && template.library_name && (
              <Badge variant="outline" className="font-mono text-[10px] border-amber-500/40 text-amber-400">
                {template.library_name}
              </Badge>
            )}
            {template.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="font-mono text-[10px]">
                <Tag className="mr-0.5 h-2.5 w-2.5" />{tag}
              </Badge>
            ))}
            {template.documentation && (
              <Badge variant="outline" className="font-mono text-[10px] border-blue-500/40 text-blue-400">
                <FileText className="mr-0.5 h-2.5 w-2.5" />docs
              </Badge>
            )}
            {hasLad && (
              <Badge variant="outline" className="font-mono text-[10px] border-green-500/40 text-green-400">
                <Layers className="mr-0.5 h-2.5 w-2.5" />LAD logic
              </Badge>
            )}
          </div>

          {/* Block chips */}
          <div className="flex flex-wrap gap-0.5">
            {blocks.map((b) => (
              <span key={b.id} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {b.block_type}: {b.block_name}
                {b.programming_language && b.programming_language !== "SCL" && (
                  <span className="ml-1 text-green-400/70">[{b.programming_language}]</span>
                )}
              </span>
            ))}
          </div>

          {/* Description */}
          {template.description && (
            <p className="text-xs text-muted-foreground">{template.description}</p>
          )}

          <div className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
            <Clock className="h-2.5 w-2.5" />
            {new Date(template.updated_at).toLocaleDateString()}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Variable Table (parsed from SCL interface) ---

interface ParsedVar {
  name: string;
  type: string;
  section: string;
  comment: string;
}

function parseVarsFromScl(scl: string): ParsedVar[] {
  const vars: ParsedVar[] = [];
  const blockRe = /VAR_(INPUT|OUTPUT|IN_OUT|TEMP)\b([\s\S]*?)END_VAR/gi;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(scl)) !== null) {
    const section = block[1].replace("_", " ");
    const body = block[2];
    const declRe = /^\s+(\w+)\s*:\s*([^;]+);?\s*(?:\/\/\s*(.*))?$/gm;
    let decl: RegExpExecArray | null;
    while ((decl = declRe.exec(body)) !== null) {
      vars.push({
        name: decl[1],
        type: decl[2].trim(),
        section,
        comment: decl[3]?.trim() ?? "",
      });
    }
  }
  // Also parse plain VAR section (static vars)
  const staticRe = /\bVAR\b(?!\s*_)([\s\S]*?)END_VAR/gi;
  let staticBlock: RegExpExecArray | null;
  while ((staticBlock = staticRe.exec(scl)) !== null) {
    const body = staticBlock[1];
    const declRe = /^\s+(\w+)\s*:\s*([^;]+);?\s*(?:\/\/\s*(.*))?$/gm;
    let decl: RegExpExecArray | null;
    while ((decl = declRe.exec(body)) !== null) {
      vars.push({
        name: decl[1],
        type: decl[2].trim(),
        section: "STATIC",
        comment: decl[3]?.trim() ?? "",
      });
    }
  }
  return vars;
}

const SECTION_COLORS: Record<string, string> = {
  INPUT: "text-blue-400/70",
  OUTPUT: "text-green-400/70",
  "IN OUT": "text-cyan-400/70",
  STATIC: "text-muted-foreground/50",
  TEMP: "text-muted-foreground/40",
};

function VariableTable({ blocks }: { blocks: Array<{ block_name: string; block_type: string; scl_code: string }> }) {
  const allVars = blocks.flatMap((b) => {
    const vars = parseVarsFromScl(b.scl_code);
    return vars.map((v) => ({ ...v, blockName: b.block_name, blockType: b.block_type }));
  });

  if (allVars.length === 0) return null;

  // Group by section
  const sections = ["INPUT", "OUTPUT", "IN OUT", "STATIC", "TEMP"];
  const grouped = sections
    .map((s) => ({ section: s, vars: allVars.filter((v) => v.section === s) }))
    .filter((g) => g.vars.length > 0);

  return (
    <div className="rounded border border-border/40 overflow-hidden">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border/30 bg-muted/30">
            <th className="px-2 py-1 text-left font-mono text-[10px] uppercase text-muted-foreground">Direction</th>
            <th className="px-2 py-1 text-left font-mono text-[10px] uppercase text-muted-foreground">Name</th>
            <th className="px-2 py-1 text-left font-mono text-[10px] uppercase text-muted-foreground">Type</th>
            <th className="px-2 py-1 text-left font-mono text-[10px] uppercase text-muted-foreground">Description</th>
          </tr>
        </thead>
        <tbody>
          {grouped.map((g) =>
            g.vars.map((v, i) => (
              <tr key={`${g.section}-${v.name}-${i}`} className="border-b border-border/10 hover:bg-muted/20">
                <td className={`px-2 py-0.5 font-mono ${SECTION_COLORS[g.section] ?? "text-muted-foreground"}`}>
                  {i === 0 ? g.section : ""}
                </td>
                <td className="px-2 py-0.5 font-mono text-foreground">{v.name}</td>
                <td className="px-2 py-0.5 font-mono text-muted-foreground">{v.type}</td>
                <td className="px-2 py-0.5 text-muted-foreground">{v.comment}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
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
