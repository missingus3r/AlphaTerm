/** Formatos chicos para los widgets (en castellano rioplatense, con coma decimal). */

const nf1 = new Intl.NumberFormat("es-UY", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat("es-UY", { maximumFractionDigits: 0 });

export function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${nf1.format(n / 1024 ** 3)} GB`;
  if (n >= 1024 ** 2) return `${nf0.format(n / 1024 ** 2)} MB`;
  if (n >= 1024) return `${nf0.format(n / 1024)} KB`;
  return `${n} B`;
}

export const fmtPct = (p: number) => `${nf0.format(Math.round(p))} %`;

/** "hace 3 min", "hace 2 h", "hace 5 días" (desde `ms` hasta `now`). */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "recién";
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

/** "en 2 h 10 min", "en 3 días" (hasta `unixSec`). */
export function until(unixSec: number, now = Date.now()): string {
  const s = Math.round(unixSec - now / 1000);
  if (s <= 0) return "ya se reinició";
  const m = Math.ceil(s / 60);
  if (m < 60) return `en ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `en ${h} h ${m % 60} min` : `en ${h} h`;
  return `en ${Math.round(h / 24)} días`;
}

/** Puntos de una sparkline (valores 0–100) para un SVG de `w`×`h`. */
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

/** Agrega una muestra y se queda con las últimas `max`. */
export const pushSample = (list: number[], v: number, max = 60) => [...list, v].slice(-max);

/** Color según el uso: tranquilo, atención, crítico. */
export const level = (pct: number) => (pct >= 90 ? "crit" : pct >= 70 ? "warn" : "ok");
