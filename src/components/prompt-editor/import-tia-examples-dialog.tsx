import { useState, useCallback, useMemo } from "react";
import {
  Loader2,
  Download,
  Sparkles,
  Save,
  CheckCircle2,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import Editor from "@monaco-editor/react";

import { useExportFromTia } from "@/hooks/use-export-from-tia";
import { useBridgeStatus } from "@/hooks/use-tia-jobs";
import { useSavePromptSection } from "@/hooks/use-prompt-sections";
import {
  useDesignProfiles,
  useUpdateDesignProfile,
} from "@/hooks/use-design-profiles";
import { callNonStreaming } from "@/hooks/use-generation";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

type Destination = "code_examples" | "platform_rules" | "design_profile";

type DialogStep =
  | "idle"
  | "exporting"
  | "selecting"
  | "summarizing"
  | "editing"
  | "saving"
  | "done";

type BlockType = "FB" | "FC" | "DB" | "UDT" | "OB" | "UNKNOWN";

interface ExportedBlock {
  name: string;
  source: string;
  type: BlockType;
  lineCount: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (
    destination: Destination,
    sectionKey?: string,
  ) => void;
}

const BLOCK_TYPE_COLORS: Record<BlockType, string> = {
  FB: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  FC: "bg-green-500/20 text-green-400 border-green-500/30",
  DB: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  UDT: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  OB: "bg-red-500/20 text-red-400 border-red-500/30",
  UNKNOWN: "bg-neutral-500/20 text-neutral-400 border-neutral-500/30",
};

function detectBlockType(source: string): BlockType {
  const lines = source.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("(*")) continue;
    if (/^FUNCTION_BLOCK\b/i.test(line)) return "FB";
    if (/^FUNCTION\s/i.test(line)) return "FC";
    if (/^DATA_BLOCK\b/i.test(line)) return "DB";
    if (/^TYPE\s/i.test(line)) return "UDT";
    if (/^ORGANIZATION_BLOCK\b/i.test(line)) return "OB";
    break; // only check first meaningful line
  }
  return "UNKNOWN";
}

function buildSystemPrompt(destination: Destination): string {
  switch (destination) {
    case "code_examples":
      return "You are an SCL code documentation expert for Siemens S7-1200/S7-1500 PLCs. Format these exported TIA Portal blocks as reference code examples. Keep the full SCL source blocks intact and add brief annotations above each one explaining what patterns they demonstrate (naming conventions, state machine style, timer usage, error handling, etc.). Group related blocks together. Use markdown formatting with ```scl fenced code blocks.";
    case "platform_rules":
      return "You are a PLC coding standards expert for Siemens S7-1200/S7-1500. Analyze these exported TIA Portal blocks and extract the coding conventions, rules, and standards they follow. Output a structured rules document with numbered rules grouped by category (Naming Conventions, Block Structure, Error Handling, Timer/Counter Usage, State Machines, etc.). Reference specific patterns from the code as examples. Use markdown formatting.";
    case "design_profile":
      return "You are a PLC project analyst for Siemens S7-1200/S7-1500. Analyze these exported TIA Portal blocks and extract customer-specific design patterns and conventions. Focus on what makes this project unique — not general PLC best practices. Look for: project-specific naming patterns, custom UDT structures, state machine conventions, alarm handling approaches, HMI interface patterns, device control templates. Use markdown formatting.";
  }
}

export function ImportTiaExamplesDialog({ open, onOpenChange, onSaved }: Props) {
  const [step, setStep] = useState<DialogStep>("idle");
  const [blocks, setBlocks] = useState<ExportedBlock[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [destination, setDestination] = useState<Destination>("code_examples");
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [appendMode, setAppendMode] = useState(true);
  const [aiResult, setAiResult] = useState("");
  const [error, setError] = useState<string | null>(null);
  const resolvedTheme = useUiStore((s) => s.resolvedTheme);

  const { data: bridgeStatus } = useBridgeStatus();
  const exportMutation = useExportFromTia();
  const saveSectionMutation = useSavePromptSection();
  const { data: profiles } = useDesignProfiles();
  const updateProfileMutation = useUpdateDesignProfile();

  const canExport = bridgeStatus?.bridgeOnline && bridgeStatus?.projectOpen;

  const resetState = useCallback(() => {
    setStep("idle");
    setBlocks([]);
    setSelected(new Set());
    setDestination("code_examples");
    setSelectedProfileId("");
    setAppendMode(true);
    setAiResult("");
    setError(null);
  }, []);

  const handleOpenChange = useCallback(
    (value: boolean) => {
      if (!value) resetState();
      onOpenChange(value);
    },
    [onOpenChange, resetState],
  );

  // --- Export ---
  const handleExport = useCallback(async () => {
    setStep("exporting");
    setError(null);
    try {
      const result = await exportMutation.mutateAsync();
      const exported: ExportedBlock[] = Object.entries(result.sources).map(
        ([name, source]) => ({
          name,
          source,
          type: detectBlockType(source),
          lineCount: source.split("\n").length,
        }),
      );
      exported.sort((a, b) => {
        const order: Record<BlockType, number> = { UDT: 0, FB: 1, FC: 2, DB: 3, OB: 4, UNKNOWN: 5 };
        return (order[a.type] - order[b.type]) || a.name.localeCompare(b.name);
      });
      setBlocks(exported);
      setSelected(new Set(exported.map((b) => b.name)));
      setStep("selecting");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("idle");
    }
  }, [exportMutation]);

  // --- Selection toggles ---
  const toggleBlock = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selected.size === blocks.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(blocks.map((b) => b.name)));
    }
  }, [selected.size, blocks]);

  // --- AI Summarize ---
  const handleAnalyze = useCallback(async () => {
    setStep("summarizing");
    setError(null);

    const selectedBlocks = blocks.filter((b) => selected.has(b.name));
    const userMessage = selectedBlocks
      .map((b) => `### ${b.name} (${b.type})\n\`\`\`scl\n${b.source}\n\`\`\``)
      .join("\n\n");

    try {
      const abort = new AbortController();
      const { content } = await callNonStreaming(
        buildSystemPrompt(destination),
        [{ role: "user", content: userMessage }],
        abort.signal,
      );
      setAiResult(content);
      setStep("editing");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("selecting");
    }
  }, [blocks, selected, destination]);

  // --- Save ---
  const handleSave = useCallback(async () => {
    setStep("saving");
    setError(null);
    const blockCount = selected.size;

    try {
      if (destination === "design_profile") {
        if (!selectedProfileId) {
          setError("Select a design profile");
          setStep("editing");
          return;
        }
        const profile = profiles?.find((p) => p.id === selectedProfileId);
        const newRules = appendMode && profile?.rules
          ? `${profile.rules}\n\n---\n\n## Imported from TIA Portal\n\n${aiResult}`
          : aiResult;

        await updateProfileMutation.mutateAsync({
          id: selectedProfileId,
          updates: { rules: newRules },
        });
      } else {
        const sectionKey = destination; // "code_examples" or "platform_rules"
        await saveSectionMutation.mutateAsync({
          role: "shared",
          sectionKey,
          content: aiResult,
          notes: `Imported from TIA Portal (${blockCount} blocks)`,
        });
      }

      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("editing");
    }
  }, [
    destination,
    selectedProfileId,
    profiles,
    appendMode,
    aiResult,
    selected.size,
    saveSectionMutation,
    updateProfileMutation,
  ]);

  // --- Derived ---
  const totalLines = useMemo(
    () => blocks.filter((b) => selected.has(b.name)).reduce((sum, b) => sum + b.lineCount, 0),
    [blocks, selected],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            Import from TIA Portal
          </DialogTitle>
          <DialogDescription>
            Export blocks from TIA Portal, analyze them with AI, and save as
            reference examples, platform rules, or design profile content.
          </DialogDescription>
        </DialogHeader>

        {/* Error banner */}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Step: idle */}
        {step === "idle" && (
          <div className="space-y-4 py-2">
            {/* Bridge status */}
            <div className="flex items-center gap-2 text-sm">
              <div
                className={cn(
                  "h-2 w-2 rounded-full",
                  bridgeStatus?.bridgeOnline
                    ? bridgeStatus.projectOpen
                      ? "bg-green-500"
                      : "bg-amber-500"
                    : "bg-red-500",
                )}
              />
              <span className="text-muted-foreground">
                {!bridgeStatus?.bridgeOnline
                  ? "Bridge offline — start the .NET TIA bridge to export"
                  : !bridgeStatus.projectOpen
                    ? "Bridge connected, but no TIA project is open"
                    : `Bridge connected — TIA Portal ${bridgeStatus.version ?? ""}`}
              </span>
            </div>

            <Button
              onClick={handleExport}
              disabled={!canExport}
              className="w-full"
            >
              <Download className="mr-2 h-4 w-4" />
              Export Sources from TIA Portal
            </Button>
          </div>
        )}

        {/* Step: exporting */}
        {step === "exporting" && (
          <div className="flex items-center justify-center gap-3 py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Exporting sources from TIA Portal...
            </span>
          </div>
        )}

        {/* Step: selecting */}
        {step === "selecting" && (
          <div className="space-y-4">
            {/* Block list */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">
                  Exported Blocks ({blocks.length})
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs"
                  onClick={toggleAll}
                >
                  {selected.size === blocks.length ? (
                    <ToggleRight className="h-3 w-3" />
                  ) : (
                    <ToggleLeft className="h-3 w-3" />
                  )}
                  {selected.size === blocks.length ? "Deselect All" : "Select All"}
                </Button>
              </div>
              <ScrollArea className="h-[200px] rounded-md border">
                <div className="space-y-0.5 p-2">
                  {blocks.map((block) => (
                    <label
                      key={block.name}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-md px-3 py-1.5 transition-colors hover:bg-accent/50",
                        selected.has(block.name) && "bg-accent/30",
                      )}
                    >
                      <Checkbox
                        checked={selected.has(block.name)}
                        onCheckedChange={() => toggleBlock(block.name)}
                      />
                      <Badge
                        variant="outline"
                        className={cn(
                          "h-5 px-1.5 font-mono text-[10px]",
                          BLOCK_TYPE_COLORS[block.type],
                        )}
                      >
                        {block.type}
                      </Badge>
                      <span className="flex-1 font-mono text-sm">{block.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {block.lineCount} lines
                      </span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
              <div className="mt-1 text-xs text-muted-foreground">
                {selected.size} blocks selected ({totalLines} lines)
              </div>
            </div>

            {/* Destination picker */}
            <div className="space-y-3">
              <span className="text-sm font-medium">Save Destination</span>
              <RadioGroup
                value={destination}
                onValueChange={(v) => setDestination(v as Destination)}
                className="space-y-2"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="code_examples" id="dest-examples" />
                  <Label htmlFor="dest-examples" className="cursor-pointer text-sm">
                    Code Examples
                    <span className="ml-2 text-xs text-muted-foreground">
                      (shared prompt section)
                    </span>
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="platform_rules" id="dest-rules" />
                  <Label htmlFor="dest-rules" className="cursor-pointer text-sm">
                    Platform Rules
                    <span className="ml-2 text-xs text-muted-foreground">
                      (shared prompt section)
                    </span>
                  </Label>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="design_profile" id="dest-profile" />
                    <Label htmlFor="dest-profile" className="cursor-pointer text-sm">
                      Design Profile
                    </Label>
                  </div>
                  {destination === "design_profile" && (
                    <div className="ml-6 space-y-2">
                      <Select
                        value={selectedProfileId}
                        onValueChange={setSelectedProfileId}
                      >
                        <SelectTrigger className="h-8 w-64 text-sm">
                          <SelectValue placeholder="Select a profile..." />
                        </SelectTrigger>
                        <SelectContent>
                          {profiles?.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={appendMode}
                          onCheckedChange={setAppendMode}
                          id="append-switch"
                        />
                        <Label
                          htmlFor="append-switch"
                          className="cursor-pointer text-xs text-muted-foreground"
                        >
                          {appendMode ? "Append to existing rules" : "Replace existing rules"}
                        </Label>
                      </div>
                    </div>
                  )}
                </div>
              </RadioGroup>
            </div>

            <Button
              onClick={handleAnalyze}
              disabled={
                selected.size === 0 ||
                (destination === "design_profile" && !selectedProfileId)
              }
              className="w-full"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Analyze {selected.size} Blocks
            </Button>
          </div>
        )}

        {/* Step: summarizing */}
        {step === "summarizing" && (
          <div className="flex items-center justify-center gap-3 py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Analyzing {selected.size} blocks with AI...
            </span>
          </div>
        )}

        {/* Step: editing */}
        {step === "editing" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                Review & Edit
              </span>
              <Badge variant="outline" className="font-mono text-xs">
                {destination === "design_profile"
                  ? `Design Profile${appendMode ? " (append)" : " (replace)"}`
                  : destination === "code_examples"
                    ? "Code Examples"
                    : "Platform Rules"}
              </Badge>
            </div>
            <div className="overflow-hidden rounded-md border">
              <Editor
                height="400px"
                language="markdown"
                theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
                value={aiResult}
                onChange={(value) => setAiResult(value ?? "")}
                options={{
                  minimap: { enabled: false },
                  wordWrap: "on",
                  lineNumbers: "off",
                  fontSize: 13,
                  fontFamily: "JetBrains Mono, Fira Code, monospace",
                  scrollBeyondLastLine: false,
                  padding: { top: 12, bottom: 12 },
                }}
              />
            </div>
            <Button onClick={handleSave} className="w-full">
              <Save className="mr-2 h-4 w-4" />
              Save
            </Button>
          </div>
        )}

        {/* Step: saving */}
        {step === "saving" && (
          <div className="flex items-center justify-center gap-3 py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Saving...</span>
          </div>
        )}

        {/* Step: done */}
        {step === "done" && (
          <div className="space-y-4 py-4 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-green-500" />
            <div>
              <p className="text-sm font-medium">Saved successfully</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {destination === "design_profile"
                  ? `${appendMode ? "Appended to" : "Replaced"} design profile rules.`
                  : `New version saved to ${destination === "code_examples" ? "Code Examples" : "Platform Rules"}.`}
              </p>
            </div>
            <div className="flex justify-center gap-2">
              {destination !== "design_profile" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onSaved?.(destination, destination);
                    handleOpenChange(false);
                  }}
                >
                  View in Editor
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleOpenChange(false)}
              >
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
