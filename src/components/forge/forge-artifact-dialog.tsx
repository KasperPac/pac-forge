import { useState, useCallback } from "react";
import {
  X, CheckCircle2, Circle, Edit, Eye, Plus, Trash2,
} from "lucide-react";
import Editor from "@monaco-editor/react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LadCanvas } from "@/components/lad-editor/lad-canvas";
import { LadPropertiesPanel } from "@/components/lad-editor/lad-properties-panel";
import { cn } from "@/lib/utils";
import type { ForgeArtifact } from "@/types/forge";
import type { LadProgram, LadElement, LadElementType, LadRung, LadNode } from "@/types/lad";
import { LAD_ELEMENT_TYPES, LAD_ELEMENT_LABELS, isOutputElement } from "@/types/lad";

// ---------------------------------------------------------------------------
// LAD helpers (mirrored from pac-lad.tsx)
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

function updateInNodes(nodes: LadNode[], id: string, patch: Partial<LadElement>): LadNode[] {
  return nodes.map((node) => {
    if (node.type === "element" && node.element.id === id)
      return { ...node, element: { ...node.element, ...patch } };
    if (node.type === "parallel")
      return { ...node, branches: node.branches.map((b) => ({ ...b, nodes: updateInNodes(b.nodes, id, patch) })) };
    return node;
  });
}

function updateElementInProgram(program: LadProgram, id: string, patch: Partial<LadElement>): LadProgram {
  return {
    ...program,
    rungs: program.rungs.map((rung) => ({
      ...rung,
      logic: { ...rung.logic, nodes: updateInNodes(rung.logic.nodes, id, patch) },
    })),
  };
}

const LAD_PALETTE: { type: LadElementType; label: string }[] = [
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

const TYPE_COLORS: Record<string, string> = {
  FB: "border-blue-500/50 text-blue-400",
  FC: "border-cyan-500/50 text-cyan-400",
  DB: "border-purple-500/50 text-purple-400",
  UDT: "border-orange-500/50 text-orange-400",
  OB: "border-green-500/50 text-green-400",
  TAG_TABLE: "border-gray-500/50 text-gray-400",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ForgeArtifactDialogProps {
  artifacts: ForgeArtifact[];
  initialId: string | null;
  open: boolean;
  onClose: () => void;
  onContentChange: (id: string, content: string) => void;
  onToggleApprove: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Main dialog
// ---------------------------------------------------------------------------

export function ForgeArtifactDialog({
  artifacts,
  initialId,
  open,
  onClose,
  onContentChange,
  onToggleApprove,
}: ForgeArtifactDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editable, setEditable] = useState(false);

  const effectiveId = selectedId ?? initialId ?? artifacts[0]?.id ?? null;
  const selected = artifacts.find((a) => a.id === effectiveId) ?? null;

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) { onClose(); setEditable(false); }
  }

  function handleSelectArtifact(id: string) {
    setSelectedId(id);
    setEditable(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-[96vw] w-[96vw] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden rounded-lg"
        hideClose
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* Header */}
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Artifacts</span>
          {selected && (
            <>
              <span className="text-muted-foreground/40">/</span>
              <span className="font-mono text-sm font-semibold">{selected.name}</span>
              <Badge variant="outline" className={cn("font-mono text-[10px]", TYPE_COLORS[selected.type] ?? "")}>
                {selected.type}
              </Badge>
              <Badge variant="outline" className={cn("font-mono text-[10px]", selected.language === "SCL" ? "border-emerald-500/50 text-emerald-400" : "border-yellow-500/50 text-yellow-400")}>
                {selected.language}
              </Badge>
            </>
          )}
          <div className="flex-1" />
          {selected && (
            <>
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => onToggleApprove(selected.id)}>
                {selected.approved
                  ? <><CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> Approved</>
                  : <><Circle className="h-3.5 w-3.5 text-muted-foreground/40" /> Approve</>}
              </Button>
              {selected.language !== "LAD" && (
                <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setEditable((v) => !v)}>
                  {editable ? <><Eye className="h-3.5 w-3.5" /> Read-only</> : <><Edit className="h-3.5 w-3.5" /> Edit</>}
                </Button>
              )}
            </>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1">
          <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
            {/* Artifact list */}
            <ResizablePanel defaultSize={16} minSize={10} maxSize={28}>
              <div className="flex h-full flex-col border-r border-border/60">
                <div className="border-b border-border/40 px-3 py-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {artifacts.length} artifact{artifacts.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <ScrollArea className="flex-1">
                  <div className="space-y-0.5 p-1.5">
                    {artifacts.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => handleSelectArtifact(a.id)}
                        className={cn(
                          "flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs transition-colors",
                          a.id === effectiveId ? "bg-primary/15 text-foreground" : "hover:bg-muted/40 text-muted-foreground",
                        )}
                      >
                        {a.approved
                          ? <CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />
                          : <Circle className="h-3 w-3 shrink-0 text-muted-foreground/30" />}
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{a.name}</span>
                        <Badge variant="outline" className={cn("shrink-0 font-mono text-[9px]", TYPE_COLORS[a.type] ?? "")}>
                          {a.type}
                        </Badge>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Editor area */}
            <ResizablePanel defaultSize={84}>
              {!selected ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Select an artifact
                </div>
              ) : selected.language === "LAD" ? (
                <LadEditor
                  artifact={selected}
                  onContentChange={onContentChange}
                />
              ) : (
                <Editor
                  height="100%"
                  language="plaintext"
                  value={selected.content}
                  theme="vs-dark"
                  options={{
                    readOnly: !editable,
                    minimap: { enabled: false },
                    fontSize: 13,
                    fontFamily: "JetBrains Mono, Consolas, monospace",
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    wordWrap: "off",
                  }}
                  onChange={(value) => {
                    if (editable && value != null && selected) onContentChange(selected.id, value);
                  }}
                />
              )}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// LAD editor (embedded pac-lad experience)
// ---------------------------------------------------------------------------

function LadEditor({
  artifact,
  onContentChange,
}: {
  artifact: ForgeArtifact;
  onContentChange: (id: string, content: string) => void;
}) {
  const [program, setProgram] = useState<LadProgram | null>(() => {
    try {
      const parsed = JSON.parse(artifact.content) as LadProgram;
      return Array.isArray(parsed.rungs) ? parsed : null;
    } catch { return null; }
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);

  const selectedElement = selectedId && program ? findElement(program, selectedId) : null;

  function commit(updated: LadProgram) {
    setProgram(updated);
    onContentChange(artifact.id, JSON.stringify(updated, null, 2));
  }

  const handleUpdateElement = useCallback((id: string, patch: Partial<LadElement>) => {
    setProgram((prev) => {
      if (!prev) return prev;
      const updated = updateElementInProgram(prev, id, patch);
      onContentChange(artifact.id, JSON.stringify(updated, null, 2));
      return updated;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact.id]);

  const handleAddRung = useCallback(() => {
    setProgram((prev) => {
      if (!prev) return prev;
      const newRung: LadRung = {
        id: `rung_${Date.now()}`,
        title: `Network ${prev.rungs.length + 1}`,
        logic: {
          type: "series",
          nodes: [
            { type: "element", element: { id: `el_${Date.now()}_1`, type: "NO_CONTACT", operand: "input" } },
            { type: "element", element: { id: `el_${Date.now()}_2`, type: "OUTPUT_COIL", operand: "output" } },
          ],
        },
      };
      const updated = { ...prev, rungs: [...prev.rungs, newRung] };
      onContentChange(artifact.id, JSON.stringify(updated, null, 2));
      return updated;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact.id]);

  const handleDeleteRung = useCallback((rungId: string) => {
    setProgram((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, rungs: prev.rungs.filter((r) => r.id !== rungId) };
      onContentChange(artifact.id, JSON.stringify(updated, null, 2));
      return updated;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact.id]);

  const handleAddElement = useCallback((type: LadElementType) => {
    setProgram((prev) => {
      if (!prev) return prev;
      let targetIdx = prev.rungs.length - 1;
      if (selectedId) {
        for (let i = 0; i < prev.rungs.length; i++) {
          if (findInChain(prev.rungs[i].logic.nodes, selectedId)) { targetIdx = i; break; }
        }
      }
      const newEl: LadElement = {
        id: `el_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        type,
        operand: isOutputElement(type) ? "output" : "input",
      };
      const updated = {
        ...prev,
        rungs: prev.rungs.map((rung, i) => {
          if (i !== targetIdx) return rung;
          const nodes = [...rung.logic.nodes];
          nodes.splice(Math.max(0, nodes.length - 1), 0, { type: "element" as const, element: newEl });
          return { ...rung, logic: { ...rung.logic, nodes } };
        }),
      };
      setSelectedId(newEl.id);
      onContentChange(artifact.id, JSON.stringify(updated, null, 2));
      return updated;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, artifact.id]);

  const handleDeleteSelected = useCallback(() => {
    if (!selectedId) return;
    setProgram((prev) => {
      if (!prev) return prev;
      const updated = {
        ...prev,
        rungs: prev.rungs.map((rung) => ({
          ...rung,
          logic: {
            ...rung.logic,
            nodes: rung.logic.nodes.filter((n) => !(n.type === "element" && n.element.id === selectedId)),
          },
        })),
      };
      onContentChange(artifact.id, JSON.stringify(updated, null, 2));
      return updated;
    });
    setSelectedId(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, artifact.id]);

  if (!program) {
    return (
      <Editor
        height="100%"
        language="json"
        value={artifact.content}
        theme="vs-dark"
        options={{ minimap: { enabled: false }, fontSize: 13, fontFamily: "JetBrains Mono, Consolas, monospace", automaticLayout: true }}
        onChange={(v) => { if (v != null) onContentChange(artifact.id, v); }}
      />
    );
  }

  if (showJson) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-3">
          <Button variant="outline" size="sm" className="h-6 gap-1 text-[10px]" onClick={() => setShowJson(false)}>
            <Eye className="h-3 w-3" /> Visual
          </Button>
          <span className="font-mono text-[10px] text-muted-foreground">Editing JSON</span>
        </div>
        <div className="min-h-0 flex-1">
          <Editor
            height="100%"
            language="json"
            value={artifact.content}
            theme="vs-dark"
            options={{ minimap: { enabled: false }, fontSize: 12, fontFamily: "JetBrains Mono, Consolas, monospace", automaticLayout: true }}
            onChange={(v) => { if (v != null) onContentChange(artifact.id, v); }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        {/* Block name + type */}
        <Input
          value={program.name}
          onChange={(e) => commit({ ...program, name: e.target.value })}
          className="h-6 w-32 font-mono text-xs"
        />
        <Select
          value={program.blockType}
          onValueChange={(v) => commit({ ...program, blockType: v as "FB" | "FC" | "OB" })}
        >
          <SelectTrigger className="h-6 w-14 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="FB">FB</SelectItem>
            <SelectItem value="FC">FC</SelectItem>
            <SelectItem value="OB">OB</SelectItem>
          </SelectContent>
        </Select>

        <div className="mx-1 h-4 w-px bg-border/60" />

        {/* Palette */}
        <span className="font-mono text-[10px] text-muted-foreground">Add:</span>
        {LAD_PALETTE.map(({ type, label }) => (
          <Button
            key={type}
            variant="outline"
            size="sm"
            className="h-6 px-1.5 font-mono text-[10px]"
            onClick={() => handleAddElement(type)}
            title={LAD_ELEMENT_LABELS[type]}
          >
            {label}
          </Button>
        ))}

        <div className="mx-1 h-4 w-px bg-border/60" />

        <Button variant="outline" size="sm" className="h-6 gap-1 text-[10px]" onClick={handleAddRung}>
          <Plus className="h-3 w-3" /> Rung
        </Button>
        {selectedId && (
          <Button variant="outline" size="sm" className="h-6 gap-1 text-[10px] text-destructive" onClick={handleDeleteSelected}>
            <Trash2 className="h-3 w-3" /> Delete
          </Button>
        )}

        <div className="flex-1" />

        <Button variant="ghost" size="sm" className="h-6 gap-1 text-[10px]" onClick={() => setShowJson(true)}>
          <Edit className="h-3 w-3" /> JSON
        </Button>
      </div>

      {/* Canvas + rung list + properties */}
      <div className="min-h-0 flex-1">
        <ResizablePanelGroup orientation="horizontal" className="h-full">
          {/* Canvas */}
          <ResizablePanel defaultSize={65} minSize={40}>
            <LadCanvas
              program={program}
              selectedId={selectedId}
              onSelectElement={setSelectedId}
            />
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right side: rung list + properties */}
          <ResizablePanel defaultSize={35} minSize={20}>
            <div className="flex h-full flex-col">
              {/* Rung list */}
              <div className="border-b border-border/60">
                <div className="border-b border-border/40 px-3 py-1">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Rungs ({program.rungs.length})
                  </span>
                </div>
                <ScrollArea className="max-h-40">
                  <div className="space-y-0.5 p-1.5">
                    {program.rungs.map((rung, i) => (
                      <div key={rung.id} className="group/rung flex items-center gap-1.5 rounded px-2 py-1 hover:bg-muted/30">
                        <span className="font-mono text-[10px] text-muted-foreground w-4">{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">{rung.title}</span>
                        <button
                          onClick={() => handleDeleteRung(rung.id)}
                          className="hidden text-muted-foreground/50 hover:text-destructive group-hover/rung:block"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              {/* Properties */}
              <div className="min-h-0 flex-1 overflow-auto">
                <div className="border-b border-border/40 px-3 py-1">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Properties</span>
                </div>
                <LadPropertiesPanel
                  element={selectedElement}
                  onUpdate={handleUpdateElement}
                />
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
