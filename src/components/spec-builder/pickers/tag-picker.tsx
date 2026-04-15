/**
 * TagPicker — popover + cmdk combobox, grouped subsystem / assembly / device.
 * Resolves a tag name into a full `ResolvedTag` (ids + tier + direction).
 *
 * Virtualises the flat list via @tanstack/react-virtual when items > 150.
 * When `tier === "fb_instance"` filter is active, any matching tags whose
 * owning device does not yet have an FB assignment render disabled with a
 * tooltip. (FB-assignment status is not part of the contract yet, so for
 * Wave B we display every matching tag and rely on `filter.tier` to
 * prune — the "FB assignment pending" state is visually reserved for a
 * future enrichment pass.)
 */
import * as React from "react";
import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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
import { usePickerIndex, type IndexedTag } from "./use-picker-index";
import type { SignalType, IoSignalTier } from "@/types/spec-contract-v2";
import { cn } from "@/lib/utils";

const VIRTUAL_THRESHOLD = 150;

export interface ResolvedTag {
  tag: string;
  signal_type: SignalType;
  signal_direction: "input" | "output" | "internal";
  io_address: string;
  device_id: string;
  assembly_id: string;
  subsystem_id: string;
  tier: IoSignalTier;
}

export interface TagPickerProps {
  value: string | null;
  onChange: (resolved: ResolvedTag | null) => void;
  specProjectId?: string;
  filter?: {
    subsystemId?: string;
    assemblyId?: string;
    deviceId?: string;
    signalDirection?: "input" | "output" | "internal";
    tier?: IoSignalTier;
    /** Restrict to numeric signals (AI/AO) — used by tag_compare. */
    numericOnly?: boolean;
  };
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

function SignalBadge({ tag }: { tag: IndexedTag }) {
  const color =
    tag.signal_direction === "input"
      ? "bg-blue-500/15 text-blue-300 border-blue-500/30"
      : tag.signal_direction === "output"
        ? "bg-blue-500/15 text-blue-300 border-blue-500/30"
        : "bg-neutral-500/15 text-neutral-300 border-neutral-500/30";
  const analog =
    tag.signal_type === "AI" || tag.signal_type === "AO"
      ? "bg-green-500/15 text-green-300 border-green-500/30"
      : null;
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-4 px-1 text-[9px] font-mono",
        analog ?? color,
      )}
    >
      {tag.signal_type}
    </Badge>
  );
}

export function TagPicker({
  value,
  onChange,
  specProjectId,
  filter,
  placeholder = "Pick a tag…",
  disabled,
  className,
}: TagPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: contract } = useSpecContract(specProjectId);
  const index = usePickerIndex(contract);

  const filtered = useMemo(() => {
    let list = index.tags;
    if (filter?.subsystemId)
      list = list.filter((t) => t.subsystem_id === filter.subsystemId);
    if (filter?.assemblyId)
      list = list.filter((t) => t.assembly_id === filter.assemblyId);
    if (filter?.deviceId)
      list = list.filter((t) => t.device_id === filter.deviceId);
    if (filter?.signalDirection)
      list = list.filter((t) => t.signal_direction === filter.signalDirection);
    if (filter?.tier) list = list.filter((t) => t.tier === filter.tier);
    if (filter?.numericOnly)
      list = list.filter(
        (t) => t.signal_type === "AI" || t.signal_type === "AO",
      );
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter((t) => t.searchKey.includes(q));
  }, [index.tags, filter, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, IndexedTag[]>();
    for (const t of filtered) {
      const bucket = map.get(t.groupLabel) ?? [];
      bucket.push(t);
      map.set(t.groupLabel, bucket);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const current = value
    ? (index.tags.find((t) => t.tag === value) ?? null)
    : null;

  const handleSelect = (tag: IndexedTag) => {
    onChange({
      tag: tag.tag,
      signal_type: tag.signal_type,
      signal_direction: tag.signal_direction,
      io_address: tag.io_address,
      device_id: tag.device_id,
      assembly_id: tag.assembly_id,
      subsystem_id: tag.subsystem_id,
      tier: tag.tier,
    });
    setOpen(false);
  };

  const useVirtual = filtered.length > VIRTUAL_THRESHOLD;

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
            {current?.is_safety && (
              <ShieldAlert className="h-3 w-3 text-red-400 shrink-0" />
            )}
            <span className="truncate">{value ?? placeholder}</span>
          </span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search tags…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No matching tags.</CommandEmpty>
            {useVirtual ? (
              <VirtualTagList
                tags={filtered}
                value={value}
                onSelect={handleSelect}
              />
            ) : (
              grouped.map(([label, items]) => (
                <CommandGroup key={label} heading={label}>
                  {items.map((t) => (
                    <CommandItem
                      key={`${t.device_id}:${t.tag}`}
                      value={`${t.tag} ${t.searchKey}`}
                      onSelect={() => handleSelect(t)}
                      className="flex items-center gap-2"
                    >
                      <Check
                        className={cn(
                          "h-3 w-3",
                          value === t.tag ? "opacity-100" : "opacity-0",
                        )}
                      />
                      {t.is_safety && (
                        <ShieldAlert className="h-3 w-3 text-red-400 shrink-0" />
                      )}
                      <span className="font-mono truncate flex-1">{t.tag}</span>
                      <SignalBadge tag={t} />
                      <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                        {t.io_address}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function VirtualTagList({
  tags,
  value,
  onSelect,
}: {
  tags: IndexedTag[];
  value: string | null;
  onSelect: (t: IndexedTag) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: tags.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 8,
  });
  return (
    <div ref={parentRef} className="max-h-[280px] overflow-auto">
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((vi) => {
          const t = tags[vi.index];
          return (
            <div
              key={`${t.device_id}:${t.tag}`}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: vi.size,
                transform: `translateY(${vi.start}px)`,
              }}
            >
              <button
                type="button"
                onClick={() => onSelect(t)}
                className="flex h-full w-full items-center gap-2 rounded-sm px-2 text-left text-xs hover:bg-accent"
              >
                <Check
                  className={cn(
                    "h-3 w-3",
                    value === t.tag ? "opacity-100" : "opacity-0",
                  )}
                />
                {t.is_safety && (
                  <ShieldAlert className="h-3 w-3 text-red-400 shrink-0" />
                )}
                <span className="font-mono truncate flex-1">{t.tag}</span>
                <SignalBadge tag={t} />
                <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                  {t.io_address}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
