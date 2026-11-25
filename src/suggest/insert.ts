/**
 * How a suggestion is written into the shell: backspaces to erase what is replaced and then
 * the new text, with quotes if needed. Everything goes through the tab's WriteQueue.
 */
import type { Suggestion } from "./engine";
import type { Word } from "./line";
import type { Shell } from "./types";

/** What xterm sends for the Backspace key. */
export const DEL = "\x7f";

// Characters that force quoting in a name (those of `cmd /?` and PowerShell's special ones).
const NEEDS_QUOTES: Record<Shell, RegExp> = {
  cmd: /[\s&()[\]{}^=;!'+,`~]/,
  ps: /[\s'"`$&(){};,|<>@#]/,
  // bash, zsh and fish: globs, expansions, redirections and the rest of the special characters.
  sh: /[\s'"`$&(){};|<>*?!#\\[\]]/,
};

function quote(v: string, shell: Shell, q: '"' | "'" | null): string {
  if (shell === "sh") {
    // Single quotes take everything literally (in bash, zsh and fish) except a quote; a name with one
    // goes in double quotes escaping " $ ` \ (valid in the three).
    if (q === '"' || v.includes("'")) return `"${v.replace(/["$`\\]/g, "\\$&")}"`;
    return `'${v}'`;
  }
  // Trailing slash doubled: with a single one, `\"` escapes the quote for git, node and any external program
  // (what reaches them ends up broken); cd, Set-Location and cmdlets accept the double one.
  const body = v.replace(/\\+$/, "\\\\");
  if (shell === "cmd") return `"${body}"`;
  if ((q ?? "'") === "'") return `'${body.replace(/'/g, "''")}'`;
  return `"${body.replace(/[`"$]/g, "`$&")}"`;
}

/** A catalog value that already comes in quotes (`"IMAGENAME eq chrome.exe"`). */
const alreadyQuoted = (v: string) => /^(["']).*\1$/.test(v);

/**
 * `line`: what was typed up to the cursor (the cursor is at the end). `cur`: the current word.
 * A folder ends in `\` (to keep going down); everything else gets a space after it.
 */
export function insertion(line: string, s: Suggestion, cur: Word, shell: Shell): string {
  if (s.replace === "line") return DEL.repeat(line.length) + s.insert;
  if (s.from !== undefined) {
    const quoted = /['"]$/.test(s.insert);
    const suffix = s.dir ? (quoted || /[\\/]$/.test(s.insert) ? "" : shell === "sh" ? "/" : "\\") : " ";
    return DEL.repeat(Math.max(0, line.length - s.from)) + s.insert + suffix;
  }
  const text =
    !alreadyQuoted(s.insert) && (cur.quote || NEEDS_QUOTES[shell].test(s.insert)) ? quote(s.insert, shell, cur.quote) : s.insert;
  return DEL.repeat(cur.raw.length) + text + (s.dir ? "" : " ");
}
