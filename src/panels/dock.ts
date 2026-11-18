/**
 * Paneles laterales en mosaico ("tiles"): columnas a la derecha de la terminal; cada columna
 * apila paneles. Abrir uno lo pone debajo (si la última columna tiene lugar) o en una columna
 * nueva al costado. Se puede cambiar el ancho de cada columna, el alto de cada panel y moverlos.
 */
export type DockPanelId = "agents" | "servers" | "projects" | "git" | "history" | "docker";

export interface DockPanel {
  id: DockPanelId;
  /** Proporción del alto dentro de la columna. */
  size: number;
}

export interface DockCol {
  id: string;
  width: number;
  panels: DockPanel[];
}

export interface Dock {
  cols: DockCol[];
}

export const MAX_PER_COL = 2;
export const MIN_W = 240;
export const MAX_W = 900;
export const DEFAULT_W = 330;

let seq = 0;
const colId = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

export const isOpen = (d: Dock, p: DockPanelId) => d.cols.some((c) => c.panels.some((x) => x.id === p));
export const openIds = (d: Dock) => d.cols.flatMap((c) => c.panels.map((p) => p.id));

/** Abre un panel: debajo, en la última columna con lugar; si no hay, en una columna nueva. */
export function openPanel(d: Dock, p: DockPanelId): Dock {
  if (isOpen(d, p)) return d;
  const last = d.cols[d.cols.length - 1];
  if (last && last.panels.length < MAX_PER_COL) {
    return { cols: d.cols.map((c) => (c === last ? { ...c, panels: [...c.panels, { id: p, size: 1 }] } : c)) };
  }
  return { cols: [...d.cols, { id: colId(), width: DEFAULT_W, panels: [{ id: p, size: 1 }] }] };
}

export function closePanel(d: Dock, p: DockPanelId): Dock {
  return { cols: d.cols.map((c) => ({ ...c, panels: c.panels.filter((x) => x.id !== p) })).filter((c) => c.panels.length > 0) };
}

export const togglePanel = (d: Dock, p: DockPanelId) => (isOpen(d, p) ? closePanel(d, p) : openPanel(d, p));

export function setColWidth(d: Dock, id: string, width: number): Dock {
  const w = Math.round(Math.min(MAX_W, Math.max(MIN_W, width)));
  return { cols: d.cols.map((c) => (c.id === id ? { ...c, width: w } : c)) };
}

/** Mueve el borde entre el panel `i` y el `i+1` de una columna (fracción del alto de la columna). */
export function resizeSplit(d: Dock, id: string, i: number, frac: number): Dock {
  return {
    cols: d.cols.map((c) => {
      if (c.id !== id || i < 0 || i >= c.panels.length - 1) return c;
      const total = c.panels.reduce((s, p) => s + p.size, 0);
      const pair = c.panels[i].size + c.panels[i + 1].size;
      const before = c.panels.slice(0, i).reduce((s, p) => s + p.size, 0);
      // `frac` es la posición del borde (0..1) dentro de la columna.
      let a = frac * total - before;
      a = Math.min(pair - 0.15 * total, Math.max(0.15 * total, a));
      const panels = c.panels.map((p, k) => (k === i ? { ...p, size: a } : k === i + 1 ? { ...p, size: pair - a } : p));
      return { ...c, panels };
    }),
  };
}

export type DropTarget = { kind: "panel"; target: DockPanelId; after: boolean } | { kind: "newCol"; index: number };

/** Mueve un panel: junto a otro (arriba o abajo) o a una columna nueva en la posición dada. */
export function movePanel(d: Dock, p: DockPanelId, to: DropTarget): Dock {
  if (!isOpen(d, p) || (to.kind === "panel" && to.target === p)) return d;
  const moving = d.cols.flatMap((c) => c.panels).find((x) => x.id === p)!;
  const width = d.cols.find((c) => c.panels.some((x) => x.id === p))!.width;
  let cols = d.cols.map((c) => ({ ...c, panels: c.panels.filter((x) => x.id !== p) }));
  if (to.kind === "panel") {
    cols = cols.map((c) => {
      const i = c.panels.findIndex((x) => x.id === to.target);
      if (i < 0) return c;
      const panels = [...c.panels];
      panels.splice(to.after ? i + 1 : i, 0, { ...moving, size: 1 });
      return { ...c, panels: panels.map((x) => ({ ...x, size: 1 })) };
    });
  } else {
    const fresh = { id: colId(), width, panels: [{ ...moving, size: 1 }] };
    const kept = cols.filter((c) => c.panels.length > 0);
    // El índice se calcula sobre las columnas originales: se ajusta si la columna de origen desaparece.
    const removedBefore = d.cols.slice(0, to.index).filter((c, k) => c.panels.length === 1 && c.panels[0].id === p && cols[k].panels.length === 0).length;
    const idx = Math.max(0, Math.min(kept.length, to.index - removedBefore));
    kept.splice(idx, 0, fresh);
    return { cols: kept };
  }
  return { cols: cols.filter((c) => c.panels.length > 0) };
}

/** Acepta lo guardado (sesión o preferencia) y lo deja válido. */
export function normalizeDock(v: unknown): Dock {
  const ids: DockPanelId[] = ["agents", "servers", "projects", "git", "history", "docker"];
  const seen = new Set<string>();
  const cols: DockCol[] = [];
  const raw = (v as { cols?: unknown })?.cols;
  if (!Array.isArray(raw)) return { cols: [] };
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const panels = (Array.isArray(c.panels) ? c.panels : [])
      .filter((p: { id?: string }) => p && ids.includes(p.id as DockPanelId) && !seen.has(p.id!) && seen.add(p.id!))
      .map((p: { id: DockPanelId; size?: number }) => ({ id: p.id, size: typeof p.size === "number" && p.size > 0 ? p.size : 1 }));
    if (!panels.length) continue;
    const width = typeof c.width === "number" ? Math.min(MAX_W, Math.max(MIN_W, c.width)) : DEFAULT_W;
    cols.push({ id: typeof c.id === "string" ? c.id : colId(), width, panels });
  }
  return { cols };
}
