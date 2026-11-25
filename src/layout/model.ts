/**
 * Tab and pane model. Pure functions: they take the state and return a new one.
 * Each tab has a tree of panes: leaves (a terminal) and two-way splits.
 */
import { t } from "../i18n";

export type SplitDir = "row" | "column"; // row: side by side; column: one above the other

/** Something to run as soon as the shell is ready (for example, an agent). */
export interface Startup {
  command: string;
  env?: Record<string, string>;
  agentId?: string;
}

/** Browser pane (instead of a terminal). */
export interface BrowserSpec {
  url: string;
  /** Terminal pane that requests go to (the project's agent). */
  owner?: string;
}

export interface Leaf {
  kind: "leaf";
  id: string;
  profileId: string;
  cwd?: string;
  startup?: Startup;
  /** If present, the pane is a built-in browser. */
  browser?: BrowserSpec;
}

export interface Split {
  kind: "split";
  id: string;
  dir: SplitDir;
  ratio: number; // fraction that `a` occupies
  a: PaneNode;
  b: PaneNode;
}

export type PaneNode = Leaf | Split;

export interface Tab {
  id: string;
  root: PaneNode;
  activePane: string;
  manualTitle?: string;
  /** Title color (hex). */
  color?: string;
  /** Tab group it belongs to. */
  groupId?: string;
}

/** Tab group: groups several tabs under a name and can be collapsed. */
export interface Group {
  id: string;
  name: string;
  color?: string;
  collapsed: boolean;
}

export interface Layout {
  tabs: Tab[];
  activeTab: string;
  groups?: Group[];
}

let seq = 0;
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

export function leaf(profileId: string, cwd?: string, startup?: Startup): Leaf {
  return { kind: "leaf", id: newId("p"), profileId, cwd, ...(startup ? { startup } : {}) };
}

/** Browser leaf (no shell). */
export function browserLeaf(url: string, owner?: string): Leaf {
  return { kind: "leaf", id: newId("b"), profileId: "", browser: { url, ...(owner ? { owner } : {}) } };
}

export const isBrowser = (l: Leaf | undefined) => !!l?.browser;

/** Updates the URL (or owner) of a browser pane: what is saved in the session. */
export function setBrowser(l: Layout, paneId: string, patch: Partial<BrowserSpec>): Layout {
  const fix = (n: PaneNode): PaneNode =>
    n.kind === "leaf" ? (n.id === paneId && n.browser ? { ...n, browser: { ...n.browser, ...patch } } : n) : { ...n, a: fix(n.a), b: fix(n.b) };
  let changed = false;
  const tabs = l.tabs.map((t) => {
    if (!findLeaf(t.root, paneId)?.browser) return t;
    changed = true;
    return { ...t, root: fix(t.root) };
  });
  return changed ? { ...l, tabs } : l;
}

/** First browser pane of a tab. */
export function browserOf(t: Tab): Leaf | undefined {
  return leaves(t.root).find((x) => x.browser);
}

export function newTab(profileId: string, cwd?: string, startup?: Startup): Tab {
  const l = leaf(profileId, cwd, startup);
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
  // A new tab ends up in the same folder as the active one.
  const group = l.tabs[i]?.groupId;
  tabs.splice(i < 0 ? tabs.length : i + 1, 0, group && !tab.groupId ? { ...tab, groupId: group } : tab);
  return { ...l, tabs, activeTab: tab.id };
}

/** Closes a tab; the one to the right becomes active (or the one to the left if it was the last). */
export function closeTab(l: Layout, tabId: string): Layout {
  const i = l.tabs.findIndex((t) => t.id === tabId);
  if (i < 0) return l;
  const tabs = l.tabs.filter((t) => t.id !== tabId);
  let active = l.activeTab;
  if (active === tabId) active = tabs[Math.min(i, tabs.length - 1)]?.id ?? "";
  return pruneGroups({ ...l, tabs, activeTab: active });
}

// --- Tab colors and folders ------------------------------------------------------------------------

export function setTabColor(l: Layout, tabId: string, color: string | undefined): Layout {
  return mapTab(l, tabId, (t) => ({ ...t, color }));
}

/** Removes the folders that were left empty. */
export function pruneGroups(l: Layout): Layout {
  if (!l.groups?.length) return l;
  const used = new Set(l.tabs.map((t) => t.groupId).filter(Boolean));
  const groups = l.groups.filter((g) => used.has(g.id));
  return groups.length === l.groups.length ? l : { ...l, groups };
}

/** The tabs of a folder stay together (in the first one's place). */
function compact(l: Layout): Layout {
  const out: Tab[] = [];
  const placed = new Set<string>();
  for (const t of l.tabs) {
    if (!t.groupId) {
      out.push(t);
      continue;
    }
    if (placed.has(t.groupId)) continue;
    placed.add(t.groupId);
    out.push(...l.tabs.filter((x) => x.groupId === t.groupId));
  }
  return { ...l, tabs: out };
}

/** Creates a folder with these tabs. */
export function createGroup(l: Layout, name: string, tabIds: string[], color?: string): Layout {
  const g: Group = { id: newId("g"), name: name.trim() || t("Carpeta"), color, collapsed: false };
  const tabs = l.tabs.map((t) => (tabIds.includes(t.id) ? { ...t, groupId: g.id } : t));
  return pruneGroups(compact({ ...l, tabs, groups: [...(l.groups ?? []), g] }));
}

/** Moves a tab into a folder (or takes it out with `null`). */
export function moveToGroup(l: Layout, tabId: string, groupId: string | null): Layout {
  if (groupId && !l.groups?.some((g) => g.id === groupId)) return l;
  const tab = l.tabs.find((t) => t.id === tabId);
  if (!tab) return l;
  let tabs = l.tabs.filter((t) => t.id !== tabId);
  const moved = { ...tab, groupId: groupId ?? undefined };
  if (groupId) {
    const last = tabs.map((t) => t.groupId).lastIndexOf(groupId);
    tabs.splice(last + 1, 0, moved);
  } else {
    // Outside the folder: right after it.
    const last = tabs.map((t) => t.groupId).lastIndexOf(tab.groupId);
    tabs.splice(last < 0 ? l.tabs.findIndex((t) => t.id === tabId) : last + 1, 0, moved);
  }
  tabs = tabs.filter(Boolean);
  return pruneGroups(compact({ ...l, tabs }));
}

export function updateGroup(l: Layout, groupId: string, patch: Partial<Omit<Group, "id">>): Layout {
  return { ...l, groups: (l.groups ?? []).map((g) => (g.id === groupId ? { ...g, ...patch } : g)) };
}

/** Dissolves the folder: the tabs are left loose, in the same place. */
export function ungroup(l: Layout, groupId: string): Layout {
  return {
    ...l,
    tabs: l.tabs.map((t) => (t.groupId === groupId ? { ...t, groupId: undefined } : t)),
    groups: (l.groups ?? []).filter((g) => g.id !== groupId),
  };
}

export function selectTab(l: Layout, tabId: string): Layout {
  return l.tabs.some((t) => t.id === tabId) ? { ...l, activeTab: tabId } : l;
}

/** Next (+1) or previous (-1) tab, wrapping around. */
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

/** Splits pane `paneId`: the new one goes to the right (row) or below (column) and becomes active. */
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

/** Closes a pane. If it was the tab's last one, closes the tab. */
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
    // The previous neighbor in reading order; if there is none, the first.
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

/** Where a pane dragged onto another is dropped: one side, or the center to swap them. */
export type DropZone = "left" | "right" | "top" | "bottom" | "center";

/** Swaps two panes (the splits and their proportions stay the same). */
export function swapPanes(l: Layout, tabId: string, aId: string, bId: string): Layout {
  const tab = l.tabs.find((t) => t.id === tabId);
  if (!tab || aId === bId) return l;
  const a = findLeaf(tab.root, aId);
  const b = findLeaf(tab.root, bId);
  if (!a || !b) return l;
  const swap = (n: PaneNode): PaneNode =>
    n.kind === "leaf" ? (n.id === aId ? b : n.id === bId ? a : n) : { ...n, a: swap(n.a), b: swap(n.b) };
  return mapTab(l, tabId, (t) => ({ ...t, root: swap(t.root), activePane: aId }));
}

/**
 * Moves a pane next to another (it ends up half and half) or, in the center, swaps them.
 * The moved pane is the same leaf: its terminal isn't recreated.
 */
export function movePane(l: Layout, tabId: string, paneId: string, targetId: string, zone: DropZone): Layout {
  if (zone === "center") return swapPanes(l, tabId, paneId, targetId);
  const tab = l.tabs.find((t) => t.id === tabId);
  if (!tab || paneId === targetId) return l;
  const moved = findLeaf(tab.root, paneId);
  if (!moved || !findLeaf(tab.root, targetId)) return l;
  const rest = removeLeaf(tab.root, paneId);
  if (!rest) return l;
  const dir: SplitDir = zone === "left" || zone === "right" ? "row" : "column";
  const first = zone === "left" || zone === "top";
  const root = replaceNode(rest, targetId, (n) => ({ kind: "split", id: newId("s"), dir, ratio: 0.5, a: first ? moved : n, b: first ? n : moved }));
  return mapTab(l, tabId, (t) => ({ ...t, root, activePane: paneId }));
}

/** How many panes there are along an axis (side-by-side ones add up; those stacked on the other axis don't). */
function span(n: PaneNode, dir: SplitDir): number {
  if (n.kind === "leaf") return 1;
  return n.dir === dir ? span(n.a, dir) + span(n.b, dir) : Math.max(span(n.a, dir), span(n.b, dir));
}

/** Equalizes sizes: on each axis, all panes end up the same width (or height). */
export function equalize(l: Layout, tabId: string): Layout {
  const fix = (n: PaneNode): PaneNode => {
    if (n.kind === "leaf") return n;
    const a = span(n.a, n.dir);
    const ratio = Math.min(0.9, Math.max(0.1, a / (a + span(n.b, n.dir))));
    return { ...n, ratio, a: fix(n.a), b: fix(n.b) };
  };
  return mapTab(l, tabId, (t) => ({ ...t, root: fix(t.root) }));
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Relative rectangles (0..1) of each leaf, for moving between panes with the keyboard. */
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

/** The pane whose rectangle contains the point (in the same units as the rectangles). */
export function paneAt(rects: Map<string, Rect>, fx: number, fy: number): string | undefined {
  for (const [id, r] of rects) if (fx >= r.x && fx < r.x + r.w && fy >= r.y && fy < r.y + r.h) return id;
  return undefined;
}

/** Zone of a pane under the pointer: the center (to swap) or the nearest edge. */
export function dropZone(r: Rect, fx: number, fy: number): DropZone {
  const u = (fx - r.x) / r.w;
  const v = (fy - r.y) / r.h;
  if (Math.abs(u - 0.5) <= 0.2 && Math.abs(v - 0.5) <= 0.2) return "center";
  const edges: [DropZone, number][] = [
    ["left", u],
    ["right", 1 - u],
    ["top", v],
    ["bottom", 1 - v],
  ];
  return edges.reduce((best, e) => (e[1] < best[1] ? e : best))[0];
}

/** What is drawn while dragging: the half where the pane will end up, or the whole pane (swap). */
export function zoneRect(r: Rect, zone: DropZone): Rect {
  switch (zone) {
    case "left":
      return { ...r, w: r.w / 2 };
    case "right":
      return { ...r, x: r.x + r.w / 2, w: r.w / 2 };
    case "top":
      return { ...r, h: r.h / 2 };
    case "bottom":
      return { ...r, y: r.y + r.h / 2, h: r.h / 2 };
    default:
      return r;
  }
}

export const SNAP_POINTS = [1 / 3, 1 / 2, 2 / 3];

/** The divider snaps at ⅓, ½ or ⅔ if released within a few pixels (`extentPx`: length of the split). */
export function snapRatio(ratio: number, extentPx: number, thresholdPx = 12): number {
  const near = SNAP_POINTS.reduce((best, s) => (Math.abs(s - ratio) < Math.abs(best - ratio) ? s : best));
  return Math.abs(near - ratio) * extentPx <= thresholdPx ? near : ratio;
}

export type Direction = "left" | "right" | "up" | "down";

/** Neighbor pane in a direction: the nearest one that overlaps on the other axis. */
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

/** Each split with the rectangle it occupies: to draw the draggable dividers. */
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
