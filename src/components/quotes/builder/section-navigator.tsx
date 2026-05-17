import { cn } from "@/lib/utils";
import {
  BUILDER_SECTIONS,
  BUILDER_SECTION_LABELS,
  useQuoteBuilderStore,
} from "@/stores/quote-builder-store";

export function SectionNavigator() {
  const activeSection = useQuoteBuilderStore((s) => s.activeSection);
  const setActive = useQuoteBuilderStore((s) => s.setActive);

  return (
    <nav className="flex flex-col gap-1 p-3 text-sm" aria-label="Quote sections">
      {BUILDER_SECTIONS.map((s) => {
        const isActive = activeSection === s;
        return (
          <button
            key={s}
            type="button"
            onClick={() => setActive(s)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "text-left px-3 py-2 rounded border font-mono text-xs transition-colors",
              isActive
                ? "bg-[#3050A0]/20 border-[#3050A0] text-white"
                : "border-transparent text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200",
            )}
          >
            {BUILDER_SECTION_LABELS[s]}
          </button>
        );
      })}
    </nav>
  );
}
