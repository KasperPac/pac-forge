import { useEffect, useRef } from "react";

type ShortcutMap = Record<string, () => void>;

/**
 * Registers global keyboard shortcuts.
 * Key format: "ctrl+s", "ctrl+shift+e", "alt+d"
 * Modifiers: ctrl, shift, alt, meta
 */
export function useKeyboardShortcuts(shortcuts: ShortcutMap) {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Don't intercept shortcuts when typing in inputs/textareas
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push("ctrl");
      if (e.shiftKey) parts.push("shift");
      if (e.altKey) parts.push("alt");

      const key = e.key.toLowerCase();
      if (!["control", "shift", "alt", "meta"].includes(key)) {
        parts.push(key);
      }

      const combo = parts.join("+");
      const callback = shortcutsRef.current[combo];
      if (callback) {
        e.preventDefault();
        e.stopPropagation();
        callback();
      }
    }

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
}
