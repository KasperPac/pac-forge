import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { Plus, Trash2 } from "lucide-react";
import { useTncTemplates } from "@/hooks/use-tnc-templates";
import { useTncClauses } from "@/hooks/use-tnc-clauses";
import {
  useTncSelection,
  useUpsertTncSelection,
  useTncOverride,
  useUpsertTncOverride,
  useClearTncOverride,
} from "@/hooks/use-doc-tnc";
import type { ParentRef } from "@/hooks/use-doc-content";
import type { CustomClauseDraft, TncTemplate } from "@/types";
import { cn } from "@/lib/utils";

export function SectionTnc() {
  const { revId } = useParams<{ revId: string }>();
  const ref: ParentRef = {
    parent_type: "quote_revision",
    parent_id: revId ?? "",
  };

  const { data: templates = [] } = useTncTemplates();
  const { data: selection } = useTncSelection(revId ? ref : undefined);
  const { data: override } = useTncOverride(revId ? ref : undefined);

  const activeTemplateId = selection?.template_id ?? defaultTemplateId(templates);
  const { data: clauses = [] } = useTncClauses(activeTemplateId ?? undefined);
  const upsertSel = useUpsertTncSelection();
  const upsertOverride = useUpsertTncOverride();
  const clearOverride = useClearTncOverride();

  // Override pane visibility:
  //   - if the server has an override row, it's open.
  //   - otherwise the user can manually open it to start writing one.
  const [overrideManuallyOpen, setOverrideManuallyOpen] = useState(false);
  const overrideOpen = !!override || overrideManuallyOpen;

  const omittedSet = useMemo(
    () => new Set(selection?.omitted_clause_ids ?? []),
    [selection],
  );

  function persistSelection(patch: {
    template_id?: string | null;
    omitted_clause_ids?: string[];
    added_custom_clauses?: CustomClauseDraft[];
  }) {
    if (!revId) return;
    upsertSel.mutate({
      ...ref,
      template_id: patch.template_id ?? selection?.template_id ?? activeTemplateId ?? null,
      omitted_clause_ids:
        patch.omitted_clause_ids ?? selection?.omitted_clause_ids ?? [],
      added_custom_clauses:
        patch.added_custom_clauses ?? selection?.added_custom_clauses ?? [],
    });
  }

  function selectTemplate(id: string) {
    persistSelection({
      template_id: id,
      omitted_clause_ids: [],
      added_custom_clauses: selection?.added_custom_clauses ?? [],
    });
  }

  function toggleOmit(clauseId: string) {
    const next = omittedSet.has(clauseId)
      ? (selection?.omitted_clause_ids ?? []).filter((id) => id !== clauseId)
      : [...(selection?.omitted_clause_ids ?? []), clauseId];
    persistSelection({ omitted_clause_ids: next });
  }

  function addCustomClause() {
    if (!revId) return;
    const customs = selection?.added_custom_clauses ?? [];
    const next: CustomClauseDraft[] = [
      ...customs,
      {
        clause_number: "",
        title: "New custom clause",
        body_markdown: "",
      },
    ];
    persistSelection({ added_custom_clauses: next });
  }

  function patchCustomClause(idx: number, patch: Partial<CustomClauseDraft>) {
    const customs = selection?.added_custom_clauses ?? [];
    const next = customs.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    persistSelection({ added_custom_clauses: next });
  }

  function removeCustomClause(idx: number) {
    const customs = selection?.added_custom_clauses ?? [];
    const next = customs.filter((_, i) => i !== idx);
    persistSelection({ added_custom_clauses: next });
  }

  return (
    <section className="space-y-4 max-w-3xl">
      <header>
        <h2 className="text-lg font-semibold text-zinc-100">
          Terms &amp; Conditions
        </h2>
        <p className="text-xs font-mono text-zinc-500 mt-1">
          Pick a template, drop clauses you don't want, append customs, or
          override entirely.
        </p>
      </header>

      {!overrideOpen && (
        <>
          <div className="space-y-2">
            <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
              Template
            </span>
            <ul className="space-y-1.5" aria-label="T&Cs templates">
              {templates
                .filter((t) => t.status === "active")
                .map((t) => {
                  const checked = activeTemplateId === t.id;
                  return (
                    <li key={t.id}>
                      <label
                        className={cn(
                          "flex items-center justify-between gap-3 px-3 py-2 rounded border cursor-pointer",
                          checked
                            ? "border-[#3050A0] bg-[#3050A0]/15 text-white"
                            : "border-zinc-800 text-zinc-300 hover:border-zinc-600",
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="tnc-template"
                            value={t.id}
                            checked={checked}
                            onChange={() => selectTemplate(t.id)}
                            className="accent-[#3050A0]"
                          />
                          <span>
                            {t.name}{" "}
                            <span className="text-[10px] font-mono text-zinc-500 ml-1">
                              v{t.version}
                            </span>
                          </span>
                        </span>
                        {t.is_default ? (
                          <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                            default
                          </span>
                        ) : null}
                      </label>
                    </li>
                  );
                })}
              {templates.length === 0 && (
                <li className="text-xs text-zinc-500">
                  No T&Cs templates configured. Visit{" "}
                  <span className="font-mono">/tnc</span> to add one.
                </li>
              )}
            </ul>
          </div>

          {activeTemplateId && clauses.length > 0 && (
            <div className="space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
                Clauses ({clauses.length - omittedSet.size}/{clauses.length} kept)
              </span>
              <ul className="space-y-1.5">
                {clauses.map((c) => {
                  const kept = !omittedSet.has(c.id);
                  return (
                    <li
                      key={c.id}
                      className={cn(
                        "rounded border px-3 py-2",
                        kept
                          ? "border-zinc-800 bg-zinc-900"
                          : "border-zinc-900 bg-zinc-950/60 opacity-60",
                      )}
                    >
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={kept}
                          onChange={() => toggleOmit(c.id)}
                          className="mt-1 accent-[#3050A0]"
                          aria-label={`Include clause ${c.clause_number || c.title}`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-zinc-100 font-medium">
                            <span className="text-[#3050A0] font-mono mr-2">
                              {c.clause_number}
                            </span>
                            {c.title}
                          </div>
                          {c.body_markdown && (
                            <p className="text-xs font-mono text-zinc-400 mt-1 whitespace-pre-wrap line-clamp-3">
                              {c.body_markdown}
                            </p>
                          )}
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
                Custom clauses ({(selection?.added_custom_clauses ?? []).length})
              </span>
              <button
                type="button"
                onClick={addCustomClause}
                disabled={!revId || upsertSel.isPending}
                className="inline-flex items-center gap-1 text-xs font-mono px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                <Plus className="h-3 w-3" />
                Add custom clause
              </button>
            </div>
            {(selection?.added_custom_clauses ?? []).map((c, idx) => (
              <div
                key={idx}
                className="rounded border border-zinc-800 bg-zinc-900 p-3 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <input
                    aria-label="Custom clause number"
                    defaultValue={c.clause_number}
                    placeholder="No."
                    className="w-16 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs font-mono text-zinc-200 focus:border-[#3050A0] outline-none"
                    onBlur={(e) =>
                      patchCustomClause(idx, { clause_number: e.target.value })
                    }
                  />
                  <input
                    aria-label="Custom clause title"
                    defaultValue={c.title}
                    placeholder="Clause title"
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm text-zinc-100 focus:border-[#3050A0] outline-none"
                    onBlur={(e) =>
                      patchCustomClause(idx, { title: e.target.value })
                    }
                  />
                  <button
                    type="button"
                    aria-label="Remove custom clause"
                    onClick={() => removeCustomClause(idx)}
                    className="text-zinc-500 hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <textarea
                  aria-label="Custom clause body"
                  defaultValue={c.body_markdown}
                  rows={3}
                  placeholder="Clause body (markdown)…"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-xs font-mono text-zinc-300 focus:border-[#3050A0] outline-none"
                  onBlur={(e) =>
                    patchCustomClause(idx, { body_markdown: e.target.value })
                  }
                />
              </div>
            ))}
          </div>
        </>
      )}

      <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-sm text-zinc-200">Override entire T&amp;Cs</span>
          <input
            type="checkbox"
            checked={overrideOpen}
            onChange={(e) => {
              if (!e.target.checked && override) {
                clearOverride.mutate(ref);
              }
              setOverrideManuallyOpen(e.target.checked);
            }}
            className="accent-[#3050A0]"
            aria-label="Override entire T&Cs"
          />
        </label>
        {overrideOpen && (
          <div className="space-y-2">
            <p className="text-[11px] font-mono text-zinc-500">
              When set, replaces the structured selection in the final document.
            </p>
            <textarea
              key={override?.id ?? "new-override"}
              defaultValue={override?.body_markdown ?? ""}
              onBlur={(e) => {
                if (!revId) return;
                upsertOverride.mutate({
                  ...ref,
                  body_markdown: e.target.value,
                });
              }}
              rows={10}
              placeholder="Override the entire T&Cs section with this markdown…"
              className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-xs font-mono text-zinc-200 focus:border-[#3050A0] outline-none"
              aria-label="Override body markdown"
            />
            {override && (
              <button
                type="button"
                onClick={() => {
                  clearOverride.mutate(ref);
                  setOverrideManuallyOpen(false);
                }}
                className="text-xs font-mono text-red-400 hover:underline"
              >
                Clear override
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function defaultTemplateId(templates: TncTemplate[]): string | undefined {
  const def = templates.find((t) => t.is_default && t.status === "active");
  if (def) return def.id;
  return templates.find((t) => t.status === "active")?.id;
}
