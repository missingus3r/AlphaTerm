export type KeyAction = "copy" | "paste" | "pass";

export interface KeyLike {
  type: string;
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/**
 * Copy/paste shortcuts, like Windows Terminal:
 * - Ctrl+Shift+C copies; Ctrl+Shift+V and Ctrl+V paste.
 * - Ctrl+C copies only if there is a selection; otherwise it goes to the shell (interrupt).
 */
export function decideKey(e: KeyLike, hasSelection: boolean): KeyAction {
  if (e.type !== "keydown" || !e.ctrlKey || e.altKey || e.metaKey) return "pass";
  const k = e.key.toLowerCase();
  if (k === "c") return e.shiftKey || hasSelection ? "copy" : "pass";
  if (k === "v") return "paste";
  return "pass";
}
