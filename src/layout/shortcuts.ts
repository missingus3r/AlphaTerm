import type { Direction } from "./model";

/**
 * Atajos de la app (se interceptan antes de que la tecla llegue a la shell).
 * Se pueden cambiar en Configuración; lo que no se cambió usa el de fábrica.
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
  | { type: "copyLastOutput" }
  | { type: "openSettings" }
  | { type: "togglePanel"; panel: "agents" | "servers" | "projects" | "git" };

export interface Command {
  id: string;
  label: string;
  action: Action;
  defaults: string[];
}

export const COMMANDS: Command[] = [
  { id: "newTab", label: "Pestaña nueva", action: { type: "newTab" }, defaults: ["Ctrl+Shift+T"] },
  { id: "newWindow", label: "Ventana nueva", action: { type: "newWindow" }, defaults: ["Ctrl+Shift+N"] },
  { id: "closePane", label: "Cerrar panel", action: { type: "closePane" }, defaults: ["Ctrl+Shift+W"] },
  // El "+" del teclado español da "*" con Shift; el del inglés da "=" sin Shift.
  { id: "splitRight", label: "Dividir a la derecha", action: { type: "split", dir: "row" }, defaults: ["Alt+Shift++", "Alt+Shift+*", "Alt+Shift+="] },
  { id: "splitDown", label: "Dividir abajo", action: { type: "split", dir: "column" }, defaults: ["Alt+Shift+-", "Alt+Shift+_"] },
  { id: "splitAuto", label: "Dividir (automático)", action: { type: "split", dir: "auto" }, defaults: ["Alt+Shift+D"] },
  { id: "focusLeft", label: "Panel de la izquierda", action: { type: "focus", dir: "left" }, defaults: ["Alt+Left"] },
  { id: "focusRight", label: "Panel de la derecha", action: { type: "focus", dir: "right" }, defaults: ["Alt+Right"] },
  { id: "focusUp", label: "Panel de arriba", action: { type: "focus", dir: "up" }, defaults: ["Alt+Up"] },
  { id: "focusDown", label: "Panel de abajo", action: { type: "focus", dir: "down" }, defaults: ["Alt+Down"] },
  { id: "nextTab", label: "Pestaña siguiente", action: { type: "cycleTab", delta: 1 }, defaults: ["Ctrl+Tab"] },
  { id: "prevTab", label: "Pestaña anterior", action: { type: "cycleTab", delta: -1 }, defaults: ["Ctrl+Shift+Tab"] },
  { id: "rename", label: "Renombrar pestaña", action: { type: "rename" }, defaults: ["Ctrl+Shift+R"] },
  { id: "toggleTabBar", label: "Barra de pestañas arriba / a la izquierda", action: { type: "toggleTabBar" }, defaults: ["Ctrl+Shift+B"] },
  { id: "prevPrompt", label: "Ir al comando anterior", action: { type: "jumpPrompt", delta: -1 }, defaults: ["Ctrl+Shift+Up"] },
  { id: "nextPrompt", label: "Ir al comando siguiente", action: { type: "jumpPrompt", delta: 1 }, defaults: ["Ctrl+Shift+Down"] },
  { id: "copyLastOutput", label: "Copiar la salida del último comando", action: { type: "copyLastOutput" }, defaults: ["Ctrl+Shift+O"] },
  { id: "openSettings", label: "Abrir la configuración", action: { type: "openSettings" }, defaults: ["Ctrl+,"] },
  { id: "panelAgents", label: "Panel de agentes", action: { type: "togglePanel", panel: "agents" }, defaults: ["Ctrl+Shift+A"] },
];

/** Ctrl+1…8 van a esa pestaña y Ctrl+9 a la última. No se cambian. */
export const FIXED_HELP: [string, string] = ["Ctrl+1…8, Ctrl+9", "Ir a la pestaña N / a la última"];

export interface ShortcutKey {
  type: string;
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

const KEY_NAMES: Record<string, string> = { ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down", " ": "Space" };
const MODIFIERS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock", "OS"]);

/** "Ctrl+Shift+T" a partir de un evento; null si es solo un modificador o es AltGr. */
export function comboOf(e: ShortcutKey): string | null {
  if (e.metaKey || MODIFIERS.has(e.key) || !e.key || e.key === "Dead" || e.key === "Unidentified") return null;
  if (e.ctrlKey && e.altKey) return null; // AltGr
  const key = KEY_NAMES[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", key].filter(Boolean).join("+");
}

/** Separa "Alt+Shift++" en modificadores y tecla (la tecla puede ser "+"). */
export function parseCombo(combo: string): { ctrl: boolean; shift: boolean; alt: boolean; key: string } | null {
  let rest = combo.trim();
  const mods = { ctrl: false, shift: false, alt: false };
  for (;;) {
    const m = /^(Ctrl|Shift|Alt)\+(?=.)/i.exec(rest);
    if (!m) break;
    mods[m[1].toLowerCase() as "ctrl" | "shift" | "alt"] = true;
    rest = rest.slice(m[0].length);
  }
  if (!rest) return null;
  const key = rest.length === 1 ? rest.toUpperCase() : rest[0].toUpperCase() + rest.slice(1);
  return { ...mods, key };
}

/** Forma canónica (Ctrl, Alt, Shift, como escribe Windows; tecla en mayúscula), o null si no se entiende. */
export function canonical(combo: string): string | null {
  const p = parseCombo(combo);
  if (!p) return null;
  return [p.ctrl && "Ctrl", p.alt && "Alt", p.shift && "Shift", p.key].filter(Boolean).join("+");
}

/** Problema de una combinación para usarla de atajo, o null si sirve. */
export function comboProblem(combo: string): string | null {
  const p = parseCombo(combo);
  if (!p) return "No se entiende la combinación";
  if (p.ctrl && p.alt) return "Ctrl+Alt es AltGr en el teclado español: se usa para escribir @, # o [";
  const fKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(p.key);
  if (!p.ctrl && !p.alt && !fKey) return "Necesita Ctrl o Alt (si no, se come teclas que escribís)";
  if (p.ctrl && !p.shift && !p.alt && /^[A-Z]$/.test(p.key)) {
    if (p.key === "C" || p.key === "V") return "Ctrl+C y Ctrl+V ya son copiar/pegar e interrumpir";
    return null; // se permite, pero ver comboWarning
  }
  if (p.ctrl && !p.shift && /^[1-9]$/.test(p.key)) return "Ctrl+1…9 ya cambian de pestaña";
  return null;
}

/** Aviso (no bloquea): Ctrl+letra sin Shift se lo saca a la shell (Ctrl+R busca en el historial, etc.). */
export function comboWarning(combo: string): string | null {
  const p = parseCombo(combo);
  if (p && p.ctrl && !p.shift && !p.alt && /^[A-Z]$/.test(p.key)) {
    return `Ctrl+${p.key} ya no le llega a la shell ni a los programas de la terminal`;
  }
  return null;
}

/** Combinaciones efectivas de cada comando (las cambiadas reemplazan a las de fábrica). */
export function effectiveBindings(overrides: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const c of COMMANDS) {
    const list = overrides[c.id] ?? c.defaults;
    out[c.id] = list.map((x) => canonical(x)).filter((x): x is string => !!x && !comboProblem(x));
  }
  return out;
}

export type Keymap = Map<string, Action>;

export function buildKeymap(overrides: Record<string, string[]> = {}): Keymap {
  const map: Keymap = new Map();
  const eff = effectiveBindings(overrides);
  for (const c of COMMANDS) for (const combo of eff[c.id]) if (!map.has(combo)) map.set(combo, c.action);
  return map;
}

/** Combinaciones usadas por más de un comando: combinación → ids. */
export function conflicts(overrides: Record<string, string[]>): Map<string, string[]> {
  const eff = effectiveBindings(overrides);
  const seen = new Map<string, string[]>();
  for (const c of COMMANDS) for (const combo of eff[c.id]) seen.set(combo, [...(seen.get(combo) ?? []), c.id]);
  return new Map([...seen].filter(([, ids]) => ids.length > 1));
}

const DEFAULT_KEYMAP = buildKeymap();

export function matchShortcut(e: ShortcutKey, keymap: Keymap = DEFAULT_KEYMAP): Action | null {
  if (e.type !== "keydown") return null;
  const combo = comboOf(e);
  if (!combo) return null;
  const hit = keymap.get(combo);
  if (hit) return hit;
  const m = /^Ctrl\+([1-9])$/.exec(combo);
  if (m) return { type: "goTab", index: m[1] === "9" ? -1 : Number(m[1]) - 1 };
  return null;
}

/** Texto de ayuda (tooltip del botón "?"). */
export function shortcutHelp(overrides: Record<string, string[]> = {}): [string, string][] {
  const eff = effectiveBindings(overrides);
  const rows: [string, string][] = COMMANDS.filter((c) => eff[c.id].length > 0).map((c) => [eff[c.id].join(" o "), c.label]);
  rows.push(FIXED_HELP, ["Doble clic en la pestaña", "Renombrar pestaña"]);
  return rows;
}
