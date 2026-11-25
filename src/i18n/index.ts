// Interface languages: Spanish (the code's own), English and Portuguese.
//
// The Spanish text is the key: `t("Pestaña nueva")`. Translations live in
// `src/i18n/en/*.json` and `src/i18n/pt/*.json` (one file per area, all merged here), with the
// Spanish text as key and the translation as value. `scripts/i18n-check.mjs` (and its test)
// fails if a marked text has no translation, if one is left over or if the {variables} don't match.
//
// - In JSX and in code that runs when something is shown: `t("…")`. It reads the current language, so in JSX
//   it updates by itself when the language changes.
// - In module constants (lists, labels): `k("…")` when defining them (it only marks the text) and
//   `t(value)` when showing them.
// - Variables in braces: `t("Cerrar {n} pestañas", { n })`.
import { createSignal } from "solid-js";

export type Lang = "es" | "en" | "pt";

/** Languages in their own name (not translated: each one is recognized in its own language). */
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

/** Language for a new install, based on the system's (English if it's neither Spanish nor Portuguese). */
export function detectLang(system = typeof navigator !== "undefined" ? navigator.language : ""): Lang {
  const l = system.toLowerCase();
  if (l.startsWith("es")) return "es";
  if (l.startsWith("pt")) return "pt";
  return "en";
}

/** Locale for dates and numbers (`toLocaleString`, `Intl.NumberFormat`). */
export const locale = (): string => ({ es: "es-UY", en: "en-US", pt: "pt-BR" })[lang()];

/** Marks a text for translation without translating it (module constants): it's translated when shown with `t`. */
export const k = <S extends string>(s: S): S => s;

const fill = (s: string, params?: Record<string, string | number>) =>
  params ? s.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m)) : s;

/** Translates a text written in Spanish into the current language (if the translation is missing, it stays in Spanish). */
export function t(es: string, params?: Record<string, string | number>): string {
  const l = lang();
  return fill(l === "es" ? es : (DICTS[l][es] ?? es), params);
}

/** Same as `t` but for a given language (without depending on the current one). */
export function tIn(l: Lang, es: string, params?: Record<string, string | number>): string {
  return fill(l === "es" ? es : (DICTS[l][es] ?? es), params);
}
