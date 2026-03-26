import { useState, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import {
  ArrowLeft,
  Save,
  Loader2,
  FileText,
  FolderTree,
  Workflow,
  Blocks,
  AlertTriangle,
  Cable,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
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
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type {
  FolderRulesSchema,
  GeneralRulesSchema,
  FbRulesSchema,
  ProcessRulesSchema,
  StructuredRule,
  RuleBlockTarget,
  RuleStrength,
  StepActionDbRules,
  FbInterfaceRules,
} from "@/types/design-profile";
import {
  parseGeneralRules,
  parseFbRules,
  parseProcessRules,
  serializeGeneralRules,
  serializeFbRules,
  serializeProcessRules,
  makeRule,
} from "@/lib/design-profile-schemas";
import {
  useDesignProfile,
  useUpdateDesignProfile,
} from "@/hooks/use-design-profiles";
import { useActivePromptSections } from "@/hooks/use-prompt-sections";
import { resolveSection } from "@/lib/prompt-defaults";
import { detectConflicts } from "@/lib/conflict-detector";
import type { KnowledgeConflict } from "@/lib/conflict-detector";

type Tab = "general" | "folders" | "io_linking" | "process" | "fb";

const TABS: { key: Tab; label: string; icon: typeof FileText }[] = [
  { key: "general", label: "General", icon: FileText },
  { key: "folders", label: "Folders", icon: FolderTree },
  { key: "io_linking", label: "IO Linking", icon: Cable },
  { key: "process", label: "Process", icon: Workflow },
  { key: "fb", label: "FB", icon: Blocks },
];

const DEFAULT_FOLDER_SCHEMA: FolderRulesSchema = {
  version: 2,
  pattern: 'section_per_area',
  shared_device_group: true,
  device_group_name: 'DEVICE',
  device_subfolders: { fbs: 'FB', dbs: 'DB', call_fcs_at_root: true },
  section_groups: [],
  other_root_groups: ['OB', 'IO_MAPPING', 'DATA_MGMT', 'SAFETY', 'SYS'],
  call_fc_rules: {
    one_fc_per_device_type: true,
    one_network_per_instance: true,
    networks_contain_wiring_only: true,
  },
  custom_notes: '',
};

function parseFolderSchema(raw: string | null | undefined): FolderRulesSchema {
  if (!raw?.trim()) return { ...DEFAULT_FOLDER_SCHEMA };
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version === 2) return parsed as FolderRulesSchema;
  } catch { /* fall through */ }
  // Legacy freetext — return default, preserve text in custom_notes
  return { ...DEFAULT_FOLDER_SCHEMA, custom_notes: raw };
}

function FolderGroupEditor({
  label, hint, values, onChange,
}: {
  label: string;
  hint: string;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const [input, setInput] = useState('');
  return (
    <div className="space-y-2">
      <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      <div className="flex flex-wrap gap-1 min-h-[28px]">
        {values.map(v => (
          <Badge key={v} variant="secondary" className="font-mono text-xs gap-1">
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter(x => x !== v))}
              className="hover:text-destructive"
            >×</button>
          </Badge>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={e => setInput(e.target.value.toUpperCase())}
          onKeyDown={e => {
            if (e.key === 'Enter' && input.trim()) {
              e.preventDefault();
              if (!values.includes(input.trim())) onChange([...values, input.trim()]);
              setInput('');
            }
          }}
          placeholder={hint}
          className="font-mono text-xs"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            if (input.trim() && !values.includes(input.trim())) {
              onChange([...values, input.trim()]);
              setInput('');
            }
          }}
        >Add</Button>
      </div>
    </div>
  );
}

export default function ProfileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: profile, isLoading } = useDesignProfile(id);
  const updateProfile = useUpdateDesignProfile();
  const { data: promptSections } = useActivePromptSections();

  const [tab, setTab] = useState<Tab>("general");
  const [dirty, setDirty] = useState(false);

  // Local form state — initialized from profile
  const [generalSchema, setGeneralSchema] = useState<GeneralRulesSchema | null>(null);
  const [fbSchema, setFbSchema] = useState<FbRulesSchema | null>(null);
  const [processSchema, setProcessSchema] = useState<ProcessRulesSchema | null>(null);
  const [folderRules, setFolderRules] = useState<string | null>(null);
  const [ioLinkingRules, setIoLinkingRules] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);

  // Initialize schema state from profile when it loads
  useEffect(() => {
    if (!profile) return;
    if (!generalSchema) setGeneralSchema(parseGeneralRules(profile.general_rules));
    if (!fbSchema) setFbSchema(parseFbRules(profile.fb_rules as string));
    if (!processSchema) setProcessSchema(parseProcessRules(profile.process_rules as string));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on profile load
  }, [profile]);

  // Conflict detection
  const [conflicts, setConflicts] = useState<KnowledgeConflict[]>([]);
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);

  // Resolve current values (local edits or profile data)
  const currentName = name ?? profile?.name ?? "";
  const currentClientName = clientName ?? profile?.client_name ?? "";
  const currentGeneralRules = generalSchema ? serializeGeneralRules(generalSchema) : (profile?.general_rules ?? "");
  const currentFolderRules = folderRules ?? profile?.folder_rules ?? "";
  const currentIoLinkingRules = ioLinkingRules ?? profile?.io_linking_rules ?? "";

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
          process_rules: processSchema ? serializeProcessRules(processSchema) : '[]',
          fb_rules: fbSchema ? serializeFbRules(fbSchema) : '[]',
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
              false,
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {tab === "general" && (
            <GeneralTab
              schema={generalSchema}
              clientName={currentClientName}
              profile={profile}
              onSchemaChange={(v) => { setGeneralSchema(v); markDirty(); }}
              onClientNameChange={(v) => { setClientName(v); markDirty(); }}
              onLanguageChange={(field, value) => {
                if (!profile) return;
                updateProfile.mutate({ id: profile.id, updates: { [field]: value } });
              }}
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
            <ProcessTab
              schema={processSchema}
              onSchemaChange={(v) => { setProcessSchema(v); markDirty(); }}
            />
          )}
          {tab === "fb" && (
            <FbTab
              schema={fbSchema}
              onSchemaChange={(v) => { setFbSchema(v); markDirty(); }}
            />
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
  schema,
  clientName,
  profile,
  onSchemaChange,
  onClientNameChange,
  onLanguageChange,
}: {
  schema: GeneralRulesSchema | null;
  clientName: string;
  profile: import("@/types").DesignProfile | undefined;
  onSchemaChange: (v: GeneralRulesSchema) => void;
  onClientNameChange: (v: string) => void;
  onLanguageChange: (field: string, value: string) => void;
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

      {/* Language defaults */}
      {profile && (
        <div>
          <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">
            Language Defaults
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            These are used as defaults in the project wizard. Engineers can still override per session.
          </p>
          <div className="grid grid-cols-4 gap-3">
            {([
              { field: 'device_fb_language' as const, label: 'Device FB language' },
              { field: 'device_call_fc_language' as const, label: 'Call FC language' },
              { field: 'io_linking_language' as const, label: 'IO linking FC language' },
              { field: 'process_code_language' as const, label: 'Process code language' },
            ]).map(({ field, label }) => (
              <div key={field} className="space-y-1">
                <Label className="text-xs text-muted-foreground">{label}</Label>
                <Select
                  value={profile[field] ?? 'SCL'}
                  onValueChange={v => onLanguageChange(field, v)}
                >
                  <SelectTrigger className="font-mono text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SCL">SCL</SelectItem>
                    <SelectItem value="LAD">LAD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>
      )}

      <Separator />

      {schema && (
        <div className="space-y-6">
          {/* Naming */}
          <div>
            <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">
              Naming
            </h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {([
                { key: 'fb_prefix' as const, label: 'FB prefix', placeholder: 'e.g. MOTOR_FB or FB_CK_' },
                { key: 'fc_prefix' as const, label: 'FC prefix', placeholder: 'e.g. CALL_' },
                { key: 'db_prefix' as const, label: 'DB prefix', placeholder: 'e.g. DB_' },
                { key: 'udt_prefix' as const, label: 'UDT prefix', placeholder: 'e.g. type' },
                { key: 'instance_db_prefix' as const, label: 'Instance DB prefix', placeholder: 'e.g. Inst' },
                { key: 'static_var_prefix' as const, label: 'Static var prefix', placeholder: 'e.g. stat' },
                { key: 'temp_var_prefix' as const, label: 'Temp var prefix', placeholder: 'e.g. temp' },
                { key: 'instance_var_prefix' as const, label: 'Instance var prefix', placeholder: 'e.g. inst' },
              ]).map(({ key, label, placeholder }) => (
                <div key={key} className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{label}</Label>
                  <Input
                    value={schema.naming[key]}
                    onChange={e => onSchemaChange({
                      ...schema, naming: { ...schema.naming, [key]: e.target.value }
                    })}
                    placeholder={placeholder}
                    className="font-mono text-xs"
                  />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Block name casing</Label>
                <Select
                  value={schema.naming.block_name_casing}
                  onValueChange={v => onSchemaChange({
                    ...schema, naming: { ...schema.naming, block_name_casing: v as GeneralRulesSchema['naming']['block_name_casing'] }
                  })}
                >
                  <SelectTrigger className="font-mono text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UPPER_SNAKE_CASE">UPPER_SNAKE_CASE</SelectItem>
                    <SelectItem value="UpperCamelCase">UpperCamelCase</SelectItem>
                    <SelectItem value="custom">Custom (see notes)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Parameter casing</Label>
                <Select
                  value={schema.naming.param_casing}
                  onValueChange={v => onSchemaChange({
                    ...schema, naming: { ...schema.naming, param_casing: v as GeneralRulesSchema['naming']['param_casing'] }
                  })}
                >
                  <SelectTrigger className="font-mono text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lowerCamelCase">lowerCamelCase</SelectItem>
                    <SelectItem value="custom">Custom (see notes)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-3 space-y-1">
              <Label className="text-xs text-muted-foreground">Naming notes</Label>
              <Textarea
                value={schema.naming.custom_notes}
                onChange={e => onSchemaChange({
                  ...schema, naming: { ...schema.naming, custom_notes: e.target.value }
                })}
                placeholder="Additional naming conventions not covered above..."
                className="font-mono text-xs min-h-[60px]"
              />
            </div>
          </div>

          <Separator />

          {/* State Machine */}
          <div>
            <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">
              State Machine
            </h3>
            <div className="grid grid-cols-3 gap-3">
              {([
                { key: 'step_start' as const, label: 'First step value' },
                { key: 'step_increment' as const, label: 'Step increment' },
                { key: 'fault_step' as const, label: 'Fault step value' },
              ]).map(({ key, label }) => (
                <div key={key} className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{label}</Label>
                  <Input
                    type="number"
                    value={schema.state_machine[key]}
                    onChange={e => onSchemaChange({
                      ...schema, state_machine: { ...schema.state_machine, [key]: parseInt(e.target.value) || 0 }
                    })}
                    className="font-mono text-xs"
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-3">
              <Label className="text-xs text-muted-foreground">CASE always requires ELSE branch</Label>
              <Switch
                checked={schema.state_machine.always_has_else}
                onCheckedChange={v => onSchemaChange({
                  ...schema, state_machine: { ...schema.state_machine, always_has_else: v }
                })}
              />
            </div>
            {schema.state_machine.always_has_else && (
              <div className="mt-2 space-y-1">
                <Label className="text-xs text-muted-foreground">ELSE action</Label>
                <Input
                  value={schema.state_machine.else_action}
                  onChange={e => onSchemaChange({
                    ...schema, state_machine: { ...schema.state_machine, else_action: e.target.value }
                  })}
                  placeholder="e.g. set fault step and status 16#8600"
                  className="font-mono text-xs"
                />
              </div>
            )}
            <div className="mt-3 space-y-1">
              <Label className="text-xs text-muted-foreground">State machine notes</Label>
              <Textarea
                value={schema.state_machine.custom_notes}
                onChange={e => onSchemaChange({
                  ...schema, state_machine: { ...schema.state_machine, custom_notes: e.target.value }
                })}
                placeholder="Additional state machine conventions..."
                className="font-mono text-xs min-h-[60px]"
              />
            </div>
          </div>

          <Separator />

          <ExtraRulesEditor
            rules={schema.extra_rules}
            onChange={v => onSchemaChange({ ...schema, extra_rules: v })}
          />

          <Separator />

          {/* Freetext escape hatch */}
          <div className="space-y-1">
            <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Additional Rules (freetext)
            </Label>
            <Textarea
              value={schema.freetext}
              onChange={e => onSchemaChange({ ...schema, freetext: e.target.value })}
              placeholder="Any additional general rules not covered by the structured fields above..."
              className="font-mono text-xs min-h-[100px]"
            />
          </div>
        </div>
      )}
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
  const [folderSchema, setFolderSchema] = useState<FolderRulesSchema>(() => parseFolderSchema(rules));
  const [showRawFolderJson, setShowRawFolderJson] = useState(false);
  const initialRender = useRef(true);

  // Sync schema changes back to the string field used by save
  useEffect(() => {
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }
    onChange(JSON.stringify(folderSchema, null, 2));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only sync when schema changes
  }, [folderSchema]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-mono text-sm font-semibold">Folder Rules</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Define how TIA Portal program groups and folders should be structured.
          These rules are applied when creating project structure.
        </p>
      </div>

      <div className="space-y-6">
        {/* Pattern */}
        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Folder Pattern
          </Label>
          <Select
            value={folderSchema.pattern}
            onValueChange={v => setFolderSchema(s => ({
              ...s, pattern: v as FolderRulesSchema['pattern']
            }))}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="section_per_area">Section per area</SelectItem>
              <SelectItem value="flat">Flat (no sections)</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Shared device group */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Shared Device Group
            </Label>
            <Switch
              checked={folderSchema.shared_device_group}
              onCheckedChange={v => setFolderSchema(s => ({ ...s, shared_device_group: v }))}
            />
          </div>
          {folderSchema.shared_device_group && (
            <div className="space-y-3 pl-3 border-l border-border">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Group name</Label>
                <Input
                  value={folderSchema.device_group_name}
                  onChange={e => setFolderSchema(s => ({ ...s, device_group_name: e.target.value }))}
                  placeholder="DEVICE"
                  className="font-mono text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">FB subfolder</Label>
                  <Input
                    value={folderSchema.device_subfolders.fbs}
                    onChange={e => setFolderSchema(s => ({
                      ...s, device_subfolders: { ...s.device_subfolders, fbs: e.target.value }
                    }))}
                    placeholder="FB"
                    className="font-mono text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">DB subfolder</Label>
                  <Input
                    value={folderSchema.device_subfolders.dbs}
                    onChange={e => setFolderSchema(s => ({
                      ...s, device_subfolders: { ...s.device_subfolders, dbs: e.target.value }
                    }))}
                    placeholder="DB"
                    className="font-mono text-sm"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Call FCs at group root (not in subfolder)</Label>
                <Switch
                  checked={folderSchema.device_subfolders.call_fcs_at_root}
                  onCheckedChange={v => setFolderSchema(s => ({
                    ...s, device_subfolders: { ...s.device_subfolders, call_fcs_at_root: v }
                  }))}
                />
              </div>
            </div>
          )}
        </div>

        {/* Call FC rules */}
        <div className="space-y-3">
          <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Call FC Rules
          </Label>
          {([
            { key: 'one_fc_per_device_type' as const, label: 'One FC per device type' },
            { key: 'one_network_per_instance' as const, label: 'One network per device instance' },
            { key: 'networks_contain_wiring_only' as const, label: 'Networks contain wiring only (no logic)' },
          ]).map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">{label}</Label>
              <Switch
                checked={folderSchema.call_fc_rules[key]}
                onCheckedChange={v => setFolderSchema(s => ({
                  ...s, call_fc_rules: { ...s.call_fc_rules, [key]: v }
                }))}
              />
            </div>
          ))}
        </div>

        {/* Section groups */}
        <FolderGroupEditor
          label="Section Groups"
          hint="e.g. CONVEYORS, ELEVATORS, SAFETY"
          values={folderSchema.section_groups}
          onChange={v => setFolderSchema(s => ({ ...s, section_groups: v }))}
        />

        {/* Other root groups */}
        <FolderGroupEditor
          label="Other Root Groups"
          hint="e.g. OB, IO_MAPPING, DATA_MGMT, SYS"
          values={folderSchema.other_root_groups}
          onChange={v => setFolderSchema(s => ({ ...s, other_root_groups: v }))}
        />

        {/* Custom notes */}
        <div className="space-y-1">
          <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Custom Notes
          </Label>
          <Textarea
            value={folderSchema.custom_notes}
            onChange={e => setFolderSchema(s => ({ ...s, custom_notes: e.target.value }))}
            placeholder="Any additional folder/structure rules not covered above..."
            className="font-mono text-xs min-h-[80px]"
          />
        </div>

        {/* Raw JSON toggle */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setShowRawFolderJson(v => !v)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showRawFolderJson ? 'Hide' : 'Show'} raw JSON
          </button>
          {showRawFolderJson && (
            <Textarea
              value={JSON.stringify(folderSchema, null, 2)}
              onChange={e => {
                try {
                  const parsed = JSON.parse(e.target.value);
                  if (parsed?.version === 2) setFolderSchema(parsed);
                } catch { /* ignore invalid JSON while typing */ }
              }}
              className="font-mono text-xs mt-2 min-h-[200px]"
            />
          )}
        </div>
      </div>
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

// ─── FB Tab ────────────────────────────────────────────────────────────────

function FbTab({
  schema,
  onSchemaChange,
}: {
  schema: FbRulesSchema | null;
  onSchemaChange: (v: FbRulesSchema) => void;
}) {
  if (!schema) return null;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-mono text-sm font-semibold">Function Block Rules</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Define interface patterns, alarm handling, and FB-specific code conventions.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Interface pattern */}
        <div>
          <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">
            Interface Pattern
          </h3>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">PLCopen pattern</Label>
              <Select
                value={schema.interface_pattern.pattern}
                onValueChange={v => onSchemaChange({
                  ...schema, interface_pattern: { ...schema.interface_pattern, pattern: v as FbInterfaceRules['pattern'] }
                })}
              >
                <SelectTrigger className="font-mono text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="plcopen_enable">Enable (level-triggered, device FBs)</SelectItem>
                  <SelectItem value="plcopen_execute">Execute (edge-triggered, one-shot commands)</SelectItem>
                  <SelectItem value="custom">Custom (see notes)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Status word initial value</Label>
              <Input
                value={schema.interface_pattern.status_initial_value}
                onChange={e => onSchemaChange({
                  ...schema, interface_pattern: { ...schema.interface_pattern, status_initial_value: e.target.value }
                })}
                placeholder="16#7000"
                className="font-mono text-xs w-32"
              />
            </div>
            {(['include_busy', 'include_done', 'include_error', 'include_status'] as const).map(key => (
              <div key={key} className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">
                  {key === 'include_busy' && 'Include "busy : Bool" output'}
                  {key === 'include_done' && 'Include "done : Bool" output'}
                  {key === 'include_error' && 'Include "error : Bool" output'}
                  {key === 'include_status' && 'Include "status : Word" output'}
                </Label>
                <Switch
                  checked={schema.interface_pattern[key]}
                  onCheckedChange={v => onSchemaChange({
                    ...schema, interface_pattern: { ...schema.interface_pattern, [key]: v }
                  })}
                />
              </div>
            ))}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Interface notes</Label>
              <Textarea
                value={schema.interface_pattern.custom_notes}
                onChange={e => onSchemaChange({
                  ...schema, interface_pattern: { ...schema.interface_pattern, custom_notes: e.target.value }
                })}
                className="font-mono text-xs min-h-[60px]"
                placeholder="Additional interface rules..."
              />
            </div>
          </div>
        </div>

        {/* Alarm handling */}
        <div>
          <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">
            Alarm Handling
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Alarms latch (require explicit reset)</Label>
              <Switch
                checked={schema.alarm_handling.latching}
                onCheckedChange={v => onSchemaChange({
                  ...schema, alarm_handling: { ...schema.alarm_handling, latching: v }
                })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Reset via VAR_INPUT</Label>
              <Switch
                checked={schema.alarm_handling.reset_via_input}
                onCheckedChange={v => onSchemaChange({
                  ...schema, alarm_handling: { ...schema.alarm_handling, reset_via_input: v }
                })}
              />
            </div>
            {schema.alarm_handling.reset_via_input && (
              <div className="space-y-1 pl-3 border-l border-border">
                <Label className="text-xs text-muted-foreground">Reset input name</Label>
                <Input
                  value={schema.alarm_handling.reset_input_name}
                  onChange={e => onSchemaChange({
                    ...schema, alarm_handling: { ...schema.alarm_handling, reset_input_name: e.target.value }
                  })}
                  placeholder="resetAlarms"
                  className="font-mono text-xs w-48"
                />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Alarm notes</Label>
              <Textarea
                value={schema.alarm_handling.custom_notes}
                onChange={e => onSchemaChange({
                  ...schema, alarm_handling: { ...schema.alarm_handling, custom_notes: e.target.value }
                })}
                className="font-mono text-xs min-h-[60px]"
                placeholder="Additional alarm handling rules..."
              />
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <Separator className="mb-4" />
          <ExtraRulesEditor
            rules={schema.extra_rules}
            onChange={v => onSchemaChange({ ...schema, extra_rules: v })}
          />
        </div>
        <div className="lg:col-span-2">
          <Separator className="mb-4" />
          <div className="space-y-1">
            <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Additional Rules (freetext)
            </Label>
            <Textarea
              value={schema.freetext}
              onChange={e => onSchemaChange({ ...schema, freetext: e.target.value })}
              placeholder="Any additional FB rules not covered above..."
              className="font-mono text-xs min-h-[100px]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Process Tab ────────────────────────────────────────────────────────────

function ProcessTab({
  schema,
  onSchemaChange,
}: {
  schema: ProcessRulesSchema | null;
  onSchemaChange: (v: ProcessRulesSchema) => void;
}) {
  if (!schema) return null;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-mono text-sm font-semibold">Process Rules</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Define step/action DB patterns, sequence structure, and process-specific conventions.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Step/Action DB pattern */}
        <div>
          <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">
            Step / Action DB Pattern
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">
                Use step/action DB pattern
              </Label>
              <Switch
                checked={schema.step_action_db.enabled}
                onCheckedChange={v => onSchemaChange({
                  ...schema, step_action_db: { ...schema.step_action_db, enabled: v }
                })}
              />
            </div>
            {schema.step_action_db.enabled && (
              <div className="space-y-3 pl-3 border-l border-border">
                {([
                  { key: 'db_name_pattern' as const, label: 'DB name pattern', placeholder: 'STEPS_ACTIONS_{SECTION}_DB' },
                  { key: 'step_array_name' as const, label: 'Step array name', placeholder: 'AS' },
                  { key: 'action_array_name' as const, label: 'Action array name', placeholder: 'AA' },
                ] satisfies { key: keyof StepActionDbRules; label: string; placeholder: string }[]).map(({ key, label, placeholder }) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{label}</Label>
                    <Input
                      value={schema.step_action_db[key] as string}
                      onChange={e => onSchemaChange({
                        ...schema, step_action_db: { ...schema.step_action_db, [key]: e.target.value }
                      })}
                      placeholder={placeholder}
                      className="font-mono text-xs"
                    />
                  </div>
                ))}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Step/action DB notes</Label>
                  <Textarea
                    value={schema.step_action_db.custom_notes}
                    onChange={e => onSchemaChange({
                      ...schema, step_action_db: { ...schema.step_action_db, custom_notes: e.target.value }
                    })}
                    className="font-mono text-xs min-h-[60px]"
                    placeholder="Structure details, array sizing, access patterns..."
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sequence structure */}
        <div>
          <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">
            Sequence Structure
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">
                Safety contacts inline in step transition rung
              </Label>
              <Switch
                checked={schema.sequence_structure.safety_inline}
                onCheckedChange={v => onSchemaChange({
                  ...schema, sequence_structure: { ...schema.sequence_structure, safety_inline: v }
                })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">
                Permissive conditions checked in first network
              </Label>
              <Switch
                checked={schema.sequence_structure.permissives_as_first_rung}
                onCheckedChange={v => onSchemaChange({
                  ...schema, sequence_structure: { ...schema.sequence_structure, permissives_as_first_rung: v }
                })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Sequence notes</Label>
              <Textarea
                value={schema.sequence_structure.custom_notes}
                onChange={e => onSchemaChange({
                  ...schema, sequence_structure: { ...schema.sequence_structure, custom_notes: e.target.value }
                })}
                className="font-mono text-xs min-h-[60px]"
                placeholder="Management FC pattern, how steps drive outputs..."
              />
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <Separator className="mb-4" />
          <ExtraRulesEditor
            rules={schema.extra_rules}
            onChange={v => onSchemaChange({ ...schema, extra_rules: v })}
          />
        </div>
        <div className="lg:col-span-2">
          <Separator className="mb-4" />
          <div className="space-y-1">
            <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Additional Rules (freetext)
            </Label>
            <Textarea
              value={schema.freetext}
              onChange={e => onSchemaChange({ ...schema, freetext: e.target.value })}
              placeholder="Any additional process rules not covered above..."
              className="font-mono text-xs min-h-[100px]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Extra Rules Editor ─────────────────────────────────────────────────────

const RULE_TARGETS: RuleBlockTarget[] = ['ALL','FB','FC','OB','DB','UDT','CALL_FC','PROCESS_FC','DEVICE_FB'];
const RULE_STRENGTHS: RuleStrength[] = ['MUST','MUST NOT','SHOULD','SHOULD NOT'];

function ExtraRulesEditor({
  rules,
  onChange,
}: {
  rules: StructuredRule[];
  onChange: (rules: StructuredRule[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<StructuredRule>>({
    category: '', target: 'ALL', strength: 'MUST', statement: '', example: '', enabled: true,
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Extra Rules
        </Label>
        <Button size="sm" variant="outline" onClick={() => setAdding(v => !v)}>
          {adding ? 'Cancel' : '+ Add rule'}
        </Button>
      </div>

      {rules.map(rule => (
        <div key={rule.id} className="flex items-start gap-2 p-2 rounded border border-border bg-muted/30">
          <Switch
            checked={rule.enabled}
            onCheckedChange={v => onChange(rules.map(r => r.id === rule.id ? { ...r, enabled: v } : r))}
            className="mt-0.5 shrink-0"
          />
          <div className="flex-1 min-w-0">
            <p className="font-mono text-xs">
              <span className="text-primary">RULE: {rule.category}</span>
              {' — '}
              <span className="text-muted-foreground">{rule.target}</span>
              {' '}
              <span className="font-semibold">{rule.strength}</span>
              {' '}
              {rule.statement}
            </p>
            {rule.example && (
              <pre className="mt-1 text-[10px] text-muted-foreground whitespace-pre-wrap">{rule.example}</pre>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 text-destructive hover:text-destructive"
            onClick={() => onChange(rules.filter(r => r.id !== rule.id))}
          >×</Button>
        </div>
      ))}

      {adding && (
        <div className="p-3 rounded border border-border space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Category</Label>
              <Input
                value={draft.category ?? ''}
                onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}
                placeholder="e.g. Naming"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Target</Label>
              <Select
                value={draft.target ?? 'ALL'}
                onValueChange={v => setDraft(d => ({ ...d, target: v as RuleBlockTarget }))}
              >
                <SelectTrigger className="font-mono text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RULE_TARGETS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Strength</Label>
              <Select
                value={draft.strength ?? 'MUST'}
                onValueChange={v => setDraft(d => ({ ...d, strength: v as RuleStrength }))}
              >
                <SelectTrigger className="font-mono text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RULE_STRENGTHS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Statement</Label>
            <Input
              value={draft.statement ?? ''}
              onChange={e => setDraft(d => ({ ...d, statement: e.target.value }))}
              placeholder="use the UPPER_SNAKE_CASE naming convention for all block names"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Example (optional SCL/LAD snippet)</Label>
            <Textarea
              value={draft.example ?? ''}
              onChange={e => setDraft(d => ({ ...d, example: e.target.value }))}
              className="font-mono text-xs min-h-[60px]"
              placeholder="MOTOR_FB, SENSOR_FB, SOLENOID_2SEN_FB"
            />
          </div>
          <Button
            size="sm"
            onClick={() => {
              if (!draft.category?.trim() || !draft.statement?.trim()) return;
              onChange([...rules, makeRule(
                draft.category!, draft.target ?? 'ALL',
                draft.strength ?? 'MUST', draft.statement!, draft.example,
              )]);
              setDraft({ category: '', target: 'ALL', strength: 'MUST', statement: '', example: '', enabled: true });
              setAdding(false);
            }}
          >
            Add rule
          </Button>
        </div>
      )}
    </div>
  );
}
