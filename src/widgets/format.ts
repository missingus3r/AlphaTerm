/** Small formats for the widgets (in the interface language: in Spanish, with a decimal comma). */
import { lang, locale, t } from "../i18n";

// One number format per language and number of decimals (created on use: the language changes).
const nfs = new Map<string, Intl.NumberFormat>();
function nf(digits: 0 | 1): Intl.NumberFormat {
  const key = `${locale()}:${digits}`;
  let f = nfs.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale(), { maximumFractionDigits: digits, minimumFractionDigits: digits });
    nfs.set(key, f);
  }
  return f;
}

export function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${nf(1).format(n / 1024 ** 3)} GB`;
  if (n >= 1024 ** 2) return `${nf(0).format(n / 1024 ** 2)} MB`;
  if (n >= 1024) return `${nf(0).format(n / 1024)} KB`;
  return `${n} B`;
}

/** "28 %" in Spanish; "28%" in English and Portuguese. */
export const fmtPct = (p: number) => `${nf(0).format(Math.round(p))}${lang() === "es" ? " %" : "%"}`;

/** "hace 3 min", "hace 2 h", "hace 5 días" (from `ms` to `now`). */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return t("recién");
  const m = Math.round(s / 60);
  if (m < 60) return t("hace {m} min", { m });
  const h = Math.round(m / 60);
  if (h < 48) return t("hace {h} h", { h });
  return t("hace {d} días", { d: Math.round(h / 24) });
}

/**
 * Duration of `m` minutes: "45 min", "2 h 10 min", "3 días" (days rounded) or, with `withHours`,
 * "3 días 4 h" (whole days and the leftover hours).
 */
export function fmtSpan(m: number, withHours = false): string {
  if (m < 60) return t("{m} min", { m });
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? t("{h} h {m} min", { h, m: m % 60 }) : t("{h} h", { h });
  if (!withHours) return t("{d} días", { d: Math.round(h / 24) });
  const d = Math.floor(h / 24);
  return h % 24 ? t("{d} días {h} h", { d, h: h % 24 }) : t("{d} días", { d });
}

/** "en 2 h 10 min", "en 3 días" (until `unixSec`). */
export function until(unixSec: number, now = Date.now()): string {
  const s = Math.round(unixSec - now / 1000);
  if (s <= 0) return t("ya se reinició");
  return t("en {time}", { time: fmtSpan(Math.ceil(s / 60)) });
}

/** Points of a sparkline (values 0–100) for an SVG of `w`×`h`. */
export function sparkPoints(values: number[], w: number, h: number, slots = 60): string {
  if (values.length === 0) return "";
  const step = w / Math.max(1, slots - 1);
  const start = slots - values.length;
  return values
    .map((v, i) => {
      const x = (start + i) * step;
      const y = h - (Math.min(100, Math.max(0, v)) / 100) * (h - 1) - 0.5;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Adds a sample and keeps the last `max`. */
export const pushSample = (list: number[], v: number, max = 60) => [...list, v].slice(-max);

/** Color by usage: calm, warning, critical. */
export const level = (pct: number) => (pct >= 90 ? "crit" : pct >= 70 ? "warn" : "ok");
