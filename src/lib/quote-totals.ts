import { LINE_ITEM_CATEGORIES } from "@/types";
import type { DocLineItem, LineItemCategory } from "@/types";

function toNum(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

export function computeLineSubtotal(item: DocLineItem): number | null {
  const qty = toNum(item.qty);
  const unitPrice = toNum(item.unit_price);
  if (qty != null && unitPrice != null) {
    return qty * unitPrice;
  }

  const hours = toNum(item.hours);
  const hourRate = toNum(item.hour_rate);
  if (hours != null && hourRate != null) {
    const multiplier = toNum(item.hour_rate_multiplier) ?? 1;
    return hours * hourRate * multiplier;
  }

  return null;
}

export interface CategoryAggregate {
  category: LineItemCategory;
  subtotal: number;
  count: number;
}

export interface AggregateOptions {
  onlyCustomerVisible: boolean;
}

export function aggregateByCategory(
  items: DocLineItem[],
  opts: AggregateOptions = { onlyCustomerVisible: false }
): CategoryAggregate[] {
  const source = opts.onlyCustomerVisible
    ? items.filter((i) => i.show_in_customer_doc)
    : items;

  const buckets = new Map<LineItemCategory, { subtotal: number; count: number }>();
  for (const i of source) {
    const sub = computeLineSubtotal(i);
    if (sub == null) continue;
    const cur = buckets.get(i.category) ?? { subtotal: 0, count: 0 };
    buckets.set(i.category, {
      subtotal: cur.subtotal + sub,
      count: cur.count + 1,
    });
  }

  return LINE_ITEM_CATEGORIES.filter((c) => buckets.has(c)).map((c) => {
    const b = buckets.get(c)!;
    return { category: c, subtotal: b.subtotal, count: b.count };
  });
}

export function grandTotal(items: DocLineItem[]): number {
  return items.reduce((sum, i) => sum + (computeLineSubtotal(i) ?? 0), 0);
}
