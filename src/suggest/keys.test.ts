import { describe, expect, it } from "vitest";
import { menuKey } from "./keys";
import type { KeyLike } from "../terminal/keys";

const k = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  type: "keydown",
  key,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});
const closed = { open: false, navigating: false, enabled: true };
const open = { open: true, navigating: false, enabled: true };
const nav = { open: true, navigating: true, enabled: true };

describe("menuKey", () => {
  it("con el menú cerrado todo va a la shell, salvo Ctrl+Espacio", () => {
    for (const key of ["ArrowUp", "ArrowDown", "Tab", "Enter", "Escape", "a"]) expect(menuKey(k(key), closed)).toBe("pass");
    expect(menuKey(k(" ", { ctrlKey: true }), closed)).toBe("open");
  });

  it("Ctrl+Espacio no se toca si las sugerencias están desactivadas", () => {
    expect(menuKey(k(" ", { ctrlKey: true }), { ...closed, enabled: false })).toBe("pass");
  });

  it("↑ sin navegar cierra y deja pasar a la shell (historial); navegando, sube", () => {
    expect(menuKey(k("ArrowUp"), open)).toBe("toShell");
    expect(menuKey(k("ArrowUp"), nav)).toBe("up");
  });

  it("↓ empieza a navegar o baja", () => {
    expect(menuKey(k("ArrowDown"), open)).toBe("down");
    expect(menuKey(k("ArrowDown"), nav)).toBe("down");
  });

  it("Tab inserta; Enter solo inserta si se navegó, si no ejecuta", () => {
    expect(menuKey(k("Tab"), open)).toBe("accept");
    expect(menuKey(k("Tab"), nav)).toBe("accept");
    expect(menuKey(k("Enter"), open)).toBe("toShell");
    expect(menuKey(k("Enter"), nav)).toBe("accept");
  });

  it("Esc cierra el menú sin llegarle a la shell", () => {
    expect(menuKey(k("Escape"), open)).toBe("close");
    expect(menuKey(k("Escape"), nav)).toBe("close");
  });

  it("las letras siguen yendo a la shell con el menú abierto", () => {
    expect(menuKey(k("a"), open)).toBe("pass");
    expect(menuKey(k("Backspace"), nav)).toBe("pass");
  });

  it("con modificadores no se toma nada (Ctrl+Alt = AltGr, Shift+Tab de PSReadLine)", () => {
    expect(menuKey(k("Tab", { shiftKey: true }), open)).toBe("pass");
    expect(menuKey(k("ArrowUp", { ctrlKey: true }), nav)).toBe("pass");
    expect(menuKey(k(" ", { ctrlKey: true, altKey: true }), closed)).toBe("pass");
    expect(menuKey(k("Enter", { altKey: true }), nav)).toBe("pass");
  });

  it("solo keydown: keypress y keyup pasan (los traga el controlador)", () => {
    expect(menuKey({ ...k("Enter"), type: "keypress" }, nav)).toBe("pass");
    expect(menuKey({ ...k("Tab"), type: "keyup" }, open)).toBe("pass");
  });
});
