import { useRef, useState } from "react";
import {
  AlertCircle,
  BookPlus,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { useLibraryImport, buildSclStub, type ExtractedBlock } from "@/hooks/use-library-import";
import { useCreateFbTemplate } from "@/hooks/use-fb-templates";
import { useFbDeviceCategories } from "@/hooks/use-fb-categories";
import { extractTextFromPdf, extractTextFromDocx } from "@/lib/document-extractor";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ─── Block row ─────────────────────────────────────────────────────────────────

function BlockRow({
  block,
  onToggle,
}: {
  block: ExtractedBlock;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasParams =
    block.inputs.length > 0 || block.outputs.length > 0 || block.in_out.length > 0;

  return (
    <div
      className={cn(
        "rounded-md border transition-colors",
        block.selected
          ? "border-primary/30 bg-primary/5"
          : "border-border/40 bg-muted/5 opacity-60",
      )}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Checkbox
          checked={block.selected}
          onCheckedChange={onToggle}
          className="shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium">{block.name}</span>
            <Badge
              variant="outline"
              className={cn(
                "font-mono text-[10px] shrink-0",
                block.block_type === "FB"
                  ? "border-blue-500/40 text-blue-400"
                  : "border-emerald-500/40 text-emerald-400",
              )}
            >
              {block.block_type}
            </Badge>
          </div>
          {block.description && (
            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
              {block.description}
            </p>
          )}
        </div>
        {hasParams && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 p-1 text-muted-foreground hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>

      {expanded && hasParams && (
        <div className="border-t border-border/40 px-3 py-2 space-y-2">
          {[
            { label: "IN", params: block.inputs },
            { label: "IN_OUT", params: block.in_out },
            { label: "OUT", params: block.outputs },
          ]
            .filter((g) => g.params.length > 0)
            .map((group) => (
              <div key={group.label}>
                <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/60">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.params.map((p) => (
                    <div key={p.name} className="flex items-baseline gap-2 text-[11px]">
                      <span className="font-mono text-foreground/80 shrink-0">{p.name}</span>
                      <span className="font-mono text-muted-foreground/60 shrink-0">
                        : {p.data_type}
                      </span>
                      {p.description && (
                        <span className="text-muted-foreground truncate">{p.description}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function LibraryImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [libraryName, setLibraryName] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const { extracting, progress, blocks, error, extractFromText, toggleBlock, selectAll, reset } =
    useLibraryImport();

  const createTemplate = useCreateFbTemplate();
  const { data: categories = [] } = useFbDeviceCategories();
  const { toast } = useToast();

  const selectedBlocks = blocks.filter((b) => b.selected);
  const hasBlocks = blocks.length > 0;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    reset();

    let text = "";
    try {
      if (file.name.endsWith(".pdf")) {
        text = await extractTextFromPdf(file);
      } else if (file.name.endsWith(".docx")) {
        text = await extractTextFromDocx(file);
      } else {
        text = await file.text();
      }
    } catch {
      toast({ title: "Failed to read file", variant: "destructive" });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await extractFromText(text, controller.signal);
    } catch {
      // error shown in state
    }
  }

  async function handleImport() {
    if (selectedBlocks.length === 0) return;
    if (!libraryName.trim()) {
      toast({ title: "Enter a library name before importing", variant: "destructive" });
      return;
    }

    setImporting(true);
    let saved = 0;
    let failed = 0;

    // Find or fall back to a category
    const generalCategory =
      categories.find((c) => c.name === "general")?.name ??
      categories[0]?.name ??
      "general";

    for (const block of selectedBlocks) {
      try {
        await createTemplate.mutateAsync({
          name: block.name,
          description: block.description || null,
          device_category: generalCategory,
          plc_brand: "SIEMENS_TIA",
          tags: block.tags,
          source: "library",
          library_name: libraryName.trim(),
          blocks: [
            {
              block_name: block.name,
              block_type: block.block_type,
              scl_code: buildSclStub(block),
              sort_order: 0,
            },
          ],
        });
        saved++;
      } catch {
        failed++;
      }
    }

    setImporting(false);
    if (saved > 0) {
      toast({
        title: `Imported ${saved} block${saved !== 1 ? "s" : ""} into FB Library`,
        description:
          failed > 0 ? `${failed} block${failed !== 1 ? "s" : ""} failed to save.` : undefined,
      });
      reset();
      setFileName(null);
      setLibraryName("");
    } else {
      toast({ title: "Import failed", description: "No blocks were saved.", variant: "destructive" });
    }
  }

  function handleAbort() {
    abortRef.current?.abort();
  }

  return (
    <div className="flex h-full flex-col gap-0">
      {/* Header */}
      <div className="border-b border-border/60 px-6 py-4">
        <div className="flex items-center gap-3">
          <BookPlus className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-sm font-semibold">Library Import</h1>
            <p className="text-xs text-muted-foreground">
              Upload a TIA Portal library guide or instruction manual — all callable blocks are
              extracted and added to your FB Library for use in code generation.
            </p>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
        {/* Library name + upload */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              Library Name
            </label>
            <Input
              placeholder="e.g. LGF V3.1, LMEC Drives V2"
              value={libraryName}
              onChange={(e) => setLibraryName(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
          <div className="flex flex-col justify-end">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={extracting}
              className="gap-2"
            >
              <Upload className="h-3.5 w-3.5" />
              {fileName ? "Change File" : "Upload Document"}
            </Button>
          </div>
        </div>

        {fileName && (
          <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/20 px-3 py-2">
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
              {fileName}
            </span>
            {!extracting && (
              <button
                onClick={() => {
                  reset();
                  setFileName(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Extracting state */}
        {extracting && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="relative flex h-5 w-5 shrink-0 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-30" />
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
              </div>
              <span className="text-xs text-blue-300">{progress ?? "Extracting…"}</span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-6 px-2 text-[10px]"
                onClick={handleAbort}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Results */}
        {hasBlocks && !extracting && (
          <>
            <div className="flex items-center gap-3">
              <span className="text-sm text-foreground/80">
                Found <strong>{blocks.length}</strong> block{blocks.length !== 1 ? "s" : ""}
                {" "}—{" "}
                <span className="text-muted-foreground">
                  {selectedBlocks.length} selected
                </span>
              </span>
              <div className="ml-auto flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => selectAll(true)}
                >
                  Select all
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => selectAll(false)}
                >
                  Deselect all
                </Button>
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1 rounded-md border border-border/60">
              <div className="space-y-1.5 p-3">
                {blocks.map((block) => (
                  <BlockRow
                    key={block.name}
                    block={block}
                    onToggle={() => toggleBlock(block.name)}
                  />
                ))}
              </div>
            </ScrollArea>

            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-muted-foreground">
                {selectedBlocks.length} / {blocks.length} blocks will be imported
              </span>
              <Button
                onClick={handleImport}
                disabled={selectedBlocks.length === 0 || importing || !libraryName.trim()}
                className="gap-2"
              >
                {importing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                {importing
                  ? "Importing…"
                  : `Add ${selectedBlocks.length} to FB Library`}
              </Button>
            </div>
          </>
        )}

        {/* Empty state */}
        {!hasBlocks && !extracting && !error && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-md border border-border/40 bg-muted/5 p-10 text-center">
            <BookPlus className="h-10 w-10 text-muted-foreground/30" />
            <div>
              <p className="text-sm text-muted-foreground">
                Upload a library guide or instruction manual
              </p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                PDF, DOCX, or TXT — all callable blocks will be extracted automatically
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
