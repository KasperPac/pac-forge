/**
 * StatePicker — grouped by state_pattern (static / sequential).
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
import { usePickerIndex, type IndexedState } from "./use-picker-index";
import { cn } from "@/lib/utils";

export interface ResolvedState {
  state_id: string;
  state_name: string;
  state_pattern: "static" | "sequential";
}

export interface StatePickerProps {
  value: string | null;
  onChange: (resolved: ResolvedState | null) => void;
  specProjectId?: string;
  filter?: { pattern?: "static" | "sequential" };
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function StatePicker({
  value,
  onChange,
  specProjectId,
  filter,
  placeholder = "Pick a state…",
  disabled,
  className,
}: StatePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: contract } = useSpecContract(specProjectId);
  const index = usePickerIndex(contract);

  const filtered = useMemo(() => {
    let list = index.states;
    if (filter?.pattern)
      list = list.filter((s) => s.state_pattern === filter.pattern);
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter((s) => s.searchKey.includes(q));
  }, [index.states, filter, query]);

  const grouped = useMemo(() => {
    const stat = filtered.filter((s) => s.state_pattern === "static");
    const seq = filtered.filter((s) => s.state_pattern === "sequential");
    return [
      ["Static", stat] as const,
      ["Sequential", seq] as const,
    ].filter(([, items]) => items.length > 0);
  }, [filtered]);

  const current = value
    ? (index.states.find((s) => s.state_id === value) ?? null)
    : null;

  const handleSelect = (s: IndexedState) => {
    onChange({
      state_id: s.state_id,
      state_name: s.state_name,
      state_pattern: s.state_pattern,
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
          <span className="truncate">{current?.state_name ?? placeholder}</span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search states…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No matching states.</CommandEmpty>
            {grouped.map(([label, items]) => (
              <CommandGroup key={label} heading={label}>
                {items.map((s) => (
                  <CommandItem
                    key={s.state_id}
                    value={`${s.state_id} ${s.searchKey}`}
                    onSelect={() => handleSelect(s)}
                    className="flex items-center gap-2"
                  >
                    <Check
                      className={cn(
                        "h-3 w-3",
                        value === s.state_id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <Badge
                      variant="outline"
                      className="h-4 px-1 text-[9px] font-mono"
                    >
                      {s.state_id}
                    </Badge>
                    <span className="truncate flex-1">{s.state_name}</span>
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
