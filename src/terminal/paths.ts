/**
 * Rutas en la salida de la terminal (lo que muestran los agentes: "Escribí C:\x\a.ts",
 * "src/layout/TabBar.tsx:42", "./build/out.png"). Se vuelven links que abren la carpeta o el
 * archivo, y al pasar el mouse muestran una vista previa.
 */

export interface PathMatch {
  /** Columna (0-based) donde empieza y termina el texto del link. */
  start: number;
  end: number;
  /** Ruta tal como aparece (sin el :línea:columna). */
  raw: string;
  line?: number;
  col?: number;
}

// Absolutas (C:\..., C:/..., \\servidor\recurso\...) o relativas con al menos una barra
// (./x, ../x, src/x.ts, .claude\settings.json). Sin espacios: una ruta con espacios solo se
// reconoce entre comillas.
const ABS = String.raw`(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/]|\\\\[^\\\s]+\\)[^\s"'<>|*?\x00-\x1f]*`;
const REL = String.raw`(?:\.{1,2}[\\/]|[\w.@-]+[\\/])[^\s"'<>|*?:\x00-\x1f]*(?::\d+){0,2}`;
const QUOTED = String.raw`["'\x60]((?:[A-Za-z]:[\\/]|\.{1,2}[\\/])[^"'\x60\x00-\x1f]+)["'\x60]`;
const RE = new RegExp(`${QUOTED}|(${ABS})|(?<![\\w:/\\\\.-])(${REL})`, "g");

const TRAIL = /[.,;:)\]}>'"`]+$/;
const LINECOL = /:(\d+)(?::(\d+))?$/;

export function findPaths(text: string): PathMatch[] {
  const out: PathMatch[] = [];
  for (const m of text.matchAll(RE)) {
    const quoted = m[1] !== undefined;
    let raw = m[1] ?? m[2] ?? m[3];
    if (!raw) continue;
    let start = m.index! + (quoted ? 1 : m[0].indexOf(raw));
    // URLs las maneja el addon de links web.
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
    if (raw.length < 3 || /^\d+[\\/]\d+/.test(raw)) continue; // fechas tipo 18/11/2026
    if (!/[\\/]/.test(raw)) continue;
    out.push({ start, end: start + shown.replace(TRAIL, "").length, raw, line, col });
    start = 0;
  }
  return out;
}

/** Ruta absoluta (con barras de Windows) a partir de una relativa y la carpeta del panel. */
export function resolvePath(raw: string, cwd?: string): string | null {
  let p = raw.replace(/\//g, "\\");
  if (!/^([A-Za-z]:\\|\\\\)/.test(p)) {
    if (!cwd) return null;
    p = `${cwd.replace(/[\\/]+$/, "")}\\${p}`;
  }
  // Normalizar . y ..
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
