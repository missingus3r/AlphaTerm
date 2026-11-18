import type { Direction } from "./model";

/**
 * Atajos de la app (se interceptan antes de que la tecla llegue a la shell).
 * No se usa Ctrl+Alt: en teclados en español es AltGr y se usa para escribir @, #, [, ], etc.
 */
export type Action =
  | { type: "newTab" }
  | { type: "newWindow" }
  | { type: "closePane" }
  | { type: "split"; dir: "row" | "column" | "auto" }
  | { type: "focus"; dir: Direction }
  | { type: "cycleTab"; delta: 1 | -1 }
  | { type: "goTab"; index: number }
  | { type: "rename" }
  | { type: "toggleTabBar" }
  | { type: "jumpPrompt"; delta: 1 | -1 }
  | { type: "copyLastOutput" };

export interface ShortcutKey {
  type: string;
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

const ARROWS: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

export function matchShortcut(e: ShortcutKey): Action | null {
  if (e.type !== "keydown" || e.metaKey) return null;
  const { ctrlKey: ctrl, shiftKey: shift, altKey: alt } = e;
  if (ctrl && alt) return null; // AltGr
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (ctrl && shift) {
    switch (k) {
      case "t":
        return { type: "newTab" };
      case "n":
        return { type: "newWindow" };
      case "w":
        return { type: "closePane" };
      case "r":
        return { type: "rename" };
      case "b":
        return { type: "toggleTabBar" };
      case "o":
        return { type: "copyLastOutput" };
      case "ArrowUp":
        return { type: "jumpPrompt", delta: -1 };
      case "ArrowDown":
        return { type: "jumpPrompt", delta: 1 };
      case "Tab":
        return { type: "cycleTab", delta: -1 };
    }
    return null;
  }
  if (ctrl && !shift) {
    if (k === "Tab") return { type: "cycleTab", delta: 1 };
    if (/^[1-9]$/.test(k)) return { type: "goTab", index: k === "9" ? -1 : Number(k) - 1 };
    return null;
  }
  if (alt && shift) {
    if (["+", "*", "="].includes(k)) return { type: "split", dir: "row" };
    if (["-", "_"].includes(k)) return { type: "split", dir: "column" };
    if (k === "d") return { type: "split", dir: "auto" };
    return null;
  }
  if (alt && !shift && ARROWS[k]) return { type: "focus", dir: ARROWS[k] };
  return null;
}

/** Texto de ayuda para tooltips y el menú. */
export const SHORTCUT_HELP: [string, string][] = [
  ["Ctrl+Shift+T", "Pestaña nueva"],
  ["Ctrl+Shift+N", "Ventana nueva"],
  ["Ctrl+Shift+W", "Cerrar panel"],
  ["Alt+Shift++", "Dividir a la derecha"],
  ["Alt+Shift+-", "Dividir abajo"],
  ["Alt+Shift+D", "Dividir (automático)"],
  ["Alt+Flechas", "Moverse entre paneles"],
  ["Ctrl+Tab / Ctrl+Shift+Tab", "Pestaña siguiente / anterior"],
  ["Ctrl+1…8, Ctrl+9", "Ir a la pestaña N / a la última"],
  ["Ctrl+Shift+R o doble clic", "Renombrar pestaña"],
  ["Ctrl+Shift+B", "Barra de pestañas arriba / a la izquierda"],
  ["Ctrl+Shift+↑ / ↓", "Comando anterior / siguiente"],
  ["Ctrl+Shift+O", "Copiar la salida del último comando"],
];
