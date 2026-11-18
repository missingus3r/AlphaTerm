/**
 * Parseo de las secuencias que mandan los scripts de shell integration:
 * - OSC 133 (FinalTerm): A = empieza el prompt, B = termina el prompt, C = arranca el comando,
 *   D;código = terminó el comando.
 * - OSC 633;E;<comando> (convención de VS Code): el texto del comando, escapado.
 * - OSC 7 (file://host/ruta) y OSC 9;9;ruta (Windows Terminal/ConEmu): carpeta actual.
 */

export type ShellMark =
  | { type: "promptStart" }
  | { type: "promptEnd" }
  | { type: "commandStart" }
  | { type: "commandEnd"; exitCode: number | null };

export function parse133(data: string): ShellMark | null {
  const [kind, arg] = data.split(";");
  switch (kind) {
    case "A":
      return { type: "promptStart" };
    case "B":
      return { type: "promptEnd" };
    case "C":
      return { type: "commandStart" };
    case "D": {
      const n = arg === undefined || arg === "" ? NaN : Number(arg);
      return { type: "commandEnd", exitCode: Number.isFinite(n) ? n : null };
    }
    default:
      return null;
  }
}

/** Deshace el escapado de 633;E: `\\` es una barra y `\xNN` un byte (por ejemplo `\x3b` = `;`). */
export function unescape633(s: string): string {
  return s.replace(/\\(\\|x([0-9a-fA-F]{2}))/g, (_m, all: string, hex?: string) =>
    hex ? String.fromCharCode(parseInt(hex, 16)) : all,
  );
}

export function parse633(data: string): { command: string } | null {
  if (!data.startsWith("E;")) return null;
  // Puede venir un nonce después de otro `;` sin escapar: se descarta.
  const body = data.slice(2).split(";")[0];
  return { command: unescape633(body) };
}

/** `/c/Users/x` (MSYS) o `/C:/Users/x` → `C:\Users\x`. Deja tal cual lo que ya es ruta de Windows. */
export function toWindowsPath(p: string): string {
  let s = p;
  const msys = /^\/([a-zA-Z])(\/|$)(.*)$/.exec(s);
  if (msys) s = `${msys[1].toUpperCase()}:\\${msys[3]}`;
  else if (/^\/[a-zA-Z]:/.test(s)) s = s.slice(1);
  s = s.replace(/\//g, "\\");
  if (/^[a-zA-Z]:$/.test(s)) s += "\\";
  if (/^[a-z]:/.test(s)) s = s[0].toUpperCase() + s.slice(1);
  return s.length > 3 ? s.replace(/\\+$/, "") : s;
}

export function parseOsc7(data: string): string | null {
  const m = /^file:\/\/[^/]*(\/.*)$/.exec(data);
  if (!m) return null;
  let path: string;
  try {
    path = decodeURIComponent(m[1]);
  } catch {
    path = m[1];
  }
  return toWindowsPath(path);
}

export function parseOsc9(data: string): string | null {
  if (!data.startsWith("9;")) return null;
  const p = data.slice(2).replace(/^"|"$/g, "");
  return p ? toWindowsPath(p) : null;
}
