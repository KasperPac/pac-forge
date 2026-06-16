/**
 * AssemblyPicker — grouped by unit.
 */
import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useSpecContract } from "@/hooks/use-spec-contract";
import { usePickerIndex, type IndexedAssembly } from "./use-picker-index";
import { cn } from "@/lib/utils";

export interface ResolvedAssembly {
  equipment_module_id: string;
  equipment_module_name: string;
  unit_id: string;
}

export interface AssemblyPickerProps {
  value: string | null;
  onChange: (resolved: ResolvedAssembly | null) => void;
  specProjectId?: string;
  filter?: { unitId?: string };
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function AssemblyPicker({
  value,
  onChange,
  specProjectId,
  filter,
  placeholder = "Pick an equipment_module…",
  disabled,
  className,
}: AssemblyPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: contract } = useSpecContract(specProjectId);
  const index = usePickerIndex(contract);

  const filtered = useMemo(() => {
    let list = index.equipment_modules;
    if (filter?.unitId)
      list = list.filter((a) => a.unit_id === filter.unitId);
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter((a) => a.searchKey.includes(q));
  }, [index.equipment_modules, filter, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, IndexedAssembly[]>();
    for (const a of filtered) {
      const bucket = map.get(a.groupLabel) ?? [];
      bucket.push(a);
      map.set(a.groupLabel, bucket);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const current = value
    ? (index.equipment_modules.find((a) => a.equipment_module_id === value) ?? null)
    : null;

  const handleSelect = (a: IndexedAssembly) => {
    onChange({
      equipment_module_id: a.equipment_module_id,
      equipment_module_name: a.equipment_module_name,
      unit_id: a.unit_id,
    });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          size="sm"
          disabled={disabled}
          className={cn(
            "h-7 w-full justify-between gap-2 px-2 text-xs",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate font-mono">
            {current?.equipment_module_name ?? placeholder}
          </span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search equipment_modules…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No matching equipment_modules.</CommandEmpty>
            {grouped.map(([label, items]) => (
              <CommandGroup key={label} heading={label}>
                {items.map((a) => (
                  <CommandItem
                    key={a.equipment_module_id}
                    value={`${a.equipment_module_name} ${a.searchKey}`}
                    onSelect={() => handleSelect(a)}
                    className="flex items-center gap-2"
                  >
                    <Check
                      className={cn(
                        "h-3 w-3",
                        value === a.equipment_module_id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="font-mono truncate flex-1">
                      {a.equipment_module_name}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {a.control_module_count} dev
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
