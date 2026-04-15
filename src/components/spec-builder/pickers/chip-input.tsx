/**
 * ChipInput — mixed free text + tag chips, authored inline.
 *
 * Implementation approach (Wave B, token-based not contenteditable):
 *   - Internal state is an array of tokens: `{ kind: "text" } | { kind: "tag" }`.
 *   - Text tokens render as small `<input>`s; tag tokens render as `Badge`
 *     chips with an `x`. The `@` key on any text input opens a TagPicker
 *     popover at that position; selecting a tag splits the current text
 *     token and inserts a tag token between.
 *
 * A true contenteditable widget is overkill for the V2 shipping target —
 * this token model serialises predictably and preserves `referenced_tags`
 * order.
 */
import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TagPicker, type ResolvedTag } from "./tag-picker";
import { cn } from "@/lib/utils";

type Token = { kind: "text"; value: string } | { kind: "tag"; tag: string };

export interface ChipInputValue {
  text: string;
  referenced_tags: string[];
}

export interface ChipInputProps {
  value: ChipInputValue;
  onChange: (value: ChipInputValue) => void;
  specProjectId?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Parse a serialized {text, referenced_tags} pair into tokens.
 * Tags are located by literal substring match of each referenced tag name
 * (longest first) inside the text.
 */
export function parseChipTokens(value: ChipInputValue): Token[] {
  if (!value.text) return [{ kind: "text", value: "" }];
  const tags = [...value.referenced_tags].sort((a, b) => b.length - a.length);
  if (tags.length === 0) return [{ kind: "text", value: value.text }];

  const tokens: Token[] = [];
  let cursor = 0;
  const text = value.text;
  while (cursor < text.length) {
    // Find earliest tag match starting at or after cursor.
    let nextIdx = -1;
    let nextTag = "";
    for (const t of tags) {
      const i = text.indexOf(t, cursor);
      if (i !== -1 && (nextIdx === -1 || i < nextIdx)) {
        nextIdx = i;
        nextTag = t;
      }
    }
    if (nextIdx === -1) {
      tokens.push({ kind: "text", value: text.slice(cursor) });
      break;
    }
    if (nextIdx > cursor) {
      tokens.push({ kind: "text", value: text.slice(cursor, nextIdx) });
    }
    tokens.push({ kind: "tag", tag: nextTag });
    cursor = nextIdx + nextTag.length;
  }
  return tokens;
}

function serializeTokens(tokens: Token[]): ChipInputValue {
  const parts: string[] = [];
  const tags: string[] = [];
  for (const tok of tokens) {
    if (tok.kind === "text") parts.push(tok.value);
    else {
      parts.push(tok.tag);
      tags.push(tok.tag);
    }
  }
  return { text: parts.join(""), referenced_tags: Array.from(new Set(tags)) };
}

export function ChipInput({
  value,
  onChange,
  specProjectId,
  placeholder = "Type expression. @ to insert tag.",
  disabled,
  className,
}: ChipInputProps) {
  const tokens = useMemo(() => parseChipTokens(value), [value]);
  const [pickerOpenAt, setPickerOpenAt] = useState<number | null>(null);

  const update = (next: Token[]) => {
    onChange(serializeTokens(next));
  };

  const updateText = (idx: number, v: string) => {
    // If user typed "@" at the end, open picker and strip the "@".
    if (v.endsWith("@")) {
      const next = [...tokens];
      next[idx] = { kind: "text", value: v.slice(0, -1) };
      update(next);
      setPickerOpenAt(idx);
      return;
    }
    const next = [...tokens];
    next[idx] = { kind: "text", value: v };
    update(next);
  };

  const insertTagAfter = (idx: number, tag: ResolvedTag) => {
    // Split: keep text token up to idx, append tag token + new empty text
    // token for continued typing.
    const next: Token[] = [];
    for (let i = 0; i <= idx; i++) next.push(tokens[i]);
    next.push({ kind: "tag", tag: tag.tag });
    next.push({ kind: "text", value: "" });
    for (let i = idx + 1; i < tokens.length; i++) next.push(tokens[i]);
    update(next);
    setPickerOpenAt(null);
  };

  const removeTag = (idx: number) => {
    // Merge neighbouring text tokens if present.
    const next: Token[] = [];
    for (let i = 0; i < tokens.length; i++) {
      if (i === idx) continue;
      const prev = next[next.length - 1];
      const cur = tokens[i];
      if (prev && prev.kind === "text" && cur.kind === "text") {
        next[next.length - 1] = {
          kind: "text",
          value: prev.value + cur.value,
        };
      } else {
        next.push(cur);
      }
    }
    update(next);
  };

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1 rounded-md border border-neutral-800 bg-background p-1 min-h-[28px]",
        disabled && "opacity-50 pointer-events-none",
        className,
      )}
    >
      {tokens.map((tok, i) =>
        tok.kind === "tag" ? (
          <Badge
            key={`tag-${i}`}
            variant="secondary"
            className="h-5 px-1.5 text-[10px] font-mono gap-1 group"
          >
            <span>{tok.tag}</span>
            <button
              type="button"
              onClick={() => removeTag(i)}
              className="opacity-60 hover:opacity-100"
              aria-label={`Remove ${tok.tag}`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </Badge>
        ) : (
          <Popover
            key={`txt-${i}`}
            open={pickerOpenAt === i}
            onOpenChange={(o) => setPickerOpenAt(o ? i : null)}
          >
            <PopoverTrigger asChild>
              <Input
                className={cn(
                  "h-6 text-xs border-0 shadow-none px-1 min-w-[80px] flex-1",
                  "focus-visible:ring-0 focus-visible:ring-offset-0",
                )}
                value={tok.value}
                disabled={disabled}
                placeholder={i === 0 && tokens.length === 1 ? placeholder : ""}
                onChange={(e) => updateText(i, e.target.value)}
              />
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[380px]" align="start">
              <TagPicker
                value={null}
                specProjectId={specProjectId}
                onChange={(r) => {
                  if (r) insertTagAfter(i, r);
                }}
              />
            </PopoverContent>
          </Popover>
        ),
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-5 w-5 shrink-0"
        disabled={disabled}
        onClick={() => {
          const lastIdx = tokens.length - 1;
          setPickerOpenAt(
            lastIdx >= 0 && tokens[lastIdx].kind === "text" ? lastIdx : null,
          );
        }}
        aria-label="Insert tag"
      >
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );
}
