import { useMemo } from "react";
import { Plus, Trash2, ArrowDownToLine, ArrowUpFromLine, Cable, Database, Wand2, Bot, MoveRight, MoveLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { prefillContractFromScl } from "@/lib/fb-library/scl-interface-parser";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  INTERFACE_INPUT_ROLES,
  INTERFACE_OUTPUT_ROLES,
  IO_SLOT_ROLES,
  INTERFACE_DATA_TYPES,
  SIGNAL_TYPES,
  SLOT_CARDINALITIES,
  EMPTY_INTERFACE_CONTRACT,
  normaliseInterfaceContract,
  isContractPopulated,
  type FbInterfaceContract,
  type FbInterfaceInput,
  type FbInterfaceOutput,
  type FbIoSlot,
  type InterfaceDataType,
  type SignalType,
} from "@/types/fb-interface-contract";

// Default signal type when promoting an input/output row into an IO slot.
function defaultSignalTypeForInput(dt: InterfaceDataType): SignalType {
  if (dt === "BOOL") return "DI";
  if (dt === "INT" || dt === "DINT" || dt === "REAL" || dt === "WORD" || dt === "DWORD") return "AI";
  return "DI";
}
function defaultSignalTypeForOutput(dt: InterfaceDataType): SignalType {
  if (dt === "BOOL") return "DO";
  if (dt === "INT" || dt === "DINT" || dt === "REAL" || dt === "WORD" || dt === "DWORD") return "AO";
  return "DO";
}

/**
 * Interface contract editor for an FbTemplate.
 *
 * Renders five sections (Inputs, Outputs, IO Slots, ProcessState Reads,
 * ProcessState Writes) per Docs/ASSEMBLY_FB_LIBRARY_PLAN.md §3.1.
 *
 * Used in the FB Library edit dialog. The editor is available on **any**
 * FbTemplate record — same UI for Mode A retrofit, Mode B import completion,
 * Mode C inline authoring, and Mode D AI scaffolding.
 */

interface InterfaceContractEditorProps {
  contract: FbInterfaceContract | Record<string, never>;
  onChange: (next: FbInterfaceContract) => void;
  /** SCL blocks from the enclosing template, used to power "Pre-fill from SCL". */
  sclBlocks?: Array<{ scl_code: string }>;
}

export function InterfaceContractEditor({ contract: rawContract, onChange, sclBlocks }: InterfaceContractEditorProps) {
  const contract = useMemo(() => normaliseInterfaceContract(rawContract), [rawContract]);
  const populated = isContractPopulated(contract);
  const { toast } = useToast();

  const hasScl = !!sclBlocks?.some((b) => b.scl_code?.trim());

  function update(patch: Partial<FbInterfaceContract>) {
    onChange({ ...contract, ...patch });
  }

  function moveInputToSlot(idx: number) {
    const row = contract.inputs[idx];
    if (!row) return;
    const slot: FbIoSlot = {
      slot_name: row.tia_name || row.name,
      signal_type: defaultSignalTypeForInput(row.data_type),
      role: "other",
      description: row.description,
      cardinality: "one",
      ...(row.agent_description ? { agent_description: row.agent_description } : {}),
    };
    onChange({
      ...contract,
      inputs: contract.inputs.filter((_, i) => i !== idx),
      io_slots: [...contract.io_slots, slot],
    });
    toast({ title: "Moved to IO Slots", description: `${slot.slot_name} (${slot.signal_type}) — relabel role + cardinality on the IO Slots tab.` });
  }

  function moveSlotBack(idx: number) {
    const slot = contract.io_slots[idx];
    if (!slot) return;
    const goesToInputs = slot.signal_type === "DI" || slot.signal_type === "AI";
    const dataType: InterfaceDataType =
      slot.signal_type === "DI" || slot.signal_type === "DO" ? "BOOL" : "REAL";
    const nextSlots = contract.io_slots.filter((_, i) => i !== idx);
    if (goesToInputs) {
      const row: FbInterfaceInput = {
        name: slot.slot_name,
        tia_name: slot.slot_name,
        data_type: dataType,
        role: "other",
        description: slot.description,
        required: false,
        ...(slot.agent_description ? { agent_description: slot.agent_description } : {}),
      };
      onChange({
        ...contract,
        io_slots: nextSlots,
        inputs: [...contract.inputs, row],
      });
      toast({ title: "Moved back to Inputs", description: `${row.tia_name} — data type defaulted to ${dataType}, relabel role on the Inputs tab.` });
    } else {
      const row: FbInterfaceOutput = {
        name: slot.slot_name,
        tia_name: slot.slot_name,
        data_type: dataType,
        role: "other",
        description: slot.description,
        ...(slot.agent_description ? { agent_description: slot.agent_description } : {}),
      };
      onChange({
        ...contract,
        io_slots: nextSlots,
        outputs: [...contract.outputs, row],
      });
      toast({ title: "Moved back to Outputs", description: `${row.tia_name} — data type defaulted to ${dataType}, relabel role on the Outputs tab.` });
    }
  }

  function moveOutputToSlot(idx: number) {
    const row = contract.outputs[idx];
    if (!row) return;
    const slot: FbIoSlot = {
      slot_name: row.tia_name || row.name,
      signal_type: defaultSignalTypeForOutput(row.data_type),
      role: "other",
      description: row.description,
      cardinality: "one",
      ...(row.agent_description ? { agent_description: row.agent_description } : {}),
    };
    onChange({
      ...contract,
      outputs: contract.outputs.filter((_, i) => i !== idx),
      io_slots: [...contract.io_slots, slot],
    });
    toast({ title: "Moved to IO Slots", description: `${slot.slot_name} (${slot.signal_type}) — relabel role + cardinality on the IO Slots tab.` });
  }

  function handlePrefill() {
    if (!sclBlocks) return;
    const result = prefillContractFromScl(contract, sclBlocks);
    onChange(result.contract);
    const added = result.addedInputs + result.addedOutputs;
    const skipped = result.skippedInputs + result.skippedOutputs;
    if (added === 0 && skipped === 0) {
      toast({
        title: "Nothing to pre-fill",
        description: "No VAR_INPUT or VAR_OUTPUT declarations found in the SCL.",
      });
      return;
    }
    toast({
      title: added > 0 ? "Pre-filled from SCL" : "Contract already in sync",
      description:
        `Added ${result.addedInputs} input${result.addedInputs === 1 ? "" : "s"}, ` +
        `${result.addedOutputs} output${result.addedOutputs === 1 ? "" : "s"}` +
        (skipped > 0 ? ` — ${skipped} already present (kept existing roles).` : "."),
    });
  }

  return (
    <div className="space-y-2 rounded-md border border-border/40 bg-muted/10 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold">Interface Contract</span>
          <Badge
            variant={populated ? "default" : "outline"}
            className="font-mono text-[10px] px-1.5 py-0"
          >
            {populated ? "populated" : "empty"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden font-mono text-[10px] text-muted-foreground/70 md:inline">
            Spec Builder Co-Author renders the structured wiring form when populated; otherwise falls back to free-form authoring.
          </span>
          {hasScl && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 gap-1 px-2 font-mono text-xs"
              onClick={handlePrefill}
              title="Parse VAR_INPUT / VAR_OUTPUT from the SCL blocks and add any missing rows. Existing rows are preserved."
            >
              <Wand2 className="h-3 w-3" /> Pre-fill from SCL
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="inputs">
        <TabsList className="h-8">
          <TabsTrigger value="inputs" className="font-mono text-xs h-6 px-3">
            <ArrowDownToLine className="mr-1 h-3 w-3" />
            Inputs ({contract.inputs.length})
          </TabsTrigger>
          <TabsTrigger value="outputs" className="font-mono text-xs h-6 px-3">
            <ArrowUpFromLine className="mr-1 h-3 w-3" />
            Outputs ({contract.outputs.length})
          </TabsTrigger>
          <TabsTrigger value="io_slots" className="font-mono text-xs h-6 px-3">
            <Cable className="mr-1 h-3 w-3" />
            IO Slots ({contract.io_slots.length})
          </TabsTrigger>
          <TabsTrigger value="process_state" className="font-mono text-xs h-6 px-3">
            <Database className="mr-1 h-3 w-3" />
            ProcessState ({contract.process_state_reads.length + contract.process_state_writes.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inputs" className="mt-2">
          <InputsTable
            rows={contract.inputs}
            onChange={(rows) => update({ inputs: rows })}
            onMoveToSlot={moveInputToSlot}
          />
        </TabsContent>

        <TabsContent value="outputs" className="mt-2">
          <OutputsTable
            rows={contract.outputs}
            onChange={(rows) => update({ outputs: rows })}
            onMoveToSlot={moveOutputToSlot}
          />
        </TabsContent>

        <TabsContent value="io_slots" className="mt-2">
          <IoSlotsTable
            rows={contract.io_slots}
            onChange={(rows) => update({ io_slots: rows })}
            onMoveBack={moveSlotBack}
          />
        </TabsContent>

        <TabsContent value="process_state" className="mt-2 space-y-3">
          <StringList
            label="Reads"
            placeholder="e.g. ProcessLogic.SAFETY_HEALTHY"
            values={contract.process_state_reads}
            onChange={(rows) => update({ process_state_reads: rows })}
          />
          <StringList
            label="Writes"
            placeholder="e.g. ProcessState_INFEED.CV_IN_01_PackageReady"
            values={contract.process_state_writes}
            onChange={(rows) => update({ process_state_writes: rows })}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ===========================================================================
// Reusable row helpers
// ===========================================================================

const TH = "font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70 px-1.5 py-1 text-left";
const TD = "px-1 py-0.5 align-top";

function AddRowButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 font-mono text-xs" onClick={onClick}>
      <Plus className="h-3 w-3" /> {label}
    </Button>
  );
}

function RemoveRowButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
      onClick={onClick}
      title="Remove row"
    >
      <Trash2 className="h-3 w-3" />
    </Button>
  );
}

function MoveToSlotButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
      onClick={onClick}
      title="Move this row to IO Slots — this pin is physical wiring, not a coordination signal"
    >
      <MoveRight className="h-3 w-3" />
    </Button>
  );
}

function MoveBackButton({ target, onClick }: { target: "Inputs" | "Outputs"; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
      onClick={onClick}
      title={`Move this slot back to ${target} — it's a coordination signal, not physical wiring`}
    >
      <MoveLeft className="h-3 w-3" />
    </Button>
  );
}

/**
 * Popover trigger + textarea for the long-form `agent_description` field.
 * Goes into agent prompts when the template is consumed.
 */
function AgentDescriptionButton({
  value,
  onChange,
  rowLabel,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  rowLabel: string;
}) {
  const hasValue = !!value?.trim();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`h-6 w-6 p-0 ${hasValue ? "text-primary" : "text-muted-foreground"} hover:text-foreground`}
          title={hasValue ? "Edit agent description" : "Add agent description (long-form notes for AI prompts)"}
        >
          <Bot className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96" align="end">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-semibold">Agent description</span>
            <span className="font-mono text-[10px] text-muted-foreground">{rowLabel}</span>
          </div>
          <p className="font-mono text-[10px] text-muted-foreground/80">
            Long-form notes for AI agents — purpose, expected range, failure modes, wiring gotchas. Injected when the template is loaded into a Co-Author or Spec Builder prompt.
          </p>
          <Textarea
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value || undefined)}
            placeholder="Describe what this signal represents, when it fires, what a typical value looks like, and what conditions make it significant to the orchestration…"
            className="min-h-[140px] font-mono text-xs"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EmptyTableRow({ colSpan, hint }: { colSpan: number; hint: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-2 py-3 text-center font-mono text-[11px] text-muted-foreground/60">
        {hint}
      </td>
    </tr>
  );
}

// ===========================================================================
// Inputs table
// ===========================================================================

const EMPTY_INPUT: FbInterfaceInput = {
  name: "",
  tia_name: "",
  data_type: "BOOL",
  role: "other",
  description: "",
  required: false,
};

function InputsTable({
  rows,
  onChange,
  onMoveToSlot,
}: {
  rows: FbInterfaceInput[];
  onChange: (rows: FbInterfaceInput[]) => void;
  onMoveToSlot: (idx: number) => void;
}) {
  function patch(idx: number, p: Partial<FbInterfaceInput>) {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...p } : r)));
  }
  function remove(idx: number) {
    onChange(rows.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([...rows, { ...EMPTY_INPUT }]);
  }

  return (
    <div className="space-y-1">
      <div className="overflow-x-auto rounded border border-border/30">
        <table className="w-full text-xs">
          <thead className="bg-muted/30">
            <tr>
              <th className={TH}>Name</th>
              <th className={TH}>TIA Name</th>
              <th className={TH}>Type</th>
              <th className={TH}>UDT</th>
              <th className={TH}>Role</th>
              <th className={TH}>Default</th>
              <th className={`${TH} w-[60px]`}>Req?</th>
              <th className={TH}>Description</th>
              <th className={`${TH} w-[90px]`}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyTableRow colSpan={9} hint="No inputs declared. Add rows for each VAR_INPUT the orchestration writes to this instance." />
            ) : (
              rows.map((row, idx) => (
                <tr key={idx} className="border-t border-border/20">
                  <td className={TD}>
                    <CellInput value={row.name} onChange={(v) => patch(idx, { name: v })} placeholder="AutoRun" />
                  </td>
                  <td className={TD}>
                    <CellInput value={row.tia_name} onChange={(v) => patch(idx, { tia_name: v })} placeholder="AutoRun" />
                  </td>
                  <td className={TD}>
                    <CellSelect
                      value={row.data_type}
                      onValueChange={(v) => patch(idx, { data_type: v as typeof row.data_type })}
                      options={INTERFACE_DATA_TYPES}
                    />
                  </td>
                  <td className={TD}>
                    <CellInput
                      value={row.udt_name ?? ""}
                      onChange={(v) => patch(idx, { udt_name: v || undefined })}
                      placeholder={row.data_type === "UDT" ? "udtName" : "—"}
                      disabled={row.data_type !== "UDT"}
                    />
                  </td>
                  <td className={TD}>
                    <CellSelect
                      value={row.role}
                      onValueChange={(v) => patch(idx, { role: v as typeof row.role })}
                      options={INTERFACE_INPUT_ROLES}
                    />
                  </td>
                  <td className={TD}>
                    <CellInput
                      value={row.default_value ?? ""}
                      onChange={(v) => patch(idx, { default_value: v || undefined })}
                      placeholder="TRUE"
                    />
                  </td>
                  <td className={TD}>
                    <input
                      type="checkbox"
                      checked={row.required}
                      onChange={(e) => patch(idx, { required: e.target.checked })}
                      className="ml-2 h-3 w-3 cursor-pointer accent-primary"
                    />
                  </td>
                  <td className={TD}>
                    <CellInput
                      value={row.description}
                      onChange={(v) => patch(idx, { description: v })}
                      placeholder="What this input does"
                    />
                  </td>
                  <td className={`${TD} text-right whitespace-nowrap`}>
                    <AgentDescriptionButton
                      value={row.agent_description}
                      onChange={(v) => patch(idx, { agent_description: v })}
                      rowLabel={row.name || row.tia_name || "(unnamed input)"}
                    />
                    <MoveToSlotButton onClick={() => onMoveToSlot(idx)} />
                    <RemoveRowButton onClick={() => remove(idx)} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <AddRowButton onClick={add} label="Add input" />
    </div>
  );
}

// ===========================================================================
// Outputs table
// ===========================================================================

const EMPTY_OUTPUT: FbInterfaceOutput = {
  name: "",
  tia_name: "",
  data_type: "BOOL",
  role: "other",
  description: "",
};

function OutputsTable({
  rows,
  onChange,
  onMoveToSlot,
}: {
  rows: FbInterfaceOutput[];
  onChange: (rows: FbInterfaceOutput[]) => void;
  onMoveToSlot: (idx: number) => void;
}) {
  function patch(idx: number, p: Partial<FbInterfaceOutput>) {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...p } : r)));
  }
  function remove(idx: number) {
    onChange(rows.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([...rows, { ...EMPTY_OUTPUT }]);
  }

  return (
    <div className="space-y-1">
      <div className="overflow-x-auto rounded border border-border/30">
        <table className="w-full text-xs">
          <thead className="bg-muted/30">
            <tr>
              <th className={TH}>Name</th>
              <th className={TH}>TIA Name</th>
              <th className={TH}>Type</th>
              <th className={TH}>UDT</th>
              <th className={TH}>Role</th>
              <th className={TH}>Description</th>
              <th className={`${TH} w-[90px]`}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyTableRow colSpan={7} hint="No outputs declared. Add rows for each VAR_OUTPUT the orchestration reads from this instance." />
            ) : (
              rows.map((row, idx) => (
                <tr key={idx} className="border-t border-border/20">
                  <td className={TD}>
                    <CellInput value={row.name} onChange={(v) => patch(idx, { name: v })} placeholder="Running" />
                  </td>
                  <td className={TD}>
                    <CellInput value={row.tia_name} onChange={(v) => patch(idx, { tia_name: v })} placeholder="Running" />
                  </td>
                  <td className={TD}>
                    <CellSelect
                      value={row.data_type}
                      onValueChange={(v) => patch(idx, { data_type: v as typeof row.data_type })}
                      options={INTERFACE_DATA_TYPES}
                    />
                  </td>
                  <td className={TD}>
                    <CellInput
                      value={row.udt_name ?? ""}
                      onChange={(v) => patch(idx, { udt_name: v || undefined })}
                      placeholder={row.data_type === "UDT" ? "udtName" : "—"}
                      disabled={row.data_type !== "UDT"}
                    />
                  </td>
                  <td className={TD}>
                    <CellSelect
                      value={row.role}
                      onValueChange={(v) => patch(idx, { role: v as typeof row.role })}
                      options={INTERFACE_OUTPUT_ROLES}
                    />
                  </td>
                  <td className={TD}>
                    <CellInput
                      value={row.description}
                      onChange={(v) => patch(idx, { description: v })}
                      placeholder="What this output reports"
                    />
                  </td>
                  <td className={`${TD} text-right whitespace-nowrap`}>
                    <AgentDescriptionButton
                      value={row.agent_description}
                      onChange={(v) => patch(idx, { agent_description: v })}
                      rowLabel={row.name || row.tia_name || "(unnamed output)"}
                    />
                    <MoveToSlotButton onClick={() => onMoveToSlot(idx)} />
                    <RemoveRowButton onClick={() => remove(idx)} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <AddRowButton onClick={add} label="Add output" />
    </div>
  );
}

// ===========================================================================
// IO Slots table
// ===========================================================================

const EMPTY_SLOT: FbIoSlot = {
  slot_name: "",
  signal_type: "DI",
  role: "other",
  description: "",
  cardinality: "one",
};

function IoSlotsTable({
  rows,
  onChange,
  onMoveBack,
}: {
  rows: FbIoSlot[];
  onChange: (rows: FbIoSlot[]) => void;
  onMoveBack: (idx: number) => void;
}) {
  function patch(idx: number, p: Partial<FbIoSlot>) {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...p } : r)));
  }
  function remove(idx: number) {
    onChange(rows.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([...rows, { ...EMPTY_SLOT }]);
  }

  return (
    <div className="space-y-1">
      <div className="overflow-x-auto rounded border border-border/30">
        <table className="w-full text-xs">
          <thead className="bg-muted/30">
            <tr>
              <th className={TH}>Slot Name</th>
              <th className={TH}>Signal</th>
              <th className={TH}>Role</th>
              <th className={TH}>Cardinality</th>
              <th className={TH}>Description</th>
              <th className={`${TH} w-[90px]`}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyTableRow colSpan={6} hint="No IO slots declared. Add a slot for each register tag the instance must wire (e.g. discharge_photoeye → DI)." />
            ) : (
              rows.map((row, idx) => (
                <tr key={idx} className="border-t border-border/20">
                  <td className={TD}>
                    <CellInput value={row.slot_name} onChange={(v) => patch(idx, { slot_name: v })} placeholder="discharge_photoeye" />
                  </td>
                  <td className={TD}>
                    <CellSelect
                      value={row.signal_type}
                      onValueChange={(v) => patch(idx, { signal_type: v as typeof row.signal_type })}
                      options={SIGNAL_TYPES}
                    />
                  </td>
                  <td className={TD}>
                    <CellSelect
                      value={row.role}
                      onValueChange={(v) => patch(idx, { role: v as typeof row.role })}
                      options={IO_SLOT_ROLES}
                    />
                  </td>
                  <td className={TD}>
                    <CellSelect
                      value={row.cardinality}
                      onValueChange={(v) => patch(idx, { cardinality: v as typeof row.cardinality })}
                      options={SLOT_CARDINALITIES}
                    />
                  </td>
                  <td className={TD}>
                    <CellInput
                      value={row.description}
                      onChange={(v) => patch(idx, { description: v })}
                      placeholder="Discharge package-detect photoeye"
                    />
                  </td>
                  <td className={`${TD} text-right whitespace-nowrap`}>
                    <AgentDescriptionButton
                      value={row.agent_description}
                      onChange={(v) => patch(idx, { agent_description: v })}
                      rowLabel={row.slot_name || "(unnamed slot)"}
                    />
                    <MoveBackButton
                      target={row.signal_type === "DI" || row.signal_type === "AI" ? "Inputs" : "Outputs"}
                      onClick={() => onMoveBack(idx)}
                    />
                    <RemoveRowButton onClick={() => remove(idx)} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <AddRowButton onClick={add} label="Add IO slot" />
    </div>
  );
}

// ===========================================================================
// String list (ProcessState reads/writes)
// ===========================================================================

function StringList({
  label,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  function patch(idx: number, v: string) {
    onChange(values.map((x, i) => (i === idx ? v : x)));
  }
  function remove(idx: number) {
    onChange(values.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([...values, ""]);
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] font-semibold text-muted-foreground">{label}</span>
        <AddRowButton onClick={add} label={`Add ${label.toLowerCase()}`} />
      </div>
      {values.length === 0 ? (
        <p className="rounded border border-dashed border-border/30 px-2 py-2 text-center font-mono text-[11px] text-muted-foreground/60">
          No {label.toLowerCase()} declared.
        </p>
      ) : (
        <div className="space-y-1">
          {values.map((value, idx) => (
            <div key={idx} className="flex items-center gap-1">
              <Input
                value={value}
                onChange={(e) => patch(idx, e.target.value)}
                placeholder={placeholder}
                className="h-7 font-mono text-xs"
              />
              <RemoveRowButton onClick={() => remove(idx)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Cell editors
// ===========================================================================

function CellInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="h-6 px-1.5 font-mono text-xs"
    />
  );
}

function CellSelect({
  value,
  onValueChange,
  options,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="h-6 px-1.5 font-mono text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o} className="font-mono text-xs">
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Re-export the empty constant for callers that need to seed fresh rows externally
export { EMPTY_INTERFACE_CONTRACT };
