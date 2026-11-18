import { describe, expect, it } from "vitest";
import { decideKey, type KeyLike } from "./keys";

const k = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  type: "keydown", key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods,
});

describe("decideKey", () => {
  it("Ctrl+C sin selección pasa a la shell (interrumpir)", () => {
    expect(decideKey(k("c", { ctrlKey: true }), false)).toBe("pass");
  });
  it("Ctrl+C con selección copia", () => {
    expect(decideKey(k("c", { ctrlKey: true }), true)).toBe("copy");
  });
  it("Ctrl+Shift+C copia siempre", () => {
    expect(decideKey(k("C", { ctrlKey: true, shiftKey: true }), false)).toBe("copy");
  });
  it("Ctrl+V y Ctrl+Shift+V pegan", () => {
    expect(decideKey(k("v", { ctrlKey: true }), false)).toBe("paste");
    expect(decideKey(k("V", { ctrlKey: true, shiftKey: true }), false)).toBe("paste");
  });
  it("keyup, Alt y teclas comunes pasan", () => {
    expect(decideKey({ ...k("c", { ctrlKey: true }), type: "keyup" }, true)).toBe("pass");
    expect(decideKey(k("v", { ctrlKey: true, altKey: true }), false)).toBe("pass");
    expect(decideKey(k("a", { ctrlKey: true }), false)).toBe("pass");
    expect(decideKey(k("c"), true)).toBe("pass");
  });
});
