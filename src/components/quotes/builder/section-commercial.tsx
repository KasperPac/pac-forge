import { useState } from "react";
import { useParams } from "react-router";
import {
  useCommercialTerms,
  useUpsertCommercialTerms,
  type ParentRef,
} from "@/hooks/use-doc-content";
import type { DocCommercialTerms } from "@/types";

interface CommercialFormProps {
  initial: DocCommercialTerms | null;
  refId: ParentRef;
  isPending: boolean;
  savedAt: Date | null;
  onSave: (form: CommercialFormState) => void;
}

interface CommercialFormState {
  payment_schedule: string;
  validity: string;
  gst_treatment: string;
  currency: string;
  notes: string;
}

const GST_OPTIONS = ["Excludes GST", "Includes GST", "Not applicable"];

function makeInitial(initial: DocCommercialTerms | null): CommercialFormState {
  return {
    payment_schedule: initial?.payment_schedule ?? "",
    validity: initial?.validity ?? "",
    gst_treatment: initial?.gst_treatment ?? "",
    currency: initial?.currency ?? "AUD",
    notes: initial?.notes ?? "",
  };
}

function CommercialForm({
  initial,
  isPending,
  savedAt,
  onSave,
}: CommercialFormProps) {
  const [form, setForm] = useState<CommercialFormState>(() => makeInitial(initial));

  function patch<K extends keyof CommercialFormState>(
    key: K,
    value: CommercialFormState[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function persist() {
    onSave(form);
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        persist();
      }}
    >
      <Field label="Payment schedule">
        <textarea
          value={form.payment_schedule}
          onChange={(e) => patch("payment_schedule", e.target.value)}
          onBlur={persist}
          placeholder="30% deposit · 60% on delivery · 10% on commissioning"
          rows={3}
          className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-sm font-mono text-zinc-200 focus:border-[#3050A0] outline-none"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Validity period">
          <input
            value={form.validity}
            onChange={(e) => patch("validity", e.target.value)}
            onBlur={persist}
            placeholder="30 days"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm font-mono text-zinc-200 focus:border-[#3050A0] outline-none"
          />
        </Field>
        <Field label="Currency">
          <input
            value={form.currency}
            onChange={(e) => patch("currency", e.target.value)}
            onBlur={persist}
            placeholder="AUD"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm font-mono text-zinc-200 focus:border-[#3050A0] outline-none"
          />
        </Field>
      </div>

      <Field label="GST treatment">
        <div className="flex flex-wrap gap-2">
          {GST_OPTIONS.map((opt) => (
            <label
              key={opt}
              className={`text-xs font-mono px-3 py-1.5 rounded border cursor-pointer ${
                form.gst_treatment === opt
                  ? "border-[#3050A0] text-white bg-[#3050A0]/20"
                  : "border-zinc-800 text-zinc-300 hover:border-zinc-600"
              }`}
            >
              <input
                type="radio"
                name="gst_treatment"
                className="sr-only"
                value={opt}
                checked={form.gst_treatment === opt}
                onChange={() => {
                  const next = { ...form, gst_treatment: opt };
                  setForm(next);
                  onSave(next);
                }}
              />
              {opt}
            </label>
          ))}
        </div>
      </Field>

      <Field label="Notes">
        <textarea
          value={form.notes}
          onChange={(e) => patch("notes", e.target.value)}
          onBlur={persist}
          placeholder="Anything else the customer should see under Commercial Terms…"
          rows={3}
          className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-sm font-mono text-zinc-200 focus:border-[#3050A0] outline-none"
        />
      </Field>

      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono text-zinc-500">
          {isPending
            ? "Saving…"
            : savedAt
              ? `Saved ${savedAt.toLocaleTimeString()}`
              : "Auto-saves on blur"}
        </span>
        <button
          type="submit"
          className="text-xs font-mono px-3 py-1.5 rounded bg-[#3050A0] text-white hover:bg-[#3F61B0] disabled:opacity-50"
          disabled={isPending}
        >
          Save now
        </button>
      </div>
    </form>
  );
}

export function SectionCommercial() {
  const { revId } = useParams<{ revId: string }>();
  const ref: ParentRef = {
    parent_type: "quote_revision",
    parent_id: revId ?? "",
  };

  const { data: terms, isLoading } = useCommercialTerms(revId ? ref : undefined);
  const upsert = useUpsertCommercialTerms();
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  function onSave(form: CommercialFormState) {
    if (!revId) return;
    upsert.mutate(
      {
        ...ref,
        payment_schedule: form.payment_schedule || null,
        validity: form.validity || null,
        gst_treatment: form.gst_treatment || null,
        currency: form.currency || null,
        notes: form.notes || null,
      },
      {
        onSuccess: () => setSavedAt(new Date()),
      },
    );
  }

  return (
    <section className="space-y-4 max-w-2xl">
      <header>
        <h2 className="text-lg font-semibold text-zinc-100">Commercial Terms</h2>
        <p className="text-xs font-mono text-zinc-500 mt-1">
          Payment, validity, GST treatment, currency, notes.
        </p>
      </header>

      {isLoading ? (
        <p className="text-xs font-mono text-zinc-500">Loading…</p>
      ) : (
        // Key by row id (or "new") so initial form values lock in on hydration
        // without a setState-inside-effect.
        <CommercialForm
          key={terms?.id ?? "new"}
          initial={terms ?? null}
          refId={ref}
          isPending={upsert.isPending}
          savedAt={savedAt}
          onSave={onSave}
        />
      )}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      {children}
    </label>
  );
}
