/**
 * Pac-LAD: Ladder Logic Editor & AI Generator
 * Proof-of-concept for AI-generated ladder logic with TIA Portal XML export.
 */

import { useState, useCallback, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Send,
  Loader2,
  ImagePlus,
  Download,
  Plus,
  Trash2,
  X,
  GitBranchPlus,
  Sparkles,
  Upload,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Cpu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { LadCanvas } from "@/components/lad-editor/lad-canvas";
import { LadPropertiesPanel } from "@/components/lad-editor/lad-properties-panel";
import { useLadGenerate } from "@/hooks/use-lad-generate";
import { useLadImport } from "@/hooks/use-lad-import";
import { useBridgeStatus } from "@/hooks/use-tia-jobs";
import { useAgents } from "@/hooks/use-agents";
import { useFilteredAgentKnowledgeDocs } from "@/hooks/use-agent-knowledge";
import { useActivePromptSections } from "@/hooks/use-prompt-sections";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import { buildLadXml } from "@/lib/lad-xml-builder";
import type {
  LadProgram,
  LadElement,
  LadElementType,
  LadRung,
  LadNode,
} from "@/types/lad";
import { LAD_ELEMENT_TYPES, LAD_ELEMENT_LABELS, isOutputElement } from "@/types/lad";

// ---------------------------------------------------------------------------
// Default empty program
// ---------------------------------------------------------------------------

function createEmptyProgram(): LadProgram {
  return {
    id: `lad_${Date.now()}`,
    name: "NewBlock",
    blockType: "FB",
    variables: [],
    rungs: [
      {
        id: "rung_1",
        title: "Network 1",
        logic: {
          type: "series",
          nodes: [
            {
              type: "element",
              element: {
                id: "el_1",
                type: "NO_CONTACT",
                operand: "input1",
              },
            },
            {
              type: "element",
              element: {
                id: "el_2",
                type: "OUTPUT_COIL",
                operand: "output1",
              },
            },
          ],
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Helper: find element in program tree
// ---------------------------------------------------------------------------

function findElement(program: LadProgram, id: string): LadElement | null {
  for (const rung of program.rungs) {
    const found = findInChain(rung.logic.nodes, id);
    if (found) return found;
  }
  return null;
}

function findInChain(nodes: LadNode[], id: string): LadElement | null {
  for (const node of nodes) {
    if (node.type === "element" && node.element.id === id) return node.element;
    if (node.type === "parallel") {
      for (const branch of node.branches) {
        const found = findInChain(branch.nodes, id);
        if (found) return found;
      }
    }
  }
  return null;
}

function updateElementInProgram(
  program: LadProgram,
  id: string,
  patch: Partial<LadElement>,
): LadProgram {
  return {
    ...program,
    rungs: program.rungs.map((rung) => ({
      ...rung,
      logic: {
        ...rung.logic,
        nodes: updateInNodes(rung.logic.nodes, id, patch),
      },
    })),
  };
}

function updateInNodes(
  nodes: LadNode[],
  id: string,
  patch: Partial<LadElement>,
): LadNode[] {
  return nodes.map((node) => {
    if (node.type === "element" && node.element.id === id) {
      return { ...node, element: { ...node.element, ...patch } };
    }
    if (node.type === "parallel") {
      return {
        ...node,
        branches: node.branches.map((b) => ({
          ...b,
          nodes: updateInNodes(b.nodes, id, patch),
        })),
      };
    }
    return node;
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PacLadPage() {
  const [program, setProgram] = useState<LadProgram>(createEmptyProgram);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const imageDataRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tiaProjectPath, setTiaProjectPath] = useState("");
  const [compileAfterImport, setCompileAfterImport] = useState(true);
  const [tiaPanelOpen, setTiaPanelOpen] = useState(false);

  const { data: agents } = useAgents();
  const codeArchitect = agents?.find((a) => a.display_name === "Code Architect");
  const { data: knowledgeDocs } = useFilteredAgentKnowledgeDocs(codeArchitect?.id, "SIEMENS_TIA");
  const { data: promptSections } = useActivePromptSections();

  const { generate, generateFromImage, loading, error } = useLadGenerate({
    agentKnowledgeDocs: knowledgeDocs,
    promptSections,
  });
  const { importToTia, loading: importing, error: importError, result: importResult, reset: resetImport } = useLadImport();
  const { data: bridgeStatus, refetch: refetchBridgeStatus } = useBridgeStatus();
  const queryClient = useQueryClient();

  const connectMutation = useMutation({
    mutationFn: async () => {
      const resp = await fetch(`${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "attach" }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `Bridge returned ${resp.status}`);
      }
      return resp.json() as Promise<{ success: boolean; message: string }>;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["tia-bridge-status"] });
      void refetchBridgeStatus();
    },
  });

  const selectedElement = selectedId ? findElement(program, selectedId) : null;

  // AI generation
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() && !imageDataRef.current) return;

    let result: LadProgram | null = null;
    if (imageDataRef.current) {
      result = await generateFromImage(imageDataRef.current, prompt.trim() || undefined);
    } else {
      result = await generate(prompt.trim());
    }

    if (result) {
      setProgram(result);
      setSelectedId(null);
      setPrompt("");
      setImagePreview(null);
      imageDataRef.current = null;
    }
  }, [prompt, generate, generateFromImage]);

  // Image upload
  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setImagePreview(dataUrl);
      // Strip data URI prefix for base64
      imageDataRef.current = dataUrl.replace(/^data:image\/[^;]+;base64,/, "");
    };
    reader.readAsDataURL(file);
  }, []);

  // Update element
  const handleUpdateElement = useCallback(
    (id: string, patch: Partial<LadElement>) => {
      setProgram((prev) => updateElementInProgram(prev, id, patch));
    },
    [],
  );

  // Add rung
  const handleAddRung = useCallback(() => {
    const rungId = `rung_${Date.now()}`;
    const newRung: LadRung = {
      id: rungId,
      title: `Network ${program.rungs.length + 1}`,
      logic: {
        type: "series",
        nodes: [
          {
            type: "element",
            element: {
              id: `el_${Date.now()}_1`,
              type: "NO_CONTACT",
              operand: "input",
            },
          },
          {
            type: "element",
            element: {
              id: `el_${Date.now()}_2`,
              type: "OUTPUT_COIL",
              operand: "output",
            },
          },
        ],
      },
    };
    setProgram((prev) => ({ ...prev, rungs: [...prev.rungs, newRung] }));
  }, [program.rungs.length]);

  // Add element to selected rung
  const handleAddElement = useCallback(
    (type: LadElementType) => {
      // Find which rung the selected element is in, or use the last rung
      let targetRungIdx = program.rungs.length - 1;
      if (selectedId) {
        for (let i = 0; i < program.rungs.length; i++) {
          if (findInChain(program.rungs[i].logic.nodes, selectedId)) {
            targetRungIdx = i;
            break;
          }
        }
      }

      const newEl: LadElement = {
        id: `el_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        type,
        operand: isOutputElement(type) ? "output" : "input",
      };

      setProgram((prev) => ({
        ...prev,
        rungs: prev.rungs.map((rung, i) => {
          if (i !== targetRungIdx) return rung;
          // Insert before the last element (which is typically the coil)
          const nodes = [...rung.logic.nodes];
          const insertIdx = Math.max(0, nodes.length - 1);
          nodes.splice(insertIdx, 0, { type: "element", element: newEl });
          return { ...rung, logic: { ...rung.logic, nodes } };
        }),
      }));
      setSelectedId(newEl.id);
    },
    [program, selectedId],
  );

  // Delete selected element
  const handleDeleteSelected = useCallback(() => {
    if (!selectedId) return;
    setProgram((prev) => ({
      ...prev,
      rungs: prev.rungs.map((rung) => ({
        ...rung,
        logic: {
          ...rung.logic,
          nodes: rung.logic.nodes.filter(
            (n) => !(n.type === "element" && n.element.id === selectedId),
          ),
        },
      })),
    }));
    setSelectedId(null);
  }, [selectedId]);

  // Delete rung
  const handleDeleteRung = useCallback(
    (rungId: string) => {
      setProgram((prev) => ({
        ...prev,
        rungs: prev.rungs.filter((r) => r.id !== rungId),
      }));
    },
    [],
  );

  // Export XML
  const handleExportXml = useCallback(() => {
    const xml = buildLadXml(program);
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${program.name}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [program]);

  // Import to TIA
  const handleImportToTia = useCallback(async () => {
    resetImport();
    await importToTia(program, {
      tiaProjectPath: tiaProjectPath.trim() || undefined,
      compile: compileAfterImport,
      destinationFolder: "Pac-LAD",
    });
  }, [program, tiaProjectPath, compileAfterImport, importToTia, resetImport]);

  // Element palette items
  const PALETTE: { type: LadElementType; label: string }[] = [
    { type: LAD_ELEMENT_TYPES.NO_CONTACT, label: "NO" },
    { type: LAD_ELEMENT_TYPES.NC_CONTACT, label: "NC" },
    { type: LAD_ELEMENT_TYPES.OUTPUT_COIL, label: "( )" },
    { type: LAD_ELEMENT_TYPES.SET_COIL, label: "(S)" },
    { type: LAD_ELEMENT_TYPES.RESET_COIL, label: "(R)" },
    { type: LAD_ELEMENT_TYPES.TON, label: "TON" },
    { type: LAD_ELEMENT_TYPES.TOF, label: "TOF" },
    { type: LAD_ELEMENT_TYPES.CTU, label: "CTU" },
    { type: LAD_ELEMENT_TYPES.CTD, label: "CTD" },
    { type: LAD_ELEMENT_TYPES.CMP, label: "CMP" },
    { type: LAD_ELEMENT_TYPES.MATH, label: "±×÷" },
    { type: LAD_ELEMENT_TYPES.MOVE, label: "MOV" },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex h-12 items-center gap-3 border-b bg-card px-4">
        <GitBranchPlus className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Pac-LAD</span>
        <Badge variant="outline" className="text-[10px]">PoC</Badge>
        <Separator orientation="vertical" className="h-5" />

        {/* Block settings */}
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Name</Label>
          <Input
            value={program.name}
            onChange={(e) => setProgram((p) => ({ ...p, name: e.target.value }))}
            className="h-7 w-36 font-mono text-xs"
          />
        </div>
        <Select
          value={program.blockType}
          onValueChange={(v) =>
            setProgram((p) => ({ ...p, blockType: v as "FB" | "FC" | "OB" }))
          }
        >
          <SelectTrigger className="h-7 w-16 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="FB">FB</SelectItem>
            <SelectItem value="FC">FC</SelectItem>
            <SelectItem value="OB">OB</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex-1" />

        {/* Actions */}
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleAddRung}>
          <Plus className="h-3 w-3" /> Rung
        </Button>
        {selectedId && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs text-destructive"
            onClick={handleDeleteSelected}
          >
            <Trash2 className="h-3 w-3" /> Delete
          </Button>
        )}
        <Button variant="default" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleExportXml}>
          <Download className="h-3 w-3" /> Export XML
        </Button>
      </div>

      {/* Element palette */}
      <div className="flex items-center gap-1 border-b bg-card/50 px-4 py-1.5">
        <span className="mr-2 text-[10px] font-medium uppercase text-muted-foreground">Add:</span>
        {PALETTE.map(({ type, label }) => (
          <Button
            key={type}
            variant="outline"
            size="sm"
            className="h-6 px-2 font-mono text-[10px]"
            onClick={() => handleAddElement(type)}
            title={LAD_ELEMENT_LABELS[type]}
          >
            {label}
          </Button>
        ))}
      </div>

      {/* TIA Import panel */}
      <div className="border-b bg-card/30">
        <button
          className="flex w-full items-center gap-2 px-4 py-1.5 text-xs hover:bg-accent/40"
          onClick={() => setTiaPanelOpen((v) => !v)}
        >
          <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium">TIA Portal Import</span>
          <span className="ml-1 flex items-center gap-1">
            {bridgeStatus?.bridgeOnline ? (
              bridgeStatus.projectOpen ? (
                <Badge className="h-4 bg-emerald-600/80 px-1.5 text-[9px]">Project open</Badge>
              ) : (
                <Badge className="h-4 bg-amber-600/80 px-1.5 text-[9px]">No project</Badge>
              )
            ) : (
              <Badge variant="outline" className="h-4 px-1.5 text-[9px] text-muted-foreground">Bridge offline</Badge>
            )}
          </span>
          <span className="ml-auto flex items-center gap-2">
            {!bridgeStatus?.tiaConnected && (
              <button
                className="rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                onClick={(e) => { e.stopPropagation(); connectMutation.mutate(); }}
                disabled={connectMutation.isPending || !bridgeStatus?.bridgeOnline}
                title={!bridgeStatus?.bridgeOnline ? "Bridge offline" : "Attach to running TIA Portal"}
              >
                {connectMutation.isPending ? <Loader2 className="inline h-2.5 w-2.5 animate-spin" /> : "Connect"}
              </button>
            )}
            {tiaPanelOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </span>
        </button>

        {tiaPanelOpen && (
          <div className="flex flex-wrap items-end gap-3 border-t px-4 py-2">
            {/* Connect error */}
            {connectMutation.isError && (
              <div className="w-full rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
                Connect failed: {connectMutation.error instanceof Error ? connectMutation.error.message : "Unknown error"}
              </div>
            )}

            {/* Project path */}
            <div className="flex min-w-[280px] flex-1 flex-col gap-1">
              <Label className="text-[10px] text-muted-foreground">TIA project path (leave blank if already open)</Label>
              <Input
                value={tiaProjectPath}
                onChange={(e) => setTiaProjectPath(e.target.value)}
                placeholder="C:\TIA_Projects\MyProject\MyProject.ap18"
                className="h-7 font-mono text-[11px]"
              />
            </div>

            {/* Compile toggle */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="lad-compile"
                checked={compileAfterImport}
                onChange={(e) => setCompileAfterImport(e.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer"
              />
              <Label htmlFor="lad-compile" className="cursor-pointer text-xs">Compile after import</Label>
            </div>

            {/* Import button */}
            <Button
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={handleImportToTia}
              disabled={importing || !bridgeStatus?.bridgeOnline}
              title={!bridgeStatus?.bridgeOnline ? "TIA Bridge is offline" : undefined}
            >
              {importing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              {importing ? "Importing…" : "Import to TIA"}
            </Button>

            {/* Result */}
            {importResult && (
              <div className={`flex items-start gap-1.5 rounded border px-2 py-1 text-[11px] ${
                importResult.success
                  ? "border-emerald-800/40 bg-emerald-900/20 text-emerald-400"
                  : "border-destructive/40 bg-destructive/10 text-destructive"
              }`}>
                {importResult.success
                  ? <CheckCircle2 className="mt-px h-3 w-3 shrink-0" />
                  : <XCircle className="mt-px h-3 w-3 shrink-0" />}
                <div>
                  <div>{importResult.message}</div>
                  {importResult.compile_result && !importResult.compile_result.success && (
                    <div className="mt-0.5 space-y-0.5">
                      {importResult.compile_result.errors?.slice(0, 3).map((e, i) => (
                        <div key={i} className="font-mono opacity-80">{e.error_text}</div>
                      ))}
                    </div>
                  )}
                  {importResult.compile_result?.success && (
                    <div className="opacity-70">Compile OK ({importResult.compile_result.warnings?.length ?? 0} warnings)</div>
                  )}
                </div>
              </div>
            )}
            {importError && !importResult && (
              <div className="flex items-center gap-1.5 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
                <XCircle className="h-3 w-3 shrink-0" />
                {importError}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main content */}
      <ResizablePanelGroup orientation="horizontal" className="flex-1">
        {/* Left: AI input */}
        <ResizablePanel defaultSize={25} minSize={15}>
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium">AI Generator</span>
            </div>
            <ScrollArea className="flex-1">
              <div className="space-y-3 p-3">
                {/* Image upload */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Upload ladder diagram image</Label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-full gap-2 text-xs"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                    {imagePreview ? "Change Image" : "Upload Image"}
                  </Button>
                  {imagePreview && (
                    <div className="relative">
                      <img
                        src={imagePreview}
                        alt="Uploaded ladder"
                        className="w-full rounded border border-border"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1 h-5 w-5"
                        onClick={() => {
                          setImagePreview(null);
                          imageDataRef.current = null;
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>

                {/* Text prompt */}
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    {imagePreview
                      ? "Additional instructions (optional)"
                      : "Describe the ladder logic you want"}
                  </Label>
                  <Textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleGenerate();
                      }
                    }}
                    placeholder={
                      imagePreview
                        ? "e.g. Rename the tags to use camelCase..."
                        : "e.g. Create a motor start/stop circuit with seal-in latch and overload protection..."
                    }
                    className="min-h-[80px] text-xs"
                    disabled={loading}
                  />
                </div>

                <Button
                  className="w-full gap-2"
                  onClick={handleGenerate}
                  disabled={loading || (!prompt.trim() && !imageDataRef.current)}
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {imagePreview ? "Analyze & Generate" : "Generate Ladder"}
                </Button>

                {error && (
                  <div className="rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {error}
                  </div>
                )}

                {/* Quick examples */}
                <div className="space-y-1.5">
                  <span className="text-[10px] font-medium uppercase text-muted-foreground">
                    Quick prompts
                  </span>
                  {[
                    "Motor start/stop with seal-in latch",
                    "Traffic light sequence controller",
                    "Tank level control with high/low alarms",
                    "Conveyor belt with jam detection and auto-restart",
                  ].map((ex) => (
                    <button
                      key={ex}
                      className="block w-full rounded border border-border px-2 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      onClick={() => setPrompt(ex)}
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            </ScrollArea>

            {/* Rung list */}
            <div className="border-t">
              <div className="flex items-center gap-2 px-3 py-1.5">
                <span className="text-[10px] font-medium uppercase text-muted-foreground">
                  Networks ({program.rungs.length})
                </span>
              </div>
              <ScrollArea className="max-h-40">
                <div className="space-y-0.5 px-2 pb-2">
                  {program.rungs.map((rung, i) => (
                    <div
                      key={rung.id}
                      className="flex items-center gap-1.5 rounded px-2 py-1 text-xs hover:bg-accent/50"
                    >
                      <span className="font-mono text-muted-foreground">{i + 1}</span>
                      <Input
                        value={rung.title}
                        onChange={(e) =>
                          setProgram((prev) => ({
                            ...prev,
                            rungs: prev.rungs.map((r) =>
                              r.id === rung.id ? { ...r, title: e.target.value } : r,
                            ),
                          }))
                        }
                        className="h-6 flex-1 border-0 bg-transparent px-1 text-xs focus-visible:ring-0"
                      />
                      {program.rungs.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDeleteRung(rung.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Center: Ladder canvas */}
        <ResizablePanel defaultSize={55} minSize={30}>
          <LadCanvas
            program={program}
            selectedId={selectedId}
            onSelectElement={setSelectedId}
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right: Properties */}
        <ResizablePanel defaultSize={20} minSize={15}>
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <span className="text-xs font-medium">Properties</span>
            </div>
            <ScrollArea className="flex-1">
              <LadPropertiesPanel
                element={selectedElement}
                onUpdate={handleUpdateElement}
              />
            </ScrollArea>

            {/* Variables list */}
            <div className="border-t">
              <div className="flex items-center gap-2 px-3 py-1.5">
                <span className="text-[10px] font-medium uppercase text-muted-foreground">
                  Variables ({program.variables.length})
                </span>
              </div>
              <ScrollArea className="max-h-48">
                <div className="space-y-0.5 px-2 pb-2">
                  {program.variables.map((v) => (
                    <div
                      key={v.name}
                      className="flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px]"
                    >
                      <Badge
                        variant="outline"
                        className="h-4 shrink-0 px-1 text-[9px]"
                      >
                        {v.section.slice(0, 3).toUpperCase()}
                      </Badge>
                      <span className="font-mono text-foreground">{v.name}</span>
                      <span className="text-muted-foreground">: {v.dataType}</span>
                    </div>
                  ))}
                  {program.variables.length === 0 && (
                    <div className="py-2 text-center text-[10px] text-muted-foreground">
                      No variables (generate to populate)
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
