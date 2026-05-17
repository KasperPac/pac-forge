import { cn } from "@/lib/utils";

interface BuilderFooterProps {
  total: number;
  status?: string | null;
  canIssue?: boolean;
  onIssue?: () => void;
}

const aud = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

export function BuilderFooter({
  total,
  status,
  canIssue = false,
  onIssue,
}: BuilderFooterProps) {
  return (
    <footer className="flex items-center justify-between gap-3 px-6 py-3 border-t border-zinc-800 bg-zinc-950">
      <div className="text-xs font-mono text-zinc-500">
        {status ?? "Draft — autosaves on edit."}
      </div>
      <div className="flex items-center gap-4">
        <div className="font-mono text-sm text-zinc-400">
          Total{" "}
          <span className="text-white" data-testid="builder-total">
            {aud.format(total)}
          </span>
        </div>
        <button
          type="button"
          disabled={!canIssue}
          onClick={onIssue}
          className={cn(
            "px-4 py-2 rounded font-mono text-xs uppercase tracking-wide transition-colors",
            canIssue
              ? "bg-[#3050A0] text-white hover:bg-[#3F61B0]"
              : "bg-[#3050A0] text-white opacity-40 cursor-not-allowed",
          )}
        >
          Issue
        </button>
      </div>
    </footer>
  );
}
