/**
 * Esquema de `%APPDATA%\AlphaTerm\settings.json`.
 * `normalize` acepta cualquier cosa (un archivo editado a mano, de una versión vieja o roto)
 * y devuelve una configuración completa y válida, sin perder claves que no conoce.
 */
import type { ThemeColors } from "./themes";

export type ThemeMode = "dark" | "light" | "auto";
export type Effect = "none" | "mica" | "acrylic" | "tabbed" | "blur";
export type ImageFit = "cover" | "contain" | "tile";
export type CursorStyle = "block" | "bar" | "underline";

export interface CustomTheme {
  id: string;
  name: string;
  colors: ThemeColors;
}

export interface AgentDef {
  id: string;
  name: string;
  /** Línea de comando que se escribe en la shell (ej. "claude --model opus"). */
  command: string;
  /** Variables de entorno extra para la pestaña del agente. */
  env: Record<string, string>;
  /** Oculto del panel (sin borrarlo). */
  hidden: boolean;
  builtin: boolean;
}

export const BUILTIN_AGENTS: AgentDef[] = [
  { id: "claude", name: "Claude Code", command: "claude", env: {}, hidden: false, builtin: true },
  { id: "codex", name: "Codex", command: "codex", env: {}, hidden: false, builtin: true },
  { id: "agy", name: "Antigravity (agy)", command: "agy", env: {}, hidden: false, builtin: true },
  { id: "opencode", name: "OpenCode", command: "opencode", env: {}, hidden: false, builtin: true },
];

/** Cómo volver a iniciar un servidor. */
export interface Recipe {
  id: string;
  name: string;
  command: string;
  cwd: string;
  env: Record<string, string>;
  /** Puertos en los que se lo vio escuchar. */
  ports: number[];
  /** Guardada sola (vista nacer en una pestaña) o escrita a mano. */
  auto: boolean;
  lastSeen?: number;
}

export interface Settings {
  version: 1;
  appearance: {
    /** Tema cuando el modo es oscuro (o fijo). */
    theme: string;
    /** Tema cuando el modo es claro. */
    themeLight: string;
    mode: ThemeMode;
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    letterSpacing: number;
    fontWeight: "normal" | "bold" | "300" | "500" | "600";
    ligatures: boolean;
    cursorStyle: CursorStyle;
    cursorBlink: boolean;
  };
  background: {
    effect: Effect;
    /** Opacidad del color de fondo (1 = opaco). Con efecto, deja ver el Mica/Acrylic. */
    opacity: number;
    /** Ruta de la copia en %APPDATA%\AlphaTerm\fondos, o "" sin imagen. */
    image: string;
    imageOpacity: number;
    imageFit: ImageFit;
  };
  customThemes: CustomTheme[];
  tabBar: { position: "top" | "left" };
  terminal: {
    /** "" = el que detecta el backend (PowerShell 5.1 en esta PC). */
    defaultProfile: string;
    scrollback: number;
  };
  behavior: {
    /** Cada cuánto se mira qué programa corre en cada pestaña (para el título). */
    foregroundPollMs: number;
  };
  /** Atajos cambiados (id de acción → combinaciones). Lo que no está usa el de fábrica. */
  shortcuts: Record<string, string[]>;
  /** Catálogo de agentes: los de fábrica (editables) y los propios. */
  agents: AgentDef[];
  /** Carpetas usadas hace poco para lanzar agentes (la más reciente primero). */
  recentDirs: string[];
  /** Footer de consumo por suscripción. */
  usage: {
    claude: boolean;
    codex: boolean;
    agy: boolean;
    /** Claude y Codex se leen de archivos locales: es barato. */
    filesEverySec: number;
    /** agy ejecuta `agy -p /quota` (no gasta cuota, pero tarda unos segundos). */
    agyEveryMin: number;
  };
  /** Widget de CPU y RAM. */
  sysmon: { enabled: boolean; everyMs: number };
  /** Recetas para iniciar servidores. */
  recipes: Recipe[];
  /** Proyectos agregados a mano y ocultos de la lista. */
  projects: { manual: string[]; hidden: string[] };
  /** Al abrir, volver a como estaban las ventanas. */
  session: { restore: boolean; relaunchAgents: boolean };
}

export const DEFAULT_FONT = "Cascadia Mono";

export const DEFAULTS: Settings = {
  version: 1,
  appearance: {
    theme: "nova-dark",
    themeLight: "nova-light",
    mode: "dark",
    fontFamily: DEFAULT_FONT,
    fontSize: 14,
    lineHeight: 1.15,
    letterSpacing: 0,
    fontWeight: "normal",
    ligatures: false,
    cursorStyle: "block",
    cursorBlink: true,
  },
  background: { effect: "none", opacity: 1, image: "", imageOpacity: 0.25, imageFit: "cover" },
  customThemes: [],
  tabBar: { position: "top" },
  terminal: { defaultProfile: "", scrollback: 10_000 },
  behavior: { foregroundPollMs: 2000 },
  shortcuts: {},
  agents: BUILTIN_AGENTS,
  recentDirs: [],
  usage: { claude: true, codex: true, agy: true, filesEverySec: 60, agyEveryMin: 10 },
  sysmon: { enabled: true, everyMs: 1000 },
  recipes: [],
  projects: { manual: [], hidden: [] },
  session: { restore: true, relaunchAgents: false },
};

export const LIMITS = {
  fontSize: [8, 32],
  lineHeight: [1, 2],
  letterSpacing: [-2, 6],
  opacity: [0.3, 1],
  imageOpacity: [0.05, 1],
  scrollback: [500, 200_000],
  foregroundPollMs: [500, 10_000],
  filesEverySec: [15, 3600],
  agyEveryMin: [2, 240],
  sysmonMs: [500, 10_000],
} as const satisfies Record<string, readonly [number, number]>;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const obj = (v: unknown): Obj => (isObj(v) ? v : {});

const num = (v: unknown, def: number, [lo, hi]: readonly [number, number]) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
const str = (v: unknown, def: string) => (typeof v === "string" && v.trim() ? v.trim() : def);
const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);
const oneOf = <T extends string>(v: unknown, opts: readonly T[], def: T): T =>
  typeof v === "string" && (opts as readonly string[]).includes(v) ? (v as T) : def;

export const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const COLOR_KEYS = [
  "background", "foreground", "cursor", "cursorAccent", "selectionBackground",
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];
export { COLOR_KEYS };

function normalizeColors(v: unknown, base: ThemeColors): ThemeColors {
  const o = obj(v);
  const out = { ...base };
  for (const k of COLOR_KEYS) {
    const c = o[k];
    if (typeof c === "string" && HEX.test(c.trim())) out[k] = c.trim();
  }
  return out;
}

function normalizeThemes(v: unknown, base: ThemeColors): CustomTheme[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: CustomTheme[] = [];
  for (const t of v) {
    if (!isObj(t)) continue;
    const id = str(t.id, "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: str(t.name, id), colors: normalizeColors(t.colors, base) });
  }
  return out;
}

function normalizeShortcuts(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, combos] of Object.entries(obj(v))) {
    if (Array.isArray(combos)) out[k] = combos.filter((c): c is string => typeof c === "string" && c.length > 0);
  }
  return out;
}

function normalizeEnv(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(obj(v))) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && typeof val === "string") out[k] = val;
  }
  return out;
}

/** Los de fábrica siempre están (con lo que se les haya cambiado); los propios se agregan al final. */
export function normalizeAgents(v: unknown): AgentDef[] {
  const list = Array.isArray(v) ? v.filter(isObj) : [];
  const byId = new Map(list.map((a) => [str(a.id, ""), a] as const));
  const fix = (a: Obj, base: AgentDef): AgentDef => ({
    id: base.id,
    name: str(a.name, base.name),
    command: str(a.command, base.command),
    env: normalizeEnv(a.env),
    hidden: bool(a.hidden, false),
    builtin: base.builtin,
  });
  const out = BUILTIN_AGENTS.map((b) => fix(byId.get(b.id) ?? {}, b));
  const seen = new Set(out.map((a) => a.id));
  for (const a of list) {
    const id = str(a.id, "");
    const command = str(a.command, "");
    if (!id || !command || seen.has(id)) continue;
    seen.add(id);
    out.push(fix(a, { id, name: id, command, env: {}, hidden: false, builtin: false }));
  }
  return out;
}

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.trim() !== ""))] : [];

function normalizeRecipes(v: unknown): Recipe[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: Recipe[] = [];
  for (const r of v.filter(isObj)) {
    const id = str(r.id, "");
    const command = str(r.command, "");
    if (!id || !command || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: str(r.name, command),
      command,
      cwd: typeof r.cwd === "string" ? r.cwd : "",
      env: normalizeEnv(r.env),
      ports: Array.isArray(r.ports) ? r.ports.filter((p): p is number => Number.isInteger(p) && p > 0 && p < 65536) : [],
      auto: bool(r.auto, false),
      ...(typeof r.lastSeen === "number" ? { lastSeen: r.lastSeen } : {}),
    });
  }
  return out;
}

export function normalize(raw: unknown, baseColors: ThemeColors): Settings {
  const r = obj(raw);
  const a = obj(r.appearance);
  const b = obj(r.background);
  const D = DEFAULTS;
  return {
    ...r, // claves de otras fases o versiones: se conservan tal cual
    version: 1,
    appearance: {
      theme: str(a.theme, D.appearance.theme),
      themeLight: str(a.themeLight, D.appearance.themeLight),
      mode: oneOf(a.mode, ["dark", "light", "auto"], D.appearance.mode),
      fontFamily: str(a.fontFamily, D.appearance.fontFamily),
      fontSize: num(a.fontSize, D.appearance.fontSize, LIMITS.fontSize),
      lineHeight: num(a.lineHeight, D.appearance.lineHeight, LIMITS.lineHeight),
      letterSpacing: num(a.letterSpacing, D.appearance.letterSpacing, LIMITS.letterSpacing),
      fontWeight: oneOf(a.fontWeight, ["normal", "bold", "300", "500", "600"], D.appearance.fontWeight),
      ligatures: bool(a.ligatures, D.appearance.ligatures),
      cursorStyle: oneOf(a.cursorStyle, ["block", "bar", "underline"], D.appearance.cursorStyle),
      cursorBlink: bool(a.cursorBlink, D.appearance.cursorBlink),
    },
    background: {
      effect: oneOf(b.effect, ["none", "mica", "acrylic", "tabbed", "blur"], D.background.effect),
      opacity: num(b.opacity, D.background.opacity, LIMITS.opacity),
      image: typeof b.image === "string" ? b.image : "",
      imageOpacity: num(b.imageOpacity, D.background.imageOpacity, LIMITS.imageOpacity),
      imageFit: oneOf(b.imageFit, ["cover", "contain", "tile"], D.background.imageFit),
    },
    customThemes: normalizeThemes(r.customThemes, baseColors),
    tabBar: { position: oneOf(obj(r.tabBar).position, ["top", "left"], D.tabBar.position) },
    terminal: {
      defaultProfile: typeof obj(r.terminal).defaultProfile === "string" ? (obj(r.terminal).defaultProfile as string) : "",
      scrollback: Math.round(num(obj(r.terminal).scrollback, D.terminal.scrollback, LIMITS.scrollback)),
    },
    behavior: {
      foregroundPollMs: Math.round(num(obj(r.behavior).foregroundPollMs, D.behavior.foregroundPollMs, LIMITS.foregroundPollMs)),
    },
    shortcuts: normalizeShortcuts(r.shortcuts),
    agents: normalizeAgents(r.agents),
    recentDirs: Array.isArray(r.recentDirs)
      ? [...new Set(r.recentDirs.filter((d): d is string => typeof d === "string" && d.trim() !== ""))].slice(0, 12)
      : [],
    usage: (() => {
      const u = obj(r.usage);
      const D = DEFAULTS.usage;
      return {
        claude: bool(u.claude, D.claude),
        codex: bool(u.codex, D.codex),
        agy: bool(u.agy, D.agy),
        filesEverySec: Math.round(num(u.filesEverySec, D.filesEverySec, LIMITS.filesEverySec)),
        agyEveryMin: Math.round(num(u.agyEveryMin, D.agyEveryMin, LIMITS.agyEveryMin)),
      };
    })(),
    recipes: normalizeRecipes(r.recipes),
    session: {
      restore: bool(obj(r.session).restore, DEFAULTS.session.restore),
      relaunchAgents: bool(obj(r.session).relaunchAgents, DEFAULTS.session.relaunchAgents),
    },
    projects: {
      manual: strList(obj(r.projects).manual),
      hidden: strList(obj(r.projects).hidden),
    },
    sysmon: {
      enabled: bool(obj(r.sysmon).enabled, DEFAULTS.sysmon.enabled),
      everyMs: Math.round(num(obj(r.sysmon).everyMs, DEFAULTS.sysmon.everyMs, LIMITS.sysmonMs)),
    },
  };
}

/** Copia profunda (las settings son JSON puro). */
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
