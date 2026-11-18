/**
 * Guardar y restaurar el estado de una ventana. Se guarda la carpeta *actual* de cada panel
 * (no la de cuando se abrió) y, en los paneles de agentes, qué agente era.
 */
import type { AgentDef } from "../settings/schema";
import * as M from "./model";

export interface SavedWindow {
  version: 1;
  layout: M.Layout;
  windowTitle?: string;
  panel?: string | null;
}

/** Cómo retomar la última conversación de cada agente de fábrica (si se elige relanzarlos). */
export const RESUME_ARGS: Record<string, string> = { claude: "--continue", codex: "resume --last" };

function mapLeaves(n: M.PaneNode, f: (l: M.Leaf) => M.Leaf): M.PaneNode {
  return n.kind === "leaf" ? f(n) : { ...n, a: mapLeaves(n.a, f), b: mapLeaves(n.b, f) };
}

export function serialize(
  l: M.Layout,
  live: (paneId: string) => { cwd?: string; agentId?: string } | undefined,
  extra: { windowTitle?: string; panel?: string | null } = {},
): SavedWindow {
  const tabs = l.tabs.map((t) => ({
    ...t,
    root: mapLeaves(t.root, (leaf) => {
      const p = live(leaf.id);
      const agentId = p?.agentId ?? leaf.startup?.agentId;
      // Sin el comando ni las variables (pueden traer el PATH entero): solo qué agente era.
      return { kind: "leaf", id: leaf.id, profileId: leaf.profileId, cwd: p?.cwd ?? leaf.cwd, ...(agentId ? { startup: { command: "", agentId } } : {}) };
    }),
  }));
  return { version: 1, layout: { tabs, activeTab: l.activeTab, groups: l.groups ?? [] }, ...extra };
}

/**
 * Arma el layout a partir de lo guardado. Los paneles de agentes se relanzan (con su forma de
 * retomar la conversación) solo si `relaunch`; si no, quedan como shells comunes en esa carpeta.
 */
export function restore(
  saved: unknown,
  opts: { relaunch: boolean; agents: AgentDef[]; profileOk: (id: string) => boolean; fallbackProfile: string; env?: Record<string, string> },
): SavedWindow | null {
  const s = saved as SavedWindow | null;
  if (!s || s.version !== 1 || !Array.isArray(s.layout?.tabs) || s.layout.tabs.length === 0) return null;
  const fix = (leaf: M.Leaf): M.Leaf => {
    const profileId = opts.profileOk(leaf.profileId) ? leaf.profileId : opts.fallbackProfile;
    const agent = leaf.startup?.agentId ? opts.agents.find((a) => a.id === leaf.startup!.agentId) : undefined;
    const startup =
      opts.relaunch && agent
        ? { command: [agent.command, RESUME_ARGS[agent.id]].filter(Boolean).join(" "), env: { ...opts.env, ...agent.env }, agentId: agent.id }
        : undefined;
    return { kind: "leaf", id: leaf.id, profileId, cwd: leaf.cwd, ...(startup ? { startup } : {}) };
  };
  const tabs = s.layout.tabs
    .filter((t) => t && t.root)
    .map((t) => {
      const root = mapLeaves(t.root, fix);
      const ids = M.leaves(root).map((x) => x.id);
      return { ...t, root, activePane: ids.includes(t.activePane) ? t.activePane : ids[0] };
    });
  if (!tabs.length) return null;
  const activeTab = tabs.some((t) => t.id === s.layout.activeTab) ? s.layout.activeTab : tabs[0].id;
  return { ...s, layout: M.pruneGroups({ tabs, activeTab, groups: s.layout.groups ?? [] }) };
}
