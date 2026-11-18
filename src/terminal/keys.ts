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
 * Atajos de copiar/pegar, como Windows Terminal:
 * - Ctrl+Shift+C copia; Ctrl+Shift+V y Ctrl+V pegan.
 * - Ctrl+C copia solo si hay selección; si no, pasa a la shell (interrumpir).
 */
export function decideKey(e: KeyLike, hasSelection: boolean): KeyAction {
  if (e.type !== "keydown" || !e.ctrlKey || e.altKey || e.metaKey) return "pass";
  const k = e.key.toLowerCase();
  if (k === "c") return e.shiftKey || hasSelection ? "copy" : "pass";
  if (k === "v") return "paste";
  return "pass";
}
