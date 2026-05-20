import { useState } from "react";
import { useBuilderParentRef } from "./use-builder-parent-ref";
import { useQuoteRevision, useUpdateQuoteRevision } from "@/hooks/use-quotes";
import { useVariation, useUpdateVariation } from "@/hooks/use-variations";

export function SectionSummary() {
  const ref = useBuilderParentRef();

  const isQuote = ref?.parent_type === "quote_revision";
  const isVariation = ref?.parent_type === "variation";

  const { data: rev } = useQuoteRevision(isQuote ? ref.parent_id : undefined);
  const { data: variation } = useVariation(
    isVariation ? ref.parent_id : undefined,
  );

  const updateRev = useUpdateQuoteRevision();
  const updateVariation = useUpdateVariation();

  const record = isQuote ? rev : variation;

  const [contactName, setContactName] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const displayContact = contactName ?? record?.contact_name ?? "";
  const displaySummary = summary ?? record?.summary ?? "";

  const isPending = updateRev.isPending || updateVariation.isPending;
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  function persist() {
    if (!ref) return;
    const contact = displayContact === "" ? null : displayContact;
    const text = displaySummary === "" ? null : displaySummary;
    const onSuccess = () => setSavedAt(new Date());
    if (isQuote) {
      updateRev.mutate(
        { id: ref.parent_id, updates: { contact_name: contact, summary: text } },
        { onSuccess },
      );
    } else if (isVariation) {
      updateVariation.mutate(
        { id: ref.parent_id, updates: { contact_name: contact, summary: text } },
        { onSuccess },
      );
    }
  }

  if (!ref) return null;

  return (
    <section className="space-y-4 max-w-2xl">
      <header>
        <h2 className="text-lg font-semibold text-zinc-100">Introduction</h2>
        <p className="text-xs font-mono text-zinc-500 mt-1">
          Personalises the opening of the document. The intro letter reads:{" "}
          <span className="text-zinc-400">Hi [contact], Pac Technologies is pleased to present…</span>
        </p>
      </header>

      <label className="block space-y-1">
        <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
          Contact name
        </span>
        <input
          type="text"
          value={displayContact}
          onChange={(e) => setContactName(e.target.value)}
          onBlur={persist}
          placeholder="e.g. John Smith"
          className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-sm text-zinc-200 focus:border-[#3050A0] outline-none"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
          Additional notes (optional)
        </span>
        <textarea
          value={displaySummary}
          onChange={(e) => setSummary(e.target.value)}
          onBlur={persist}
          placeholder="Any additional context for the client — describes the scope of works, site conditions, etc."
          rows={6}
          className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-sm text-zinc-200 focus:border-[#3050A0] outline-none resize-y"
        />
      </label>

      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono text-zinc-500">
          {isPending
            ? "Saving…"
            : savedAt
              ? `Saved ${savedAt.toLocaleTimeString()}`
              : "Auto-saves on blur"}
        </span>
        <button
          onClick={persist}
          disabled={isPending}
          className="text-xs font-mono px-3 py-1.5 rounded bg-[#3050A0] text-white hover:bg-[#3F61B0] disabled:opacity-50"
        >
          Save now
        </button>
      </div>
    </section>
  );
}
