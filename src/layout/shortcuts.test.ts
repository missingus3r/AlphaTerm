import { describe, expect, it } from "vitest";
import { matchShortcut, type ShortcutKey } from "./shortcuts";

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
    expect(matchShortcut(k("*", as))).toEqual({ type: "split", dir: "row" }); // Shift + tecla '+' en español
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
