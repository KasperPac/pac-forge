import { useRef, useState, useCallback, type RefObject } from "react";

/**
 * Generic column-resize hook for HTML tables.
 *
 * Adapted from forge-matrix-review.tsx SequenceRowsTable. Starts in auto layout
 * (browser fits content). On the first drag we snapshot the rendered widths and
 * switch to table-fixed so subsequent drags get deterministic px sizing.
 */
export function useResizableColumns<K extends string>(cols: readonly K[]): {
  tableRef: RefObject<HTMLTableElement>;
  colWidths: Record<K, number> | null;
  isFixed: boolean;
  onDragStart: (col: K, e: React.MouseEvent) => void;
} {
  const [colWidths, setColWidths] = useState<Record<K, number> | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const dragRef = useRef<{ col: K; startX: number; startW: number } | null>(null);

  const onDragStart = useCallback(
    (col: K, e: React.MouseEvent) => {
      e.preventDefault();

      let widths = colWidths;
      if (!widths && tableRef.current) {
        const ths = tableRef.current.querySelectorAll<HTMLElement>("thead th");
        widths = {} as Record<K, number>;
        cols.forEach((c, i) => {
          widths![c] = ths[i]?.offsetWidth ?? 120;
        });
        setColWidths(widths);
      }

      dragRef.current = {
        col,
        startX: e.clientX,
        startW: widths![col] ?? 120,
      };

      const onMove = (me: MouseEvent) => {
        if (!dragRef.current) return;
        const delta = me.clientX - dragRef.current.startX;
        setColWidths((prev) => ({
          ...(prev as Record<K, number>),
          [dragRef.current!.col]: Math.max(48, dragRef.current!.startW + delta),
        }));
      };
      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [cols, colWidths],
  );

  return {
    tableRef: tableRef as RefObject<HTMLTableElement>,
    colWidths,
    isFixed: colWidths !== null,
    onDragStart,
  };
}
