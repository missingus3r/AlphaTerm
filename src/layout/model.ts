/**
 * Modelo de pestañas y paneles. Funciones puras: reciben el estado y devuelven uno nuevo.
 * Cada pestaña tiene un árbol de paneles: hojas (una terminal) y divisiones en dos.
 */

export type SplitDir = "row" | "column"; // row: lado a lado; column: uno arriba del otro

export interface Leaf {
  kind: "leaf";
  id: string;
  profileId: string;
  cwd?: string;
}

export interface Split {
  kind: "split";
  id: string;
  dir: SplitDir;
  ratio: number; // fracción que ocupa `a`
  a: PaneNode;
  b: PaneNode;
}

export type PaneNode = Leaf | Split;

export interface Tab {
  id: string;
  root: PaneNode;
  activePane: string;
  manualTitle?: string;
}

export interface Layout {
  tabs: Tab[];
  activeTab: string;
}

let seq = 0;
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

export function leaf(profileId: string, cwd?: string): Leaf {
  return { kind: "leaf", id: newId("p"), profileId, cwd };
}

export function newTab(profileId: string, cwd?: string): Tab {
  const l = leaf(profileId, cwd);
  return { id: newId("t"), root: l, activePane: l.id };
}

export function leaves(node: PaneNode): Leaf[] {
  return node.kind === "leaf" ? [node] : [...leaves(node.a), ...leaves(node.b)];
}

export function findLeaf(node: PaneNode, id: string): Leaf | undefined {
  return leaves(node).find((l) => l.id === id);
}

export function activeTab(l: Layout): Tab | undefined {
  return l.tabs.find((t) => t.id === l.activeTab);
}

function mapTab(l: Layout, tabId: string, f: (t: Tab) => Tab): Layout {
  return { ...l, tabs: l.tabs.map((t) => (t.id === tabId ? f(t) : t)) };
}

export function addTab(l: Layout, tab: Tab): Layout {
  const i = l.tabs.findIndex((t) => t.id === l.activeTab);
  const tabs = [...l.tabs];
  tabs.splice(i < 0 ? tabs.length : i + 1, 0, tab);
  return { tabs, activeTab: tab.id };
}

/** Cierra una pestaña; queda activa la de la derecha (o la de la izquierda si era la última). */
export function closeTab(l: Layout, tabId: string): Layout {
  const i = l.tabs.findIndex((t) => t.id === tabId);
  if (i < 0) return l;
  const tabs = l.tabs.filter((t) => t.id !== tabId);
  let active = l.activeTab;
  if (active === tabId) active = tabs[Math.min(i, tabs.length - 1)]?.id ?? "";
  return { tabs, activeTab: active };
}

export function selectTab(l: Layout, tabId: string): Layout {
  return l.tabs.some((t) => t.id === tabId) ? { ...l, activeTab: tabId } : l;
}

/** Pestaña siguiente (+1) o anterior (-1), dando la vuelta. */
export function cycleTab(l: Layout, delta: number): Layout {
  const n = l.tabs.length;
  if (n === 0) return l;
  const i = l.tabs.findIndex((t) => t.id === l.activeTab);
  return { ...l, activeTab: l.tabs[(((i + delta) % n) + n) % n].id };
}

export function selectTabIndex(l: Layout, index: number): Layout {
  const t = index < 0 ? l.tabs[l.tabs.length - 1] : l.tabs[index];
  return t ? { ...l, activeTab: t.id } : l;
}

export function moveTab(l: Layout, tabId: string, toIndex: number): Layout {
  const from = l.tabs.findIndex((t) => t.id === tabId);
  if (from < 0) return l;
  const tabs = [...l.tabs];
  const [t] = tabs.splice(from, 1);
  tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, t);
  return { ...l, tabs };
}

export function renameTab(l: Layout, tabId: string, title: string): Layout {
  const clean = title.trim();
  return mapTab(l, tabId, (t) => ({ ...t, manualTitle: clean || undefined }));
}

function replaceNode(node: PaneNode, id: string, f: (n: PaneNode) => PaneNode): PaneNode {
  if (node.id === id) return f(node);
  if (node.kind === "leaf") return node;
  return { ...node, a: replaceNode(node.a, id, f), b: replaceNode(node.b, id, f) };
}

/** Divide el panel `paneId`: el nuevo queda a la derecha (row) o abajo (column) y pasa a estar activo. */
export function splitPane(l: Layout, tabId: string, paneId: string, dir: SplitDir, fresh: Leaf): Layout {
  return mapTab(l, tabId, (t) => {
    if (!findLeaf(t.root, paneId)) return t;
    const root = replaceNode(t.root, paneId, (n) => ({ kind: "split", id: newId("s"), dir, ratio: 0.5, a: n, b: fresh }));
    return { ...t, root, activePane: fresh.id };
  });
}

function removeLeaf(node: PaneNode, id: string): PaneNode | null {
  if (node.kind === "leaf") return node.id === id ? null : node;
  const a = removeLeaf(node.a, id);
  const b = removeLeaf(node.b, id);
  if (!a) return b;
  if (!b) return a;
  return { ...node, a, b };
}

/** Cierra un panel. Si era el último de la pestaña, cierra la pestaña. */
export function closePane(l: Layout, tabId: string, paneId: string): Layout {
  const tab = l.tabs.find((t) => t.id === tabId);
  if (!tab) return l;
  const root = removeLeaf(tab.root, paneId);
  if (!root) return closeTab(l, tabId);
  const order = leaves(tab.root).map((x) => x.id);
  let active = tab.activePane;
  if (active === paneId) {
    const remaining = leaves(root).map((x) => x.id);
    const i = order.indexOf(paneId);
    // El vecino anterior en orden de lectura; si no hay, el primero.
    active = order.slice(0, i).reverse().find((id) => remaining.includes(id)) ?? remaining[0];
  }
  return mapTab(l, tabId, (t) => ({ ...t, root, activePane: active }));
}

export function focusPane(l: Layout, tabId: string, paneId: string): Layout {
  return mapTab(l, tabId, (t) => (findLeaf(t.root, paneId) ? { ...t, activePane: paneId } : t));
}

export function setRatio(l: Layout, tabId: string, splitId: string, ratio: number): Layout {
  const r = Math.min(0.9, Math.max(0.1, ratio));
  return mapTab(l, tabId, (t) => ({
    ...t,
    root: replaceNode(t.root, splitId, (n) => (n.kind === "split" ? { ...n, ratio: r } : n)),
  }));
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Rectángulos relativos (0..1) de cada hoja, para moverse entre paneles con el teclado. */
export function paneRects(node: PaneNode, r: Rect = { x: 0, y: 0, w: 1, h: 1 }): Map<string, Rect> {
  if (node.kind === "leaf") return new Map([[node.id, r]]);
  const out = new Map<string, Rect>();
  const [ra, rb]: [Rect, Rect] =
    node.dir === "row"
      ? [
          { ...r, w: r.w * node.ratio },
          { ...r, x: r.x + r.w * node.ratio, w: r.w * (1 - node.ratio) },
        ]
      : [
          { ...r, h: r.h * node.ratio },
          { ...r, y: r.y + r.h * node.ratio, h: r.h * (1 - node.ratio) },
        ];
  for (const [k, v] of paneRects(node.a, ra)) out.set(k, v);
  for (const [k, v] of paneRects(node.b, rb)) out.set(k, v);
  return out;
}

export type Direction = "left" | "right" | "up" | "down";

/** Panel vecino en una dirección: el más cercano que se superpone en el otro eje. */
export function neighbor(node: PaneNode, fromId: string, dir: Direction): string | undefined {
  const rects = paneRects(node);
  const from = rects.get(fromId);
  if (!from) return undefined;
  const eps = 1e-9;
  let best: { id: string; dist: number; overlap: number } | undefined;
  for (const [id, r] of rects) {
    if (id === fromId) continue;
    let dist: number;
    let overlap: number;
    if (dir === "left" || dir === "right") {
      dist = dir === "right" ? r.x - (from.x + from.w) : from.x - (r.x + r.w);
      overlap = Math.min(from.y + from.h, r.y + r.h) - Math.max(from.y, r.y);
    } else {
      dist = dir === "down" ? r.y - (from.y + from.h) : from.y - (r.y + r.h);
      overlap = Math.min(from.x + from.w, r.x + r.w) - Math.max(from.x, r.x);
    }
    if (dist < -eps || overlap <= eps) continue;
    if (!best || dist < best.dist - eps || (Math.abs(dist - best.dist) <= eps && overlap > best.overlap)) {
      best = { id, dist, overlap };
    }
  }
  return best?.id;
}

export interface SplitArea {
  id: string;
  dir: SplitDir;
  ratio: number;
  rect: Rect;
}

/** Cada división con el rectángulo que ocupa: para dibujar los divisores arrastrables. */
export function splitAreas(node: PaneNode, r: Rect = { x: 0, y: 0, w: 1, h: 1 }): SplitArea[] {
  if (node.kind === "leaf") return [];
  const [ra, rb]: [Rect, Rect] =
    node.dir === "row"
      ? [
          { ...r, w: r.w * node.ratio },
          { ...r, x: r.x + r.w * node.ratio, w: r.w * (1 - node.ratio) },
        ]
      : [
          { ...r, h: r.h * node.ratio },
          { ...r, y: r.y + r.h * node.ratio, h: r.h * (1 - node.ratio) },
        ];
  return [{ id: node.id, dir: node.dir, ratio: node.ratio, rect: r }, ...splitAreas(node.a, ra), ...splitAreas(node.b, rb)];
}
