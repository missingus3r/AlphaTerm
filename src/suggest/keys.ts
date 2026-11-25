/**
 * Keys with the suggestion menu (design table). The up arrow belongs to the shell's
 * history unless the menu is being navigated; Enter runs unless a row was chosen.
 */
import type { KeyLike } from "../terminal/keys";

/**
 * - `pass`: the key goes on to the shell (or the shortcuts) as usual.
 * - `toShell`: close the menu and let the key through.
 * - `close`: close the menu and swallow the key.
 * - `up` / `down` / `accept` / `open`: the menu takes them.
 */
export type MenuKey = "pass" | "up" | "down" | "accept" | "close" | "open" | "toShell";

export interface MenuKeyState {
  open: boolean;
  navigating: boolean;
  /** Suggestions enabled in the settings. */
  enabled: boolean;
}

export function menuKey(e: KeyLike, st: MenuKeyState): MenuKey {
  if (e.type !== "keydown" || e.altKey || e.metaKey) return "pass";
  if (e.ctrlKey) {
    if (st.enabled && !e.shiftKey && (e.key === " " || e.key === "Spacebar")) return "open";
    return "pass";
  }
  if (!st.open || e.shiftKey) return "pass";
  switch (e.key) {
    case "ArrowUp":
      return st.navigating ? "up" : "toShell";
    case "ArrowDown":
      return "down";
    case "Tab":
      return "accept";
    case "Enter":
      return st.navigating ? "accept" : "toShell";
    case "Escape":
      return "close";
    default:
      return "pass";
  }
}
