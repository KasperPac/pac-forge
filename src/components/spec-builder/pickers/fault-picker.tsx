/**
 * FaultPicker — flat list sourced from contract.faults.
 */
import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, AlertTriangle } from "lucide-react";

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
import { usePickerIndex, type IndexedFault } from "./use-picker-index";
import { cn } from "@/lib/utils";

export interface ResolvedFault {
  fault_code: string;
  description: string;
  severity: "warning" | "fault";
}

export interface FaultPickerProps {
  value: string | null;
  onChange: (resolved: ResolvedFault | null) => void;
  specProjectId?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function FaultPicker({
  value,
  onChange,
  specProjectId,
  placeholder = "Pick a fault…",
  disabled,
  className,
}: FaultPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: contract } = useSpecContract(specProjectId);
  const index = usePickerIndex(contract);

  const filtered = useMemo(() => {
    const list = index.faults;
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter((f) => f.searchKey.includes(q));
  }, [index.faults, query]);

  const current = value
    ? (index.faults.find((f) => f.fault_code === value) ?? null)
    : null;

  const handleSelect = (f: IndexedFault) => {
    onChange({
      fault_code: f.fault_code,
      description: f.description,
      severity: f.severity,
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
            "h-7 w-full justify-between gap-2 px-2 text-xs font-mono",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <span className="flex items-center gap-1.5 truncate">
            {current?.severity === "fault" && (
              <AlertTriangle className="h-3 w-3 text-red-400 shrink-0" />
            )}
            <span className="truncate">{value ?? placeholder}</span>
          </span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search faults…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No matching faults.</CommandEmpty>
            <CommandGroup>
              {filtered.map((f) => (
                <CommandItem
                  key={f.fault_code}
                  value={`${f.fault_code} ${f.searchKey}`}
                  onSelect={() => handleSelect(f)}
                  className="flex items-center gap-2"
                >
                  <Check
                    className={cn(
                      "h-3 w-3",
                      value === f.fault_code ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="font-mono text-[10px] shrink-0">
                    {f.fault_code}
                  </span>
                  <span className="truncate flex-1">{f.description}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "h-4 px-1 text-[9px] font-mono",
                      f.severity === "fault"
                        ? "bg-red-500/15 text-red-300 border-red-500/30"
                        : "bg-amber-500/15 text-amber-300 border-amber-500/30",
                    )}
                  >
                    {f.severity}
                  </Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
