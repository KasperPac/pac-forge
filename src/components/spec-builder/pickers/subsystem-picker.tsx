/**
 * SubsystemPicker — flat list with equipment_type badge.
 */
import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { usePickerIndex, type IndexedSubsystem } from "./use-picker-index";
import { cn } from "@/lib/utils";

export interface ResolvedSubsystem {
  unit_id: string;
  unit_name: string;
  equipment_type: string;
}

export interface SubsystemPickerProps {
  value: string | null;
  onChange: (resolved: ResolvedSubsystem | null) => void;
  specProjectId?: string;
  includeExcluded?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function SubsystemPicker({
  value,
  onChange,
  specProjectId,
  includeExcluded = false,
  placeholder = "Pick a unit…",
  disabled,
  className,
}: SubsystemPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: contract } = useSpecContract(specProjectId);
  const index = usePickerIndex(contract);

  const filtered = useMemo(() => {
    let list = index.units;
    if (!includeExcluded) list = list.filter((s) => !s.excluded);
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter((s) => s.searchKey.includes(q));
  }, [index.units, includeExcluded, query]);

  const current = value
    ? (index.units.find((s) => s.unit_id === value) ?? null)
    : null;

  const handleSelect = (s: IndexedSubsystem) => {
    onChange({
      unit_id: s.unit_id,
      unit_name: s.unit_name,
      equipment_type: s.equipment_type,
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
          <span className="truncate">
            {current?.unit_name ?? placeholder}
          </span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search units…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No matching units.</CommandEmpty>
            <CommandGroup>
              {filtered.map((s) => (
                <CommandItem
                  key={s.unit_id}
                  value={`${s.unit_name} ${s.searchKey}`}
                  onSelect={() => handleSelect(s)}
                  className="flex items-center gap-2"
                >
                  <Check
                    className={cn(
                      "h-3 w-3",
                      value === s.unit_id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate flex-1">{s.unit_name}</span>
                  <Badge
                    variant="outline"
                    className="h-4 px-1 text-[9px] font-mono"
                  >
                    {s.equipment_type}
                  </Badge>
                  {s.excluded && (
                    <Badge
                      variant="outline"
                      className="h-4 px-1 text-[9px] bg-red-500/15 text-red-300 border-red-500/30"
                    >
                      excluded
                    </Badge>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
