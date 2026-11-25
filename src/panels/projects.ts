/** Project list: what the backend discovered + what was added by hand + recent folders. */

export interface Found {
  path: string;
  sources: string[];
  lastUsed: number;
  exists: boolean;
  git: boolean;
}

export interface Project extends Found {
  hidden: boolean;
}

const key = (p: string) => p.replace(/[\\/]+$/, "").toLowerCase();

export function mergeProjects(found: Found[], manual: string[], recent: string[], hidden: string[]): Project[] {
  const by = new Map<string, Project>();
  const add = (path: string, src: string, f?: Found) => {
    const k = key(path);
    if (!k) return;
    const cur = by.get(k);
    if (cur) {
      if (!cur.sources.includes(src)) cur.sources.push(src);
      if (f) Object.assign(cur, { lastUsed: Math.max(cur.lastUsed, f.lastUsed), exists: f.exists, git: f.git });
      return;
    }
    by.set(k, {
      path: path.replace(/[\\/]+$/, ""),
      sources: f ? [...f.sources] : [src],
      lastUsed: f?.lastUsed ?? 0,
      exists: f?.exists ?? true,
      git: f?.git ?? false,
      hidden: false,
    });
  };
  found.forEach((f) => add(f.path, f.sources[0] ?? "?", f));
  manual.forEach((m) => add(m, "manual"));
  recent.forEach((r) => add(r, "reciente"));
  const hide = new Set(hidden.map(key));
  const list = [...by.values()].map((p) => ({ ...p, hidden: hide.has(key(p.path)) }));
  // Hand-pinned ones first; then by use.
  return list.sort((a, b) => Number(b.sources.includes("manual")) - Number(a.sources.includes("manual")) || b.lastUsed - a.lastUsed);
}

export const projectName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
