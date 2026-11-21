/**
 * Cómo se escribe una sugerencia en la shell: retrocesos para borrar lo que se reemplaza y después
 * el texto nuevo, con comillas si hace falta. Todo va por la WriteQueue de la pestaña.
 */
import type { Suggestion } from "./engine";
import type { Word } from "./line";
import type { Shell } from "./types";

/** Lo que manda xterm con la tecla Retroceso. */
export const DEL = "\x7f";

// Caracteres que obligan a poner comillas en un nombre (los de `cmd /?` y los especiales de PowerShell).
const NEEDS_QUOTES: Record<Shell, RegExp> = {
  cmd: /[\s&()[\]{}^=;!'+,`~]/,
  ps: /[\s'"`$&(){};,|<>@#]/,
};

function quote(v: string, shell: Shell, q: '"' | "'" | null): string {
  if (shell === "cmd") return `"${v}"`;
  if ((q ?? "'") === "'") return `'${v.replace(/'/g, "''")}'`;
  return `"${v.replace(/[`"$]/g, "`$&")}"`;
}

/**
 * `line`: lo escrito hasta el cursor (el cursor está al final). `cur`: la palabra actual.
 * Una carpeta queda terminada en `\` (para seguir bajando); el resto, con un espacio después.
 */
export function insertion(line: string, s: Suggestion, cur: Word, shell: Shell): string {
  if (s.replace === "line") return DEL.repeat(line.length) + s.insert;
  if (s.from !== undefined) {
    const quoted = /['"]$/.test(s.insert);
    const suffix = s.dir ? (quoted || /[\\/]$/.test(s.insert) ? "" : "\\") : " ";
    return DEL.repeat(Math.max(0, line.length - s.from)) + s.insert + suffix;
  }
  const text = cur.quote || NEEDS_QUOTES[shell].test(s.insert) ? quote(s.insert, shell, cur.quote) : s.insert;
  return DEL.repeat(cur.raw.length) + text + (s.dir ? "" : " ");
}
