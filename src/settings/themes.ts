/**
 * Temas: los de fábrica, la importación (Windows Terminal, iTerm2 o el formato propio)
 * y la paleta de la interfaz, que sale del tema de la terminal.
 */
import { k, t } from "../i18n";
import { COLOR_KEYS, HEX, type ColorKey, type CustomTheme } from "./schema";

export type ThemeColors = Record<ColorKey, string>;

export interface Theme {
  id: string;
  name: string;
  colors: ThemeColors;
  builtin: boolean;
}

type Ansi = [string, string, string, string, string, string, string, string];

function make(
  id: string,
  name: string,
  bg: string,
  fg: string,
  normal: Ansi,
  bright: Ansi,
  extra: { cursor?: string; selection?: string } = {},
): Theme {
  const [black, red, green, yellow, blue, magenta, cyan, white] = normal;
  const [bBlack, bRed, bGreen, bYellow, bBlue, bMagenta, bCyan, bWhite] = bright;
  return {
    id,
    name,
    builtin: true,
    colors: {
      background: bg,
      foreground: fg,
      cursor: extra.cursor ?? fg,
      cursorAccent: bg,
      selectionBackground: extra.selection ?? `${fg.slice(0, 7)}40`,
      black, red, green, yellow, blue, magenta, cyan, white,
      brightBlack: bBlack, brightRed: bRed, brightGreen: bGreen, brightYellow: bYellow,
      brightBlue: bBlue, brightMagenta: bMagenta, brightCyan: bCyan, brightWhite: bWhite,
    },
  };
}

export const BUILTIN_THEMES: Theme[] = [
  make("nova-dark", k("Alpha oscuro"), "#0d1017", "#d6deeb",
    ["#1b2230", "#ef6b73", "#8bd49c", "#e5c07b", "#60a5fa", "#c792ea", "#5fd7d7", "#d6deeb"],
    ["#5c6a82", "#ff8a91", "#a8e6b5", "#f2d59b", "#93c5fd", "#ddb6f2", "#8ff0f0", "#ffffff"],
    { cursor: "#60a5fa", selection: "#2563eb66" }),
  make("nova-light", k("Alpha claro"), "#f7f8fa", "#24292f",
    ["#24292f", "#cf222e", "#116329", "#9a6700", "#0969da", "#8250df", "#1b7c83", "#6e7781"],
    ["#57606a", "#a40e26", "#1a7f37", "#633c01", "#218bff", "#a475f9", "#3192aa", "#8c959f"],
    { cursor: "#0969da", selection: "#0969da33" }),
  make("campbell", "Campbell", "#0c0c0c", "#cccccc",
    ["#0c0c0c", "#c50f1f", "#13a10e", "#c19c00", "#0037da", "#881798", "#3a96dd", "#cccccc"],
    ["#767676", "#e74856", "#16c60c", "#f9f1a5", "#3b78ff", "#b4009e", "#61d6d6", "#f2f2f2"],
    { cursor: "#ffffff", selection: "#ffffff40" }),
  make("one-half-dark", "One Half Dark", "#282c34", "#dcdfe4",
    ["#282c34", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#dcdfe4"],
    ["#5a6374", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#dcdfe4"],
    { cursor: "#ffffff" }),
  make("one-half-light", "One Half Light", "#fafafa", "#383a42",
    ["#383a42", "#e45649", "#50a14f", "#c18301", "#0184bc", "#a626a4", "#0997b3", "#fafafa"],
    ["#4f525d", "#df6c75", "#98c379", "#e4c07a", "#61afef", "#c577dd", "#56b5c1", "#ffffff"],
    { cursor: "#4f525d", selection: "#383a4233" }),
  make("solarized-dark", "Solarized Dark", "#002b36", "#839496",
    ["#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5"],
    ["#586e75", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3"],
    { cursor: "#93a1a1", selection: "#073642" }),
  make("solarized-light", "Solarized Light", "#fdf6e3", "#657b83",
    ["#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5"],
    ["#002b36", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3"],
    { cursor: "#586e75", selection: "#eee8d5" }),
  make("dracula", "Dracula", "#282a36", "#f8f8f2",
    ["#21222c", "#ff5555", "#50fa7b", "#f1fa8c", "#bd93f9", "#ff79c6", "#8be9fd", "#f8f8f2"],
    ["#6272a4", "#ff6e6e", "#69ff94", "#ffffa5", "#d6acff", "#ff92df", "#a4ffff", "#ffffff"],
    { selection: "#44475a" }),
  make("tokyo-night", "Tokyo Night", "#1a1b26", "#c0caf5",
    ["#15161e", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#a9b1d6"],
    ["#414868", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#c0caf5"],
    { selection: "#33467c" }),
  make("gruvbox-dark", "Gruvbox Dark", "#282828", "#ebdbb2",
    ["#282828", "#cc241d", "#98971a", "#d79921", "#458588", "#b16286", "#689d6a", "#a89984"],
    ["#928374", "#fb4934", "#b8bb26", "#fabd2f", "#83a598", "#d3869b", "#8ec07c", "#ebdbb2"],
    { selection: "#504945" }),
  make("nord", "Nord", "#2e3440", "#d8dee9",
    ["#3b4252", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#88c0d0", "#e5e9f0"],
    ["#4c566a", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#8fbcbb", "#eceff4"],
    { selection: "#434c5e" }),
];

export const BASE_COLORS: ThemeColors = BUILTIN_THEMES[0].colors;

export function allThemes(custom: CustomTheme[]): Theme[] {
  return [...BUILTIN_THEMES, ...custom.map((x) => ({ ...x, builtin: false }))];
}

/** Nombre para mostrar: los de fábrica propios (Alpha oscuro/claro) se traducen; los demás quedan como son. */
export const themeLabel = (theme: Theme): string => (theme.builtin ? t(theme.name) : theme.name);

export function findTheme(id: string, custom: CustomTheme[], fallback = "nova-dark"): Theme {
  const all = allThemes(custom);
  return all.find((x) => x.id === id) ?? all.find((x) => x.id === fallback) ?? BUILTIN_THEMES[0];
}

// --- Colores ----------------------------------------------------------------------------------

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseHex(hex: string): RGBA {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}

const hex2 = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
export const toHex = ({ r, g, b }: RGBA) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t, a: 1 });
}

export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${+alpha.toFixed(3)})`;
}

/** Luminancia relativa (WCAG), de 0 (negro) a 1 (blanco). */
export function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export const isDark = (c: ThemeColors) => luminance(c.background) < 0.35;

/**
 * Variables CSS de la interfaz a partir del tema de la terminal (como hace Warp: la barra
 * de pestañas combina con la terminal). `opacity` < 1 deja ver el efecto o el escritorio.
 */
export function uiPalette(c: ThemeColors, opacity = 1): Record<string, string> {
  const dark = isDark(c);
  const bg = c.background.slice(0, 7);
  const fg = c.foreground.slice(0, 7);
  const bar = mix(bg, fg, dark ? 0.03 : 0.045);
  return {
    "--bg": rgba(bg, opacity),
    "--bg-solid": bg,
    "--bar": rgba(bar, Math.min(1, opacity + (opacity < 1 ? 0.1 : 0))),
    "--tab": mix(bg, fg, 0.06),
    "--tab-hover": rgba(mix(bg, fg, dark ? 0.08 : 0.09), Math.max(opacity, 0.6)),
    "--line": mix(bg, fg, dark ? 0.1 : 0.14),
    "--text": fg,
    "--muted": mix(fg, bg, 0.42),
    "--accent": c.blue.slice(0, 7),
    "--ok": c.green.slice(0, 7),
    "--err": c.red.slice(0, 7),
    "color-scheme": dark ? "dark" : "light",
  };
}

// --- Importar -------------------------------------------------------------------------------

export interface ImportedTheme {
  name: string;
  colors: ThemeColors;
  /** Colores que no venían en el archivo (se completaron con el tema base). */
  missing: ColorKey[];
}

/** Nombres de Windows Terminal (y de otros) → los nuestros. */
const ALIASES: Record<string, ColorKey> = {
  purple: "magenta",
  brightPurple: "brightMagenta",
  cursorColor: "cursor",
  selection: "selectionBackground",
  selectionColor: "selectionBackground",
};

function fromFlat(o: Record<string, unknown>, fallbackName: string): ImportedTheme | null {
  const colors: Partial<ThemeColors> = {};
  for (const [k, v] of Object.entries(o)) {
    const key = (ALIASES[k] ?? k) as ColorKey;
    if ((COLOR_KEYS as readonly string[]).includes(key) && typeof v === "string" && HEX.test(v.trim())) {
      colors[key] = v.trim().toLowerCase();
    }
  }
  if (!colors.background || !colors.foreground) return null;
  return complete(colors, typeof o.name === "string" && o.name.trim() ? o.name.trim() : fallbackName);
}

function complete(colors: Partial<ThemeColors>, name: string): ImportedTheme {
  const missing = COLOR_KEYS.filter((k) => !colors[k]);
  const bg = colors.background ?? BASE_COLORS.background;
  const filled = { ...BASE_COLORS, cursorAccent: bg, cursor: colors.foreground ?? BASE_COLORS.cursor, ...colors } as ThemeColors;
  // Lo que se completa solo (sin ser un color de la paleta ANSI) no es un aviso útil.
  return { name, colors: filled, missing: missing.filter((k) => !["cursor", "cursorAccent", "selectionBackground"].includes(k)) };
}

const ITERM_KEYS: Record<string, ColorKey> = {
  "Background Color": "background",
  "Foreground Color": "foreground",
  "Cursor Color": "cursor",
  "Cursor Text Color": "cursorAccent",
  "Selection Color": "selectionBackground",
};
COLOR_KEYS.slice(5).forEach((k, i) => (ITERM_KEYS[`Ansi ${i} Color`] = k));

function fromItermPlist(xml: string, name: string): ImportedTheme | null {
  const colors: Partial<ThemeColors> = {};
  const re = /<key>([^<]+)<\/key>\s*<dict>([\s\S]*?)<\/dict>/g;
  for (const m of xml.matchAll(re)) {
    const key = ITERM_KEYS[m[1].trim()];
    if (!key) continue;
    const comp = (c: string) => {
      const v = new RegExp(`<key>${c} Component</key>\\s*<real>([^<]+)</real>`).exec(m[2]);
      return v ? Math.round(parseFloat(v[1]) * 255) : NaN;
    };
    const [r, g, b] = [comp("Red"), comp("Green"), comp("Blue")];
    if ([r, g, b].every(Number.isFinite)) colors[key] = toHex({ r, g, b, a: 1 });
  }
  if (!colors.background || !colors.foreground) return null;
  return complete(colors, name);
}

/**
 * Lee un archivo de tema. Acepta:
 * - un esquema de Windows Terminal (o su settings.json entero, con "schemes": [...]);
 * - el formato propio ({ name, colors: {...} }) o un tema de xterm.js;
 * - un .itermcolors de iTerm2.
 */
export function importThemes(text: string, fileName = t("Tema importado")): ImportedTheme[] {
  const baseName = fileName.replace(/\.[^.]+$/, "");
  const trimmed = text.trim();
  if (trimmed.startsWith("<")) {
    const theme = fromItermPlist(trimmed, baseName);
    if (!theme) throw new Error(t("El .itermcolors no tiene colores de fondo y de texto"));
    return [theme];
  }
  let data: unknown;
  try {
    // Windows Terminal permite comentarios en su settings.json.
    data = JSON.parse(trimmed.replace(/^\s*\/\/.*$/gm, ""));
  } catch (e) {
    throw new Error(t("No es un JSON válido: {error}", { error: (e as Error).message }));
  }
  const list: unknown[] = Array.isArray(data)
    ? data
    : typeof data === "object" && data && Array.isArray((data as { schemes?: unknown[] }).schemes)
      ? (data as { schemes: unknown[] }).schemes
      : [data];
  const out: ImportedTheme[] = [];
  list.forEach((item, i) => {
    if (typeof item !== "object" || !item) return;
    const o = item as Record<string, unknown>;
    const flat = typeof o.colors === "object" && o.colors ? { name: o.name, ...(o.colors as object) } : o;
    const theme = fromFlat(flat as Record<string, unknown>, list.length > 1 ? `${baseName} ${i + 1}` : baseName);
    if (theme) out.push(theme);
  });
  if (out.length === 0) throw new Error(t("No se encontró ningún tema (hace falta al menos background y foreground)"));
  return out;
}

/** Id libre para un tema propio a partir de su nombre. */
export function themeId(name: string, taken: Set<string>): string {
  const base =
    "mi-" +
    (name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "tema");
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}
