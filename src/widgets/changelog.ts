/** Changelog: viene de src/generated/changelog.json (lo genera scripts/changelog.mjs al compilar). */
import data from "../generated/changelog.json";
import { lang, locale, type Lang } from "../i18n";

/** Un commit traducido (src/i18n/changelog/<idioma>.json): solo lo que está traducido. */
export interface CommitText {
  subject?: string;
  body?: string;
}

export interface ChangeCommit {
  hash: string;
  short: string;
  date: string;
  subject: string;
  body: string;
  /** Traducciones por idioma (las junta scripts/changelog.mjs); lo que falta se muestra en español. */
  tr?: Partial<Record<Exclude<Lang, "es">, CommitText>>;
}

export interface ChangeVersion {
  /** null = commits que todavía no son de ninguna versión (compilación de desarrollo). */
  version: string | null;
  date: string | null;
  released: boolean;
  commits: ChangeCommit[];
}

export const CHANGELOG: ChangeVersion[] = (data as { versions: ChangeVersion[] }).versions;

/** Asunto y cuerpo de un commit en un idioma (por defecto el actual); lo que no esté traducido, en español. */
export function commitText(c: ChangeCommit, l: Lang = lang()): { subject: string; body: string } {
  const tr = l === "es" ? undefined : c.tr?.[l];
  return { subject: tr?.subject ?? c.subject, body: c.body ? (tr?.body ?? c.body) : "" };
}

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

/** Fecha corta en el formato del idioma de la interfaz. */
export const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(locale(), { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
