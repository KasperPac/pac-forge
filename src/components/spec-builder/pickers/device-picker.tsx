/**
 * DevicePicker — grouped subsystem / assembly. Returns resolved device refs.
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
  device_id: string;
  device_name: string;
  device_class: string;
  is_safety: boolean;
  assembly_id: string;
  subsystem_id: string;
}

export interface DevicePickerProps {
  value: string | null;
  onChange: (resolved: ResolvedDevice | null) => void;
  specProjectId?: string;
  filter?: {
    subsystemId?: string;
    assemblyId?: string;
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
    let list = index.devices;
    if (filter?.subsystemId)
      list = list.filter((d) => d.subsystem_id === filter.subsystemId);
    if (filter?.assemblyId)
      list = list.filter((d) => d.assembly_id === filter.assemblyId);
    if (filter?.deviceClass)
      list = list.filter((d) => d.device_class === filter.deviceClass);
    if (typeof filter?.isSafety === "boolean")
      list = list.filter((d) => d.is_safety === filter.isSafety);
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter((d) => d.searchKey.includes(q));
  }, [index.devices, filter, query]);

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
    ? (index.devices.find((d) => d.device_id === value) ?? null)
    : null;

  const handleSelect = (d: IndexedDevice) => {
    onChange({
      device_id: d.device_id,
      device_name: d.device_name,
      device_class: d.device_class,
      is_safety: d.is_safety,
      assembly_id: d.assembly_id,
      subsystem_id: d.subsystem_id,
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
              {current?.device_name ?? placeholder}
            </span>
          </span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search devices…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No matching devices.</CommandEmpty>
            {grouped.map(([label, items]) => (
              <CommandGroup key={label} heading={label}>
                {items.map((d) => (
                  <CommandItem
                    key={d.device_id}
                    value={`${d.device_name} ${d.searchKey}`}
                    onSelect={() => handleSelect(d)}
                    className="flex items-center gap-2"
                  >
                    <Check
                      className={cn(
                        "h-3 w-3",
                        value === d.device_id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {d.is_safety && (
                      <ShieldAlert className="h-3 w-3 text-red-400 shrink-0" />
                    )}
                    <span className="font-mono truncate flex-1">
                      {d.device_name}
                    </span>
                    <Badge
                      variant="outline"
                      className="h-4 px-1 text-[9px] font-mono"
                    >
                      {d.device_class}
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
