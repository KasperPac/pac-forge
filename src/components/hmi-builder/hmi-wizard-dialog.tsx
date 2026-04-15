import { useCallback, useMemo, useState } from "react";
import {
  Sparkles,
  Loader2,
  ChevronRight,
  ChevronLeft,
  RefreshCw,
  Wand2,
  Image as ImageIcon,
  Check,
  AlertCircle,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { HmiPanelConfig, HmiUnifiedTheme } from "@/types/hmi-panel";
import { useHmiWizardPlan, useHmiWizardCustomSvg } from "@/hooks/use-hmi-wizard";
import type { HmiWizardPlan, HmiWizardPlanDevice } from "@/lib/hmi-wizard-prompts";
import {
  buildItemsFromPlan,
} from "@/lib/hmi-wizard-layout";
import type { DeviceGraphicMap, DeviceGraphicSource } from "@/lib/hmi-wizard-layout";
import type { HmiUnifiedItemPayload } from "@/lib/hmi-unified-payload-builder";
import {
  findOpenLibraryFaceplate,
} from "@/lib/open-library-catalog";
import { HmiGraphicsPanel } from "./hmi-graphics-panel";
import { HmiUnifiedItemView } from "./hmi-unified-item-view";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";

type WizardStep = "prompt" | "plan" | "graphics" | "review";

interface HmiWizardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panel: HmiPanelConfig;
  theme: HmiUnifiedTheme;
  onApply: (items: HmiUnifiedItemPayload[]) => void;
}

const STEP_ORDER: WizardStep[] = ["prompt", "plan", "graphics", "review"];
const STEP_LABELS: Record<WizardStep, string> = {
  prompt: "Describe",
  plan: "Layout",
  graphics: "Graphics",
  review: "Review",
};

export function HmiWizardDialog({ open, onOpenChange, panel, theme, onApply }: HmiWizardDialogProps) {
  const [step, setStep] = useState<WizardStep>("prompt");
  const [userPrompt, setUserPrompt] = useState("");
  const [screenRole, setScreenRole] = useState<"overview" | "detail" | "dashboard" | "alarm" | "trend">("overview");
  const [useTemplateFrame, setUseTemplateFrame] = useState(true);
  const [plan, setPlan] = useState<HmiWizardPlan | null>(null);
  const [graphics, setGraphics] = useState<DeviceGraphicMap>({});

  const planMutation = useHmiWizardPlan();
  const svgMutation = useHmiWizardCustomSvg();

  const reset = useCallback(() => {
    setStep("prompt");
    setPlan(null);
    setGraphics({});
    planMutation.reset();
    svgMutation.reset();
  }, [planMutation, svgMutation]);

  const handleClose = useCallback(
    (next: boolean) => {
      onOpenChange(next);
      if (!next) {
        // leave the state for now — user might re-open to continue
      }
    },
    [onOpenChange],
  );

  const handleGeneratePlan = useCallback(async () => {
    if (!userPrompt.trim()) return;
    try {
      const result = await planMutation.mutateAsync({
        userPrompt,
        screenRole,
        panel,
        theme,
        useTemplateFrame,
      });
      // User choice wins over whatever the AI decided
      result.useTemplateFrame = useTemplateFrame;
      setPlan(result);
      // Pre-resolve faceplate suggestions
      const next: DeviceGraphicMap = {};
      for (const dev of result.devices) {
        const match = findOpenLibraryFaceplate(dev.faceplateHint || dev.deviceType, dev.orientation);
        if (match) {
          next[dev.id] = {
            kind: "library",
            path: `faceplate://${match.name}`,
            name: match.name,
            category: match.category,
          };
        } else {
          next[dev.id] = { kind: "none" };
        }
      }
      setGraphics(next);
      setStep("plan");
    } catch {
      /* error surfaced via planMutation.error */
    }
  }, [userPrompt, screenRole, panel, theme, useTemplateFrame, planMutation]);

  const generatedItems = useMemo(() => {
    if (!plan) return [];
    return buildItemsFromPlan({ plan, panel, graphics });
  }, [plan, panel, graphics]);

  function goNext() {
    const idx = STEP_ORDER.indexOf(step);
    if (idx < STEP_ORDER.length - 1) setStep(STEP_ORDER[idx + 1]);
  }
  function goBack() {
    const idx = STEP_ORDER.indexOf(step);
    if (idx > 0) setStep(STEP_ORDER[idx - 1]);
  }

  function handleApply() {
    onApply(generatedItems);
    onOpenChange(false);
    reset();
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="flex h-[85vh] max-w-5xl flex-col p-0">
        <DialogHeader className="border-b border-border/50 px-4 py-3">
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-amber-500" />
            HMI Screen Wizard
          </DialogTitle>
          <DialogDescription className="text-xs">
            Describe the screen, tweak the plan, pick graphics, review and apply to the canvas.
          </DialogDescription>
        </DialogHeader>

        <StepHeader step={step} />

        <div className="flex min-h-0 flex-1 flex-col">
          {step === "prompt" && (
            <PromptStep
              userPrompt={userPrompt}
              onUserPromptChange={setUserPrompt}
              screenRole={screenRole}
              onScreenRoleChange={setScreenRole}
              useTemplateFrame={useTemplateFrame}
              onUseTemplateFrameChange={setUseTemplateFrame}
              theme={theme}
              loading={planMutation.isPending}
              error={planMutation.error?.message ?? null}
            />
          )}

          {step === "plan" && plan && (
            <PlanStep plan={plan} onPlanChange={setPlan} panel={panel} />
          )}

          {step === "graphics" && plan && (
            <GraphicsStep
              plan={plan}
              graphics={graphics}
              theme={theme}
              onGraphicsChange={setGraphics}
              customSvgLoading={svgMutation.isPending}
              onGenerateCustomSvg={async (dev: HmiWizardPlanDevice) => {
                const description = `${dev.deviceType} "${dev.label}"${dev.orientation ? ` (${dev.orientation})` : ""}`;
                try {
                  const svg = await svgMutation.mutateAsync({ description, theme });
                  setGraphics((prev) => ({
                    ...prev,
                    [dev.id]: { kind: "svg", svg, name: dev.label },
                  }));
                } catch {
                  /* surfaced via svgMutation.error */
                }
              }}
              svgError={svgMutation.error?.message ?? null}
            />
          )}

          {step === "review" && plan && (
            <ReviewStep plan={plan} items={generatedItems} panel={panel} />
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border/50 px-4 py-3">
          <Button variant="ghost" size="sm" onClick={reset} className="gap-1.5">
            <RefreshCw className="h-3 w-3" />
            Reset
          </Button>
          <div className="flex items-center gap-2">
            {step !== "prompt" && (
              <Button variant="outline" size="sm" onClick={goBack} className="gap-1">
                <ChevronLeft className="h-3 w-3" />
                Back
              </Button>
            )}
            {step === "prompt" && (
              <Button
                size="sm"
                onClick={handleGeneratePlan}
                disabled={!userPrompt.trim() || planMutation.isPending}
                className="gap-1.5"
              >
                {planMutation.isPending ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3 w-3" />
                    Generate Plan
                  </>
                )}
              </Button>
            )}
            {step === "plan" && (
              <Button size="sm" onClick={goNext} className="gap-1">
                Next: Graphics
                <ChevronRight className="h-3 w-3" />
              </Button>
            )}
            {step === "graphics" && (
              <Button size="sm" onClick={goNext} className="gap-1">
                Next: Review
                <ChevronRight className="h-3 w-3" />
              </Button>
            )}
            {step === "review" && (
              <Button size="sm" onClick={handleApply} className="gap-1.5">
                <Check className="h-3 w-3" />
                Apply to Canvas ({generatedItems.length} items)
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Step header — progress pill row
// ---------------------------------------------------------------------------

function StepHeader({ step }: { step: WizardStep }) {
  const activeIdx = STEP_ORDER.indexOf(step);
  return (
    <div className="flex items-center gap-2 border-b border-border/50 bg-card/50 px-4 py-2">
      {STEP_ORDER.map((s, i) => {
        const isActive = s === step;
        const isDone = i < activeIdx;
        return (
          <div key={s} className="flex items-center gap-2">
            <div
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full font-mono text-[10px]",
                isActive && "bg-amber-500 text-black",
                isDone && "bg-emerald-500/30 text-emerald-400",
                !isActive && !isDone && "bg-neutral-800 text-muted-foreground",
              )}
            >
              {isDone ? <Check className="h-3 w-3" /> : i + 1}
            </div>
            <span
              className={cn(
                "font-mono text-[10px] uppercase tracking-wider",
                isActive ? "text-amber-400" : isDone ? "text-emerald-400" : "text-muted-foreground",
              )}
            >
              {STEP_LABELS[s]}
            </span>
            {i < STEP_ORDER.length - 1 && (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Prompt
// ---------------------------------------------------------------------------

interface PromptStepProps {
  userPrompt: string;
  onUserPromptChange: (v: string) => void;
  screenRole: "overview" | "detail" | "dashboard" | "alarm" | "trend";
  onScreenRoleChange: (v: "overview" | "detail" | "dashboard" | "alarm" | "trend") => void;
  useTemplateFrame: boolean;
  onUseTemplateFrameChange: (v: boolean) => void;
  theme: HmiUnifiedTheme;
  loading: boolean;
  error: string | null;
}

function panelSizeHint(): string {
  return "panel";
}

const EXAMPLE_PROMPTS: string[] = [
  "Overview page for a packaging line with two conveyors, a main motor, start/stop buttons, mode selector (Auto/Manual), current machine state, and production count.",
  "Detail screen for a reversing motor with forward/reverse/stop buttons, speed readout, interlock status, fault indicators.",
  "Dashboard showing live status of 4 tanks with level bars, a system-wide alarm count, and batch timer.",
];

function PromptStep({
  userPrompt,
  onUserPromptChange,
  screenRole,
  onScreenRoleChange,
  useTemplateFrame,
  onUseTemplateFrameChange,
  theme,
  loading,
  error,
}: PromptStepProps) {
  return (
    <ScrollArea className="flex-1">
      <div className="space-y-4 p-4">
        {/* Template picker — prominent, above the prompt */}
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Base Template
          </Label>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onUseTemplateFrameChange(true)}
              className={cn(
                "flex items-start gap-3 rounded-md border p-3 text-left transition-colors",
                useTemplateFrame
                  ? "border-amber-500/60 bg-amber-500/5"
                  : "border-neutral-700 bg-neutral-900/30 hover:border-neutral-500",
              )}
            >
              <div className="flex h-14 w-20 flex-shrink-0 flex-col gap-0.5 rounded border border-neutral-700 bg-neutral-950 p-0.5">
                <div className="h-2 rounded-sm bg-neutral-700" />
                <div className="h-1.5 rounded-sm bg-neutral-800" />
                <div className="flex-1 rounded-sm border border-dashed border-amber-500/30 bg-amber-500/5" />
                <div className="h-1.5 rounded-sm bg-neutral-800" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <div
                    className={cn(
                      "h-3 w-3 rounded-full border",
                      useTemplateFrame ? "border-amber-500 bg-amber-500" : "border-neutral-600",
                    )}
                  />
                  <span className="font-mono text-[11px] font-bold">
                    Siemens Template Suite
                  </span>
                </div>
                <div className="mt-0.5 font-mono text-[9px] text-muted-foreground">
                  Title bar + status bar + nav zones, {theme} palette. Content fits inside
                  the mainWindow rect. Recommended for production screens.
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onUseTemplateFrameChange(false)}
              className={cn(
                "flex items-start gap-3 rounded-md border p-3 text-left transition-colors",
                !useTemplateFrame
                  ? "border-amber-500/60 bg-amber-500/5"
                  : "border-neutral-700 bg-neutral-900/30 hover:border-neutral-500",
              )}
            >
              <div className="flex h-14 w-20 flex-shrink-0 items-center justify-center rounded border border-neutral-700 bg-neutral-950 p-0.5">
                <div className="h-full w-full rounded-sm border border-dashed border-neutral-600" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <div
                    className={cn(
                      "h-3 w-3 rounded-full border",
                      !useTemplateFrame ? "border-amber-500 bg-amber-500" : "border-neutral-600",
                    )}
                  />
                  <span className="font-mono text-[11px] font-bold">Blank Canvas</span>
                </div>
                <div className="mt-0.5 font-mono text-[9px] text-muted-foreground">
                  No frame or nav. Items span the full {panelSizeHint()} screen. Use for
                  custom layouts or popup dialogs.
                </div>
              </div>
            </button>
          </div>
        </div>

        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Screen Role
          </Label>
          <Select value={screenRole} onValueChange={(v) => onScreenRoleChange(v as PromptStepProps["screenRole"])}>
            <SelectTrigger className="mt-1 h-8 w-56 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="overview">Overview</SelectItem>
              <SelectItem value="detail">Device Detail</SelectItem>
              <SelectItem value="dashboard">Dashboard</SelectItem>
              <SelectItem value="alarm">Alarm Page</SelectItem>
              <SelectItem value="trend">Trend Page</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Describe what you want
          </Label>
          <Textarea
            value={userPrompt}
            onChange={(e) => onUserPromptChange(e.target.value)}
            placeholder="e.g. Overview page for a packaging line with a main motor, two conveyors, start/stop/reset buttons, mode selection, current state, production count..."
            className="mt-1 min-h-32 font-mono text-xs"
            disabled={loading}
          />
        </div>

        <div>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Example prompts
          </div>
          <div className="space-y-1">
            {EXAMPLE_PROMPTS.map((ex, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onUserPromptChange(ex)}
                className="w-full rounded border border-neutral-800 bg-neutral-900/40 px-2 py-1.5 text-left font-mono text-[11px] text-neutral-400 hover:border-amber-500/40 hover:text-neutral-200"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-400">
            <AlertCircle className="mt-0.5 h-3 w-3 flex-shrink-0" />
            <div className="font-mono">{error}</div>
          </div>
        )}

        {!loading && !error && userPrompt.trim() && (
          <div className="rounded border border-neutral-800/60 bg-neutral-900/30 p-2 font-mono text-[10px] text-muted-foreground">
            Press Generate Plan to have the AI design the layout, pick devices, and match graphics from the Siemens Open Library.
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Plan review + edit
// ---------------------------------------------------------------------------

function PlanStep({
  plan,
  onPlanChange,
  panel,
}: {
  plan: HmiWizardPlan;
  onPlanChange: (p: HmiWizardPlan) => void;
  panel: HmiPanelConfig;
}) {
  function updateField<K extends keyof HmiWizardPlan>(key: K, value: HmiWizardPlan[K]) {
    onPlanChange({ ...plan, [key]: value });
  }

  function updateDevice(index: number, patch: Partial<HmiWizardPlanDevice>) {
    const next = [...plan.devices];
    next[index] = { ...next[index], ...patch };
    updateField("devices", next);
  }

  function removeDevice(index: number) {
    updateField("devices", plan.devices.filter((_, i) => i !== index));
  }

  function addDevice() {
    const id = `dev_${Math.random().toString(36).slice(2, 5)}`;
    updateField("devices", [
      ...plan.devices,
      {
        id,
        label: "New Device",
        deviceType: "motor",
        faceplateHint: "motor",
        positionHint: "grid",
      },
    ]);
  }

  return (
    <div className="flex min-h-0 flex-1">
      <ScrollArea className="flex-1 border-r border-border/50">
        <div className="space-y-4 p-4">
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Screen Title
            </Label>
            <Input
              value={plan.screenTitle}
              onChange={(e) => updateField("screenTitle", e.target.value)}
              className="mt-1 h-8 font-mono text-xs"
            />
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Description
            </Label>
            <div className="mt-1 rounded border border-neutral-800/60 bg-neutral-900/30 p-2 font-mono text-[11px] text-muted-foreground">
              {plan.description || "(no description)"}
            </div>
          </div>

          <div>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={plan.useTemplateFrame}
                onChange={(e) => updateField("useTemplateFrame", e.target.checked)}
              />
              <span className="font-mono text-[11px]">Use Siemens Template Suite frame</span>
            </label>
            <div className="mt-1 font-mono text-[10px] text-muted-foreground">
              Adds title bar, status bar, and fits content inside the mainWindow rect.
            </div>
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Nav Placeholder Pages ({plan.navItems.length})
            </Label>
            <div className="mt-1 flex flex-wrap gap-1">
              {plan.navItems.map((navItem, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded border border-neutral-700 bg-neutral-900/50 px-2 py-0.5 font-mono text-[10px] text-neutral-300"
                >
                  {navItem}
                  <button
                    type="button"
                    onClick={() => updateField("navItems", plan.navItems.filter((_, j) => j !== i))}
                    className="text-muted-foreground hover:text-red-400"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={() => {
                  const label = prompt("Nav page label?");
                  if (label) updateField("navItems", [...plan.navItems, label]);
                }}
                className="rounded border border-dashed border-neutral-700 px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-amber-400"
              >
                + add
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Devices ({plan.devices.length})
              </Label>
              <Button size="sm" variant="ghost" onClick={addDevice} className="h-6 px-2 text-[10px]">
                + Add
              </Button>
            </div>
            <div className="mt-1 space-y-1">
              {plan.devices.map((dev, i) => (
                <div
                  key={dev.id}
                  className="grid grid-cols-[1fr_1fr_auto] gap-1 rounded border border-neutral-800 bg-neutral-900/30 p-1.5"
                >
                  <Input
                    value={dev.label}
                    onChange={(e) => updateDevice(i, { label: e.target.value })}
                    className="h-6 font-mono text-[11px]"
                    placeholder="Label"
                  />
                  <Input
                    value={dev.deviceType}
                    onChange={(e) => updateDevice(i, { deviceType: e.target.value, faceplateHint: e.target.value })}
                    className="h-6 font-mono text-[11px]"
                    placeholder="type"
                  />
                  <button
                    type="button"
                    onClick={() => removeDevice(i)}
                    className="px-1 text-muted-foreground hover:text-red-400"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Controls ({plan.controls.length})
            </Label>
            <div className="mt-1 flex flex-wrap gap-1">
              {plan.controls.map((c, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded border border-neutral-700 bg-neutral-900/50 px-2 py-0.5 font-mono text-[10px]"
                >
                  <span className={variantDotClass(c.variant)}>●</span>
                  {c.label}
                </span>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Status Fields ({plan.statusFields.length})
            </Label>
            <div className="mt-1 space-y-0.5">
              {plan.statusFields.map((f, i) => (
                <div key={i} className="font-mono text-[10px] text-muted-foreground">
                  · {f.label}
                  {f.unit ? ` [${f.unit}]` : ""}
                </div>
              ))}
            </div>
          </div>

          {plan.notes && (
            <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2 font-mono text-[10px] text-amber-400">
              <strong>Notes:</strong> {plan.notes}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Template Suite frame preview */}
      <div className="flex w-80 flex-shrink-0 flex-col border-l border-border/50 bg-neutral-950/60 p-3">
        <Label className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          Layout Preview
        </Label>
        <TemplateFramePreview plan={plan} panel={panel} />
      </div>
    </div>
  );
}

function variantDotClass(v?: string): string {
  switch (v) {
    case "success":
      return "text-emerald-400";
    case "danger":
      return "text-red-400";
    case "warning":
      return "text-amber-400";
    case "neutral":
      return "text-neutral-400";
    default:
      return "text-blue-400";
  }
}

function TemplateFramePreview({ plan, panel }: { plan: HmiWizardPlan; panel: HmiPanelConfig }) {
  const scale = 280 / panel.screenWidth;
  const w = panel.screenWidth * scale;
  const h = panel.screenHeight * scale;
  return (
    <div
      className="relative border border-neutral-700 bg-neutral-900"
      style={{ width: w, height: h }}
    >
      {plan.useTemplateFrame && (
        <>
          <div
            className="absolute bg-neutral-800"
            style={{ left: 0, top: 0, width: w, height: h * 0.06 }}
          >
            <div className="px-1 font-mono text-[8px] text-neutral-400">{plan.screenTitle}</div>
          </div>
          <div
            className="absolute border-t border-neutral-700 bg-neutral-850"
            style={{ left: 0, top: h * 0.06, width: w, height: h * 0.04 }}
          >
            <div className="px-1 font-mono text-[7px] text-neutral-500">machine state</div>
          </div>
          {plan.visibleNavLevels.includes("sub") && (
            <div
              className="absolute bg-neutral-800"
              style={{ left: 0, top: h * 0.94, width: w, height: h * 0.06 }}
            />
          )}
        </>
      )}
      <div
        className="absolute border border-dashed border-amber-500/30 bg-amber-500/5"
        style={{
          left: 4,
          top: plan.useTemplateFrame ? h * 0.1 + 2 : 4,
          width: w - 8,
          height: plan.useTemplateFrame ? h * (plan.visibleNavLevels.includes("sub") ? 0.84 : 0.9) - 8 : h - 8,
        }}
      >
        <div className="p-1 font-mono text-[7px] text-amber-400">content area</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Graphics picker
// ---------------------------------------------------------------------------

interface GraphicsStepProps {
  plan: HmiWizardPlan;
  graphics: DeviceGraphicMap;
  theme: HmiUnifiedTheme;
  onGraphicsChange: (next: DeviceGraphicMap) => void;
  customSvgLoading: boolean;
  onGenerateCustomSvg: (dev: HmiWizardPlanDevice) => void;
  svgError: string | null;
}

function GraphicsStep({
  plan,
  graphics,
  onGraphicsChange,
  customSvgLoading,
  onGenerateCustomSvg,
  svgError,
}: GraphicsStepProps) {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(
    plan.devices[0]?.id ?? null,
  );
  const [showPicker, setShowPicker] = useState(false);
  const selectedDevice = plan.devices.find((d) => d.id === selectedDeviceId) ?? null;

  function handleSwap(entry: { name: string; path: string; category: string }) {
    if (!selectedDevice) return;
    onGraphicsChange({
      ...graphics,
      [selectedDevice.id]: { kind: "library", path: entry.path, name: entry.name, category: entry.category },
    });
    setShowPicker(false);
  }

  function handleClear() {
    if (!selectedDevice) return;
    onGraphicsChange({
      ...graphics,
      [selectedDevice.id]: { kind: "none" },
    });
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* Device list on left */}
      <ScrollArea className="w-56 flex-shrink-0 border-r border-border/50">
        <div className="space-y-0.5 p-2">
          {plan.devices.map((dev) => {
            const src = graphics[dev.id];
            return (
              <button
                key={dev.id}
                type="button"
                onClick={() => {
                  setSelectedDeviceId(dev.id);
                  setShowPicker(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs",
                  selectedDeviceId === dev.id
                    ? "bg-amber-500/10 text-amber-400"
                    : "text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200",
                )}
              >
                <DeviceThumbnail src={src} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[11px]">{dev.label}</div>
                  <div className="truncate font-mono text-[9px] text-muted-foreground">
                    {dev.deviceType}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>

      {/* Selected device + actions / picker */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!selectedDevice ? (
          <div className="flex flex-1 items-center justify-center font-mono text-[11px] text-muted-foreground">
            No devices in plan
          </div>
        ) : showPicker ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
              <div className="font-mono text-[11px]">
                Pick graphic for <span className="text-amber-400">{selectedDevice.label}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowPicker(false)}>
                Cancel
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <HmiGraphicsPanel onAdd={handleSwap} />
            </div>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="space-y-4 p-4">
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {selectedDevice.label}
                </Label>
                <div className="mt-2 flex items-center gap-4">
                  <div className="flex h-32 w-32 items-center justify-center rounded border border-neutral-700 bg-neutral-950">
                    <DeviceThumbnail src={graphics[selectedDevice.id]} size={112} />
                  </div>
                  <div className="flex flex-col gap-1 font-mono text-[11px]">
                    <div className="text-muted-foreground">Source</div>
                    <div className="text-neutral-200">
                      {formatGraphicSource(graphics[selectedDevice.id])}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setShowPicker(true)} className="gap-1.5">
                  <ImageIcon className="h-3 w-3" />
                  Swap from Library
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onGenerateCustomSvg(selectedDevice)}
                  disabled={customSvgLoading}
                  className="gap-1.5"
                >
                  {customSvgLoading ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3 w-3" />
                      Generate Custom SVG
                    </>
                  )}
                </Button>
                {graphics[selectedDevice.id]?.kind !== "none" && (
                  <Button size="sm" variant="ghost" onClick={handleClear} className="gap-1.5">
                    <X className="h-3 w-3" />
                    Clear
                  </Button>
                )}
              </div>

              {svgError && (
                <div className="flex items-start gap-2 rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-400">
                  <AlertCircle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                  <div className="font-mono">{svgError}</div>
                </div>
              )}

              <div className="rounded border border-neutral-800/60 bg-neutral-900/30 p-2 font-mono text-[10px] text-muted-foreground">
                <strong>Tip:</strong> Custom SVG generation follows Siemens dynamic-SVG conventions
                (viewBox 0 0 100 100, flat engineering palette, <code>&lt;g id="background"&gt;</code>
                / <code>&lt;g id="dynamic"&gt;</code>, <code>data-bind</code> attributes).
              </div>
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

function formatGraphicSource(src: DeviceGraphicSource | undefined): string {
  if (!src || src.kind === "none") return "(none)";
  if (src.kind === "library") {
    if (src.path.startsWith("faceplate://")) return `Open Library · ${src.name}`;
    return `Graphics Library · ${src.name}`;
  }
  return `Custom SVG · ${src.name}`;
}

function DeviceThumbnail({ src, size }: { src: DeviceGraphicSource | undefined; size: number }) {
  if (!src || src.kind === "none") {
    return (
      <div
        className="flex items-center justify-center rounded border border-dashed border-neutral-700 bg-neutral-900/40"
        style={{ width: size, height: size }}
      >
        <ImageIcon className="h-4 w-4 text-neutral-600" />
      </div>
    );
  }
  if (src.kind === "library") {
    if (src.path.startsWith("faceplate://")) {
      return (
        <div
          className="flex items-center justify-center rounded border border-amber-500/30 bg-amber-500/5 p-1 text-center"
          style={{ width: size, height: size }}
        >
          <div className="font-mono text-[8px] text-amber-400">{src.name.replace(/^fp/, "")}</div>
        </div>
      );
    }
    const url = `${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/wincc-graphic?path=${encodeURIComponent(src.path)}`;
    return (
      <img
        src={url}
        alt={src.name}
        draggable={false}
        className="max-h-full max-w-full object-contain"
        style={{ width: size, height: size }}
      />
    );
  }
  // svg
  const dataUri = `data:image/svg+xml;base64,${safeBtoa(src.svg)}`;
  return (
    <img
      src={dataUri}
      alt={src.name}
      draggable={false}
      className="object-contain"
      style={{ width: size, height: size }}
    />
  );
}

function safeBtoa(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Step 4 — Review
// ---------------------------------------------------------------------------

function ReviewStep({
  plan,
  items,
  panel,
}: {
  plan: HmiWizardPlan;
  items: HmiUnifiedItemPayload[];
  panel: HmiPanelConfig;
}) {
  const scale = Math.min(700 / panel.screenWidth, 380 / panel.screenHeight);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div>
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Preview · {plan.screenTitle}
        </Label>
        <div className="mt-1 font-mono text-[10px] text-muted-foreground">
          {items.length} items · {panel.screenWidth}×{panel.screenHeight}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-neutral-950/60 p-3">
        <div
          className="relative origin-top-left bg-neutral-900 shadow-2xl"
          style={{
            width: panel.screenWidth,
            height: panel.screenHeight,
            transform: `scale(${scale})`,
            transformOrigin: "center center",
          }}
        >
          {items.map((item, i) => {
            const x = Number(item.attributes.Left ?? 0);
            const y = Number(item.attributes.Top ?? 0);
            const w = Number(item.attributes.Width ?? 100);
            const h = Number(item.attributes.Height ?? 40);
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: x,
                  top: y,
                  width: w,
                  height: h,
                }}
              >
                <HmiUnifiedItemView item={item} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
