/**
 * DevicePicker — grouped unit / equipment_module. Returns resolved device refs.
 */
import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, ShieldAlert } from "lucide-react";

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
import { usePickerIndex, type IndexedDevice } from "./use-picker-index";
import { cn } from "@/lib/utils";

export interface ResolvedDevice {
  control_module_id: string;
  control_module_name: string;
  control_module_class: string;
  is_safety: boolean;
  equipment_module_id: string;
  unit_id: string;
}

export interface DevicePickerProps {
  value: string | null;
  onChange: (resolved: ResolvedDevice | null) => void;
  specProjectId?: string;
  filter?: {
    unitId?: string;
    equipment_moduleId?: string;
    deviceClass?: string;
    isSafety?: boolean;
  };
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function DevicePicker({
  value,
  onChange,
  specProjectId,
  filter,
  placeholder = "Pick a device…",
  disabled,
  className,
}: DevicePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: contract } = useSpecContract(specProjectId);
  const index = usePickerIndex(contract);

  const filtered = useMemo(() => {
    let list = index.control_modules;
    if (filter?.unitId)
      list = list.filter((d) => d.unit_id === filter.unitId);
    if (filter?.equipment_moduleId)
      list = list.filter((d) => d.equipment_module_id === filter.equipment_moduleId);
    if (filter?.deviceClass)
      list = list.filter((d) => d.control_module_class === filter.deviceClass);
    if (typeof filter?.isSafety === "boolean")
      list = list.filter((d) => d.is_safety === filter.isSafety);
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter((d) => d.searchKey.includes(q));
  }, [index.control_modules, filter, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, IndexedDevice[]>();
    for (const d of filtered) {
      const bucket = map.get(d.groupLabel) ?? [];
      bucket.push(d);
      map.set(d.groupLabel, bucket);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const current = value
    ? (index.control_modules.find((d) => d.control_module_id === value) ?? null)
    : null;

  const handleSelect = (d: IndexedDevice) => {
    onChange({
      control_module_id: d.control_module_id,
      control_module_name: d.control_module_name,
      control_module_class: d.control_module_class,
      is_safety: d.is_safety,
      equipment_module_id: d.equipment_module_id,
      unit_id: d.unit_id,
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
          <span className="flex items-center gap-1.5 truncate">
            {current?.is_safety && (
              <ShieldAlert className="h-3 w-3 text-red-400 shrink-0" />
            )}
            <span className="truncate font-mono">
              {current?.control_module_name ?? placeholder}
            </span>
          </span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search control_modules…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No matching control_modules.</CommandEmpty>
            {grouped.map(([label, items]) => (
              <CommandGroup key={label} heading={label}>
                {items.map((d) => (
                  <CommandItem
                    key={d.control_module_id}
                    value={`${d.control_module_name} ${d.searchKey}`}
                    onSelect={() => handleSelect(d)}
                    className="flex items-center gap-2"
                  >
                    <Check
                      className={cn(
                        "h-3 w-3",
                        value === d.control_module_id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {d.is_safety && (
                      <ShieldAlert className="h-3 w-3 text-red-400 shrink-0" />
                    )}
                    <span className="font-mono truncate flex-1">
                      {d.control_module_name}
                    </span>
                    <Badge
                      variant="outline"
                      className="h-4 px-1 text-[9px] font-mono"
                    >
                      {d.control_module_class}
                    </Badge>
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
