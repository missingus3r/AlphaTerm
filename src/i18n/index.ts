// Idiomas de la interfaz: español (el del código), inglés y portugués.
//
// El texto en español es la clave: `t("Pestaña nueva")`. Las traducciones viven en
// `src/i18n/en/*.json` y `src/i18n/pt/*.json` (un archivo por área, todos se juntan acá), con el
// texto en español como clave y la traducción como valor. `scripts/i18n-check.mjs` (y su test)
// falla si un texto marcado no tiene traducción, si sobra una o si no coinciden las {variables}.
//
// - En JSX y en código que corre al mostrar algo: `t("…")`. Lee el idioma actual, así que en JSX
//   se actualiza solo cuando se cambia el idioma.
// - En constantes de módulo (listas, etiquetas): `k("…")` al definirlas (solo marca el texto) y
//   `t(valor)` al mostrarlas.
// - Variables con llaves: `t("Cerrar {n} pestañas", { n })`.
import { createSignal } from "solid-js";

export type Lang = "es" | "en" | "pt";

/** Idiomas en su propio nombre (no se traducen: cada uno se reconoce en su idioma). */
export const LANGS: [Lang, string][] = [
  ["es", "Español"],
  ["en", "English"],
  ["pt", "Português"],
];

type Dict = Record<string, string>;

const merge = (mods: Record<string, { default: Dict }>): Dict => Object.assign({}, ...Object.values(mods).map((m) => m.default));

const DICTS: Record<Exclude<Lang, "es">, Dict> = {
  en: merge(import.meta.glob<{ default: Dict }>("./en/*.json", { eager: true })),
  pt: merge(import.meta.glob<{ default: Dict }>("./pt/*.json", { eager: true })),
};

const [lang, setLangSignal] = createSignal<Lang>("es");
export { lang };

export function setLang(l: Lang) {
  setLangSignal(l);
  if (typeof document !== "undefined") document.documentElement.lang = l;
}

export const isLang = (v: unknown): v is Lang => v === "es" || v === "en" || v === "pt";

/** Idioma para una instalación nueva, según el del sistema (inglés si no es español ni portugués). */
export function detectLang(system = typeof navigator !== "undefined" ? navigator.language : ""): Lang {
  const l = system.toLowerCase();
  if (l.startsWith("es")) return "es";
  if (l.startsWith("pt")) return "pt";
  return "en";
}

/** Locale para fechas y números (`toLocaleString`, `Intl.NumberFormat`). */
export const locale = (): string => ({ es: "es-UY", en: "en-US", pt: "pt-BR" })[lang()];

/** Marca un texto para traducir sin traducirlo (constantes de módulo): se traduce al mostrarlo con `t`. */
export const k = <S extends string>(s: S): S => s;

const fill = (s: string, params?: Record<string, string | number>) =>
  params ? s.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m)) : s;

/** Traduce un texto escrito en español al idioma actual (si falta la traducción, queda en español). */
export function t(es: string, params?: Record<string, string | number>): string {
  const l = lang();
  return fill(l === "es" ? es : (DICTS[l][es] ?? es), params);
}

/** Lo mismo que `t` pero para un idioma dado (sin depender del actual). */
export function tIn(l: Lang, es: string, params?: Record<string, string | number>): string {
  return fill(l === "es" ? es : (DICTS[l][es] ?? es), params);
}
