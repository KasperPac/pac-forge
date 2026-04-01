import { useState, useMemo, useRef, useCallback } from "react";
import {
  Plus,
  Trash2,
  Pencil,
  Cpu,
  ChevronDown,
  Search,
  Loader2,
  X,
  Zap,
  ArrowDown,
  ArrowUp,
  Upload,
  FileText,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import {
  useInstructions,
  useCreateInstruction,
  useUpdateInstruction,
  useDeleteInstruction,
  useVerifyFromXml,
} from "@/hooks/use-instructions";
import { useInstructionPdfImport } from "@/hooks/use-instruction-pdf-import";
import type { ExtractedInstruction } from "@/hooks/use-instruction-pdf-import";
import { parseInstructionXml } from "@/lib/instruction-xml-parser";
import type { XmlVerifyResult } from "@/lib/instruction-xml-parser";
import { getPdfPageCount } from "@/lib/document-extractor";
import type {
  Instruction,
  InstructionCategory,
  InstructionCreate,
  InstructionPin,
  InstructionLanguage,
} from "@/types";
import { INSTRUCTION_CATEGORIES } from "@/types/instruction";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Pin editor row type (no id/instruction_id/created_at)
// ---------------------------------------------------------------------------

type PinDraft = Omit<InstructionPin, "id" | "instruction_id" | "created_at">;

const EMPTY_PIN: PinDraft = {
  pin_name: "",
  direction: "in",
  data_type: "BOOL",
  is_rung_flow: false,
  is_required: true,
  description: null,
  sort_order: 0,
};

const DIRECTION_OPTIONS = [
  { value: "in", label: "In" },
  { value: "out", label: "Out" },
  { value: "inout", label: "InOut" },
] as const;

const LANGUAGE_OPTIONS: { value: InstructionLanguage; label: string }[] = [
  { value: "LAD", label: "LAD" },
  { value: "SCL", label: "SCL" },
  { value: "BOTH", label: "Both" },
];

const CATEGORY_ENTRIES = Object.entries(INSTRUCTION_CATEGORIES) as [
  InstructionCategory,
  string,
][];

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function InstructionLibraryPage() {
  const [categoryFilter, setCategoryFilter] = useState<
    InstructionCategory | undefined
  >(undefined);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // PDF import state
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const pdfAbortRef = useRef<AbortController | null>(null);
  const pdfImport = useInstructionPdfImport();
  const [pdfProgress, setPdfProgress] = useState<{
    current: number;
    total: number;
    status: string;
  } | null>(null);
  const [pdfResult, setPdfResult] = useState<{
    created: number;
    skipped: number;
    skippedNames: string[];
  } | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [extractedLive, setExtractedLive] = useState<ExtractedInstruction[]>([]);
  const [pdfPageRange, setPdfPageRange] = useState<{
    file: File;
    pageCount: number;
    startPage: string;
    endPage: string;
  } | null>(null);

  // XML verify state
  const xmlInputRef = useRef<HTMLInputElement>(null);
  const verifyMutation = useVerifyFromXml();
  const [xmlResult, setXmlResult] = useState<XmlVerifyResult | null>(null);
  const [xmlError, setXmlError] = useState<string | null>(null);

  const { data: instructions, isLoading } = useInstructions(categoryFilter);
  const deleteMutation = useDeleteInstruction();

  const filtered = useMemo(() => {
    if (!instructions) return [];
    if (!searchQuery.trim()) return instructions;
    const q = searchQuery.toLowerCase();
    return instructions.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.element_type.toLowerCase().includes(q) ||
        i.simatic_part_name.toLowerCase().includes(q) ||
        (i.description ?? "").toLowerCase().includes(q),
    );
  }, [instructions, searchQuery]);

  const handleEdit = (inst: Instruction) => {
    setEditingId(inst.id);
    setDialogOpen(true);
  };

  const handleCreate = () => {
    setEditingId(null);
    setDialogOpen(true);
  };

  const handlePdfFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setPdfError("Only PDF files are supported.");
      return;
    }
    setPdfError(null);
    setPdfResult(null);
    try {
      const pageCount = await getPdfPageCount(file);
      setPdfPageRange({ file, pageCount, startPage: "1", endPage: String(pageCount) });
    } catch {
      setPdfError("Could not read PDF page count.");
    }
    if (pdfInputRef.current) pdfInputRef.current.value = "";
  }, []);

  const handlePdfImport = useCallback(async () => {
    if (!pdfPageRange) return;
    const { file, startPage: startStr, endPage: endStr } = pdfPageRange;
    const startPage = parseInt(startStr, 10) || 1;
    const endPage = parseInt(endStr, 10) || undefined;

    setPdfPageRange(null);
    setPdfResult(null);
    setPdfError(null);
    setExtractedLive([]);

    const abort = new AbortController();
    pdfAbortRef.current = abort;
    setPdfProgress({ current: 0, total: 1, status: "Starting..." });

    try {
      const result = await pdfImport.mutateAsync({
        file,
        startPage,
        endPage,
        signal: abort.signal,
        onProgress: (current, total, status) => {
          setPdfProgress({ current, total, status });
        },
        onExtracted: (batch) => {
          setExtractedLive((prev) => {
            const seen = new Set(prev.map((i) => i.element_type));
            const newOnes = batch.filter((i) => !seen.has(i.element_type));
            return [...prev, ...newOnes];
          });
        },
      });
      setPdfResult({
        created: result.instructionsCreated,
        skipped: result.instructionsSkipped,
        skippedNames: result.skippedNames,
      });
    } catch (err) {
      if (abort.signal.aborted) return;
      setPdfError(err instanceof Error ? err.message : "PDF import failed");
    } finally {
      setPdfProgress(null);
      pdfAbortRef.current = null;
    }
  }, [pdfPageRange, pdfImport]);

  const handleCancelPdf = useCallback(() => {
    pdfAbortRef.current?.abort();
    setPdfProgress(null);
  }, []);

  const handleXmlFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setXmlError(null);
    setXmlResult(null);

    try {
      const text = await file.text();
      const parsed = parseInstructionXml(text);

      if (parsed.size === 0) {
        setXmlError("No LAD/FBD instructions found in this XML file.");
        return;
      }

      // Match parsed Part Names to existing instructions
      const found: XmlVerifyResult["found"] = [];
      const unmatched: XmlVerifyResult["unmatched"] = [];

      for (const [partName, def] of parsed) {
        const pinNames = Array.from(def.pins.keys());
        const match = (instructions ?? []).find(
          (i) => i.simatic_part_name.toLowerCase() === partName.toLowerCase(),
        );

        if (match) {
          const currentPins = (match.pins ?? []).map((p) => p.pin_name);
          const pinsChanged =
            pinNames.length !== currentPins.length ||
            pinNames.some((p) => !currentPins.includes(p));

          found.push({
            partName,
            pins: pinNames,
            matchedInstructionId: match.id,
            matchedInstructionName: match.name,
            currentPins,
            pinsChanged,
          });
        } else {
          unmatched.push({ partName, pins: pinNames });
        }
      }

      setXmlResult({ found, unmatched });
    } catch {
      setXmlError("Failed to parse XML file.");
    }

    if (xmlInputRef.current) xmlInputRef.current.value = "";
  }, [instructions]);

  const handleApplyXmlVerification = useCallback(async () => {
    if (!xmlResult) return;

    const verifyUpdates = xmlResult.found
      .filter((f) => f.matchedInstructionId)
      .map((f) => ({
        instructionId: f.matchedInstructionId!,
        pins: f.pins.map((pinName) => ({
          pin_name: pinName,
          direction: (["out", "eno", "q"].includes(pinName.toLowerCase()) ? "out" : "in") as "in" | "out" | "inout",
          is_rung_flow: ["in", "out", "en", "eno", "pre", "q", "in1", "in2"].includes(pinName.toLowerCase())
            ? !["in1", "in2"].includes(pinName.toLowerCase()) // in1/in2 are data, not rung flow
            : false,
        })),
      }));

    try {
      await verifyMutation.mutateAsync(verifyUpdates);
      setXmlResult(null);
    } catch (err) {
      setXmlError(err instanceof Error ? err.message : "Failed to apply verification");
    }
  }, [xmlResult, verifyMutation]);

  return (
    <div className="flex flex-col gap-4 p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Cpu className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-xl font-semibold">Instruction Library</h1>
            <p className="text-sm text-muted-foreground">
              Structured reference for LAD/SCL instructions. Used by agents at
              generation time.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={handlePdfFileSelect}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => pdfInputRef.current?.click()}
            disabled={!!pdfProgress}
          >
            <Upload className="h-4 w-4 mr-1" />
            Import PDF
          </Button>
          <input
            ref={xmlInputRef}
            type="file"
            accept=".xml"
            className="hidden"
            onChange={handleXmlFileSelect}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => xmlInputRef.current?.click()}
          >
            <FileText className="h-4 w-4 mr-1" />
            Verify from XML
          </Button>
          <Button size="sm" onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-1" />
            Add Instruction
          </Button>
        </div>
      </div>

      <Separator />

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          variant={categoryFilter === undefined ? "secondary" : "ghost"}
          onClick={() => setCategoryFilter(undefined)}
        >
          All
        </Button>
        {CATEGORY_ENTRIES.map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={categoryFilter === key ? "secondary" : "ghost"}
            onClick={() =>
              setCategoryFilter(categoryFilter === key ? undefined : key)
            }
          >
            {label}
          </Button>
        ))}
        <div className="ml-auto relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search instructions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-7 h-8 w-56 text-sm"
          />
        </div>
      </div>

      {/* PDF page range dialog */}
      {pdfPageRange && (
        <Card className="p-4 border-blue-500/30 bg-blue-500/5">
          <div className="flex items-center gap-3 mb-3">
            <FileText className="h-5 w-5 text-blue-400" />
            <div>
              <p className="text-sm font-medium">{pdfPageRange.file.name}</p>
              <p className="text-xs text-muted-foreground">
                {pdfPageRange.pageCount} pages total
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-xs whitespace-nowrap">Pages:</Label>
              <Input
                type="number"
                value={pdfPageRange.startPage}
                onChange={(e) =>
                  setPdfPageRange({ ...pdfPageRange, startPage: e.target.value })
                }
                className="w-20 h-8 text-sm"
                min={1}
                max={pdfPageRange.pageCount}
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="number"
                value={pdfPageRange.endPage}
                onChange={(e) =>
                  setPdfPageRange({ ...pdfPageRange, endPage: e.target.value })
                }
                className="w-20 h-8 text-sm"
                min={1}
                max={pdfPageRange.pageCount}
              />
            </div>
            <Button size="sm" onClick={handlePdfImport}>
              Extract Instructions
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPdfPageRange(null)}
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* PDF import progress */}
      {pdfProgress && (
        <Card className="p-4 border-blue-500/30 bg-blue-500/5">
          <div className="flex items-center gap-3 mb-2">
            <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
            <span className="text-sm">{pdfProgress.status}</span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto text-xs"
              onClick={handleCancelPdf}
            >
              Cancel
            </Button>
          </div>
          <Progress
            value={
              pdfProgress.total > 0
                ? (pdfProgress.current / pdfProgress.total) * 100
                : 0
            }
            className="h-1.5"
          />
          {/* Live extraction list */}
          {extractedLive.length > 0 && (
            <div className="mt-3 max-h-48 overflow-y-auto">
              <p className="text-xs text-muted-foreground mb-1.5">
                Found {extractedLive.length} instruction(s):
              </p>
              <div className="flex flex-wrap gap-1.5">
                {extractedLive.map((inst, i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className="text-xs font-mono gap-1"
                  >
                    {inst.name}
                    <span className="text-muted-foreground">
                      ({inst.simatic_part_name})
                    </span>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* PDF import result */}
      {pdfResult && (
        <Card className="p-4 border-green-500/30 bg-green-500/5">
          <div className="flex items-center gap-3">
            <CheckCircle className="h-4 w-4 text-green-400" />
            <span className="text-sm">
              Created {pdfResult.created} instruction(s)
              {pdfResult.skipped > 0 && (
                <>, skipped {pdfResult.skipped} (already exist{pdfResult.skippedNames.length > 0 ? `: ${pdfResult.skippedNames.slice(0, 5).join(", ")}${pdfResult.skippedNames.length > 5 ? "..." : ""}` : ""})</>
              )}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => setPdfResult(null)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Card>
      )}

      {/* PDF import error */}
      {pdfError && (
        <Card className="p-4 border-destructive/30 bg-destructive/5">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span className="text-sm text-destructive">{pdfError}</span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => setPdfError(null)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Card>
      )}

      {/* XML verification result */}
      {xmlResult && (
        <Card className="p-4 border-blue-500/30 bg-blue-500/5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-400" />
              <span className="text-sm font-medium">
                XML Verification: {xmlResult.found.length} matched, {xmlResult.unmatched.length} unmatched
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleApplyXmlVerification} disabled={verifyMutation.isPending}>
                {verifyMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                Apply Verified Pins
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setXmlResult(null)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {xmlResult.found.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Matched instructions:</p>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {xmlResult.found.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <Badge variant="outline" className="font-mono">{f.partName}</Badge>
                    <span className="text-muted-foreground">{f.matchedInstructionName}</span>
                    <span className="text-muted-foreground">pins: {f.pins.join(", ")}</span>
                    {f.pinsChanged ? (
                      <Badge variant="secondary" className="text-amber-400 text-xs">changed</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-green-400 text-xs">match</Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {xmlResult.unmatched.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Not matched (no instruction with this Part Name):</p>
              <div className="flex flex-wrap gap-1.5">
                {xmlResult.unmatched.map((u, i) => (
                  <Badge key={i} variant="outline" className="text-xs font-mono opacity-60">
                    {u.partName} ({u.pins.join(", ")})
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* XML error */}
      {xmlError && (
        <Card className="p-4 border-destructive/30 bg-destructive/5">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span className="text-sm text-destructive">{xmlError}</span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setXmlError(null)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Card>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading instructions...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Cpu className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm">
            {searchQuery
              ? "No instructions match your search."
              : "No instructions yet. Add one to get started."}
          </p>
        </div>
      ) : (
        <ScrollArea className="h-[calc(100vh-220px)]">
          <div className="flex flex-col gap-2 pr-4">
            {filtered.map((inst) => (
              <InstructionCard
                key={inst.id}
                instruction={inst}
                expanded={expandedId === inst.id}
                onToggle={() =>
                  setExpandedId(expandedId === inst.id ? null : inst.id)
                }
                onEdit={() => handleEdit(inst)}
                onDelete={() => deleteMutation.mutate(inst.id)}
              />
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Create / Edit Dialog */}
      <InstructionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editId={editingId}
        instructions={instructions ?? []}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Instruction Card
// ---------------------------------------------------------------------------

function InstructionCard({
  instruction,
  expanded,
  onToggle,
  onEdit,
  onDelete,
}: {
  instruction: Instruction;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const pins = instruction.pins ?? [];
  const catLabel =
    INSTRUCTION_CATEGORIES[instruction.category as InstructionCategory] ??
    instruction.category;

  return (
    <Card className="p-0 overflow-hidden">
      <Collapsible open={expanded} onOpenChange={onToggle}>
        <CollapsibleTrigger className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/40 transition-colors text-left">
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform shrink-0",
              expanded && "rotate-180",
            )}
          />
          <Zap className="h-4 w-4 text-amber-500 shrink-0" />
          <span className="font-medium text-sm">{instruction.name}</span>
          <Badge variant="outline" className="font-mono text-xs">
            {instruction.simatic_part_name}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {catLabel}
          </Badge>
          {instruction.programming_language !== "BOTH" && (
            <Badge
              variant="outline"
              className={cn(
                "text-xs",
                instruction.programming_language === "LAD"
                  ? "border-blue-500/40 text-blue-400"
                  : "border-green-500/40 text-green-400",
              )}
            >
              {instruction.programming_language}
            </Badge>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {pins.length} pin{pins.length !== 1 ? "s" : ""}
          </span>
          {instruction.is_box && (
            <Badge variant="outline" className="text-xs opacity-60">
              Box
            </Badge>
          )}
          {instruction.has_instance && (
            <Badge variant="outline" className="text-xs opacity-60">
              Instance
            </Badge>
          )}
          {instruction.verified && (
            <Badge variant="outline" className="text-xs border-green-500/40 text-green-400">
              Verified
            </Badge>
          )}
        </CollapsibleTrigger>

        <CollapsibleContent>
          <Separator />
          <div className="px-4 py-3 space-y-3">
            {instruction.description && (
              <p className="text-sm text-muted-foreground">
                {instruction.description}
              </p>
            )}

            {/* Metadata row */}
            <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
              <span>
                element_type:{" "}
                <code className="text-foreground">
                  {instruction.element_type}
                </code>
              </span>
              <span>
                Platforms:{" "}
                {instruction.supported_platforms.join(", ")}
              </span>
              {instruction.has_operator &&
                instruction.operators &&
                instruction.operators.length > 0 && (
                  <span>
                    Operators: {instruction.operators.join(", ")}
                  </span>
                )}
            </div>

            {/* Pin table */}
            {pins.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Pin</TableHead>
                    <TableHead className="w-16">Dir</TableHead>
                    <TableHead className="w-20">Type</TableHead>
                    <TableHead className="w-20">Flow</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pins.map((pin) => (
                    <TableRow key={pin.id}>
                      <TableCell className="font-mono text-sm font-medium">
                        {pin.pin_name}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs",
                            pin.direction === "in"
                              ? "border-blue-500/40 text-blue-400"
                              : pin.direction === "out"
                                ? "border-green-500/40 text-green-400"
                                : "border-amber-500/40 text-amber-400",
                          )}
                        >
                          {pin.direction}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {pin.data_type}
                      </TableCell>
                      <TableCell>
                        {pin.is_rung_flow && (
                          <Badge variant="secondary" className="text-xs">
                            rung
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {pin.description}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {instruction.notes && (
              <div className="text-xs text-muted-foreground border-l-2 border-muted pl-3">
                {instruction.notes}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" variant="ghost" onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5 mr-1" />
                Edit
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" className="text-destructive">
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete instruction?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete &quot;{instruction.name}&quot;
                      and all its pin definitions. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={onDelete}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Create / Edit Dialog
// ---------------------------------------------------------------------------

function InstructionDialog({
  open,
  onOpenChange,
  editId,
  instructions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editId: string | null;
  instructions: Instruction[];
}) {
  const createMutation = useCreateInstruction();
  const updateMutation = useUpdateInstruction();

  const existing = editId
    ? instructions.find((i) => i.id === editId)
    : undefined;

  // Form state
  const [name, setName] = useState("");
  const [elementType, setElementType] = useState("");
  const [category, setCategory] = useState<InstructionCategory>("bit_logic");
  const [description, setDescription] = useState("");
  const [partName, setPartName] = useState("");
  const [language, setLanguage] = useState<InstructionLanguage>("LAD");
  const [platforms, setPlatforms] = useState("S7-1200,S7-1500");
  const [isBox, setIsBox] = useState(false);
  const [isOutput, setIsOutput] = useState(false);
  const [hasInstance, setHasInstance] = useState(false);
  const [hasOperator, setHasOperator] = useState(false);
  const [operators, setOperators] = useState("");
  const [operatorPartNames, setOperatorPartNames] = useState("");
  const [notes, setNotes] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [pins, setPins] = useState<PinDraft[]>([]);

  // Reset form when dialog opens
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      if (existing) {
        setName(existing.name);
        setElementType(existing.element_type);
        setCategory(existing.category);
        setDescription(existing.description ?? "");
        setPartName(existing.simatic_part_name);
        setLanguage(existing.programming_language);
        setPlatforms(existing.supported_platforms.join(","));
        setIsBox(existing.is_box);
        setIsOutput(existing.is_output);
        setHasInstance(existing.has_instance);
        setHasOperator(existing.has_operator);
        setOperators(existing.operators?.join(",") ?? "");
        setOperatorPartNames(
          existing.operator_part_names
            ? JSON.stringify(existing.operator_part_names)
            : "",
        );
        setNotes(existing.notes ?? "");
        setSortOrder(existing.sort_order);
        setPins(
          (existing.pins ?? []).map((p) => ({
            pin_name: p.pin_name,
            direction: p.direction,
            data_type: p.data_type,
            is_rung_flow: p.is_rung_flow,
            is_required: p.is_required,
            description: p.description,
            sort_order: p.sort_order,
          })),
        );
      } else {
        setName("");
        setElementType("");
        setCategory("bit_logic");
        setDescription("");
        setPartName("");
        setLanguage("LAD");
        setPlatforms("S7-1200,S7-1500");
        setIsBox(false);
        setIsOutput(false);
        setHasInstance(false);
        setHasOperator(false);
        setOperators("");
        setOperatorPartNames("");
        setNotes("");
        setSortOrder(0);
        setPins([{ ...EMPTY_PIN }]);
      }
    }
    onOpenChange(nextOpen);
  };

  const addPin = () =>
    setPins([...pins, { ...EMPTY_PIN, sort_order: pins.length }]);
  const removePin = (idx: number) =>
    setPins(pins.filter((_, i) => i !== idx));
  const updatePin = (idx: number, field: keyof PinDraft, value: unknown) => {
    const next = [...pins];
    next[idx] = { ...next[idx], [field]: value };
    setPins(next);
  };
  const movePin = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= pins.length) return;
    const next = [...pins];
    [next[idx], next[target]] = [next[target], next[idx]];
    next.forEach((p, i) => (p.sort_order = i));
    setPins(next);
  };

  const handleSave = async () => {
    const platformArr = platforms
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    let opPartNames: Record<string, string> | null = null;
    if (operatorPartNames.trim()) {
      try {
        opPartNames = JSON.parse(operatorPartNames);
      } catch {
        // ignore parse error
      }
    }
    const opsArr = operators
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const payload: InstructionCreate = {
      name,
      element_type: elementType,
      category,
      description: description || null,
      simatic_part_name: partName,
      programming_language: language,
      supported_platforms: platformArr,
      is_box: isBox,
      is_output: isOutput,
      has_instance: hasInstance,
      has_operator: hasOperator,
      operators: opsArr.length > 0 ? opsArr : null,
      operator_part_names: opPartNames,
      notes: notes || null,
      verified: false,
      sort_order: sortOrder,
      pins: pins.map((p, i) => ({ ...p, sort_order: i })),
    };

    if (editId) {
      await updateMutation.mutateAsync({ id: editId, updates: payload });
    } else {
      await createMutation.mutateAsync(payload);
    }
    onOpenChange(false);
  };

  const saving = createMutation.isPending || updateMutation.isPending;
  const canSave = name.trim() && elementType.trim() && partName.trim();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editId ? "Edit Instruction" : "Add Instruction"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="NO Contact"
            />
          </div>
          {/* Element Type */}
          <div className="space-y-1.5">
            <Label>Element Type</Label>
            <Input
              value={elementType}
              onChange={(e) => setElementType(e.target.value)}
              placeholder="NO_CONTACT"
              className="font-mono"
            />
          </div>
          {/* Part Name */}
          <div className="space-y-1.5">
            <Label>SimaticML Part Name</Label>
            <Input
              value={partName}
              onChange={(e) => setPartName(e.target.value)}
              placeholder="Contact"
              className="font-mono"
            />
          </div>
          {/* Category */}
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as InstructionCategory)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_ENTRIES.map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Language */}
          <div className="space-y-1.5">
            <Label>Language</Label>
            <Select
              value={language}
              onValueChange={(v) => setLanguage(v as InstructionLanguage)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Platforms */}
          <div className="space-y-1.5">
            <Label>Platforms (comma-separated)</Label>
            <Input
              value={platforms}
              onChange={(e) => setPlatforms(e.target.value)}
              placeholder="S7-1200,S7-1500"
            />
          </div>
          {/* Sort Order */}
          <div className="space-y-1.5">
            <Label>Sort Order</Label>
            <Input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
            />
          </div>
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <Label>Description</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Functional description of the instruction..."
            rows={2}
          />
        </div>

        {/* Flags */}
        <div className="flex items-center gap-6 flex-wrap">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={isBox}
              onCheckedChange={(v) => setIsBox(v === true)}
            />
            Box element
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={isOutput}
              onCheckedChange={(v) => setIsOutput(v === true)}
            />
            Output (end of rung)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={hasInstance}
              onCheckedChange={(v) => setHasInstance(v === true)}
            />
            Requires instance
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={hasOperator}
              onCheckedChange={(v) => setHasOperator(v === true)}
            />
            Has sub-operators
          </label>
        </div>

        {/* Operator fields (conditional) */}
        {hasOperator && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Operators (comma-separated)</Label>
              <Input
                value={operators}
                onChange={(e) => setOperators(e.target.value)}
                placeholder="==,!=,>,<,>=,<="
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Operator Part Names (JSON)</Label>
              <Input
                value={operatorPartNames}
                onChange={(e) => setOperatorPartNames(e.target.value)}
                placeholder='{"==":"Eq","!=":"Ne"}'
                className="font-mono text-sm"
              />
            </div>
          </div>
        )}

        {/* Notes */}
        <div className="space-y-1.5">
          <Label>Notes</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Additional XML/import notes..."
            rows={2}
          />
        </div>

        <Separator />

        {/* Pin editor */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-base">Pins</Label>
            <Button size="sm" variant="outline" onClick={addPin}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Pin
            </Button>
          </div>

          {pins.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              No pins defined. Click &quot;Add Pin&quot; to start.
            </p>
          ) : (
            <div className="space-y-2">
              {pins.map((pin, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 p-2 rounded border bg-muted/20"
                >
                  {/* Reorder */}
                  <div className="flex flex-col gap-0.5">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5"
                      onClick={() => movePin(idx, -1)}
                      disabled={idx === 0}
                    >
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5"
                      onClick={() => movePin(idx, 1)}
                      disabled={idx === pins.length - 1}
                    >
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                  </div>

                  {/* Pin name */}
                  <Input
                    value={pin.pin_name}
                    onChange={(e) =>
                      updatePin(idx, "pin_name", e.target.value)
                    }
                    placeholder="pin_name"
                    className="w-24 font-mono text-sm h-8"
                  />

                  {/* Direction */}
                  <Select
                    value={pin.direction}
                    onValueChange={(v) => updatePin(idx, "direction", v)}
                  >
                    <SelectTrigger className="w-20 h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DIRECTION_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Data type */}
                  <Input
                    value={pin.data_type}
                    onChange={(e) =>
                      updatePin(idx, "data_type", e.target.value)
                    }
                    placeholder="BOOL"
                    className="w-20 font-mono text-sm h-8"
                  />

                  {/* Rung flow */}
                  <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                    <Checkbox
                      checked={pin.is_rung_flow}
                      onCheckedChange={(v) =>
                        updatePin(idx, "is_rung_flow", v === true)
                      }
                    />
                    Rung
                  </label>

                  {/* Description */}
                  <Input
                    value={pin.description ?? ""}
                    onChange={(e) =>
                      updatePin(
                        idx,
                        "description",
                        e.target.value || null,
                      )
                    }
                    placeholder="Description..."
                    className="flex-1 text-sm h-8"
                  />

                  {/* Remove */}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 text-destructive"
                    onClick={() => removePin(idx)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !canSave}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {editId ? "Save Changes" : "Create Instruction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
