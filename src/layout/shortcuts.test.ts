import { describe, expect, it } from "vitest";
import {
  buildKeymap, canonical, comboOf, comboProblem, comboWarning, conflicts, matchShortcut, shortcutHelp, type ShortcutKey,
} from "./shortcuts";

const k = (key: string, mods: Partial<ShortcutKey> = {}): ShortcutKey => ({
  type: "keydown", key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods,
});
const cs = { ctrlKey: true, shiftKey: true };
const as = { altKey: true, shiftKey: true };

describe("atajos", () => {
  it("pestañas y ventanas", () => {
    expect(matchShortcut(k("T", cs))).toEqual({ type: "newTab" });
    expect(matchShortcut(k("N", cs))).toEqual({ type: "newWindow" });
    expect(matchShortcut(k("W", cs))).toEqual({ type: "closePane" });
    expect(matchShortcut(k("Tab", { ctrlKey: true }))).toEqual({ type: "cycleTab", delta: 1 });
    expect(matchShortcut(k("Tab", cs))).toEqual({ type: "cycleTab", delta: -1 });
    expect(matchShortcut(k("3", { ctrlKey: true }))).toEqual({ type: "goTab", index: 2 });
    expect(matchShortcut(k("9", { ctrlKey: true }))).toEqual({ type: "goTab", index: -1 });
  });

  it("splits con teclado en español y en inglés", () => {
    expect(matchShortcut(k("*", as))).toEqual({ type: "split", dir: "row" }); // Shift + '+' key on a Spanish keyboard
    expect(matchShortcut(k("+", as))).toEqual({ type: "split", dir: "row" });
    expect(matchShortcut(k("_", as))).toEqual({ type: "split", dir: "column" });
    expect(matchShortcut(k("D", as))).toEqual({ type: "split", dir: "auto" });
  });

  it("foco entre paneles con Alt+flechas", () => {
    expect(matchShortcut(k("ArrowLeft", { altKey: true }))).toEqual({ type: "focus", dir: "left" });
    expect(matchShortcut(k("ArrowDown", { altKey: true }))).toEqual({ type: "focus", dir: "down" });
  });

  it("AltGr (Ctrl+Alt) nunca es atajo: se usa para escribir @ # [ ]", () => {
    expect(matchShortcut(k("@", { ctrlKey: true, altKey: true }))).toBeNull();
    expect(matchShortcut(k("2", { ctrlKey: true, altKey: true }))).toBeNull();
  });

  it("teclas comunes pasan a la shell", () => {
    expect(matchShortcut(k("c", { ctrlKey: true }))).toBeNull();
    expect(matchShortcut(k("r", { ctrlKey: true }))).toBeNull();
    expect(matchShortcut(k("a"))).toBeNull();
    expect(matchShortcut({ ...k("T", cs), type: "keyup" })).toBeNull();
  });
});

describe("atajos configurables", () => {
  it("arma la combinación desde el evento", () => {
    expect(comboOf(k("t", cs))).toBe("Ctrl+Shift+T");
    expect(comboOf(k("ArrowUp", { altKey: true }))).toBe("Alt+Up");
    expect(comboOf(k(",", { ctrlKey: true }))).toBe("Ctrl+,");
    expect(comboOf(k("Shift", { shiftKey: true }))).toBeNull();
    expect(comboOf(k("q", { ctrlKey: true, altKey: true }))).toBeNull();
  });

  it("forma canónica, con el + como tecla", () => {
    expect(canonical("shift+ctrl+t")).toBe("Ctrl+Shift+T");
    expect(canonical("Alt+Shift++")).toBe("Alt+Shift++");
    expect(canonical("alt+left")).toBe("Alt+Left");
    expect(canonical("")).toBeNull();
  });

  it("rechaza lo que rompería la escritura", () => {
    expect(comboProblem("Ctrl+Alt+T")).toMatch(/AltGr/);
    expect(comboProblem("Shift+A")).toMatch(/Ctrl o Alt/);
    expect(comboProblem("A")).toMatch(/Ctrl o Alt/);
    expect(comboProblem("Ctrl+C")).toMatch(/copiar/);
    expect(comboProblem("Ctrl+3")).toMatch(/pestaña/);
    expect(comboProblem("F11")).toBeNull();
    expect(comboProblem("Ctrl+Shift+K")).toBeNull();
    expect(comboProblem("Ctrl+K")).toBeNull();
    expect(comboWarning("Ctrl+K")).toMatch(/shell/);
    expect(comboWarning("Ctrl+Shift+K")).toBeNull();
  });

  it("un atajo cambiado reemplaza al de fábrica", () => {
    const km = buildKeymap({ newTab: ["Ctrl+Shift+Y"] });
    expect(matchShortcut(k("Y", cs), km)).toEqual({ type: "newTab" });
    expect(matchShortcut(k("T", cs), km)).toBeNull();
    // Empty list = no shortcut.
    expect(matchShortcut(k("W", cs), buildKeymap({ closePane: [] }))).toBeNull();
    // Invalid combinations in the file are ignored.
    expect(matchShortcut(k("T", { ctrlKey: true, altKey: true }), buildKeymap({ newTab: ["Ctrl+Alt+T"] }))).toBeNull();
  });

  it("abre la configuración con Ctrl+,", () => {
    expect(matchShortcut(k(",", { ctrlKey: true }))).toEqual({ type: "openSettings" });
  });

  it("detecta conflictos y arma la ayuda", () => {
    const c = conflicts({ rename: ["Ctrl+Shift+T"] });
    expect(c.get("Ctrl+Shift+T")).toEqual(["newTab", "rename"]);
    expect(conflicts({}).size).toBe(0);
    const help = shortcutHelp({ splitRight: ["Alt+Shift++"] });
    expect(help).toContainEqual(["Alt+Shift++", "Dividir a la derecha"]);
    expect(help.find(([, l]) => l === "Pestaña nueva")?.[0]).toBe("Ctrl+Shift+T");
  });
});
