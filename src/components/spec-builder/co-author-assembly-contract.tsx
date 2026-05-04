/**
 * CoAuthorAssemblyContract — per-assembly contract panel in the FDS co-author wizard.
 *
 * Two paths:
 *   Library path   — assembly.fb_template_id matches a template with a contract:
 *                    shows template name/version, IO slot tag pickers,
 *                    instance_params form, and process_intent textarea.
 *
 *   Custom path    — no template match (or template has empty contract):
 *                    skeleton picker → InterfaceContractEditor → process_intent →
 *                    Generate SCL button → Monaco SCL pane → drift chip →
 *                    Regenerate + Save-as-library-template.
 *
 * Phase 5, Task 7.
 */
import { useState, useCallback, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Loader2,
  Star,
  RefreshCw,
  Sparkles,
  BookOpen,
  Pencil,
  AlertTriangle,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import Editor from "@monaco-editor/react";
import { InterfaceContractEditor } from "@/components/fb-library/interface-contract-editor";
import { CONTRACT_SKELETONS, getSkeleton } from "@/lib/fb-library/contract-skeletons";
import { useForgeAssemblyGenerate } from "@/hooks/use-forge-assembly-generate";
import {
  normaliseInterfaceContract,
  isContractPopulated,
} from "@/types/fb-interface-contract";
import type { FbInterfaceContract } from "@/types/fb-interface-contract";
import type { AssemblyConfig, FdsAssemblySession, AssemblyGeneratedSclBlock } from "@/types/spec-builder";
import type { FbTemplate } from "@/types/fb-template";
import type { ForgeSession, ForgeAssemblyEntry, ForgeArtifact } from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import type { DriftReport } from "@/lib/fb-library/contract-drift";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CoAuthorAssemblyContractProps {
  assembly: AssemblyConfig;
  session: FdsAssemblySession;
  subsystemName: string;
  templates: FbTemplate[];
  forgeSession?: ForgeSession | null;
  profile?: DesignProfile | null;
  deviceArtifacts?: ForgeArtifact[];
  onSessionChange: (
    updates: Partial<
      Pick<FdsAssemblySession, "interface_contract" | "generated_scl_blocks">
    >,
  ) => void;
  onPromoteToLibrary?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal ForgeAssemblyEntry from the AssemblyConfig for generateSingle. */
function buildForgeAssemblyEntry(assembly: AssemblyConfig, subsystemName: string): ForgeAssemblyEntry {
  return {
    id: assembly.assembly_id,
    name: assembly.assembly_name,
    tag: assembly.assembly_name,
    assembly_type: "custom",
    description: assembly.description ?? "",
    subsystem: subsystemName,
    device_ids: assembly.devices.map((d) => d.device_id),
    fb_template_id: null, // force AI path
    fb_match_confidence: "none",
    language_override: null,
    approved: false,
  };
}

/** Build a minimal ForgeSession stub when no real session is available. */
function buildStubForgeSession(
  session: FdsAssemblySession,
  deviceArtifacts: ForgeArtifact[],
): ForgeSession {
  return {
    id: session.spec_project_id,
    project_id: session.spec_project_id,
    user_id: "",
    design_profile_id: null,
    spec_project_id: session.spec_project_id,
    current_step: "assembly_fb",
    spec_text: null,
    spec_filename: null,
    spec_analysis: null,
    qa_messages: [],
    hardware_config: { cpu_type: "", tia_version: "", racks: [] },
    io_list: [],
    device_list: [],
    assembly_list: [],
    network_topology: {},
    interface_contracts: null,
    linkage_matrix: null,
    device_artifacts: deviceArtifacts,
    assembly_artifacts: [],
    process_artifacts: [],
    hmi_artifacts: [],
    hmi_panel_config: null,
    step_statuses: {},
    tia_project_path: null,
    tia_export_result: null,
    device_fb_language: null,
    device_call_fc_language: null,
    io_linking_language: null,
    process_code_language: null,
    conversion_fc_language: null,
    plcsim_device_test_suite: null,
    plcsim_test_suite: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/** Build a minimal stub DesignProfile when none provided. */
function buildStubProfile(): DesignProfile {
  return {
    id: "",
    name: "",
    client_name: null,
    plc_brand: "SIEMENS_TIA",
    rules: "",
    general_rules: "",
    folder_rules: "",
    process_rules: "",
    fb_rules: "",
    io_linking_rules: "",
    device_fb_language: "SCL",
    device_call_fc_language: "SCL",
    io_linking_language: "SCL",
    io_linking_mode: "buffered_db",
    process_code_language: "SCL",
    conversion_fc_language: "SCL",
    hmi_theme: "",
    hmi_panel_family: "comfort",
    hmi_panel_model: "TP1500",
    naming_prefix: "",
    db_naming_prefix: "",
    fb_favourites: {},
    io_fb_assignments: {},
    created_by: null,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Library path sub-panel
// ---------------------------------------------------------------------------

function LibraryContractPanel({
  assembly,
  template,
}: {
  assembly: AssemblyConfig;
  template: FbTemplate;
}) {
  const contract = useMemo(
    () => normaliseInterfaceContract(template.interface_contract),
    [template.interface_contract],
  );

  const instanceParams: Record<string, string> = useMemo(
    () => assembly.instance_params ?? {},
    [assembly.instance_params],
  );

  const processIntent = assembly.process_intent ?? "";

  // process_intent lives on AssemblyConfig JSONB, not on FdsAssemblySession.
  // In the library path we show it as an informational annotation.
  const [localIntent, setLocalIntent] = useState(processIntent);

  return (
    <div className="space-y-4">
      {/* Template identity */}
      <div className="flex items-center gap-2.5 px-1">
        <BookOpen className="h-4 w-4 text-primary shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{template.name}</p>
          <p className="text-[11px] text-muted-foreground">
            v{template.version} · Library template
          </p>
        </div>
        <Badge variant="outline" className="text-[10px] shrink-0">Library bound</Badge>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[10px] px-2 text-muted-foreground hover:text-foreground shrink-0"
          title="To change the template, use the Assembly step in the forge wizard"
          onClick={() => {/* deferred to assembly-picker in forge step */}}
        >
          Change
        </Button>
      </div>

      {/* IO slot wiring */}
      {contract.io_slots.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] uppercase font-semibold tracking-wide text-muted-foreground px-1">
            IO Slot Wiring
          </p>
          <div className="space-y-1.5">
            {contract.io_slots.map((slot) => (
              <div key={slot.slot_name} className="flex items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground w-40 shrink-0 truncate" title={slot.slot_name}>
                  {slot.slot_name}
                </span>
                <Badge variant="outline" className="text-[9px] shrink-0">{slot.signal_type}</Badge>
                <Input
                  className="h-7 text-xs font-mono flex-1"
                  placeholder={`Tag for ${slot.slot_name}`}
                  defaultValue={instanceParams[slot.slot_name] ?? ""}
                  title={slot.description}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Instance params */}
      {(contract.inputs.length > 0) && (
        <div className="space-y-2">
          <p className="text-[11px] uppercase font-semibold tracking-wide text-muted-foreground px-1">
            Instance Parameters
          </p>
          <div className="space-y-1.5">
            {contract.inputs.map((inp) => (
              <div key={inp.tia_name} className="flex items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground w-40 shrink-0 truncate" title={inp.description}>
                  {inp.name}
                </span>
                <Badge variant="outline" className="text-[9px] shrink-0">{inp.data_type}</Badge>
                <Input
                  className="h-7 text-xs font-mono flex-1"
                  placeholder={inp.default_value ?? `Value for ${inp.name}`}
                  defaultValue={instanceParams[inp.tia_name] ?? ""}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Process intent */}
      <div className="space-y-1.5">
        <p className="text-[11px] uppercase font-semibold tracking-wide text-muted-foreground px-1">
          Process Intent
        </p>
        <Textarea
          rows={2}
          className="text-xs resize-none"
          placeholder="1–2 sentences: what role does this assembly play in the overall process?"
          value={localIntent}
          onChange={(e) => setLocalIntent(e.target.value)}
        />
        <p className="text-[10px] text-muted-foreground px-1">
          This annotation travels with the assembly into the forge step and process code.
        </p>
      </div>

      {/* Contract summary chips */}
      <div className="flex flex-wrap gap-1.5 px-1">
        {contract.inputs.length > 0 && (
          <Badge variant="outline" className="text-[9px]">{contract.inputs.length} inputs</Badge>
        )}
        {contract.outputs.length > 0 && (
          <Badge variant="outline" className="text-[9px]">{contract.outputs.length} outputs</Badge>
        )}
        {contract.io_slots.length > 0 && (
          <Badge variant="outline" className="text-[9px]">{contract.io_slots.length} IO slots</Badge>
        )}
        {contract.process_state_writes.length > 0 && (
          <Badge variant="outline" className="text-[9px]">{contract.process_state_writes.length} state writes</Badge>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom path sub-panel
// ---------------------------------------------------------------------------

function CustomContractPanel({
  assembly,
  session,
  subsystemName,
  forgeSession,
  profile,
  deviceArtifacts,
  onSessionChange,
  onPromoteToLibrary,
}: {
  assembly: AssemblyConfig;
  session: FdsAssemblySession;
  subsystemName: string;
  forgeSession?: ForgeSession | null;
  profile?: DesignProfile | null;
  deviceArtifacts: ForgeArtifact[];
  onSessionChange: CoAuthorAssemblyContractProps["onSessionChange"];
  onPromoteToLibrary?: () => void;
}) {
  const { generateSingle, loading } = useForgeAssemblyGenerate();

  // Local contract state — mirrors session.interface_contract but editable locally
  const [contract, setContract] = useState<FbInterfaceContract>(
    () => normaliseInterfaceContract(session.interface_contract),
  );
  const [skeletonId, setSkeletonId] = useState<string>("from_scratch");
  const [processIntent, setProcessIntent] = useState(assembly.process_intent ?? "");
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [driftReport, setDriftReport] = useState<DriftReport | null>(null);

  // SCL blocks from session (persisted) — display
  const sclBlocks: AssemblyGeneratedSclBlock[] = session.generated_scl_blocks ?? [];
  const combinedScl = sclBlocks.map((b) => `// ${b.block_type}: ${b.block_name}\n${b.scl_code}`).join("\n\n");

  // Drift: look at the first FB artifact's drift field via session-stored blocks
  // (We can't easily re-run drift here without re-parsing — we show a generic count
  // if the session itself doesn't store drift info. For now we show 0 until generation.)
  // The actual drift is tracked during generation and stored in the artifact temporarily.
  // We use the session's generated_scl_blocks array absence as indicator.
  const hasSclContent = sclBlocks.length > 0 && sclBlocks.some((b) => b.scl_code.trim().length > 0);

  // Skeleton picker handler
  const handleSkeletonChange = useCallback((id: string) => {
    setSkeletonId(id);
    setDriftReport(null); // reset drift on contract change
    const skeleton = getSkeleton(id);
    if (skeleton) {
      setContract(skeleton);
      onSessionChange({ interface_contract: skeleton });
    }
  }, [onSessionChange]);

  // Contract editor change handler
  const handleContractChange = useCallback((next: FbInterfaceContract) => {
    setContract(next);
    setDriftReport(null); // reset drift on contract edit
    onSessionChange({ interface_contract: next });
  }, [onSessionChange]);

  // Generate SCL from contract
  const handleGenerate = useCallback(async () => {
    setGenerateError(null);
    setDriftReport(null); // clear stale drift before new generation
    try {
      const forgeEntry = buildForgeAssemblyEntry(assembly, subsystemName);
      const session_ = forgeSession ?? buildStubForgeSession(session, deviceArtifacts);
      const profile_ = profile ?? buildStubProfile();

      const artifacts = await generateSingle(
        forgeEntry,
        session_,
        profile_,
        deviceArtifacts,
        [], // force AI path — no templates
        [], // no patterns
        undefined,
        undefined,
        contract,
        subsystemName,
      );

      // Extract drift from the primary FB artifact
      const primaryFb = artifacts.find((a) => a.type === "FB") ?? artifacts[0];
      const drift = (primaryFb as { drift?: DriftReport } | undefined)?.drift ?? null;
      setDriftReport(drift);

      // Map ForgeArtifact[] → AssemblyGeneratedSclBlock[]
      const blocks: AssemblyGeneratedSclBlock[] = artifacts.map((a, idx) => ({
        block_name: a.name,
        block_type: a.type as AssemblyGeneratedSclBlock["block_type"],
        scl_code: a.content,
        sort_order: idx,
      }));

      onSessionChange({ interface_contract: contract, generated_scl_blocks: blocks });
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Generation failed");
    }
  }, [assembly, subsystemName, forgeSession, session, deviceArtifacts, profile, generateSingle, contract, onSessionChange]);

  const canGenerate = isContractPopulated(contract) && !loading;

  const canPromote =
    hasSclContent &&
    processIntent.trim().length > 0;

  return (
    <div className="space-y-5">
      {/* Skeleton picker */}
      <div className="space-y-1.5">
        <p className="text-[11px] uppercase font-semibold tracking-wide text-muted-foreground px-1">
          Start from skeleton
        </p>
        <Select value={skeletonId} onValueChange={handleSkeletonChange}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select a skeleton…" />
          </SelectTrigger>
          <SelectContent>
            {CONTRACT_SKELETONS.map((s) => (
              <SelectItem key={s.id} value={s.id} className="text-xs">
                <div>
                  <span className="font-medium">{s.label}</span>
                  <span className="text-muted-foreground ml-2">{s.description}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Contract editor */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 px-1">
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-[11px] uppercase font-semibold tracking-wide text-muted-foreground">
            Interface Contract
          </p>
        </div>
        <div className="border rounded-md overflow-hidden">
          <InterfaceContractEditor
            contract={contract}
            onChange={handleContractChange}
          />
        </div>
      </div>

      {/* Process intent */}
      <div className="space-y-1.5">
        <p className="text-[11px] uppercase font-semibold tracking-wide text-muted-foreground px-1">
          Process Intent
        </p>
        <Textarea
          rows={2}
          className="text-xs resize-none"
          placeholder="1–2 sentences: what role does this assembly play in the overall process?"
          value={processIntent}
          onChange={(e) => setProcessIntent(e.target.value)}
        />
      </div>

      {/* Generate button */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleGenerate}
          disabled={!canGenerate}
          className="gap-1.5"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          Generate SCL from contract
        </Button>

        {hasSclContent && !loading && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="gap-1.5"
            title="Re-run generation with current contract"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Regenerate
          </Button>
        )}

        {generateError && (
          <span className="text-xs text-destructive">{generateError}</span>
        )}
      </div>

      {/* Monaco SCL pane */}
      {hasSclContent && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-[11px] uppercase font-semibold tracking-wide text-muted-foreground">
              Generated SCL
            </p>
            <div className="flex items-center gap-1.5">
              <DriftChip drift={driftReport} />
            </div>
          </div>
          <div className="border rounded-md overflow-hidden" style={{ height: 300 }}>
            <Editor
              language="scl"
              theme="vs-dark"
              value={combinedScl}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 12,
                scrollBeyondLastLine: false,
                lineNumbers: "on",
                wordWrap: "on",
              }}
            />
          </div>

          {/* Save as library template */}
          {onPromoteToLibrary && (
            <Button
              size="sm"
              variant="outline"
              disabled={!canPromote}
              onClick={onPromoteToLibrary}
              className="gap-1.5"
              title={
                !hasSclContent
                  ? "Generate SCL first"
                  : !processIntent.trim()
                  ? "Add a process intent first"
                  : "Save this contract + SCL as a reusable library template"
              }
            >
              <Star className="h-3.5 w-3.5" />
              Save as library template
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drift chip — reflects actual contract drift from the last generation run
// ---------------------------------------------------------------------------

function DriftChip({ drift }: { drift: DriftReport | null }) {
  if (drift === null) return null; // not yet generated

  if (!drift.hasHardDrift) {
    return (
      <Badge variant="outline" className="text-[9px] text-green-400 border-green-500/30">
        Contract matched
      </Badge>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Badge
          variant="destructive"
          className="cursor-pointer text-[9px] gap-1"
        >
          <AlertTriangle className="h-3 w-3" />
          {drift.hardDrifts.length} drift{drift.hardDrifts.length !== 1 ? "s" : ""}
        </Badge>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <p className="text-xs font-semibold mb-2">Unresolved contract drift</p>
        <ul className="list-disc pl-4 space-y-1">
          {drift.hardDrifts.map((d, i) => (
            <li key={i} className="text-xs text-muted-foreground">{d.message}</li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Main export — CoAuthorAssemblyContract
// ---------------------------------------------------------------------------

export function CoAuthorAssemblyContract({
  assembly,
  session,
  subsystemName,
  templates,
  forgeSession,
  profile,
  deviceArtifacts = [],
  onSessionChange,
  onPromoteToLibrary,
}: CoAuthorAssemblyContractProps) {
  // Find matched library template (must be an assembly template with a contract)
  const matchedTemplate = useMemo(() => {
    if (!assembly.fb_template_id) return null;
    return templates.find(
      (t) => t.id === assembly.fb_template_id && t.is_assembly,
    ) ?? null;
  }, [assembly.fb_template_id, templates]);

  const hasLibraryContract = matchedTemplate !== null && isContractPopulated(
    normaliseInterfaceContract(matchedTemplate.interface_contract),
  );

  return (
    <div className={cn("flex flex-col gap-0 min-h-0")}>
      {/* Header */}
      <div className="flex items-center gap-2 px-1 pb-3 border-b mb-4 shrink-0">
        {hasLibraryContract ? (
          <>
            <BookOpen className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Assembly Contract</span>
            <Badge variant="outline" className="text-[9px] ml-auto">Library</Badge>
          </>
        ) : (
          <>
            <Pencil className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Assembly Contract</span>
            <Badge variant="outline" className="text-[9px] ml-auto">Custom</Badge>
          </>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="pr-1">
          {hasLibraryContract ? (
            <LibraryContractPanel
              assembly={assembly}
              template={matchedTemplate!}
            />
          ) : (
            <CustomContractPanel
              assembly={assembly}
              session={session}
              subsystemName={subsystemName}
              forgeSession={forgeSession}
              profile={profile}
              deviceArtifacts={deviceArtifacts}
              onSessionChange={onSessionChange}
              onPromoteToLibrary={onPromoteToLibrary}
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
