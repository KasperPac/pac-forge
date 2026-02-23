import { useState } from "react";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { IoEntry } from "@/types";

const DATA_TYPES = ["BOOL", "BYTE", "WORD", "DWORD", "INT", "DINT", "REAL", "LREAL", "TIME", "STRING"] as const;

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

export function IoListEditor({ value, onChange, readOnly }: IoListEditorProps) {
  const [entries, setEntries] = useState<IoEntry[]>(value);
  const duplicates = validateDuplicateAddresses(entries);

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
                  <Input
                    value={entry.address}
                    onChange={(e) => updateField(idx, "address", e.target.value)}
                    placeholder="%I0.0"
                    className="h-7 font-mono text-xs"
                    disabled={readOnly}
                  />
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

      {!readOnly && (
        <Button variant="outline" size="sm" onClick={addRow} className="mt-2">
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add IO Entry
        </Button>
      )}
    </div>
  );
}
