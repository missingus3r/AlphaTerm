/**
 * Servidores: lo que devuelve el backend y las "recetas" para volver a iniciarlos.
 * Una receta se guarda sola cuando un servidor nace en una pestaña de AlphaTerm (se conoce el
 * comando por la integración de la shell y la carpeta); también se pueden escribir a mano.
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

/** Lo que el panel sabe de la pestaña donde corre (por PID de la shell). */
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

/** Receta candidata para un servidor que nació en una pestaña con integración. */
export function candidate(s: Server, pane: PaneRef | undefined): Omit<Recipe, "id"> | null {
  if (!pane || !pane.running || !pane.lastCommand || !pane.cwd) return null;
  const name = pane.lastCommand.length > 40 ? `${pane.lastCommand.slice(0, 39)}…` : pane.lastCommand;
  return { name, command: pane.lastCommand, cwd: pane.cwd, env: {}, ports: s.ports, auto: true, lastSeen: Date.now() };
}

/** Agrega o actualiza (puertos, última vez visto). Las automáticas se limitan a las 20 más recientes. */
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

/** Receta que corresponde a un servidor corriendo (misma carpeta y algún puerto en común). */
export function recipeFor(s: Server, list: Recipe[]): Recipe | undefined {
  return list.find((r) => normDir(r.cwd) === normDir(s.cwd) && r.ports.some((p) => s.ports.includes(p)));
}

/** Receta "corriendo": hay un servidor en alguno de sus puertos. */
export const isRunning = (r: Recipe, servers: Server[]) => servers.some((s) => r.ports.some((p) => s.ports.includes(p)));

export function fmtUptime(sec: number): string {
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return t("{n} días", { n: Math.floor(h / 24) });
}

/** URL para abrir en el navegador (los que escuchan solo en IPv6 usan [::1]). */
export function urlFor(s: Server, port: number): string {
  const v6only = s.addrs.length > 0 && s.addrs.every((a) => a.startsWith("["));
  return `http://${v6only ? "[::1]" : "localhost"}:${port}`;
}
