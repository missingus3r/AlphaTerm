import { currentOs, type Os } from "../platform";

/**
 * Paths in the terminal output (what agents show: "Escribí C:\x\a.ts",
 * "src/layout/TabBar.tsx:42", "./build/out.png"). They become links that open the folder or the
 * file, and show a preview on mouse hover.
 */

export interface PathMatch {
  /** Column (0-based) where the link text starts and ends. */
  start: number;
  end: number;
  /** Path as it appears (without the :line:column). */
  raw: string;
  line?: number;
  col?: number;
}

// Absolute (C:\..., C:/..., \\server\share\... on Windows; /home/x... on Linux) or relative with at
// least one slash (./x, ../x, src/x.ts, .claude\settings.json). No spaces: a path with spaces only
// is only recognized inside quotes.
const ABS_WIN = String.raw`(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/]|\\\\[^\\\s]+\\)[^\s"'<>|*?\x00-\x1f]*`;
// Linux: from a "/" that isn't part of a word, URL or relative path ("a/b", "http://").
const ABS_LINUX = String.raw`(?<![\w.~:/\\-])\/[\w.@~+-][^\s"'<>|*?\x00-\x1f]*`;
const REL = String.raw`(?:\.{1,2}[\\/]|[\w.@-]+[\\/])[^\s"'<>|*?:\x00-\x1f]*(?::\d+){0,2}`;
const QUOTED_WIN = String.raw`["'\x60]((?:[A-Za-z]:[\\/]|\.{1,2}[\\/])[^"'\x60\x00-\x1f]+)["'\x60]`;
const QUOTED_LINUX = String.raw`["'\x60]((?:\/|\.{1,2}\/)[^"'\x60\x00-\x1f]+)["'\x60]`;
const RES: Partial<Record<Os, RegExp>> = {};
const regexFor = (os: Os) =>
  (RES[os] ??=
    os === "windows"
      ? new RegExp(`${QUOTED_WIN}|(${ABS_WIN})|(?<![\\w:/\\\\.-])(${REL})`, "g")
      : new RegExp(`${QUOTED_LINUX}|(${ABS_LINUX})|(?<![\\w:/\\\\.-])(${REL})`, "g"));

const TRAIL = /[.,;:)\]}>'"`]+$/;
const LINECOL = /:(\d+)(?::(\d+))?$/;

export function findPaths(text: string): PathMatch[] {
  const out: PathMatch[] = [];
  for (const m of text.matchAll(regexFor(currentOs()))) {
    const quoted = m[1] !== undefined;
    let raw = m[1] ?? m[2] ?? m[3];
    if (!raw) continue;
    let start = m.index! + (quoted ? 1 : m[0].indexOf(raw));
    // URLs are handled by the web links addon.
    if (/^[a-z]{2,}:\/\//i.test(text.slice(Math.max(0, start - 8), start + raw.length))) continue;
    if (!quoted) raw = raw.replace(TRAIL, (t) => (/^:\d/.test(t) ? t : ""));
    let line: number | undefined;
    let col: number | undefined;
    const lc = LINECOL.exec(raw);
    let shown = raw;
    if (lc) {
      line = Number(lc[1]);
      col = lc[2] ? Number(lc[2]) : undefined;
      raw = raw.slice(0, lc.index);
    }
    raw = raw.replace(TRAIL, "");
    if (raw.length < 3 || /^\d+[\\/]\d+/.test(raw)) continue; // dates like 18/11/2026
    if (!/[\\/]/.test(raw)) continue;
    out.push({ start, end: start + shown.replace(TRAIL, "").length, raw, line, col });
    start = 0;
  }
  return out;
}

/** Absolute path (with the system's slashes) from a relative one and the pane's folder. */
export function resolvePath(raw: string, cwd?: string): string | null {
  if (currentOs() === "linux") return resolvePosix(raw, cwd);
  let p = raw.replace(/\//g, "\\");
  if (!/^([A-Za-z]:\\|\\\\)/.test(p)) {
    if (!cwd) return null;
    p = `${cwd.replace(/[\\/]+$/, "")}\\${p}`;
  }
  // Normalize . and ..
  const unc = p.startsWith("\\\\");
  const parts = p.split("\\").filter((x, i) => x !== "" || i === 0);
  const out: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      if (out.length > 1) out.pop();
      continue;
    }
    out.push(part);
  }
  const joined = out.join("\\");
  return unc ? `\\\\${joined.replace(/^\\+/, "")}` : joined.length === 2 ? `${joined}\\` : joined;
}

function resolvePosix(raw: string, cwd?: string): string | null {
  let p = raw;
  if (!p.startsWith("/")) {
    if (!cwd) return null;
    p = `${cwd.replace(/\/+$/, "")}/${p}`;
  }
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

const IMAGE = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "avif"];
const TEXT = [
  "txt", "md", "json", "jsonl", "ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "py", "toml", "yaml", "yml", "css", "html",
  "xml", "csv", "log", "ps1", "sh", "bash", "bat", "cmd", "ini", "cfg", "conf", "sql", "go", "java", "kt", "c", "h", "cpp",
  "hpp", "cs", "rb", "php", "lua", "env", "gitignore", "lock", "svelte", "vue",
];

export type PreviewKind = "image" | "text" | "other";

export function previewKind(path: string): PreviewKind {
  const name = path.split(/[\\/]/).pop()!.toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop()! : name;
  if (IMAGE.includes(ext)) return "image";
  if (TEXT.includes(ext) || !name.includes(".")) return "text";
  return "other";
}

export function mimeOf(path: string): string {
  const ext = path.split(".").pop()!.toLowerCase();
  return ext === "svg" ? "image/svg+xml" : ext === "jpg" ? "image/jpeg" : ext === "ico" ? "image/x-icon" : `image/${ext}`;
}
