/**
 * Fuentes reales de las predicciones (el motor recibe `Sources` para poder probarlo sin backend):
 * carpetas, historial, PATH y los generadores del catálogo (hosts, ramas, scripts de npm…).
 */
import { invoke } from "@tauri-apps/api/core";
import type { GenName, Value } from "./catalog";
import type { HistEntry, Sources } from "./engine";

const HISTORY_TTL = 3000;
const SLOW_MS = 1500;

/** Lo que tarde más que `ms` (Docker apagado, git colgado) no frena el menú. */
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
    { v: "8.8.8.8", desc: "DNS de Google" },
    { v: "1.1.1.1", desc: "DNS de Cloudflare" },
    ...(gw ? [{ v: gw, desc: "tu router" }] : []),
    { v: "localhost", desc: "esta PC" },
    { v: "127.0.0.1", desc: "esta PC" },
    { v: "google.com", desc: "para probar Internet" },
  ];
}

async function gen(name: GenName, cwd: string): Promise<Value[]> {
  switch (name) {
    case "hosts":
      return hosts();
    case "gitBranches": {
      const b = await quick(branches(cwd), []);
      return [
        ...b.filter((x) => !x.remote).map((x) => ({ v: x.name, desc: x.current ? "rama actual" : "rama" })),
        ...b.filter((x) => x.remote && !x.name.endsWith("/HEAD")).map((x) => ({ v: x.name, desc: "rama remota" })),
      ];
    }
    case "gitRemotes": {
      const b = await quick(branches(cwd), []);
      const remotes = [...new Set(b.filter((x) => x.remote).map((x) => x.name.split("/")[0]))];
      return remotes.map((r) => ({ v: r, desc: "remoto" }));
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

/** `cwd` se lee en cada pedido (la carpeta cambia con cada `cd`). */
export function liveSources(cwd: () => string): Sources {
  return {
    listDir: (dir, dirsOnly, hidden) =>
      invoke<{ name: string; dir: boolean }[]>("suggest_list_dir", { cwd: cwd(), dir, dirsOnly, hidden }).catch(() => []),
    history,
    pathCommands,
    gen: (name, c) => gen(name, c || cwd()),
  };
}
