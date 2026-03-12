import { useState, useRef, useCallback, useMemo } from "react";
import { Plus, Trash2, AlertTriangle, Upload, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { parseCsvToIoEntries } from "@/lib/io-csv-parser";
import { validateAddress, summarizeIoEntries } from "@/lib/io-address-validator";
import { cn } from "@/lib/utils";
import type { IoEntry } from "@/types";

const DATA_TYPES = ["BOOL", "BYTE", "WORD", "DWORD", "INT", "DINT", "REAL", "LREAL", "TIME", "STRING"] as const;

export interface PhysicalPoint {
  address: string;
  slot: number;
  module: string;
  signalType: "DI" | "DQ" | "AI" | "AQ";
}

function inferSignalType(address: string): "DI" | "DQ" | "AI" | "AQ" | null {
  const a = address.toUpperCase();
  if (a.startsWith("%IW") || a.startsWith("%ID") || a.startsWith("%IR")) return "AI";
  if (a.startsWith("%QW") || a.startsWith("%QD") || a.startsWith("%QR")) return "AQ";
  if (a.startsWith("%I")) return "DI";
  if (a.startsWith("%Q")) return "DQ";
  return null;
}

const EMPTY_ENTRY: IoEntry = {
  address: "",
  tag_name: "",
  data_type: "BOOL",
  description: "",
  module: "",
  slot: 0,
};

interface IoListEditorProps {
  value: IoEntry[];
  onChange: (entries: IoEntry[]) => void;
  readOnly?: boolean;
  physicalAddresses?: PhysicalPoint[];
}

function validateDuplicateAddresses(entries: IoEntry[]): Set<number> {
  const seen = new Map<string, number>();
  const duplicates = new Set<number>();
  entries.forEach((entry, idx) => {
    if (!entry.address) return;
    if (seen.has(entry.address)) {
      duplicates.add(seen.get(entry.address)!);
      duplicates.add(idx);
    }
    seen.set(entry.address, idx);
  });
  return duplicates;
}

export function IoListEditor({ value, onChange, readOnly, physicalAddresses }: IoListEditorProps) {
  const [entries, setEntries] = useState<IoEntry[]>(value);
  const duplicates = validateDuplicateAddresses(entries);
  const invalidAddresses = new Map<number, string>();
  entries.forEach((e, idx) => {
    const result = validateAddress(e.address);
    if (!result.valid) invalidAddresses.set(idx, result.error!);
  });
  const summary = summarizeIoEntries(entries);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [csvImport, setCsvImport] = useState<{
    entries: IoEntry[];
    warnings: string[];
  } | null>(null);

  function commit(updated: IoEntry[]) {
    setEntries(updated);
    onChange(updated);
  }

  function addRow() {
    commit([...entries, { ...EMPTY_ENTRY }]);
  }

  function removeRow(idx: number) {
    commit(entries.filter((_, i) => i !== idx));
  }

  function updateField(idx: number, field: keyof IoEntry, val: string | number) {
    const updated = entries.map((e, i) =>
      i === idx ? { ...e, [field]: val } : e
    );
    commit(updated);
  }

  function updateEntry(idx: number, patch: Partial<IoEntry>) {
    const updated = entries.map((e, i) => i === idx ? { ...e, ...patch } : e);
    commit(updated);
  }

  // Set of addresses already assigned to other rows — used to hide them from dropdowns
  const assignedAddresses = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => { if (e.address) set.add(e.address); });
    return set;
  }, [entries]);

  function moveRow(idx: number, direction: "up" | "down") {
    const target = direction === "up" ? idx - 1 : idx + 1;
    if (target < 0 || target >= entries.length) return;
    const updated = [...entries];
    [updated[idx], updated[target]] = [updated[target], updated[idx]];
    commit(updated);
  }

  const handleCsvFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const result = parseCsvToIoEntries(text);
    setCsvImport(result);
    if (csvInputRef.current) csvInputRef.current.value = "";
  }, []);

  function applyCsvImport(mode: "append" | "replace") {
    if (!csvImport) return;
    const updated = mode === "replace" ? csvImport.entries : [...entries, ...csvImport.entries];
    commit(updated);
    setCsvImport(null);
  }

  return (
    <div className="space-y-2">
      {duplicates.size > 0 && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" />
          Duplicate IO addresses detected — misalignment risk
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b font-mono text-muted-foreground">
              <th className="px-2 py-1.5 text-left">Address</th>
              <th className="px-2 py-1.5 text-left">Tag Name</th>
              <th className="px-2 py-1.5 text-left">Type</th>
              <th className="px-2 py-1.5 text-left">Description</th>
              <th className="px-2 py-1.5 text-left">Module</th>
              <th className="px-2 py-1.5 text-left">Slot</th>
              {!readOnly && <th className="w-14" />}
              {!readOnly && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, idx) => (
              <tr
                key={idx}
                className={`border-b border-border/50 ${duplicates.has(idx) ? "bg-destructive/5" : ""}`}
              >
                <td className="px-1 py-0.5">
                  {physicalAddresses && !readOnly ? (() => {
                    const sigType = inferSignalType(entry.address);
                    // Available = matching type + not assigned to another row (but keep self)
                    const available = physicalAddresses.filter(p =>
                      (sigType === null || p.signalType === sigType) &&
                      (!assignedAddresses.has(p.address) || p.address === entry.address)
                    );
                    return (
                      <select
                        value={entry.address}
                        onChange={(e) => {
                          const addr = e.target.value;
                          if (!addr) {
                            updateEntry(idx, { address: "", slot: 0, module: "" });
                          } else {
                            const pt = physicalAddresses.find(p => p.address === addr);
                            updateEntry(idx, {
                              address: addr,
                              slot: pt?.slot ?? entry.slot,
                              module: pt?.module ?? entry.module,
                            });
                          }
                        }}
                        className={cn(
                          "h-7 w-full rounded-md border border-input bg-background px-2 font-mono text-xs",
                          invalidAddresses.has(idx) && "border-red-500"
                        )}
                        title={invalidAddresses.get(idx)}
                      >
                        <option value="">— pick address —</option>
                        {available.map(p => (
                          <option key={p.address} value={p.address}>
                            {p.address} (Slot {p.slot} · {p.module})
                          </option>
                        ))}
                        {/* Keep current address visible even if not in pool */}
                        {entry.address && !physicalAddresses.some(p => p.address === entry.address) && (
                          <option value={entry.address}>{entry.address} (custom)</option>
                        )}
                      </select>
                    );
                  })() : (
                  <Input
                    value={entry.address}
                    onChange={(e) => updateField(idx, "address", e.target.value)}
                    placeholder="%I0.0"
                    className={cn(
                      "h-7 font-mono text-xs",
                      invalidAddresses.has(idx) && "border-red-500 focus-visible:ring-red-500"
                    )}
                    title={invalidAddresses.get(idx)}
                    disabled={readOnly}
                  />
                  )}
                </td>
                <td className="px-1 py-0.5">
                  <Input
                    value={entry.tag_name}
                    onChange={(e) => updateField(idx, "tag_name", e.target.value)}
                    placeholder="DI_SensorName"
                    className="h-7 font-mono text-xs"
                    disabled={readOnly}
                  />
                </td>
                <td className="px-1 py-0.5">
                  <select
                    value={entry.data_type}
                    onChange={(e) => updateField(idx, "data_type", e.target.value)}
                    className="h-7 w-full rounded-md border border-input bg-background px-2 font-mono text-xs"
                    disabled={readOnly}
                  >
                    {DATA_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </td>
                <td className="px-1 py-0.5">
                  <Input
                    value={entry.description}
                    onChange={(e) => updateField(idx, "description", e.target.value)}
                    placeholder="Description"
                    className="h-7 text-xs"
                    disabled={readOnly}
                  />
                </td>
                <td className="px-1 py-0.5">
                  <Input
                    value={entry.module}
                    onChange={(e) => updateField(idx, "module", e.target.value)}
                    placeholder="DI16"
                    className="h-7 font-mono text-xs"
                    disabled={readOnly}
                  />
                </td>
                <td className="px-1 py-0.5">
                  <Input
                    type="number"
                    value={entry.slot}
                    onChange={(e) => updateField(idx, "slot", parseInt(e.target.value) || 0)}
                    className="h-7 w-14 font-mono text-xs"
                    disabled={readOnly}
                  />
                </td>
                {!readOnly && (
                  <td className="px-1 py-0.5">
                    <div className="flex gap-0.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        disabled={idx === 0}
                        onClick={() => moveRow(idx, "up")}
                      >
                        <ArrowUp className="h-3 w-3 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        disabled={idx === entries.length - 1}
                        onClick={() => moveRow(idx, "down")}
                      >
                        <ArrowDown className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    </div>
                  </td>
                )}
                {!readOnly && (
                  <td className="px-1 py-0.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => removeRow(idx)}
                    >
                      <Trash2 className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {entries.length === 0 && (
        <div className="py-6 text-center font-mono text-xs text-muted-foreground">
          No IO entries. Add your first entry below.
        </div>
      )}

      {entries.length > 0 && (
        <div className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
          <span>{summary.total} entries:</span>
          {summary.inputs > 0 && <span>{summary.inputs} inputs</span>}
          {summary.outputs > 0 && <span>{summary.outputs} outputs</span>}
          {summary.markers > 0 && <span>{summary.markers} markers</span>}
          {summary.other > 0 && <span>{summary.other} other</span>}
          {invalidAddresses.size > 0 && (
            <span className="text-red-400">{invalidAddresses.size} invalid</span>
          )}
        </div>
      )}

      {!readOnly && (
        <div className="mt-2 flex gap-2">
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add IO Entry
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => csvInputRef.current?.click()}
          >
            <Upload className="mr-1 h-3.5 w-3.5" />
            Import CSV
          </Button>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,.txt,.tsv"
            className="hidden"
            onChange={handleCsvFile}
          />
        </div>
      )}

      {/* CSV import confirmation dialog */}
      <AlertDialog open={csvImport !== null} onOpenChange={(open) => { if (!open) setCsvImport(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-mono text-sm">
              Import {csvImport?.entries.length ?? 0} IO Entries
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block">
                Parsed {csvImport?.entries.length ?? 0} entries from CSV.
                {entries.length > 0
                  ? " Choose to append to existing entries or replace them."
                  : ""}
              </span>
              {(csvImport?.warnings.length ?? 0) > 0 && (
                <span className="mt-2 block space-y-0.5">
                  {csvImport!.warnings.map((w, i) => (
                    <span key={i} className="block font-mono text-xs text-amber-400">
                      {w}
                    </span>
                  ))}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs">Cancel</AlertDialogCancel>
            {entries.length > 0 && (
              <AlertDialogAction
                className="font-mono text-xs"
                onClick={() => applyCsvImport("append")}
              >
                Append ({(csvImport?.entries.length ?? 0) + entries.length} total)
              </AlertDialogAction>
            )}
            <AlertDialogAction
              className="font-mono text-xs"
              onClick={() => applyCsvImport("replace")}
            >
              {entries.length > 0 ? "Replace All" : "Import"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
