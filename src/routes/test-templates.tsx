import { useState, useMemo } from "react";
import {
  Plus,
  Trash2,
  Loader2,
  FlaskConical,
  ChevronDown,
  ChevronRight,
  Save,
  Sparkles,
  Check,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  usePlcsimTestTemplates,
  useCreatePlcsimTestTemplate,
  useUpdatePlcsimTestTemplate,
  useDeletePlcsimTestTemplate,
} from "@/hooks/use-plcsim-test-templates";
import { useFbTemplates, useFbTemplate } from "@/hooks/use-fb-templates";
import { useFbDeviceCategories } from "@/hooks/use-fb-categories";
import { useTestTemplateSuggest } from "@/hooks/use-test-template-suggest";
import type { TestSuggestion } from "@/hooks/use-test-template-suggest";
import type { PlcsimTestTemplate, PlcsimTestTemplateCreate } from "@/types/plcsim-test-template";
import type { PlcsimTestCase, TestStep, TestIoAction } from "@/types/plcsim-test";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createEmptyTestCase(): PlcsimTestCase {
  return {
    id: crypto.randomUUID(),
    name: "",
    sequenceName: null,
    category: "device_fb",
    description: "",
    steps: [createEmptyStep(1)],
    simRules: [],
    priority: 0,
    approved: false,
  };
}

function createEmptyStep(stepNumber: number): TestStep {
  return {
    id: crypto.randomUUID(),
    stepNumber,
    description: "",
    actions: [],
  };
}

function createEmptyAction(): TestIoAction {
  return {
    id: crypto.randomUUID(),
    type: "write",
    tag: "",
    value: "",
    dataType: "Bool",
    description: "",
  };
}

// ---------------------------------------------------------------------------
// Action Row
// ---------------------------------------------------------------------------

function ActionRow({
  action,
  onChange,
  onDelete,
}: {
  action: TestIoAction;
  onChange: (field: keyof TestIoAction, value: unknown) => void;
  onDelete: () => void;
}) {
  return (
    <div className="grid grid-cols-[24px_72px_2fr_120px_80px_2fr_28px] w-full gap-2 items-center">
      <div />
      <Select value={action.type} onValueChange={(v) => onChange("type", v)}>
        <SelectTrigger className="h-8 text-xs px-2"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="write">Write</SelectItem>
          <SelectItem value="read">Read</SelectItem>
          <SelectItem value="wait">Wait</SelectItem>
        </SelectContent>
      </Select>
      <Input
        className="h-8 text-xs font-mono"
        placeholder="{instanceDb}.enable"
        value={action.tag}
        onChange={(e) => onChange("tag", e.target.value)}
      />
      <Input
        className="h-8 text-xs"
        placeholder="true"
        value={String(action.value ?? "")}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "true") onChange("value", true);
          else if (v === "false") onChange("value", false);
          else if (!isNaN(Number(v)) && v !== "") onChange("value", Number(v));
          else onChange("value", v);
        }}
      />
      <Select value={action.dataType} onValueChange={(v) => onChange("dataType", v)}>
        <SelectTrigger className="h-8 text-xs px-2"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="Bool">Bool</SelectItem>
          <SelectItem value="Int">Int</SelectItem>
          <SelectItem value="DInt">DInt</SelectItem>
          <SelectItem value="Real">Real</SelectItem>
          <SelectItem value="Word">Word</SelectItem>
          <SelectItem value="Time">Time</SelectItem>
        </SelectContent>
      </Select>
      <Input
        className="h-8 text-xs"
        placeholder="Description"
        value={action.description ?? ""}
        onChange={(e) => onChange("description", e.target.value)}
      />
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDelete}>
        <Trash2 className="h-3 w-3 text-muted-foreground" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step Editor
// ---------------------------------------------------------------------------

function StepEditor({
  step,
  onUpdate,
  onDelete,
}: {
  step: TestStep;
  onUpdate: (updated: TestStep) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(true);

  function updateAction(actionId: string, field: keyof TestIoAction, value: unknown) {
    onUpdate({
      ...step,
      actions: step.actions.map((a) =>
        a.id === actionId ? { ...a, [field]: value } : a,
      ),
    });
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="cursor-pointer px-3 py-2" onClick={() => setExpanded((v) => !v)}>
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          <Badge variant="secondary" className="font-mono text-xs">Step {step.stepNumber}</Badge>
          <Input
            className="h-7 border-none bg-transparent px-1 text-sm shadow-none focus-visible:ring-0 flex-1"
            placeholder="Step description"
            value={step.description}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onUpdate({ ...step, description: e.target.value })}
          />
          <span className="text-xs text-muted-foreground">{step.actions.length} actions</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
            <Trash2 className="h-3 w-3 text-muted-foreground" />
          </Button>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="px-4 pb-3 pt-0 space-y-1.5">
          <div className="grid grid-cols-[24px_72px_2fr_120px_80px_2fr_28px] w-full gap-2 px-1 text-xs font-mono uppercase tracking-wider text-muted-foreground/50">
            <span />
            <span>Type</span>
            <span>Tag</span>
            <span>Value</span>
            <span>Data Type</span>
            <span>Description</span>
            <span />
          </div>
          {step.actions.map((action) => (
            <ActionRow
              key={action.id}
              action={action}
              onChange={(field, value) => updateAction(action.id, field, value)}
              onDelete={() =>
                onUpdate({ ...step, actions: step.actions.filter((a) => a.id !== action.id) })
              }
            />
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="w-full gap-1 text-xs border-dashed border"
            onClick={() =>
              onUpdate({ ...step, actions: [...step.actions, createEmptyAction()] })
            }
          >
            <Plus className="h-3 w-3" /> Add Action
          </Button>
        </CardContent>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Template Detail Editor
// ---------------------------------------------------------------------------

function TemplateEditor({
  template,
  categories,
  fbTemplates,
  onSave,
  onDelete,
  saving,
}: {
  template: PlcsimTestTemplate;
  categories: Array<{ name: string; display_name: string }>;
  fbTemplates: Array<{ id: string; name: string; device_category: string }>;
  onSave: (updates: Partial<PlcsimTestTemplate>) => void;
  onDelete: () => void;
  saving: boolean;
}) {
  const [local, setLocal] = useState<PlcsimTestTemplate>(template);
  const dirty = JSON.stringify(local) !== JSON.stringify(template);

  // AI suggestions — two-step: list suggestions, then generate selected one
  const { suggest, generateOne, loading: suggesting, generating, error: suggestError } = useTestTemplateSuggest();
  const { data: linkedFb } = useFbTemplate(local.fb_template_id);
  const [suggestions, setSuggestions] = useState<TestSuggestion[] | null>(null);

  async function handleSuggest() {
    if (!linkedFb) return;
    const results = await suggest(linkedFb);
    setSuggestions(results);
  }

  async function handlePickSuggestion(sug: TestSuggestion) {
    if (!linkedFb) return;
    const tc = await generateOne(linkedFb, sug);
    // Replace the template's test case with the generated one
    const newSteps = tc.steps.map((s, i) => ({
      ...s,
      id: crypto.randomUUID(),
      stepNumber: local.test_case.steps.length + i + 1,
      actions: s.actions.map((a) => ({ ...a, id: crypto.randomUUID() })),
    }));
    updateTestCase({
      name: local.test_case.name || tc.name,
      description: local.test_case.description || tc.description,
      steps: [...local.test_case.steps, ...newSteps],
    });
    // Remove from suggestions
    setSuggestions((prev) => prev?.filter((s) => s.id !== sug.id) ?? null);
  }

  function updateTestCase(updates: Partial<PlcsimTestCase>) {
    setLocal({ ...local, test_case: { ...local.test_case, ...updates } });
  }

  function updateStep(stepId: string, updated: TestStep) {
    updateTestCase({
      steps: local.test_case.steps.map((s) => (s.id === stepId ? updated : s)),
    });
  }

  function deleteStep(stepId: string) {
    const remaining = local.test_case.steps.filter((s) => s.id !== stepId);
    updateTestCase({
      steps: remaining.map((s, i) => ({ ...s, stepNumber: i + 1 })),
    });
  }

  function addStep() {
    const nextNum = local.test_case.steps.length + 1;
    updateTestCase({
      steps: [...local.test_case.steps, createEmptyStep(nextNum)],
    });
  }

  // Scope mode
  const scopeMode = local.fb_template_id ? "fb" : "category";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-4 py-2.5">
        <div className="flex-1">
          <Input
            className="h-8 text-lg font-semibold border-none bg-transparent px-0 shadow-none focus-visible:ring-0"
            placeholder="Template name"
            value={local.name}
            onChange={(e) => setLocal({ ...local, name: e.target.value })}
          />
        </div>
        <Button
          size="sm"
          disabled={!dirty || saving}
          onClick={() => onSave(local)}
          className="gap-1.5"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save
        </Button>
      </div>

      <ScrollArea className="flex-1 w-full [&>[data-radix-scroll-area-viewport]>div]:!block">
        <div className="p-4 space-y-4 w-full">
          {/* Scope */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-mono uppercase text-muted-foreground">Scope</Label>
              <Select
                value={scopeMode}
                onValueChange={(v) => {
                  if (v === "category") setLocal({ ...local, fb_template_id: null, device_category: local.device_category || categories[0]?.name || "" });
                  else setLocal({ ...local, device_category: null, fb_template_id: fbTemplates[0]?.id || "" });
                }}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="category">Device Category</SelectItem>
                  <SelectItem value="fb">Specific FB Template</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-mono uppercase text-muted-foreground">
                {scopeMode === "category" ? "Category" : "FB Template"}
              </Label>
              {scopeMode === "category" ? (
                <Select
                  value={local.device_category ?? ""}
                  onValueChange={(v) => setLocal({ ...local, device_category: v })}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.name} value={c.name}>{c.display_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Select
                  value={local.fb_template_id ?? ""}
                  onValueChange={(v) => setLocal({ ...local, fb_template_id: v })}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {fbTemplates.map((fb) => (
                      <SelectItem key={fb.id} value={fb.id}>{fb.name} ({fb.device_category})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label className="text-xs font-mono uppercase text-muted-foreground">Description</Label>
            <Textarea
              className="text-sm resize-none"
              rows={2}
              placeholder="What does this test template verify?"
              value={local.description ?? ""}
              onChange={(e) => setLocal({ ...local, description: e.target.value })}
            />
          </div>

          {/* Test name */}
          <div className="space-y-1.5">
            <Label className="text-xs font-mono uppercase text-muted-foreground">Test Case Name (supports placeholders)</Label>
            <Input
              className="h-8 text-sm font-mono"
              placeholder="{device:name} FB — Auto Run and Stop"
              value={local.test_case.name}
              onChange={(e) => updateTestCase({ name: e.target.value })}
            />
          </div>

          {/* Placeholder help */}
          <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground space-y-0.5">
            <div className="font-mono font-semibold text-foreground/70 mb-1">Tag Placeholders</div>
            <div><code className="text-amber-400">{"{instanceDb}"}</code> — device instance DB name (e.g., InstFAN01)</div>
            <div><code className="text-amber-400">{"{io:TAG_NAME}"}</code> — physical IO tag from device signals</div>
            <div><code className="text-amber-400">{"{wiring:paramName}"}</code> — connected DB path from device wiring</div>
            <div><code className="text-amber-400">{"{config:paramName}"}</code> — config DB path (alias for wiring)</div>
            <div><code className="text-amber-400">{"{device:name}"}</code> — device display name</div>
            <div><code className="text-amber-400">{"{device:tag}"}</code> — device tag prefix</div>
          </div>

          {/* AI Suggestions */}
          {local.fb_template_id && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs font-mono uppercase text-muted-foreground">AI Suggestions</Label>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 h-7 text-xs"
                  onClick={handleSuggest}
                  disabled={suggesting || !linkedFb}
                >
                  {suggesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  {suggesting ? "Analysing FB..." : "Suggest Tests"}
                </Button>
              </div>
              {suggestError && (
                <div className="text-xs text-red-400">{suggestError}</div>
              )}
              {suggestions && suggestions.length > 0 && (
                <div className="space-y-1.5 rounded-md border border-border/50 bg-muted/20 p-3">
                  <div className="text-xs text-muted-foreground mb-2">{suggestions.length} suggested tests — select one to generate the full procedure</div>
                  {suggestions.map((sug) => (
                    <div
                      key={sug.id}
                      className="flex items-center gap-2 rounded-md border border-border/30 bg-card px-3 py-2 hover:border-amber-500/30 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{sug.name}</div>
                        <div className="text-xs text-muted-foreground">{sug.description}</div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 h-7 text-xs shrink-0"
                        disabled={generating}
                        onClick={() => handlePickSuggestion(sug)}
                      >
                        {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                        Generate
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {suggestions && suggestions.length === 0 && (
                <div className="text-xs text-muted-foreground">No suggestions for this FB.</div>
              )}
            </div>
          )}

          {/* Steps */}
          <div className="space-y-2">
            <Label className="text-xs font-mono uppercase text-muted-foreground">Test Steps</Label>
            {local.test_case.steps.map((step) => (
              <StepEditor
                key={step.id}
                step={step}
                onUpdate={(updated) => updateStep(step.id, updated)}
                onDelete={() => deleteStep(step.id)}
              />
            ))}
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5 border-dashed text-xs"
              onClick={addStep}
            >
              <Plus className="h-3 w-3" /> Add Step
            </Button>
          </div>

          {/* Delete template */}
          <div className="pt-4 border-t">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" className="gap-1.5">
                  <Trash2 className="h-3 w-3" /> Delete Template
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this template?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete "{local.name}".
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TestTemplatesPage() {
  const { data: templates, isLoading } = usePlcsimTestTemplates();
  const { data: categories } = useFbDeviceCategories();
  const { data: fbTemplates } = useFbTemplates();
  const createMutation = useCreatePlcsimTestTemplate();
  const updateMutation = useUpdatePlcsimTestTemplate();
  const deleteMutation = useDeletePlcsimTestTemplate();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = templates?.find((t) => t.id === selectedId) ?? null;

  const categoryList = useMemo(
    () => (categories ?? []).map((c) => ({ name: c.name, display_name: c.display_name })),
    [categories],
  );

  const fbList = useMemo(
    () =>
      (fbTemplates ?? []).map((fb) => ({
        id: fb.id,
        name: fb.name,
        device_category: fb.device_category,
      })),
    [fbTemplates],
  );

  async function handleCreate() {
    const input: PlcsimTestTemplateCreate = {
      name: "New Test Template",
      device_category: categoryList[0]?.name ?? "Motor",
      fb_template_id: null,
      description: null,
      test_case: createEmptyTestCase(),
      tag_mappings: [],
    };
    const result = await createMutation.mutateAsync(input);
    setSelectedId(result.id);
  }

  async function handleSave(updates: Partial<PlcsimTestTemplate>) {
    if (!selectedId) return;
    await updateMutation.mutateAsync({
      id: selectedId,
      update: {
        name: updates.name,
        device_category: updates.device_category,
        fb_template_id: updates.fb_template_id,
        description: updates.description,
        test_case: updates.test_case,
        tag_mappings: updates.tag_mappings,
      },
    });
  }

  function handleDelete() {
    if (!selectedId) return;
    deleteMutation.mutate(selectedId);
    setSelectedId(null);
  }

  // Group templates by category/FB
  const grouped = useMemo(() => {
    const groups = new Map<string, PlcsimTestTemplate[]>();
    for (const t of templates ?? []) {
      const key = t.fb_template_name
        ? `FB: ${t.fb_template_name}`
        : t.device_category ?? "Uncategorized";
      const arr = groups.get(key) ?? [];
      arr.push(t);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [templates]);

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <FlaskConical className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Test Templates</h1>
        <span className="text-sm text-muted-foreground">
          Reusable PLCSIM test procedures per device type or FB
        </span>
        <div className="flex-1" />
        <Button size="sm" className="gap-1.5" onClick={handleCreate} disabled={createMutation.isPending}>
          {createMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          New Template
        </Button>
      </div>

      {/* Content */}
      <div className="flex flex-1 gap-4 min-h-0">
        {/* Left: template list */}
        <Card className="w-80 shrink-0">
          <ScrollArea className="h-full">
            <div className="p-2 space-y-2">
              {isLoading && (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              )}
              {grouped.map(([group, items]) => (
                <div key={group}>
                  <div className="px-2 py-1 text-xs font-mono uppercase tracking-wider text-muted-foreground/50">
                    {group}
                  </div>
                  <div className="space-y-0.5">
                    {items.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setSelectedId(t.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                          selectedId === t.id
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-muted/50",
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="truncate font-medium">{t.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {t.test_case.steps.length} steps · {t.test_case.steps.reduce((n, s) => n + s.actions.length, 0)} actions
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {!isLoading && templates?.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No test templates yet. Click "New Template" to create one.
                </div>
              )}
            </div>
          </ScrollArea>
        </Card>

        {/* Right: editor */}
        <Card className="flex-1 min-w-0">
          {selected ? (
            <TemplateEditor
              key={selected.id}
              template={selected}
              categories={categoryList}
              fbTemplates={fbList}
              onSave={handleSave}
              onDelete={handleDelete}
              saving={updateMutation.isPending}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a template or create a new one
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
