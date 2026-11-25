/**
 * Real sources of the suggestions (the engine receives `Sources` so it can be tested without a backend):
 * folders, history, PATH and the catalog generators (hosts, branches, npm scripts…).
 */
import { invoke } from "@tauri-apps/api/core";
import { k } from "../i18n";
import type { GenName, Value } from "./catalog";
import type { HistEntry, Sources } from "./engine";

const HISTORY_TTL = 3000;
const SLOW_MS = 1500;

/** Whatever takes longer than `ms` (Docker off, git hung) doesn't hold up the menu. */
const quick = <T>(p: Promise<T>, fallback: T, ms = SLOW_MS) =>
  Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

let histCache: { at: number; items: Promise<HistEntry[]> } | null = null;
function history(): Promise<HistEntry[]> {
  if (histCache && Date.now() - histCache.at < HISTORY_TTL) return histCache.items;
  const items = invoke<HistEntry[]>("history_search", { query: "", limit: 2000 }).catch(() => []);
  histCache = { at: Date.now(), items };
  return items;
}

let pathCache: Promise<string[]> | null = null;
let pathAt = 0;
function pathCommands(): Promise<string[]> {
  if (!pathCache || Date.now() - pathAt > 60_000) {
    pathAt = Date.now();
    pathCache = invoke<string[]>("suggest_path_commands").catch(() => []);
  }
  return pathCache;
}

interface Branch {
  name: string;
  current: boolean;
  remote: boolean;
}

async function branches(cwd: string): Promise<Branch[]> {
  const root = await invoke<string | null>("git_root", { dir: cwd }).catch(() => null);
  if (!root) return [];
  return invoke<Branch[]>("git_branches", { root }).catch(() => []);
}

async function hosts(): Promise<Value[]> {
  const gw = await quick(invoke<string | null>("suggest_gateway"), null);
  return [
    { v: "8.8.8.8", desc: k("DNS de Google") },
    { v: "1.1.1.1", desc: k("DNS de Cloudflare") },
    ...(gw ? [{ v: gw, desc: k("tu router") }] : []),
    { v: "localhost", desc: k("esta PC") },
    { v: "127.0.0.1", desc: k("esta PC") },
    { v: "google.com", desc: k("para probar Internet") },
  ];
}

async function gen(name: GenName, cwd: string): Promise<Value[]> {
  switch (name) {
    case "hosts":
      return hosts();
    case "gitBranches": {
      const b = await quick(branches(cwd), []);
      return [
        ...b.filter((x) => !x.remote).map((x) => ({ v: x.name, desc: x.current ? k("rama actual") : k("rama") })),
        ...b.filter((x) => x.remote && !x.name.endsWith("/HEAD")).map((x) => ({ v: x.name, desc: k("rama remota") })),
      ];
    }
    case "gitRemotes": {
      const b = await quick(branches(cwd), []);
      const remotes = [...new Set(b.filter((x) => x.remote).map((x) => x.name.split("/")[0]))];
      return remotes.map((r) => ({ v: r, desc: k("remoto") }));
    }
    case "npmScripts": {
      const s = await quick(invoke<[string, string][]>("suggest_npm_scripts", { cwd }), []);
      return s.map(([k, cmd]) => ({ v: k, desc: cmd }));
    }
    case "dockerContainers": {
      const c = await quick(invoke<{ name: string; image: string; state: string }[]>("docker_containers"), []);
      return c.map((x) => ({ v: x.name, desc: `${x.image} · ${x.state}` }));
    }
    case "dockerImages": {
      const i = await quick(invoke<{ repo: string; tag: string; size: string }[]>("docker_images"), []);
      return i.filter((x) => x.repo !== "<none>").map((x) => ({ v: x.tag && x.tag !== "<none>" ? `${x.repo}:${x.tag}` : x.repo, desc: x.size }));
    }
    case "processes": {
      const p = await quick(invoke<string[]>("suggest_processes"), []);
      return p.map((v) => ({ v }));
    }
    default:
      return [];
  }
}

// Each generator launches processes (git, docker) or walks all processes: the request in flight is reused
// and kept for a few seconds, otherwise one would be launched per key (and with Docker hung they'd pile up).
const GEN_TTL = 4000;
const genCache = new Map<string, { at: number; values: Promise<Value[]> }>();
function cachedGen(name: GenName, cwd: string): Promise<Value[]> {
  const key = `${name}|${cwd.toLowerCase()}`;
  const hit = genCache.get(key);
  if (hit && Date.now() - hit.at < GEN_TTL) return hit.values;
  const values = gen(name, cwd).catch(() => []);
  genCache.set(key, { at: Date.now(), values });
  return values;
}

/** `cwd` is read on every request (the folder changes with each `cd`). */
export function liveSources(cwd: () => string): Sources {
  return {
    listDir: (dir, dirsOnly, hidden) =>
      invoke<{ name: string; dir: boolean }[]>("suggest_list_dir", { cwd: cwd(), dir, dirsOnly, hidden }).catch(() => []),
    history,
    pathCommands,
    gen: (name, c) => cachedGen(name, c || cwd()),
  };
}
