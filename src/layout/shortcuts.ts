import { k, t } from "../i18n";
import type { Direction } from "./model";

/**
 * App shortcuts (intercepted before the key reaches the shell).
 * They can be changed in Settings; whatever wasn't changed uses the default.
 * Ctrl+Alt isn't used: on Spanish keyboards it is AltGr, used to type @, #, [, ], etc.
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
  | { type: "renameWindow" }
  | { type: "openBrowser" }
  | { type: "togglePanel"; panel: "agents" | "servers" | "projects" | "git" | "history" | "docker" | "changes" };

export interface Command {
  id: string;
  label: string;
  action: Action;
  defaults: string[];
}

export const COMMANDS: Command[] = [
  { id: "newTab", label: k("Pestaña nueva"), action: { type: "newTab" }, defaults: ["Ctrl+Shift+T"] },
  { id: "newWindow", label: k("Ventana nueva"), action: { type: "newWindow" }, defaults: ["Ctrl+Shift+N"] },
  { id: "closePane", label: k("Cerrar panel"), action: { type: "closePane" }, defaults: ["Ctrl+Shift+W"] },
  // The Spanish keyboard's "+" gives "*" with Shift; the English one gives "=" without Shift.
  { id: "splitRight", label: k("Dividir a la derecha"), action: { type: "split", dir: "row" }, defaults: ["Alt+Shift++", "Alt+Shift+*", "Alt+Shift+="] },
  { id: "splitDown", label: k("Dividir abajo"), action: { type: "split", dir: "column" }, defaults: ["Alt+Shift+-", "Alt+Shift+_"] },
  { id: "splitAuto", label: k("Dividir (automático)"), action: { type: "split", dir: "auto" }, defaults: ["Alt+Shift+D"] },
  { id: "focusLeft", label: k("Panel de la izquierda"), action: { type: "focus", dir: "left" }, defaults: ["Alt+Left"] },
  { id: "focusRight", label: k("Panel de la derecha"), action: { type: "focus", dir: "right" }, defaults: ["Alt+Right"] },
  { id: "focusUp", label: k("Panel de arriba"), action: { type: "focus", dir: "up" }, defaults: ["Alt+Up"] },
  { id: "focusDown", label: k("Panel de abajo"), action: { type: "focus", dir: "down" }, defaults: ["Alt+Down"] },
  { id: "nextTab", label: k("Pestaña siguiente"), action: { type: "cycleTab", delta: 1 }, defaults: ["Ctrl+Tab"] },
  { id: "prevTab", label: k("Pestaña anterior"), action: { type: "cycleTab", delta: -1 }, defaults: ["Ctrl+Shift+Tab"] },
  { id: "rename", label: k("Renombrar pestaña"), action: { type: "rename" }, defaults: ["Ctrl+Shift+R"] },
  { id: "renameWindow", label: k("Cambiar el título de la ventana"), action: { type: "renameWindow" }, defaults: ["Ctrl+Shift+F2"] },
  { id: "toggleTabBar", label: k("Barra de pestañas arriba / a la izquierda"), action: { type: "toggleTabBar" }, defaults: ["Ctrl+Shift+B"] },
  { id: "prevPrompt", label: k("Ir al comando anterior"), action: { type: "jumpPrompt", delta: -1 }, defaults: ["Ctrl+Shift+Up"] },
  { id: "nextPrompt", label: k("Ir al comando siguiente"), action: { type: "jumpPrompt", delta: 1 }, defaults: ["Ctrl+Shift+Down"] },
  { id: "copyLastOutput", label: k("Copiar la salida del último comando"), action: { type: "copyLastOutput" }, defaults: ["Ctrl+Shift+O"] },
  { id: "openBrowser", label: k("Abrir el navegador al lado (para ver la app y marcar elementos)"), action: { type: "openBrowser" }, defaults: ["Ctrl+Shift+U"] },
  { id: "openSettings", label: k("Abrir la configuración"), action: { type: "openSettings" }, defaults: ["Ctrl+,"] },
  { id: "panelAgents", label: k("Panel de agentes"), action: { type: "togglePanel", panel: "agents" }, defaults: ["Ctrl+Shift+A"] },
  { id: "panelServers", label: k("Panel de servidores"), action: { type: "togglePanel", panel: "servers" }, defaults: ["Ctrl+Shift+P"] },
  { id: "panelProjects", label: k("Panel de proyectos"), action: { type: "togglePanel", panel: "projects" }, defaults: ["Ctrl+Shift+E"] },
  { id: "panelGit", label: k("Panel de git"), action: { type: "togglePanel", panel: "git" }, defaults: ["Ctrl+Shift+G"] },
  { id: "panelHistory", label: k("Panel de historial"), action: { type: "togglePanel", panel: "history" }, defaults: ["Ctrl+Shift+H"] },
  { id: "panelDocker", label: k("Panel de docker"), action: { type: "togglePanel", panel: "docker" }, defaults: ["Ctrl+Shift+K"] },
  { id: "panelChanges", label: k("Panel de modificaciones"), action: { type: "togglePanel", panel: "changes" }, defaults: ["Ctrl+Shift+M"] },
];

/** Ctrl+1…8 go to that tab and Ctrl+9 to the last one. They can't be changed. */
export const FIXED_HELP: [string, string] = ["Ctrl+1…8, Ctrl+9", k("Ir a la pestaña N / a la última")];

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

/** "Ctrl+Shift+T" from an event; null if it's only a modifier or it's AltGr. */
export function comboOf(e: ShortcutKey): string | null {
  if (e.metaKey || MODIFIERS.has(e.key) || !e.key || e.key === "Dead" || e.key === "Unidentified") return null;
  if (e.ctrlKey && e.altKey) return null; // AltGr
  const key = KEY_NAMES[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", key].filter(Boolean).join("+");
}

/** Splits "Alt+Shift++" into modifiers and key (the key can be "+"). */
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

/** Canonical form (Ctrl, Alt, Shift, as Windows writes it; uppercase key), or null if it isn't understood. */
export function canonical(combo: string): string | null {
  const p = parseCombo(combo);
  if (!p) return null;
  return [p.ctrl && "Ctrl", p.alt && "Alt", p.shift && "Shift", p.key].filter(Boolean).join("+");
}

/** Problem with a combination for using it as a shortcut, or null if it's fine. */
export function comboProblem(combo: string): string | null {
  const p = parseCombo(combo);
  if (!p) return t("No se entiende la combinación");
  if (p.ctrl && p.alt) return t("Ctrl+Alt es AltGr en el teclado español: se usa para escribir @, # o [");
  const fKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(p.key);
  if (!p.ctrl && !p.alt && !fKey) return t("Necesita Ctrl o Alt (si no, se come teclas que escribís)");
  if (p.ctrl && !p.shift && !p.alt && /^[A-Z]$/.test(p.key)) {
    if (p.key === "C" || p.key === "V") return t("Ctrl+C y Ctrl+V ya son copiar/pegar e interrumpir");
    return null; // allowed, but see comboWarning
  }
  if (p.ctrl && !p.shift && /^[1-9]$/.test(p.key)) return t("Ctrl+1…9 ya cambian de pestaña");
  return null;
}

/** Warning (doesn't block): Ctrl+letter without Shift takes it away from the shell (Ctrl+R searches history, etc.). */
export function comboWarning(combo: string): string | null {
  const p = parseCombo(combo);
  if (p && p.ctrl && !p.shift && !p.alt && /^[A-Z]$/.test(p.key)) {
    return t("Ctrl+{key} ya no le llega a la shell ni a los programas de la terminal", { key: p.key });
  }
  return null;
}

/** Effective combinations of each command (changed ones replace the defaults). */
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

/** Combinations used by more than one command: combination → ids. */
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

/**
 * Help text (tooltip of the "?" button): [combinations, label]. The labels stay in Spanish
 * (marked with `k`): whoever shows them translates them with `t`.
 */
export function shortcutHelp(overrides: Record<string, string[]> = {}): [string, string][] {
  const eff = effectiveBindings(overrides);
  const rows: [string, string][] = COMMANDS.filter((c) => eff[c.id].length > 0).map((c) => [eff[c.id].reduce((a, b) => t("{a} o {b}", { a, b })), c.label]);
  rows.push(FIXED_HELP, [k("Doble clic en la pestaña"), k("Renombrar pestaña")]);
  return rows;
}
