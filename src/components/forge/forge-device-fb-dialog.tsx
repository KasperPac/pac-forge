import { useState, useEffect } from "react";
import Editor from "@monaco-editor/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Loader2, BookMarked, X } from "lucide-react";
import type { ForgeArtifact, ForgeControlModuleEntry } from "@/types/forge";

// ---------------------------------------------------------------------------
// Interface parser
// ---------------------------------------------------------------------------

function parseFbInterface(
  scl: string,
): { inputs: { name: string; type: string }[]; outputs: { name: string; type: string }[] } {
  const inputs: { name: string; type: string }[] = [];
  const outputs: { name: string; type: string }[] = [];
  const blockRe = /VAR_(INPUT|OUTPUT)\b([\s\S]*?)END_VAR/gi;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(scl)) !== null) {
    const section = block[1].toUpperCase();
    const body = block[2];
    const declRe = /^\s+(\w+)\s*:\s*(\w+)/gm;
    let decl: RegExpExecArray | null;
    while ((decl = declRe.exec(body)) !== null) {
      const entry = { name: decl[1], type: decl[2] };
      if (section === "INPUT") inputs.push(entry);
      else outputs.push(entry);
    }
  }
  return { inputs, outputs };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ForgeDeviceFbDialogProps {
  open: boolean;
  artifact: ForgeArtifact | null;
  device: ForgeControlModuleEntry | null;
  onAccept: (artifact: ForgeArtifact) => void;
  onSaveToLibrary: (artifact: ForgeArtifact, category: string) => void;
  onClose: () => void;
  onRegenerate: (instructions: string) => Promise<ForgeArtifact[]>;
  regenerating: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ForgeDeviceFbDialog({
  open,
  artifact,
  device,
  onAccept,
  onSaveToLibrary,
  onClose,
  onRegenerate,
  regenerating,
}: ForgeDeviceFbDialogProps) {
  const [code, setCode] = useState<string>("");
  const [instructions, setInstructions] = useState("");
  const [savePanelOpen, setSavePanelOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveCategory, setSaveCategory] = useState("");
  const [saving, setSaving] = useState(false);

  // Sync code when artifact changes
  useEffect(() => {
    if (artifact) {
      setCode(artifact.content);
      setSaveName(artifact.name);
      setSaveCategory(device?.device_type ?? "");
      setSavePanelOpen(false);
      setInstructions("");
    }
  }, [artifact, device]);

  const parsed = parseFbInterface(code);
  const currentArtifact = artifact ? { ...artifact, content: code } : null;

  async function handleRegenerate() {
    if (!instructions.trim() && !regenerating) return;
    const results = await onRegenerate(instructions);
    if (results.length > 0) {
      setCode(results[0].content);
    }
  }

  async function handleSaveToLibrary() {
    if (!currentArtifact) return;
    setSaving(true);
    try {
      await onSaveToLibrary(currentArtifact, saveCategory || currentArtifact.name);
      setSavePanelOpen(false);
    } finally {
      setSaving(false);
    }
  }

  if (!artifact) return null;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="flex max-w-6xl w-full flex-col gap-0 p-0 h-[85vh] bg-background border-border/70">
        <DialogHeader className="shrink-0 border-b border-border/60 px-4 py-3">
          <div className="flex items-center justify-between">
            <DialogTitle className="font-mono text-sm text-foreground">
              Review &amp; Edit — {artifact.name}
            </DialogTitle>
            <button
              onClick={onClose}
              className="rounded p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </DialogHeader>

        {/* Main body */}
        <div className="min-h-0 flex-1">
          <ResizablePanelGroup orientation="horizontal" className="h-full">
            {/* Left: Monaco editor */}
            <ResizablePanel defaultSize={65} minSize={40}>
              <div className="h-full w-full">
                <Editor
                  height="100%"
                  defaultLanguage="plaintext"
                  value={code}
                  onChange={v => setCode(v ?? "")}
                  theme="vs-dark"
                  options={{
                    minimap: { enabled: false },
                    fontSize: 12,
                    fontFamily: "monospace",
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    wordWrap: "off",
                    renderWhitespace: "none",
                  }}
                />
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Right: Info + instructions */}
            <ResizablePanel defaultSize={35} minSize={25}>
              <ScrollArea className="h-full">
                <div className="flex flex-col gap-4 p-4">
                  {/* Device info */}
                  <div className="rounded-md border border-border/50 bg-muted/10 px-3 py-2">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      Device
                    </div>
                    <div className="font-mono text-xs text-foreground">
                      {device?.name ?? artifact.name}
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {device?.device_type ?? ""}
                    </div>
                  </div>

                  {/* Parsed inputs */}
                  <div>
                    <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      VAR_INPUT ({parsed.inputs.length})
                    </div>
                    {parsed.inputs.length === 0 ? (
                      <div className="font-mono text-[11px] text-muted-foreground/60">None</div>
                    ) : (
                      <div className="space-y-0.5">
                        {parsed.inputs.map((p, i) => (
                          <div key={i} className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[11px] text-foreground">{p.name}</span>
                            <Badge
                              variant="outline"
                              className="font-mono text-[9px] border-blue-500/50 text-blue-400"
                            >
                              {p.type}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Parsed outputs */}
                  <div>
                    <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      VAR_OUTPUT ({parsed.outputs.length})
                    </div>
                    {parsed.outputs.length === 0 ? (
                      <div className="font-mono text-[11px] text-muted-foreground/60">None</div>
                    ) : (
                      <div className="space-y-0.5">
                        {parsed.outputs.map((p, i) => (
                          <div key={i} className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[11px] text-foreground">{p.name}</span>
                            <Badge
                              variant="outline"
                              className="font-mono text-[9px] border-green-500/50 text-green-400"
                            >
                              {p.type}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Save to library panel or instructions */}
                  {savePanelOpen ? (
                    <div className="rounded-md border border-border/60 bg-muted/10 p-3 space-y-3">
                      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        Save to FB Library
                      </div>
                      <div className="space-y-1.5">
                        <Label className="font-mono text-[11px]">Name</Label>
                        <Input
                          value={saveName}
                          onChange={e => setSaveName(e.target.value)}
                          className="h-7 font-mono text-xs"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="font-mono text-[11px]">Category</Label>
                        <Input
                          value={saveCategory}
                          onChange={e => setSaveCategory(e.target.value)}
                          className="h-7 font-mono text-xs"
                          placeholder="e.g. Motor, Valve, Sensor"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSavePanelOpen(false)}
                          className="flex-1 h-7 text-xs"
                          disabled={saving}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => void handleSaveToLibrary()}
                          className="flex-1 h-7 text-xs gap-1"
                          disabled={saving || !saveName.trim() || !saveCategory.trim()}
                        >
                          {saving
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <BookMarked className="h-3 w-3" />}
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        Additional Instructions
                      </Label>
                      <Textarea
                        value={instructions}
                        onChange={e => setInstructions(e.target.value)}
                        placeholder="e.g. Add a diagnostic output for communication fault&#10;Include a timer for debounce on the start input"
                        className="font-mono text-xs resize-none h-28"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full gap-2 h-7 text-xs"
                        onClick={() => void handleRegenerate()}
                        disabled={regenerating || !instructions.trim()}
                      >
                        {regenerating && <Loader2 className="h-3 w-3 animate-spin" />}
                        {regenerating ? "Regenerating…" : "Regenerate with Instructions"}
                      </Button>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between border-t border-border/60 px-4 py-2">
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 text-xs">
            Close
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setSavePanelOpen(true)}
              disabled={saving || savePanelOpen}
            >
              <BookMarked className="h-3 w-3" />
              Save to Library
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => { if (currentArtifact) onAccept(currentArtifact); }}
              disabled={!currentArtifact}
            >
              Accept
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
