import { Fragment, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { lineItems } from "@/hooks/use-doc-content";
import { computeLineSubtotal } from "@/lib/quote-totals";
import {
  LINE_ITEM_CATEGORIES,
  LINE_ITEM_CATEGORY_LABELS,
} from "@/types";
import type {
  DocLineItem,
  DocLineItemCreate,
  LineItemCategory,
} from "@/types";
import { cn } from "@/lib/utils";
import {
  useCitationsForVariation,
  useDeleteCitation,
} from "@/hooks/use-variation-citations";
import { useVariationBuilderCtx } from "./variation-builder-context";
import { useBuilderParentRef } from "./use-builder-parent-ref";
import { CiteOriginalButton } from "./cite-original-button";
import { AmendsBanner } from "./amends-banner";
import { CitationPickerDialog } from "./citation-picker-dialog";

type CalcMode = "qty" | "hours";

function inferCalcMode(row: DocLineItem): CalcMode {
  if (row.hours != null || row.hour_rate != null) return "hours";
  return "qty";
}

const aud = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

function fmtSubtotal(row: DocLineItem): string {
  const v = computeLineSubtotal(row);
  return v == null ? "—" : aud.format(v);
}

function parseNumeric(value: string): string | null {
  if (value.trim() === "") return null;
  // Postgres numeric type accepts the string as-is; keep raw value when
  // it parses as a finite number.
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return value;
}

export function SectionLineItems() {
  const ref = useBuilderParentRef();
  const variation = useVariationBuilderCtx();

  const { data: rows = [] } = lineItems.useList(ref ?? undefined);
  const create = lineItems.useCreate();
  const update = lineItems.useUpdate();
  const remove = lineItems.useDelete();

  const { data: citations = [] } = useCitationsForVariation(
    variation?.variationId,
  );
  const removeCitation = useDeleteCitation();
  const [citePickerRowId, setCitePickerRowId] = useState<string | null>(null);

  const isPending = create.isPending || update.isPending || remove.isPending;
  const sorted = [...rows].sort((a, b) => a.ordering - b.ordering);

  function addLine() {
    if (!ref) return;
    const payload: DocLineItemCreate = {
      ...ref,
      category: "labour",
      description: "New line",
      hour_rate_multiplier: "1",
      show_in_customer_doc: true,
      ordering: sorted.length,
    };
    create.mutate(payload);
  }

  function patchRow(id: string, updates: Partial<DocLineItem>) {
    if (!ref) return;
    update.mutate({ id, updates, ref });
  }

  function citationFor(rowId: string) {
    return citations.find(
      (c) => c.target_section === "line_item" && c.target_doc_id === rowId,
    );
  }

  function switchMode(row: DocLineItem, mode: CalcMode) {
    if (mode === inferCalcMode(row)) return;
    if (mode === "qty") {
      patchRow(row.id, { hours: null, hour_rate: null });
    } else {
      // Seed hours: "0" so inferCalcMode returns "hours" after the update.
      patchRow(row.id, { qty: null, unit: null, unit_price: null, hours: "0" });
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Pricing</h2>
          <p className="text-xs font-mono text-zinc-500 mt-1">
            Line items aggregated by category — drives the grand total.
          </p>
        </div>
        <button
          type="button"
          onClick={addLine}
          disabled={isPending || !ref}
          className="inline-flex items-center gap-1 text-xs font-mono px-3 py-1.5 rounded bg-[#3050A0] text-white hover:bg-[#3F61B0] disabled:opacity-50"
          data-testid="add-line-item"
        >
          <Plus className="h-3 w-3" aria-hidden />
          Add line item
        </button>
      </header>

      {sorted.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-700 bg-zinc-900/50 p-6 text-sm text-zinc-400">
          No line items yet. Add one to start building the price.
        </p>
      ) : (
        <div className="rounded-md border border-zinc-800 bg-zinc-900 overflow-hidden">
          <table className="w-full text-xs font-mono">
            <thead className="bg-zinc-950 text-zinc-500 text-[10px] uppercase tracking-wider">
              <tr>
                <th className="text-left px-2 py-2">Category</th>
                <th className="text-left px-2 py-2">Description</th>
                <th className="text-left px-2 py-2">Mode</th>
                <th className="text-right px-2 py-2">Qty / Hrs</th>
                <th className="text-left px-2 py-2">Unit</th>
                <th className="text-right px-2 py-2">Unit price / Rate</th>
                <th className="text-right px-2 py-2">×</th>
                <th className="text-right px-2 py-2">Subtotal</th>
                <th className="text-center px-2 py-2">Cust</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const mode = inferCalcMode(row);
                const cite = variation ? citationFor(row.id) : undefined;
                return (
                  <Fragment key={row.id}>
                    {variation && cite && (
                      <tr className="border-t border-zinc-800 bg-[#3050A0]/5">
                        <td colSpan={10} className="px-2 pt-2 pb-0">
                          <AmendsBanner
                            citation={cite}
                            sourceLabel="(source)"
                          />
                        </td>
                      </tr>
                    )}
                    <tr
                      className={cn(
                        "align-top",
                        variation && cite
                          ? "border-t-0"
                          : "border-t border-zinc-800",
                      )}
                      data-testid={`line-row-${row.id}`}
                    >
                    <td className="px-2 py-2">
                      <select
                        aria-label="Category"
                        defaultValue={row.category}
                        onChange={(e) =>
                          patchRow(row.id, {
                            category: e.target.value as LineItemCategory,
                          })
                        }
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200"
                      >
                        {LINE_ITEM_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {LINE_ITEM_CATEGORY_LABELS[c]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <input
                        aria-label="Description"
                        defaultValue={row.description}
                        onBlur={(e) => {
                          if (e.target.value !== row.description) {
                            patchRow(row.id, { description: e.target.value });
                          }
                        }}
                        className="w-full bg-transparent border-b border-zinc-700 focus:border-[#3050A0] text-zinc-100 text-xs py-1 outline-none"
                      />
                      <input
                        aria-label="Customer-facing label"
                        defaultValue={row.customer_doc_label ?? ""}
                        placeholder="Customer-facing label (optional)"
                        onBlur={(e) => {
                          const next =
                            e.target.value === "" ? null : e.target.value;
                          if (next !== row.customer_doc_label) {
                            patchRow(row.id, { customer_doc_label: next });
                          }
                        }}
                        className="w-full mt-1 bg-transparent border-b border-zinc-800 focus:border-[#3050A0] text-zinc-500 text-[11px] py-0.5 outline-none"
                      />
                      {variation && (
                        <div className="mt-1 flex justify-end">
                          <CiteOriginalButton
                            variationId={variation.variationId}
                            targetSection="line_item"
                            targetDocId={row.id}
                            hasCitation={!!cite}
                            onClick={() => setCitePickerRowId(row.id)}
                            onClear={() => {
                              if (cite)
                                removeCitation.mutate({
                                  id: cite.id,
                                  variation_id: variation.variationId,
                                });
                            }}
                          />
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div
                        className="inline-flex rounded border border-zinc-800 bg-zinc-950 overflow-hidden"
                        role="group"
                        aria-label="Calc mode"
                      >
                        {(["qty", "hours"] as CalcMode[]).map((m) => (
                          <button
                            key={m}
                            type="button"
                            aria-pressed={mode === m}
                            onClick={() => switchMode(row, m)}
                            className={cn(
                              "px-2 py-1 text-[10px] uppercase tracking-wider",
                              mode === m
                                ? "bg-[#3050A0] text-white"
                                : "text-zinc-400 hover:text-zinc-200",
                            )}
                          >
                            {m === "qty" ? "Qty" : "Hours"}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <input
                        type="number"
                        step="any"
                        aria-label={mode === "qty" ? "Quantity" : "Hours"}
                        defaultValue={mode === "qty" ? row.qty ?? "" : row.hours ?? ""}
                        onBlur={(e) => {
                          const v = parseNumeric(e.target.value);
                          patchRow(
                            row.id,
                            mode === "qty" ? { qty: v } : { hours: v },
                          );
                        }}
                        className="w-20 bg-zinc-950 border border-zinc-800 rounded px-1 py-1 text-right text-zinc-200"
                      />
                    </td>
                    <td className="px-2 py-2">
                      {mode === "qty" ? (
                        <input
                          aria-label="Unit"
                          defaultValue={row.unit ?? ""}
                          placeholder="ea"
                          onBlur={(e) => {
                            const next =
                              e.target.value === "" ? null : e.target.value;
                            if (next !== row.unit) {
                              patchRow(row.id, { unit: next });
                            }
                          }}
                          className="w-16 bg-zinc-950 border border-zinc-800 rounded px-1 py-1 text-zinc-200"
                        />
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <input
                        type="number"
                        step="any"
                        aria-label={mode === "qty" ? "Unit price" : "Hour rate"}
                        defaultValue={
                          mode === "qty"
                            ? row.unit_price ?? ""
                            : row.hour_rate ?? ""
                        }
                        onBlur={(e) => {
                          const v = parseNumeric(e.target.value);
                          patchRow(
                            row.id,
                            mode === "qty"
                              ? { unit_price: v }
                              : { hour_rate: v },
                          );
                        }}
                        className="w-24 bg-zinc-950 border border-zinc-800 rounded px-1 py-1 text-right text-zinc-200"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      {mode === "hours" ? (
                        <input
                          type="number"
                          step="0.1"
                          aria-label="Rate multiplier"
                          defaultValue={row.hour_rate_multiplier}
                          onBlur={(e) => {
                            const v = parseNumeric(e.target.value) ?? "1";
                            patchRow(row.id, { hour_rate_multiplier: v });
                          }}
                          className="w-16 bg-zinc-950 border border-zinc-800 rounded px-1 py-1 text-right text-zinc-200"
                        />
                      ) : (
                        <span className="text-zinc-600">1</span>
                      )}
                    </td>
                    <td
                      className="px-2 py-2 text-right text-zinc-100"
                      data-testid={`line-subtotal-${row.id}`}
                    >
                      {fmtSubtotal(row)}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        aria-label="Show in customer doc"
                        defaultChecked={row.show_in_customer_doc}
                        onChange={(e) =>
                          patchRow(row.id, {
                            show_in_customer_doc: e.target.checked,
                          })
                        }
                        className="accent-[#3050A0]"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        aria-label="Delete line"
                        onClick={() => {
                          if (!ref) return;
                          remove.mutate({ id: row.id, ref });
                        }}
                        disabled={isPending}
                        className="text-zinc-500 hover:text-red-400 disabled:opacity-30"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {variation && citePickerRowId && (
        <CitationPickerDialog
          open
          onOpenChange={(o) => !o && setCitePickerRowId(null)}
          variationId={variation.variationId}
          projectId={variation.projectId}
          targetSection="line_item"
          targetDocId={citePickerRowId}
          onCreated={() => setCitePickerRowId(null)}
        />
      )}
    </section>
  );
}
