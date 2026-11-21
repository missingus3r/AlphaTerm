/**
 * La línea que se está escribiendo en el prompt: se lee de la pantalla (desde donde terminó el
 * prompt, marca OSC 133;B, hasta el cursor) y se separa en palabras respetando comillas.
 */
import type { Shell } from "./types";

export interface BufLine {
  isWrapped: boolean;
  translateToString(trimRight: boolean, startCol?: number, endCol?: number): string;
}
export interface BufLike {
  getLine(i: number): BufLine | undefined;
}
export interface Pos {
  line: number;
  x: number;
}

/** Texto entre `start` (fin del prompt) y `cur` (cursor), o null si no es una sola línea lógica. */
export function readInput(buf: BufLike, start: Pos, cur: Pos, cols: number): string | null {
  if (cur.line < start.line || (cur.line === start.line && cur.x < start.x)) return null;
  let out = "";
  for (let i = start.line; i <= cur.line; i++) {
    const line = buf.getLine(i);
    if (!line) return null;
    if (i > start.line && !line.isWrapped) return null;
    const s = i === start.line ? start.x : 0;
    const e = i === cur.line ? cur.x : cols;
    out += line.translateToString(false, s, e);
  }
  return out;
}

export interface Word {
  /** Tal como está escrita (con comillas). */
  raw: string;
  /** Sin comillas. */
  value: string;
  /** Índice en la línea donde empieza `raw`. */
  start: number;
  /** Comilla con la que empieza, si empieza con una. */
  quote: '"' | "'" | null;
  /** Si empezaba con comilla, si se cerró. */
  closed: boolean;
}

export interface Parsed {
  /** Palabras no vacías (incluye la actual si no está vacía). */
  words: Word[];
  /** La palabra que toca el cursor (vacía si la línea termina en espacio). */
  current: Word;
  /** Índice de `current` en `words` (o `words.length` si está vacía). */
  index: number;
}

/** En cmd solo `"` es comilla; en PowerShell también `'`. */
export function parseLine(line: string, shell: Shell): Parsed {
  const quotes = shell === "cmd" ? ['"'] : ['"', "'"];
  const words: Word[] = [];
  let w: Word | null = null;
  let open: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (!open && /\s/.test(ch)) {
      if (w) words.push(w);
      w = null;
      continue;
    }
    if (!w) {
      w = { raw: "", value: "", start: i, quote: null, closed: false };
      if (quotes.includes(ch)) w.quote = ch as '"' | "'";
    }
    w.raw += ch;
    if (open) {
      if (ch === open) {
        open = null;
        if (w.quote) w.closed = true;
      } else w.value += ch;
    } else if (quotes.includes(ch)) {
      open = ch;
      if (w.quote && w.raw.length > 1) w.closed = false;
    } else w.value += ch;
  }
  if (w) {
    words.push(w);
    return { words, current: w, index: words.length - 1 };
  }
  return { words, current: { raw: "", value: "", start: line.length, quote: null, closed: false }, index: words.length };
}
