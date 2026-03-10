import { useCallback, useRef } from "react";
import type { HmiScreenSpec } from "@/types/hmi-screen";

const MAX_HISTORY = 50;

/**
 * Undo/redo history for HMI screen state.
 * Stores snapshots of screen state and provides undo/redo operations.
 */
export function useHmiHistory(
  screen: HmiScreenSpec,
  onChange: (screen: HmiScreenSpec) => void,
) {
  const undoStack = useRef<HmiScreenSpec[]>([]);
  const redoStack = useRef<HmiScreenSpec[]>([]);
  const lastPushed = useRef<string>("");

  /** Push current state to undo stack (call BEFORE making a change) */
  const pushState = useCallback(() => {
    const key = JSON.stringify(screen.elements.map((e) => ({ id: e.id, x: e.x, y: e.y, w: e.width, h: e.height })));
    // Avoid duplicate consecutive pushes (e.g. during drag)
    if (key === lastPushed.current) return;
    lastPushed.current = key;

    undoStack.current = [
      ...undoStack.current.slice(-(MAX_HISTORY - 1)),
      screen,
    ];
    // Any new change clears the redo stack
    redoStack.current = [];
  }, [screen]);

  /** Undo last change */
  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    const prev = undoStack.current[undoStack.current.length - 1];
    undoStack.current = undoStack.current.slice(0, -1);
    redoStack.current = [...redoStack.current, screen];
    lastPushed.current = "";
    onChange(prev);
  }, [screen, onChange]);

  /** Redo last undone change */
  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    const next = redoStack.current[redoStack.current.length - 1];
    redoStack.current = redoStack.current.slice(0, -1);
    undoStack.current = [...undoStack.current, screen];
    lastPushed.current = "";
    onChange(next);
  }, [screen, onChange]);

  return {
    pushState,
    undo,
    redo,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  };
}
