/** Lógica pura del consumo (sin APIs de Tauri, para poder testearla). */

export interface UsageWindow {
  label: string;
  usedPct: number;
  resetsAt: number | null;
  stale: boolean;
}
export interface Usage {
  provider: string;
  exact: boolean;
  source: string;
  updatedAt: number | null;
  windows: UsageWindow[];
  note: string | null;
}
export type ProviderId = "claude" | "codex" | "agy";


/** Qué proveedor de consumo corresponde a un agente o a un comando ("claude --continue" → claude). */
export function providerFor(agentId?: string, command?: string, fg?: string): ProviderId | null {
  const pick = (s?: string) => {
    const first = (s ?? "").trim().split(/\s+/)[0] ?? "";
    const base = first.split(/[\\/]/).pop()?.toLowerCase().replace(/\.(exe|cmd)$/, "") ?? "";
    return base === "claude" || base === "codex" || base === "agy" ? (base as ProviderId) : null;
  };
  return pick(agentId) ?? pick(command) ?? pick(fg);
}

/** Ventanas a mostrar en el footer (agy tiene muchas: se muestran las del grupo más usado). */
export function headline(u: Usage): UsageWindow[] {
  if (u.provider !== "agy" || u.windows.length <= 2) return u.windows;
  const groups = new Map<string, UsageWindow[]>();
  for (const w of u.windows) {
    const g = w.label.split(" · ")[0];
    groups.set(g, [...(groups.get(g) ?? []), w]);
  }
  const worst = [...groups.values()].sort((a, b) => Math.max(...b.map((w) => w.usedPct)) - Math.max(...a.map((w) => w.usedPct)))[0];
  return worst ?? u.windows.slice(0, 2);
}

