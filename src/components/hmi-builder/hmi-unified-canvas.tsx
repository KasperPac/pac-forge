import { useRef, useState } from "react";
import { Rnd } from "react-rnd";
import type { HmiUnifiedItemPayload } from "@/lib/hmi-unified-payload-builder";
import { HmiUnifiedItemView } from "./hmi-unified-item-view";
import { cn } from "@/lib/utils";

interface HmiUnifiedCanvasProps {
  items: HmiUnifiedItemPayload[];
  screenWidth: number;
  screenHeight: number;
  backColor?: string;
  zoom: number;
  snapToGrid: boolean;
  gridSize: number;
  selectedIndexes: Set<number>;
  onSelectionChange: (next: Set<number>) => void;
  onUpdateItem: (
    index: number,
    patch: Partial<HmiUnifiedItemPayload> | ((it: HmiUnifiedItemPayload) => HmiUnifiedItemPayload),
  ) => void;
  onMoveSelected: (dx: number, dy: number) => void;
}

function getAttr(item: HmiUnifiedItemPayload, key: string, fallback: number): number {
  const v = item.attributes[key];
  if (typeof v === "number") return v;
  if (typeof v === "string" && v !== "" && !isNaN(Number(v))) return Number(v);
  return fallback;
}

function resolveBackColor(raw: string | undefined): string {
  if (!raw) return "#1a1a1a";
  const tokens: Record<string, string> = {
    "Basic 80": "#1a1a1a",
    "Basic 40": "#c8c8c8",
    "DeepBlue Base": "#0b1d3d",
    "White": "#ffffff",
    "Black": "#000000",
  };
  return tokens[raw] ?? raw;
}

interface MarqueeState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  additive: boolean;
  initial: Set<number>;
}

export function HmiUnifiedCanvas({
  items,
  screenWidth,
  screenHeight,
  backColor,
  zoom,
  snapToGrid,
  gridSize,
  selectedIndexes,
  onSelectionChange,
  onUpdateItem,
  onMoveSelected,
}: HmiUnifiedCanvasProps) {
  const bg = resolveBackColor(backColor);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);

  function snap(n: number): number {
    return snapToGrid ? Math.round(n / gridSize) * gridSize : Math.round(n);
  }

  function getCanvasCoords(clientX: number, clientY: number): { x: number; y: number } | null {
    const el = screenRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / zoom,
      y: (clientY - rect.top) / zoom,
    };
  }

  function computeMarqueeSelection(
    startX: number,
    startY: number,
    currentX: number,
    currentY: number,
    additive: boolean,
    initial: Set<number>,
  ): Set<number> {
    const minX = Math.min(startX, currentX);
    const maxX = Math.max(startX, currentX);
    const minY = Math.min(startY, currentY);
    const maxY = Math.max(startY, currentY);
    const hit = new Set<number>();
    items.forEach((item, i) => {
      const x = getAttr(item, "Left", 0);
      const y = getAttr(item, "Top", 0);
      const w = getAttr(item, "Width", 100);
      const h = getAttr(item, "Height", 40);
      if (x + w < minX || x > maxX) return;
      if (y + h < minY || y > maxY) return;
      hit.add(i);
    });
    if (additive) {
      const combined = new Set(initial);
      hit.forEach((i) => combined.add(i));
      return combined;
    }
    return hit;
  }

  function handleScreenMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    if (e.target !== e.currentTarget) return;
    const coords = getCanvasCoords(e.clientX, e.clientY);
    if (!coords) return;
    const additive = e.shiftKey;
    const initial = new Set(selectedIndexes);
    if (!additive) onSelectionChange(new Set());
    setMarquee({
      startX: coords.x,
      startY: coords.y,
      currentX: coords.x,
      currentY: coords.y,
      additive,
      initial,
    });
  }

  function handleWindowMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!marquee) return;
    const coords = getCanvasCoords(e.clientX, e.clientY);
    if (!coords) return;
    const next: MarqueeState = { ...marquee, currentX: coords.x, currentY: coords.y };
    setMarquee(next);
    const sel = computeMarqueeSelection(
      next.startX,
      next.startY,
      next.currentX,
      next.currentY,
      next.additive,
      next.initial,
    );
    onSelectionChange(sel);
  }

  function handleWindowMouseUp() {
    if (!marquee) return;
    setMarquee(null);
  }

  const marqueeRect = marquee
    ? {
        left: Math.min(marquee.startX, marquee.currentX),
        top: Math.min(marquee.startY, marquee.currentY),
        width: Math.abs(marquee.currentX - marquee.startX),
        height: Math.abs(marquee.currentY - marquee.startY),
      }
    : null;

  return (
    <div
      className="flex h-full w-full items-start justify-center overflow-auto bg-neutral-950/80 p-6"
      onMouseMove={handleWindowMouseMove}
      onMouseUp={handleWindowMouseUp}
      onMouseLeave={handleWindowMouseUp}
    >
      <div
        style={{
          width: screenWidth * zoom,
          height: screenHeight * zoom,
          flexShrink: 0,
        }}
      >
        <div
          ref={screenRef}
          className="relative shadow-2xl origin-top-left"
          style={{
            width: screenWidth,
            height: screenHeight,
            transform: `scale(${zoom})`,
            background: bg,
          }}
          onMouseDown={handleScreenMouseDown}
        >
          {/* Grid overlay */}
          {snapToGrid && (
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage: `
                  linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px),
                  linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)
                `,
                backgroundSize: `${gridSize}px ${gridSize}px`,
              }}
            />
          )}

          {/* Items */}
          {items.map((item, i) => {
            const x = getAttr(item, "Left", 0);
            const y = getAttr(item, "Top", 0);
            const w = getAttr(item, "Width", 100);
            const h = getAttr(item, "Height", 40);
            const isSelected = selectedIndexes.has(i);
            return (
              <Rnd
                key={i}
                position={{ x, y }}
                size={{ width: w, height: h }}
                bounds="parent"
                scale={zoom}
                dragGrid={snapToGrid ? [gridSize, gridSize] : undefined}
                resizeGrid={snapToGrid ? [gridSize, gridSize] : undefined}
                onDragStop={(_e, d) => {
                  const newX = snap(d.x);
                  const newY = snap(d.y);
                  if (isSelected && selectedIndexes.size > 1) {
                    const dx = newX - x;
                    const dy = newY - y;
                    if (dx !== 0 || dy !== 0) onMoveSelected(dx, dy);
                  } else {
                    onUpdateItem(i, (it) => ({
                      ...it,
                      attributes: { ...it.attributes, Left: newX, Top: newY },
                    }));
                  }
                }}
                onResizeStop={(_e, _dir, ref, _delta, pos) => {
                  onUpdateItem(i, (it) => ({
                    ...it,
                    attributes: {
                      ...it.attributes,
                      Left: snap(pos.x),
                      Top: snap(pos.y),
                      Width: snap(parseInt(ref.style.width)),
                      Height: snap(parseInt(ref.style.height)),
                    },
                  }));
                }}
                className={cn("group", isSelected && "ring-2 ring-amber-500 ring-offset-1 ring-offset-transparent")}
                style={{ zIndex: isSelected ? 1000 : i + 1 }}
                onMouseDown={(e: MouseEvent) => {
                  e.stopPropagation();
                  if (e.shiftKey) {
                    const next = new Set(selectedIndexes);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    onSelectionChange(next);
                  } else if (!selectedIndexes.has(i)) {
                    onSelectionChange(new Set([i]));
                  }
                }}
              >
                <div className="h-full w-full">
                  <HmiUnifiedItemView item={item} />
                </div>
              </Rnd>
            );
          })}

          {/* Marquee rectangle */}
          {marqueeRect && (
            <div
              className="pointer-events-none absolute border border-amber-400/70 bg-amber-400/10"
              style={{
                left: marqueeRect.left,
                top: marqueeRect.top,
                width: marqueeRect.width,
                height: marqueeRect.height,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
