/**
 * The line being typed at the prompt: read from the screen (from where the
 * prompt ended, OSC 133;B mark, to the cursor) and split into words respecting quotes.
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

/** Text between `start` (end of prompt) and `cur` (cursor), or null if it isn't a single logical line. */
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
  /** As written (with quotes). */
  raw: string;
  /** Without quotes. */
  value: string;
  /** Index in the line where `raw` starts. */
  start: number;
  /** Quote it starts with, if it starts with one. */
  quote: '"' | "'" | null;
  /** If it started with a quote, whether it was closed. */
  closed: boolean;
}

export interface Parsed {
  /** Non-empty words (includes the current one if it isn't empty). */
  words: Word[];
  /** The word at the cursor (empty if the line ends in a space). */
  current: Word;
  /** Index of `current` in `words` (or `words.length` if empty). */
  index: number;
}

/** In cmd only `"` is a quote; in PowerShell and the Linux shells `'` too. */
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
