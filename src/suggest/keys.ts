/**
 * Teclas con el menú de sugerencias (tabla del diseño). La flecha arriba es del historial de la
 * shell salvo que se esté navegando el menú; Enter ejecuta salvo que se haya elegido una fila.
 */
import type { KeyLike } from "../terminal/keys";

/**
 * - `pass`: la tecla sigue a la shell (o a los atajos) como siempre.
 * - `toShell`: cerrar el menú y dejar pasar la tecla.
 * - `close`: cerrar el menú y tragarse la tecla.
 * - `up` / `down` / `accept` / `open`: las toma el menú.
 */
export type MenuKey = "pass" | "up" | "down" | "accept" | "close" | "open" | "toShell";

export interface MenuKeyState {
  open: boolean;
  navigating: boolean;
  /** Sugerencias activadas en la configuración. */
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
