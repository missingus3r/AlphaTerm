/** Pure usage logic (no Tauri APIs, so it can be tested). */

export interface UsageWindow {
  label: string;
  usedPct: number;
  resetsAt: number | null;
  /** Reset as the program writes it ("3pm (America/Montevideo)", "09:12 on 25 Nov"). */
  resetsText: string | null;
  stale: boolean;
  /** Only for the detail (per model, extra usage). */
  detail: boolean;
}
export interface Usage {
  provider: string;
  exact: boolean;
  source: string;
  updatedAt: number | null;
  windows: UsageWindow[];
  note: string | null;
  refreshing: boolean;
  plan: string | null;
  model: string | null;
  extras: string[];
  groups: { name: string; models: string | null }[];
  tables: { title: string; rows: [string, number][] }[];
}
export type ProviderId = "claude" | "codex" | "agy";
export const PROVIDER_NAMES: Record<ProviderId, string> = { claude: "Claude", codex: "Codex", agy: "Antigravity" };

/** Which usage provider corresponds to an agent or a command ("claude --continue" → claude). */
export function providerFor(agentId?: string, command?: string, fg?: string): ProviderId | null {
  const pick = (s?: string) => {
    const first = (s ?? "").trim().split(/\s+/)[0] ?? "";
    const base = first.split(/[\\/]/).pop()?.toLowerCase().replace(/\.(exe|cmd)$/, "") ?? "";
    return base === "claude" || base === "codex" || base === "agy" ? (base as ProviderId) : null;
  };
  return pick(agentId) ?? pick(command) ?? pick(fg);
}

/** Windows to show in the footer: the main ones (agy has many: those of the most used group). */
export function headline(u: Usage): UsageWindow[] {
  const main = u.windows.filter((w) => !w.detail);
  if (u.provider !== "agy" || main.length <= 2) return main;
  const groups = new Map<string, UsageWindow[]>();
  for (const w of main) {
    const g = w.label.split(" · ")[0];
    groups.set(g, [...(groups.get(g) ?? []), w]);
  }
  const worst = [...groups.values()].sort((a, b) => Math.max(...b.map((w) => w.usedPct)) - Math.max(...a.map((w) => w.usedPct)))[0];
  return worst ?? main.slice(0, 2);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const monthOf = (s: string) => {
  const k = s.slice(0, 3).toLowerCase();
  const i = MONTHS.indexOf(k);
  return i >= 0 ? i : MONTHS_ES.indexOf(k);
};

/**
 * Reset text → moment (ms), taking as reference when it was read (`at`), in local time.
 * Formatos: "3pm", "1:30pm (America/Montevideo)", "Nov 22, 10pm", "14:30", "09:12 on 25 Nov",
 * "in 2h 5m", "3d 4h".
 */
export function parseResetText(text: string | null | undefined, at: number): number | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim();
  const dur = /^(?:in )?(?:(\d+)\s*d(?:ays?)?)?\s*(?:(\d+)\s*h(?:rs?|ours?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?$/.exec(t);
  if (dur && (dur[1] || dur[2] || dur[3])) return at + ((+(dur[1] ?? 0) * 24 + +(dur[2] ?? 0)) * 60 + +(dur[3] ?? 0)) * 60_000;
  const md = /\b([a-z]{3,9})\.? (\d{1,2})\b/.exec(t) ?? null;
  const dm = /\b(\d{1,2}) ([a-z]{3,9})\b/.exec(t) ?? null;
  let month = -1;
  let day = 0;
  if (md && monthOf(md[1]) >= 0) {
    month = monthOf(md[1]);
    day = +md[2];
  } else if (dm && monthOf(dm[2]) >= 0) {
    month = monthOf(dm[2]);
    day = +dm[1];
  }
  const ampm = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(t);
  const h24 = /\b(\d{1,2}):(\d{2})\b/.exec(t);
  let hh = -1;
  let mm = 0;
  if (ampm) {
    hh = (+ampm[1] % 12) + (ampm[3] === "pm" ? 12 : 0);
    mm = +(ampm[2] ?? 0);
  } else if (h24) {
    hh = +h24[1];
    mm = +h24[2];
  }
  if (month < 0 && hh < 0) return null;
  const d = new Date(at);
  if (month >= 0) {
    d.setMonth(month, day);
    d.setHours(hh >= 0 ? hh : 0, hh >= 0 ? mm : 0, 0, 0);
    if (d.getTime() < at - 86_400_000) d.setFullYear(d.getFullYear() + 1);
  } else {
    d.setHours(hh, mm, 0, 0);
    if (d.getTime() <= at) d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}

/** Reset moment (ms) of a window: the exact one or the one read from the text. */
export function resetOf(w: UsageWindow, updatedAt: number | null): number | null {
  if (w.resetsAt) return w.resetsAt * 1000;
  return parseResetText(w.resetsText, updatedAt ?? Date.now());
}

/** Length of a window according to its label ("5 h", "semana", "Gemini · semana"). */
export function windowMs(label: string): number | null {
  const l = label.split(" · ").pop()!.toLowerCase();
  if (l.startsWith("semana") || label.toLowerCase().startsWith("semana")) return 7 * 86_400_000;
  const h = /^(\d+) h$/.exec(l);
  if (h) return +h[1] * 3_600_000;
  if (l === "día") return 86_400_000;
  return null;
}

export interface Forecast {
  /** Estimated percentage at reset, at the current pace. */
  projected: number;
  /** When it would run out (ms), if it is before the reset. */
  exhaustAt: number | null;
  /** Pace of this window and what is left per day to just make it. */
  ratePerDay: number;
  budgetPerDay: number;
  resetAt: number;
}

/**
 * Weekly forecast (like the dashboard's): with the percentage used and how much of the window has passed,
 * at a steady pace. It only makes sense after a while into the window.
 */
export function forecast(usedPct: number, resetAt: number, lengthMs: number, now = Date.now()): Forecast | null {
  const start = resetAt - lengthMs;
  const elapsed = now - start;
  const left = resetAt - now;
  if (elapsed < lengthMs * 0.04 || left <= 0 || usedPct <= 0) return null;
  const perMs = usedPct / elapsed;
  const projected = usedPct + perMs * left;
  const exhaustAt = projected > 100 ? now + (100 - usedPct) / perMs : null;
  return {
    projected,
    exhaustAt: usedPct >= 100 ? now : exhaustAt,
    ratePerDay: perMs * 86_400_000,
    budgetPerDay: Math.max(0, 100 - usedPct) / (left / 86_400_000),
    resetAt,
  };
}
