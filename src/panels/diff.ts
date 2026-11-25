/** Unified diff → lines with old/new number, and its side-by-side version. */
import { k } from "../i18n";

export type LineKind = "add" | "del" | "ctx" | "hunk" | "meta";

export interface DiffLine {
  kind: LineKind;
  text: string;
  oldNo?: number;
  newNo?: number;
}

export function parseDiff(text: string): DiffLine[] {
  const out: DiffLine[] = [];
  let o = 0;
  let n = 0;
  let inHunk = false;
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) {
      o = Number(h[1]);
      n = Number(h[2]);
      inHunk = true;
      out.push({ kind: "hunk", text: raw });
      continue;
    }
    if (!inHunk || raw.startsWith("diff --git")) {
      inHunk = false;
      if (raw !== "") out.push({ kind: "meta", text: raw });
      continue;
    }
    if (raw.startsWith("+")) out.push({ kind: "add", text: raw.slice(1), newNo: n++ });
    else if (raw.startsWith("-")) out.push({ kind: "del", text: raw.slice(1), oldNo: o++ });
    else if (raw.startsWith("\\")) out.push({ kind: "meta", text: raw });
    else if (raw === "" ) continue;
    else out.push({ kind: "ctx", text: raw.slice(1), oldNo: o++, newNo: n++ });
  }
  return out;
}

export interface SideRow {
  left?: DiffLine;
  right?: DiffLine;
  /** Full-width header row (hunk or meta). */
  full?: DiffLine;
}

/** Pairs deletions with additions within each block of changes, as in a side-by-side diff. */
export function sideBySide(lines: DiffLine[]): SideRow[] {
  const rows: SideRow[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) rows.push({ left: dels[i], right: adds[i] });
    dels = [];
    adds = [];
  };
  for (const l of lines) {
    if (l.kind === "del") dels.push(l);
    else if (l.kind === "add") adds.push(l);
    else {
      flush();
      if (l.kind === "ctx") rows.push({ left: l, right: l });
      else rows.push({ full: l });
    }
  }
  flush();
  return rows;
}

export const countChanges = (lines: DiffLine[]) => ({
  add: lines.filter((l) => l.kind === "add").length,
  del: lines.filter((l) => l.kind === "del").length,
});

/** Status letter → word (translated with `t` when shown). */
export const STATUS_WORD: Record<string, string> = {
  M: k("modificado"),
  A: k("agregado"),
  D: k("borrado"),
  R: k("renombrado"),
  C: k("copiado"),
  U: k("en conflicto"),
  "?": k("sin seguimiento"),
};
