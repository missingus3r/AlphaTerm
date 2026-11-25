/**
 * Save and restore a window's state. The pane's *current* folder is saved
 * (not the one from when it was opened) and, for agent panes, which agent it was.
 */
import type { AgentDef } from "../settings/schema";
import * as M from "./model";
import { buildCommand, shellKindOf } from "../panels/agentLaunch";

export interface SavedWindow {
  version: 1;
  layout: M.Layout;
  windowTitle?: string;
  /** Old sessions: a single side panel. */
  panel?: string | null;
  /** Tiled panels (see panels/dock.ts). */
  dock?: unknown;
}

/** How to resume each built-in agent's last conversation (if relaunching them is chosen). */
export const RESUME_ARGS: Record<string, string> = { claude: "--continue", codex: "resume --last" };

function mapLeaves(n: M.PaneNode, f: (l: M.Leaf) => M.Leaf): M.PaneNode {
  return n.kind === "leaf" ? f(n) : { ...n, a: mapLeaves(n.a, f), b: mapLeaves(n.b, f) };
}

export function serialize(
  l: M.Layout,
  live: (paneId: string) => { cwd?: string; agentId?: string } | undefined,
  extra: { windowTitle?: string; panel?: string | null; dock?: unknown } = {},
): SavedWindow {
  const tabs = l.tabs.map((t) => ({
    ...t,
    root: mapLeaves(t.root, (leaf) => {
      if (leaf.browser) return { kind: "leaf", id: leaf.id, profileId: "", browser: { ...leaf.browser } };
      const p = live(leaf.id);
      const agentId = p?.agentId ?? leaf.startup?.agentId;
      // Without the command or the variables (they may carry the entire PATH): only which agent it was.
      return { kind: "leaf", id: leaf.id, profileId: leaf.profileId, cwd: p?.cwd ?? leaf.cwd, ...(agentId ? { startup: { command: "", agentId } } : {}) };
    }),
  }));
  return { version: 1, layout: { tabs, activeTab: l.activeTab, groups: l.groups ?? [] }, ...extra };
}

/**
 * Builds the layout from what was saved. Agent panes are relaunched (with their way of
 * resuming the conversation) only if `relaunch`; otherwise they stay as plain shells in that folder.
 */
export function restore(
  saved: unknown,
  opts: { relaunch: boolean; agents: AgentDef[]; profileOk: (id: string) => boolean; fallbackProfile: string; env?: Record<string, string> },
): SavedWindow | null {
  const s = saved as SavedWindow | null;
  if (!s || s.version !== 1 || !Array.isArray(s.layout?.tabs) || s.layout.tabs.length === 0) return null;
  const fix = (leaf: M.Leaf): M.Leaf => {
    if (leaf.browser && typeof leaf.browser.url === "string") return { kind: "leaf", id: leaf.id, profileId: "", browser: { url: leaf.browser.url, ...(leaf.browser.owner ? { owner: leaf.browser.owner } : {}) } };
    const profileId = opts.profileOk(leaf.profileId) ? leaf.profileId : opts.fallbackProfile;
    const agent = leaf.startup?.agentId ? opts.agents.find((a) => a.id === leaf.startup!.agentId) : undefined;
    // Explicit commands (a window opened through the API with a command) are run anyway.
    if (leaf.startup?.command && !leaf.startup.agentId) {
      return { kind: "leaf", id: leaf.id, profileId, cwd: leaf.cwd, startup: { command: leaf.startup.command, env: opts.env } };
    }
    const startup =
      opts.relaunch && agent
        ? {
            command: buildCommand(agent, shellKindOf(profileId), [], { resuming: true, resumeArgs: RESUME_ARGS[agent.id] }),
            env: { ...opts.env, ...agent.env },
            agentId: agent.id,
          }
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
