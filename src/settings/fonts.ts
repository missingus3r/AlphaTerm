/**
 * Fonts: the list of installed monospaced ones and access to their files for the ligatures
 * addon.
 */
import { invoke } from "@tauri-apps/api/core";

const SYMBOL_FONTS = /wingdings|webdings|symbol|marlett|mdl2|fluent icons|mt extra|bookshelf/i;

let families: Promise<string[]> | null = null;
const installed = () => (families ??= invoke<string[]>("fonts_list").catch(() => []));

/**
 * A font is monospaced if "iiii" and "WWWW" measure the same. If it isn't installed, the
 * browser uses the fallback (serif, proportional) and it fails the test.
 */
export function isMonospace(family: string, ctx: CanvasRenderingContext2D): boolean {
  // Symbol fonts (Wingdings…) pass the width test but aren't suitable for text.
  if (SYMBOL_FONTS.test(family)) return false;
  ctx.font = `20px "${family.replace(/"/g, "")}", serif`;
  const w = (s: string) => ctx.measureText(s).width;
  const i = w("iiiiiiiiii");
  return i > 0 && Math.abs(i - w("WWWWWWWWWW")) < 0.5 && Math.abs(i - w("..........")) < 0.5;
}

let mono: Promise<string[]> | null = null;
export function monospaceFonts(): Promise<string[]> {
  mono ??= installed().then((all) => {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return [];
    return all.filter((f) => isMonospace(f, ctx)).sort((a, b) => a.localeCompare(b));
  });
  return mono;
}

/**
 * The ligatures addon reads the font with the browser's "local fonts" API, which in the
 * WebView would ask for a permission. We replace it with one that requests the file from the backend.
 */
export function installFontAccess() {
  const w = window as unknown as { queryLocalFonts?: unknown };
  w.queryLocalFonts = async () =>
    (await installed()).map((family) => ({
      family,
      fullName: family,
      postscriptName: family.replace(/\s+/g, ""),
      style: "Regular",
      blob: async () => new Blob([await invoke<ArrayBuffer>("font_file", { family })]),
    }));
}
