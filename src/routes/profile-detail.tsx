import { useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router";
import {
  ArrowLeft,
  Save,
  Loader2,
  FileText,
  FolderTree,
  Workflow,
  Blocks,
  Plus,
  Trash2,
  Sparkles,
  AlertTriangle,
  ImagePlus,
  X,
  Cable,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  useDesignProfile,
  useUpdateDesignProfile,
} from "@/hooks/use-design-profiles";
import { useActivePromptSections } from "@/hooks/use-prompt-sections";
import { resolveSection } from "@/lib/prompt-defaults";
import { detectConflicts } from "@/lib/conflict-detector";
import type { KnowledgeConflict } from "@/lib/conflict-detector";
import { callNonStreaming } from "@/hooks/use-generation";
import type { MessageContent } from "@/hooks/use-generation";
import type { ProcessRuleExample } from "@/types";

type Tab = "general" | "folders" | "io_linking" | "process" | "fb";

const TABS: { key: Tab; label: string; icon: typeof FileText }[] = [
  { key: "general", label: "General", icon: FileText },
  { key: "folders", label: "Folders", icon: FolderTree },
  { key: "io_linking", label: "IO Linking", icon: Cable },
  { key: "process", label: "Process", icon: Workflow },
  { key: "fb", label: "FB", icon: Blocks },
];

const GENERAL_PLACEHOLDER = `# Naming Conventions
- FB prefix: FB_CK_
- FC prefix: FC_CK_
- Variable style: camelCase for locals

# Comment Style
- Language: English
- Every FB must have a file header
- Section comments before each REGION

# Code Structure
- State machines: CASE with integer literals (0, 10, 20...)
- All timers must use TON with configurable PT as VAR_INPUT`;

const FOLDER_PLACEHOLDER = `# Program Structure
- Root group: "Main"
- Group "DEVICES" contains:
  - FC for each device call (SensorCall_FC, MotorCall_FC, etc.)
  - Subfolder "FBs" — all device function blocks
  - Subfolder "DBs" — all instance/global data blocks
- Group "PROCESS" — process FCs and sequence logic
- Group "HMI" — HMI data blocks and mapping FCs
- Group "UTILITIES" — shared helper FCs`;

export default function ProfileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: profile, isLoading } = useDesignProfile(id);
  const updateProfile = useUpdateDesignProfile();
  const { data: promptSections } = useActivePromptSections();

  const [tab, setTab] = useState<Tab>("general");
  const [dirty, setDirty] = useState(false);

  // Local form state — initialized from profile
  const [generalRules, setGeneralRules] = useState<string | null>(null);
  const [folderRules, setFolderRules] = useState<string | null>(null);
  const [ioLinkingRules, setIoLinkingRules] = useState<string | null>(null);
  const [processRules, setProcessRules] = useState<ProcessRuleExample[] | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- will be used when FB tab is implemented
  const [fbRules, _setFbRules] = useState<ProcessRuleExample[] | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);

  // Conflict detection
  const [conflicts, setConflicts] = useState<KnowledgeConflict[]>([]);
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);

  // Resolve current values (local edits or profile data)
  const currentName = name ?? profile?.name ?? "";
  const currentClientName = clientName ?? profile?.client_name ?? "";
  const currentGeneralRules = generalRules ?? profile?.general_rules ?? profile?.rules ?? "";
  const currentFolderRules = folderRules ?? profile?.folder_rules ?? "";
  const currentIoLinkingRules = ioLinkingRules ?? profile?.io_linking_rules ?? "";
  const currentProcessRules = processRules ?? profile?.process_rules ?? [];
  const currentFbRules = fbRules ?? profile?.fb_rules ?? [];

  function markDirty() { setDirty(true); }

  function doSave() {
    if (!profile) return;
    updateProfile.mutate(
      {
        id: profile.id,
        updates: {
          name: currentName,
          client_name: currentClientName || null,
          rules: currentGeneralRules, // keep legacy field in sync
          general_rules: currentGeneralRules,
          folder_rules: currentFolderRules,
          io_linking_rules: currentIoLinkingRules,
          process_rules: currentProcessRules,
          fb_rules: currentFbRules,
        },
      },
      {
        onSuccess: () => {
          setDirty(false);
          setConflicts([]);
        },
      },
    );
  }

  function handleSave() {
    if (!currentGeneralRules.trim()) {
      doSave();
      return;
    }
    const platformRulesText = resolveSection(promptSections, "shared", "platform_rules");
    const tempProfile = {
      ...profile!,
      name: currentName,
      rules: currentGeneralRules,
      general_rules: currentGeneralRules,
    };
    const detected = detectConflicts({
      patterns: [],
      designProfile: tempProfile,
      fbTemplates: [],
      agentKnowledgeDocs: [],
      overrides: [],
      platformRulesText,
    });
    if (detected.length > 0) {
      setConflicts(detected);
      setConflictDialogOpen(true);
    } else {
      doSave();
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="py-24 text-center text-muted-foreground">Profile not found.</div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-1 pb-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/profiles")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="text-xs text-muted-foreground">DESIGN PROFILE</div>
            <div className="flex items-center gap-2">
              <Input
                value={currentName}
                onChange={(e) => { setName(e.target.value); markDirty(); }}
                className="h-8 border-none bg-transparent p-0 text-xl font-semibold shadow-none focus-visible:ring-0"
              />
              {profile.client_name && (
                <Badge variant="secondary" className="font-mono text-xs">{profile.client_name}</Badge>
              )}
            </div>
          </div>
        </div>
        <Button size="sm" onClick={handleSave} disabled={!dirty || updateProfile.isPending} className="gap-1.5">
          {updateProfile.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
      </div>

      <Separator />

      {/* Tab bar */}
      <div className="flex border-b px-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-medium transition-colors",
              tab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
              t.key === "fb" && "opacity-50",
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
            {t.key === "fb" && <span className="text-[9px] text-muted-foreground">(soon)</span>}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <ScrollArea className="flex-1">
        <div className="max-w-3xl p-4">
          {tab === "general" && (
            <GeneralTab
              rules={currentGeneralRules}
              clientName={currentClientName}
              onRulesChange={(v) => { setGeneralRules(v); markDirty(); }}
              onClientNameChange={(v) => { setClientName(v); markDirty(); }}
            />
          )}
          {tab === "folders" && (
            <FoldersTab
              rules={currentFolderRules}
              onChange={(v) => { setFolderRules(v); markDirty(); }}
            />
          )}
          {tab === "io_linking" && (
            <IoLinkingTab
              rules={currentIoLinkingRules}
              onChange={(v) => { setIoLinkingRules(v); markDirty(); }}
            />
          )}
          {tab === "process" && (
            <RuleExamplesTab
              kind="process"
              examples={currentProcessRules}
              onChange={(v) => { setProcessRules(v); markDirty(); }}
              profileName={currentName}
            />
          )}
          {tab === "fb" && (
            <div className="rounded-md border border-dashed px-4 py-12 text-center">
              <Blocks className="mx-auto h-8 w-8 text-muted-foreground/40" />
              <div className="mt-2 font-mono text-sm text-muted-foreground">
                FB Rules coming soon. Same concept as Process Rules — example code with AI analysis.
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Conflict warning dialog */}
      <AlertDialog open={conflictDialogOpen} onOpenChange={setConflictDialogOpen}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Profile conflicts with Platform Rules
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Your design profile has {conflicts.length} rule{conflicts.length !== 1 ? "s" : ""} that
                  conflict with the default Platform Rules. <strong>Your profile will take priority.</strong>
                </p>
                <ScrollArea className="max-h-[240px]">
                  <div className="space-y-2 pr-3">
                    {conflicts.map((c) => (
                      <div key={c.id} className="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                        <Badge variant="secondary" className="font-mono text-[9px]">{c.category}</Badge>
                        <p className="mt-1 text-xs">{c.description}</p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConflicts([])}>Go Back</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConflictDialogOpen(false); doSave(); }}>
              Save Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── General Tab ────────────────────────────────────────────────────────────

function GeneralTab({
  rules,
  clientName,
  onRulesChange,
  onClientNameChange,
}: {
  rules: string;
  clientName: string;
  onRulesChange: (v: string) => void;
  onClientNameChange: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-mono text-sm font-semibold">General Rules</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Rules applied to every generation path — naming conventions, comment style, code structure.
        </p>
      </div>
      <div className="space-y-1">
        <Label className="font-mono text-xs">Client Name</Label>
        <Input
          value={clientName}
          onChange={(e) => onClientNameChange(e.target.value)}
          placeholder="e.g. Coca-Cola"
          className="max-w-sm font-mono text-sm"
        />
      </div>
      <Textarea
        value={rules}
        onChange={(e) => onRulesChange(e.target.value)}
        placeholder={GENERAL_PLACEHOLDER}
        className="min-h-[400px] resize-y font-mono text-xs leading-relaxed"
      />
    </div>
  );
}

// ─── Folders Tab ────────────────────────────────────────────────────────────

function FoldersTab({
  rules,
  onChange,
}: {
  rules: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-mono text-sm font-semibold">Folder Rules</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Define how TIA Portal program groups and folders should be structured.
          These rules are applied when creating project structure.
        </p>
      </div>
      <Textarea
        value={rules}
        onChange={(e) => onChange(e.target.value)}
        placeholder={FOLDER_PLACEHOLDER}
        className="min-h-[400px] resize-y font-mono text-xs leading-relaxed"
      />
    </div>
  );
}

// ─── IO Linking Tab ──────────────────────────────────────────────────────────

const IO_LINKING_PLACEHOLDER = `# LAD IO Linking Style
- Use NO contacts connected to output coils for Bool signals
  - E.g. rung: [NO contact: "I_MotorStart"] → [Coil: "InstMotor1.start"]
- Use MOVE boxes only for analog (Word/Int/Real) signals
  - E.g. rung: [MOVE: "IW_SpeedSetpoint" → "InstMotor1.speedSetpoint"]
- One rung per IO signal
- Rung title = "Assign {tag} → {instance}.{var}"`;

function IoLinkingTab({
  rules,
  onChange,
}: {
  rules: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-mono text-sm font-semibold">IO Linking Rules</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Rules applied specifically to the IO linking FC generation. Use this to define your preferred
          LAD contact/coil style, MOVE box usage, or rung structure conventions.
        </p>
      </div>
      <Textarea
        value={rules}
        onChange={(e) => onChange(e.target.value)}
        placeholder={IO_LINKING_PLACEHOLDER}
        className="min-h-[300px] resize-y font-mono text-xs leading-relaxed"
      />
    </div>
  );
}

// ─── Process / FB Rule Examples Tab ─────────────────────────────────────────

function RuleExamplesTab({
  kind,
  examples,
  onChange,
  profileName,
}: {
  kind: "process" | "fb";
  examples: ProcessRuleExample[];
  onChange: (v: ProcessRuleExample[]) => void;
  profileName: string;
}) {
  const [analyzing, setAnalyzing] = useState<number | null>(null);
  const label = kind === "process" ? "Process" : "Function Block";

  function addExample() {
    onChange([...examples, { label: `Example ${examples.length + 1}`, example: "", analysis: "" }]);
  }

  function updateExample(index: number, patch: Partial<ProcessRuleExample>) {
    const updated = examples.map((ex, i) => (i === index ? { ...ex, ...patch } : ex));
    onChange(updated);
  }

  function removeExample(index: number) {
    onChange(examples.filter((_, i) => i !== index));
  }

  const analyzeExample = useCallback(async (index: number) => {
    const ex = examples[index];
    if (!ex?.example?.trim() && !(ex?.screenshots?.length)) return;

    setAnalyzing(index);
    try {
      const hasScreenshots = (ex.screenshots?.length ?? 0) > 0;
      const hasCode = !!ex.example.trim();

      const systemPrompt = `You are an expert PLC programmer analyzing code examples to extract structural patterns.

The user has provided ${hasCode && hasScreenshots ? "both example code and screenshots of ladder logic/code" : hasScreenshots ? "screenshots of ladder logic/code" : `example ${label} code`} that represent how they want their ${label.toLowerCase()} code structured.

Analyze ${hasScreenshots ? "the screenshots and any code provided" : "the code"} and produce a clear, structured summary of the patterns you see. Focus on:
- Overall code organization (regions, networks, sections)
- Naming conventions used
- State machine / sequencing approach (if any)
- How steps, actions, transitions are structured
- Variable naming and data block structure
- Timer/counter usage patterns
- Error handling patterns
- Comment style

Output a concise analysis (bullet points preferred) that another AI agent could follow to replicate this exact coding style. Be specific — cite actual names, prefixes, array structures, etc. from the code.

Start with a one-line summary like: "This code uses a [pattern name] pattern with [key characteristic]."`;

      // Build multimodal message content
      const contentParts: MessageContent = [];
      if (hasScreenshots) {
        for (const dataUri of ex.screenshots!) {
          const match = dataUri.match(/^data:(image\/[^;]+);base64,(.+)$/);
          if (match) {
            contentParts.push({
              type: "image",
              source: { type: "base64", media_type: match[1], data: match[2] },
            });
          }
        }
      }
      const textContent = hasCode
        ? `Profile: ${profileName}\n\nAnalyze this ${label} example:\n\n\`\`\`scl\n${ex.example}\n\`\`\``
        : `Profile: ${profileName}\n\nAnalyze the ${label} pattern shown in the screenshot(s) above.`;
      contentParts.push({ type: "text", text: textContent });

      const response = await callNonStreaming(
        systemPrompt,
        [{ role: "user", content: contentParts }],
        AbortSignal.timeout(90_000),
        4096,
      );

      const text = typeof response === "string" ? response : typeof response?.content === "string" ? response.content : "";
      if (text) {
        const updated = examples.map((e, j) => (j === index ? { ...e, analysis: text } : e));
        onChange(updated);
      }
    } catch (err) {
      console.error("Analysis failed:", err);
    } finally {
      setAnalyzing(null);
    }
  }, [examples, profileName, label, onChange]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-mono text-sm font-semibold">{label} Rules</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Add example code showing how {label.toLowerCase()} logic should be structured.
            The AI will analyze each example to understand the pattern, then follow it during generation.
            {kind === "process" && " This also influences the linkage matrix and sequence diagrams."}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={addExample} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add Example
        </Button>
      </div>

      {examples.length === 0 ? (
        <div className="rounded-md border border-dashed px-4 py-12 text-center">
          <Workflow className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <div className="mt-2 font-mono text-sm text-muted-foreground">
            No examples yet. Add an example to define your {label.toLowerCase()} code pattern.
          </div>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Paste SCL code or upload a screenshot of ladder logic — the AI will analyze the structure.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {examples.map((ex, i) => (
            <ExampleCard
              key={i}
              example={ex}
              onUpdate={(patch) => updateExample(i, patch)}
              onRemove={() => removeExample(i)}
              onAnalyze={() => analyzeExample(i)}
              analyzing={analyzing === i}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ExampleCard({
  example,
  onUpdate,
  onRemove,
  onAnalyze,
  analyzing,
}: {
  example: ProcessRuleExample;
  onUpdate: (patch: Partial<ProcessRuleExample>) => void;
  onRemove: () => void;
  onAnalyze: () => void;
  analyzing: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const screenshots = example.screenshots ?? [];
  const hasContent = !!example.example.trim() || screenshots.length > 0;

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;

    const newScreenshots = [...screenshots];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const reader = new FileReader();
      reader.onload = () => {
        newScreenshots.push(reader.result as string);
        onUpdate({ screenshots: [...newScreenshots] });
      };
      reader.readAsDataURL(file);
    }
    // Reset input so same file can be re-selected
    e.target.value = "";
  }

  function removeScreenshot(index: number) {
    onUpdate({ screenshots: screenshots.filter((_, i) => i !== index) });
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <Input
          value={example.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          className="h-7 max-w-xs border-none bg-transparent p-0 font-mono text-sm font-semibold shadow-none focus-visible:ring-0"
          placeholder="Example label..."
        />
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            onClick={onAnalyze}
            disabled={analyzing || !hasContent}
          >
            {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {analyzing ? "Analyzing..." : "Analyze"}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onRemove}>
            <Trash2 className="h-3 w-3 text-muted-foreground" />
          </Button>
        </div>
      </div>

      {/* Screenshots */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Label className="font-mono text-xs text-muted-foreground">Screenshots</Label>
          <Button
            size="sm"
            variant="outline"
            className="h-6 gap-1 text-[10px]"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImagePlus className="h-3 w-3" />
            Add Image
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleImageUpload}
          />
          <span className="text-[10px] text-muted-foreground/60">
            Upload ladder logic screenshots, code screenshots, etc.
          </span>
        </div>
        {screenshots.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {screenshots.map((uri, i) => (
              <div key={i} className="group/img relative">
                <img
                  src={uri}
                  alt={`Screenshot ${i + 1}`}
                  className="h-24 rounded border border-border object-contain bg-muted/30"
                />
                <button
                  onClick={() => removeScreenshot(i)}
                  className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground group-hover/img:flex"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Code */}
      <div className="space-y-1">
        <Label className="font-mono text-xs text-muted-foreground">Example Code (SCL) — optional if screenshots provided</Label>
        <Textarea
          value={example.example}
          onChange={(e) => onUpdate({ example: e.target.value })}
          placeholder="Paste SCL code here showing your preferred structure..."
          className="min-h-[200px] resize-y font-mono text-xs leading-relaxed"
        />
      </div>

      {example.analysis && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="font-mono text-xs text-muted-foreground">AI Analysis</Label>
            <span className="text-[10px] text-muted-foreground/60">Editable — adjust if the AI missed anything</span>
          </div>
          <Textarea
            value={example.analysis}
            onChange={(e) => onUpdate({ analysis: e.target.value })}
            className="min-h-[150px] resize-y border-emerald-500/20 bg-emerald-500/5 font-mono text-xs leading-relaxed"
          />
        </div>
      )}
    </Card>
  );
}
