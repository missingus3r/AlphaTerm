/**
 * Fuentes: la lista de monoespaciadas instaladas y el acceso a sus archivos para el addon
 * de ligaduras.
 */
import { invoke } from "@tauri-apps/api/core";

const SYMBOL_FONTS = /wingdings|webdings|symbol|marlett|mdl2|fluent icons|mt extra|bookshelf/i;

let families: Promise<string[]> | null = null;
const installed = () => (families ??= invoke<string[]>("fonts_list").catch(() => []));

/**
 * Una fuente es monoespaciada si "iiii" y "WWWW" miden lo mismo. Si no está instalada, el
 * navegador usa la de respaldo (serif, proporcional) y no pasa la prueba.
 */
export function isMonospace(family: string, ctx: CanvasRenderingContext2D): boolean {
  // Las de símbolos (Wingdings…) pasan la prueba de ancho pero no sirven para texto.
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
 * El addon de ligaduras lee la fuente con la API de "fuentes locales" del navegador, que en el
 * WebView pediría un permiso. La reemplazamos por una que pide el archivo al backend.
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
