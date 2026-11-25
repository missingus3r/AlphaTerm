/**
 * Suggestion engine: from the line (already split into words) it decides what is being
 * completed and gathers the suggestions of each source (history, catalog, folders, PATH and the
 * PowerShell session), filtered by the current word, sorted and deduplicated.
 */
import { k } from "../i18n";
import { catalogFor, findSpec, type ArgSource, type CmdSpec, type GenName, type Opt, type Value } from "./catalog";
import type { Parsed, Word } from "./line";
import type { PsMsg } from "./pwsh";
import type { Shell } from "./types";

export type Kind = "folder" | "file" | "history" | "command" | "option" | "value" | "pwsh";

export interface Suggestion {
  /** Text that replaces the word (without quotes: `insertion` adds them), or the whole line. */
  insert: string;
  label: string;
  desc?: string;
  kind: Kind;
  score: number;
  replace: "word" | "line";
  /** Folder: keeps completing inside it. */
  dir?: boolean;
  /** Indexes of `label` that match what was typed (to highlight them). */
  hits?: number[];
  /** PowerShell result: replaced from this line index and inserted as is. */
  from?: number;
}

export interface HistEntry {
  command: string;
  cwd: string | null;
  at: number;
  shell: string | null;
}

export interface Sources {
  listDir(dir: string, dirsOnly: boolean, hidden: boolean): Promise<{ name: string; dir: boolean }[]>;
  history(): Promise<HistEntry[]>;
  pathCommands(): Promise<string[]>;
  gen(name: GenName, cwd: string): Promise<Value[]>;
}

export interface Analysis {
  mode: "command" | "arg";
  word: Word;
  index: number;
  /** First word, lowercase and without `.exe`. */
  command: string;
  spec: CmdSpec | null;
  source: ArgSource | null;
  opts: Opt[];
  subs: CmdSpec[];
  pathLike: boolean;
  /** It's worth asking the PowerShell session for completions. */
  askPwsh: boolean;
  /** The menu appears on its own (without Ctrl+Space). */
  auto: boolean;
}

export interface Ctx {
  line: string;
  cwd: string;
  shell: Shell;
  now?: number;
}

const MAX = 60;
const norm = (s: string) => s.toLowerCase().replace(/\.(exe|cmd|bat|com)$/, "");
const isNetwork = (s: string) => s.startsWith("\\\\") || s.startsWith("//");
const looksLikePath = (s: string, shell: Shell) =>
  // In cmd, `/s` is an option: it is a path only if there is another slash (`/tmp/x`) or it starts differently.
  !(shell === "cmd" && /^\/[^\\/]*$/.test(s)) &&
  (/[\\/]/.test(s) || s.startsWith(".") || s.startsWith("~") || /^[a-zA-Z]:/.test(s));
const isOptionLike = (s: string, shell: Shell) => s.startsWith("-") || (shell === "cmd" && s.startsWith("/"));

export function analyze(p: Parsed, shell: Shell): Analysis {
  const word = p.current;
  const value = word.value;
  const pathLike = looksLikePath(value, shell);
  const command = p.index > 0 ? norm(p.words[0].value) : norm(value);

  if (p.index === 0) {
    return {
      mode: "command",
      word,
      index: 0,
      command,
      spec: null,
      source: pathLike ? "paths" : null,
      opts: [],
      subs: [],
      pathLike,
      askPwsh: shell === "ps" && !pathLike && !isNetwork(value) && value.length >= 3,
      auto: pathLike ? value.length >= 1 : value.length >= 2,
    };
  }

  const spec = findSpec(command, shell);
  // Subcommands already typed (git → checkout, docker → compose → up…).
  let level: CmdSpec | null = spec;
  for (let i = 1; i < p.index && level?.subs; i++) {
    const next: CmdSpec | undefined = level.subs.find((s) => s.names.includes(p.words[i].value.toLowerCase()));
    if (!next) break;
    level = next;
  }
  const prev = p.index >= 2 ? p.words[p.index - 1].value.toLowerCase() : "";
  const optArg = level?.opts?.find((o) => o.arg && o.name.toLowerCase() === prev);

  let source: ArgSource | null;
  let opts: Opt[] = [];
  let subs: CmdSpec[] = [];
  if (optArg?.arg) {
    source = optArg.arg;
  } else {
    source = level ? (level.args ?? null) : "paths";
    opts = level?.opts ?? [];
    subs = level?.subs ?? [];
  }
  if (pathLike && source !== "folders") source = "paths";

  const known = spec !== null;
  const auto =
    value.length > 0 ||
    (known && ((source !== null && source !== "paths") || subs.length > 0 || opts.length > 0));
  return {
    mode: "arg",
    word,
    index: p.index,
    command,
    spec: level,
    source,
    opts,
    subs,
    pathLike,
    askPwsh: shell === "ps" && !known && !isNetwork(value),
    auto,
  };
}

/** Match of `label` with what was typed: at the start (higher score) or inside (only if `contains`). */
function match(label: string, typed: string, contains: boolean): { bonus: number; hits: number[] } | null {
  if (!typed) return { bonus: 0, hits: [] };
  const l = label.toLowerCase();
  const t = typed.toLowerCase();
  const range = (i: number) => Array.from({ length: t.length }, (_, k) => i + k);
  if (l.startsWith(t)) return { bonus: 50, hits: range(0) };
  if (!contains) return null;
  const i = l.indexOf(t);
  return i >= 0 ? { bonus: 0, hits: range(i) } : null;
}

const matchesShell = (entry: string | null, shell: Shell) =>
  !entry || (shell === "ps" ? /powershell/i.test(entry) : /s[ií]mbolo|\bcmd\b/i.test(entry));

const sameDir = (a: string | null, b: string) => !!a && a.toLowerCase().replace(/\\+$/, "") === b.toLowerCase().replace(/\\+$/, "");

/** There is an absolute path in the arguments (valid from any folder). */
const ABSOLUTE = /\s["']?([a-zA-Z]:[\\/]|~|\\\\)/;

function historyLines(hist: HistEntry[], ctx: Ctx, a: Analysis): Suggestion[] {
  const line = ctx.line.toLowerCase();
  if (!line.trim()) return [];
  // A `cd docs` done in another folder is no use here: if the catalog says the argument is a path (or
  // what is typed is one), only this folder's history. The rest (cmdlets, CLIs the
  // catalog doesn't know) keep the whole history, with less weight for other folders'.
  const relative = a.mode === "arg" && ((a.spec !== null && (a.source === "folders" || a.source === "paths")) || a.pathLike);
  const now = ctx.now ?? Date.now();
  const groups = new Map<string, { command: string; count: number; at: number; here: boolean }>();
  for (const e of hist) {
    const c = e.command.trim();
    if (!c.toLowerCase().startsWith(line) || c.toLowerCase() === line.trimEnd()) continue;
    const g = groups.get(c) ?? { command: c, count: 0, at: 0, here: false };
    g.count++;
    g.at = Math.max(g.at, e.at);
    g.here ||= sameDir(e.cwd, ctx.cwd);
    groups.set(c, g);
  }
  return [...groups.values()].filter((g) => !relative || g.here || ABSOLUTE.test(g.command)).map((g) => {
    const hours = Math.max(0, (now - g.at) / 3_600_000);
    return {
      insert: g.command,
      label: g.command,
      desc: g.here ? k("historial, acá") : k("historial"),
      kind: "history" as const,
      replace: "line" as const,
      score: 1000 + (g.here ? 200 : 0) + Math.min(g.count, 10) * 10 + Math.max(0, 100 - hours),
      hits: Array.from({ length: ctx.line.length }, (_, k) => k),
    };
  });
}

/** Arguments used before with the same command (ping, ssh hosts…), without options or numbers. */
function historyArgs(hist: HistEntry[], command: string, shell: Shell): Value[] {
  const out: Value[] = [];
  for (const e of [...hist].reverse()) {
    const words = e.command.trim().split(/\s+/);
    if (norm(words[0] ?? "") !== command) continue;
    for (const w of words.slice(1)) {
      if (!isOptionLike(w, shell) && !/^\d+$/.test(w)) out.push({ v: w, desc: k("usado antes") });
    }
  }
  return out;
}

async function listing(a: Analysis, ctx: Ctx, src: Sources, dirsOnly: boolean): Promise<Suggestion[]> {
  const value = a.word.value;
  const cut = Math.max(value.lastIndexOf("\\"), value.lastIndexOf("/")) + 1;
  // `'Mis Documentos\\'`: the trailing slash is doubled inside quotes (see insert.ts); here it counts as one.
  const dirPart = value.slice(0, cut).replace(/\\{2,}/g, "\\");
  const namePart = value.slice(cut);
  const out: Suggestion[] = [];
  const entries = isNetwork(value) ? [] : await src.listDir(dirPart, dirsOnly, namePart.startsWith("."));
  for (const e of entries) {
    const m = match(e.name, namePart, true);
    if (!m) continue;
    const label = e.name + (e.dir ? "\\" : "");
    out.push({ insert: dirPart + label, label, kind: e.dir ? "folder" : "file", dir: e.dir, replace: "word", score: 650 + (e.dir ? 5 : 0) + m.bonus, hits: m.hits });
  }
  if (dirsOnly) {
    const specials: Value[] = [{ v: "..", desc: k("carpeta de arriba") }];
    if (ctx.shell === "ps" && dirPart === "") specials.push({ v: "~", desc: k("tu carpeta de usuario") });
    for (const s of specials) {
      const m = match(s.v, namePart, false);
      if (m) out.push({ insert: `${dirPart}${s.v}\\`, label: `${s.v}\\`, desc: s.desc, kind: "folder", dir: true, replace: "word", score: 660 + m.bonus, hits: m.hits });
    }
  }
  return out;
}

const PS_KIND: Record<string, Kind> = {
  ProviderContainer: "folder",
  ProviderItem: "file",
  Command: "command",
  ParameterName: "option",
  ParameterValue: "value",
  History: "history",
};

function fromPwsh(ps: PsMsg | undefined, ctx: Ctx, a: Analysis): Suggestion[] {
  if (!ps || ps.type !== "completions") return [];
  // Old response (typing went on) or one that doesn't end at the cursor: useless.
  if (ps.buffer !== ctx.line || ps.cursor !== ctx.line.length || ps.index + ps.length !== ps.cursor) return [];
  // First word: after history and catalog (before PATH). Arguments of a
  // command the catalog doesn't know: it is the best source. Of one it knows: last.
  const base = a.mode === "command" ? 300 : a.spec ? 250 : 640;
  const typed = ctx.line.slice(ps.index);
  return ps.results.map((r) => {
    const kind = PS_KIND[r.kind] ?? "pwsh";
    const tip = r.tip.trim();
    // Parameters come without a dash in ListItemText ("Filter"): what is going to be typed is shown.
    const label = kind === "option" ? r.text : r.label;
    return {
      insert: r.text,
      label,
      hits: match(label, typed.replace(/^\.[\\/]/, ""), true)?.hits,
      desc: tip && tip !== r.label && tip !== r.text && !tip.includes("\n") ? tip : undefined,
      kind,
      dir: kind === "folder",
      replace: "word" as const,
      from: ps.index,
      score: base,
    };
  });
}

function values(vals: Value[], typed: string, score: number): Suggestion[] {
  const out: Suggestion[] = [];
  for (const v of vals) {
    const m = match(v.v, typed, true);
    if (m) out.push({ insert: v.v, label: v.v, desc: v.desc, kind: "value", replace: "word", score: score + m.bonus, hits: m.hits });
  }
  return out;
}

const dedupeKey = (s: Suggestion) =>
  s.replace === "line"
    ? `line:${s.insert.toLowerCase()}`
    : s.insert
        .toLowerCase()
        .replace(/^['"]|['"]$/g, "")
        .replace(/^\.[\\/]/, "")
        .replace(/[\\/]+$/, "")
        // A program with and without extension (our own PATH vs. what PowerShell returns) is the same.
        .replace(s.kind === "command" ? /\.(exe|cmd|bat|com|ps1)$/ : /$^/, "");

export async function collect(a: Analysis, ctx: Ctx, src: Sources, ps?: PsMsg): Promise<Suggestion[]> {
  const typed = a.word.value;
  const hist = (await src.history()).filter((e) => matchesShell(e.shell, ctx.shell));
  const out: Suggestion[] = [...historyLines(hist, ctx, a)];

  if (a.mode === "command") {
    if (a.pathLike) out.push(...(await listing(a, ctx, src, false)));
    else {
      for (const s of catalogFor(ctx.shell)) {
        for (const n of s.names) {
          const m = match(n, typed, false);
          if (m) out.push({ insert: n, label: n, desc: s.desc, kind: "command", replace: "word", score: 500 + m.bonus, hits: m.hits });
        }
      }
      for (const n of await src.pathCommands()) {
        const m = match(n, typed, false);
        if (m) out.push({ insert: n.toLowerCase(), label: n.toLowerCase(), desc: k("programa del PATH"), kind: "command", replace: "word", score: 100 + m.bonus, hits: m.hits });
      }
    }
  } else {
    for (const s of a.subs) {
      for (const n of s.names) {
        const m = match(n, typed, false);
        if (m) out.push({ insert: n, label: n, desc: s.desc, kind: "command", replace: "word", score: 600 + m.bonus, hits: m.hits });
      }
    }
    if (!typed || isOptionLike(typed, ctx.shell)) {
      for (const o of a.opts) {
        const m = match(o.name, typed, false);
        if (m) out.push({ insert: o.name, label: o.name, desc: o.desc, kind: "option", replace: "word", score: (typed ? 600 : 200) + m.bonus, hits: m.hits });
      }
    }
    const source = a.source;
    if (Array.isArray(source)) out.push(...values(source, typed, 700));
    else if (source === "folders" || source === "paths") {
      // `dir /` or `Get-Item -`: an option is being typed, not a path.
      if (!(isOptionLike(typed, ctx.shell) && !a.pathLike)) out.push(...(await listing(a, ctx, src, source === "folders")));
    }
    else if (source) {
      out.push(...values(await src.gen(source, ctx.cwd).catch(() => []), typed, 700));
      if (source === "hosts") out.push(...values(historyArgs(hist, a.command, ctx.shell), typed, 690));
    }
  }
  out.push(...fromPwsh(ps, ctx, a));

  // Nothing with control characters: an npm script named "x\rcalc\r" (or a multi-line history line,
  // or a PowerShell completer) would run on insertion.
  const safe = out.filter((s) => !/[\x00-\x1f\x7f]/.test(s.insert));

  // No repeats: the one with the higher score wins (or the first).
  const best = new Map<string, Suggestion>();
  for (const s of safe) {
    const key = dedupeKey(s);
    const had = best.get(key);
    if (!had || s.score > had.score) best.set(key, s);
  }
  const keep = new Set(best.values());
  return safe
    .filter((s) => keep.has(s))
    .map((s, i) => ({ s, i }))
    .sort((x, y) => y.s.score - x.s.score || x.i - y.i)
    .slice(0, MAX)
    .map((x) => x.s);
}
