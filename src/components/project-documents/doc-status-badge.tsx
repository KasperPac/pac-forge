import type { DocState } from "@/lib/doc-control";

const STYLES: Record<DocState, { label: string; cls: string }> = {
  conforming: {
    label: "Conforming",
    cls: "bg-pac-signal-green-bg text-pac-signal-green border-pac-signal-green/30",
  },
  non_conforming: {
    label: "Non-conforming",
    cls: "bg-pac-signal-red-bg text-pac-signal-red border-pac-signal-red/30",
  },
  needs_review: {
    label: "Needs review",
    cls: "bg-pac-signal-amber-bg text-pac-signal-amber border-pac-signal-amber/30",
  },
  customer_supplied: {
    label: "Customer-supplied",
    cls: "bg-muted text-muted-foreground border-border",
  },
};

export function DocStatusBadge({ state }: { state: DocState }) {
  const s = STYLES[state];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border ${s.cls}`}
    >
      {s.label}
    </span>
  );
}
