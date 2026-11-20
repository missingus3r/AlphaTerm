/** Changelog: viene de src/generated/changelog.json (lo genera scripts/changelog.mjs al compilar). */
import data from "../generated/changelog.json";

export interface ChangeCommit {
  hash: string;
  short: string;
  date: string;
  subject: string;
  body: string;
}

export interface ChangeVersion {
  /** null = commits que todavía no son de ninguna versión (compilación de desarrollo). */
  version: string | null;
  date: string | null;
  released: boolean;
  commits: ChangeCommit[];
}

export const CHANGELOG: ChangeVersion[] = (data as { versions: ChangeVersion[] }).versions;

/** "0.10.2" > "0.9.9": compara números, no texto. */
export function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/**
 * Versiones entre `from` (exclusiva: lo que cambió *después* de ella) y `to` (inclusiva), de la más
 * nueva a la más vieja. Sin `from`, desde el principio; sin `to`, hasta lo último (incluye lo no
 * publicado). Así "de 0.1.0 a 0.3.0" es lo que trae 0.3.0 respecto de 0.1.0.
 */
export function between(list: ChangeVersion[], from?: string, to?: string): ChangeVersion[] {
  return list.filter((v) => {
    if (v.version === null) return !to;
    if (from && cmpVersion(v.version, from) <= 0) return false;
    if (to && cmpVersion(v.version, to) > 0) return false;
    return true;
  });
}

export const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
