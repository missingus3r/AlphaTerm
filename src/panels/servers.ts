/**
 * Servers: what the backend returns and the "recipes" to start them again.
 * A recipe is saved on its own when a server starts in an AlphaTerm tab (the
 * command is known through shell integration, and the folder); they can also be written by hand.
 */
import type { Recipe } from "../settings/schema";
import { t } from "../i18n";

export interface Server {
  pid: number;
  name: string;
  ports: number[];
  addrs: string[];
  cmdline: string;
  cwd: string | null;
  uptime: number;
  shellPid: number | null;
  system: boolean;
}

/** What the panel knows about the tab where it runs (by shell PID). */
export interface PaneRef {
  tabId: string;
  paneId: string;
  title: string;
  cwd?: string;
  lastCommand?: string;
  running: boolean;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const normDir = (d?: string | null) => (d ?? "").replace(/[\\/]+$/, "").toLowerCase();

export const sameRecipe = (a: Pick<Recipe, "command" | "cwd">, b: Pick<Recipe, "command" | "cwd">) =>
  norm(a.command) === norm(b.command) && normDir(a.cwd) === normDir(b.cwd);

/** Candidate recipe for a server that started in a tab with integration. */
export function candidate(s: Server, pane: PaneRef | undefined): Omit<Recipe, "id"> | null {
  if (!pane || !pane.running || !pane.lastCommand || !pane.cwd) return null;
  const name = pane.lastCommand.length > 40 ? `${pane.lastCommand.slice(0, 39)}…` : pane.lastCommand;
  return { name, command: pane.lastCommand, cwd: pane.cwd, env: {}, ports: s.ports, auto: true, lastSeen: Date.now() };
}

/** Adds or updates (ports, last seen). Automatic ones are limited to the 20 most recent. */
export function mergeRecipe(list: Recipe[], c: Omit<Recipe, "id">, newId: () => string): Recipe[] {
  const i = list.findIndex((r) => sameRecipe(r, c));
  if (i >= 0) {
    const r = list[i];
    const ports = [...new Set([...c.ports, ...r.ports])].sort((a, b) => a - b).slice(0, 8);
    if (ports.join() === r.ports.join() && (r.lastSeen ?? 0) > c.lastSeen! - 3_600_000) return list;
    const out = [...list];
    out[i] = { ...r, ports, lastSeen: c.lastSeen };
    return out;
  }
  const out = [...list, { ...c, id: newId() }];
  const autos = out.filter((r) => r.auto).sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
  const drop = new Set(autos.slice(20).map((r) => r.id));
  return out.filter((r) => !drop.has(r.id));
}

/** Recipe that matches a running server (same folder and some port in common). */
export function recipeFor(s: Server, list: Recipe[]): Recipe | undefined {
  return list.find((r) => normDir(r.cwd) === normDir(s.cwd) && r.ports.some((p) => s.ports.includes(p)));
}

/** "Running" recipe: there is a server on one of its ports. */
export const isRunning = (r: Recipe, servers: Server[]) => servers.some((s) => r.ports.some((p) => s.ports.includes(p)));

export function fmtUptime(sec: number): string {
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return t("{n} días", { n: Math.floor(h / 24) });
}

/** URL to open in the browser (those that listen only on IPv6 use [::1]). */
export function urlFor(s: Server, port: number): string {
  const v6only = s.addrs.length > 0 && s.addrs.every((a) => a.startsWith("["));
  return `http://${v6only ? "[::1]" : "localhost"}:${port}`;
}
