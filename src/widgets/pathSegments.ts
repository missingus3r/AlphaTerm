import { isWindows } from "../platform";

/**
 * Segments of a folder for the footer's location bar, each with the path it opens:
 * `C:\Users\x` → `C:\`, `C:\Users`, `C:\Users\x`; `/home/x` → `/`, `/home`, `/home/x`.
 */
export function pathSegments(cwd: string): { name: string; path: string }[] {
  if (isWindows()) {
    const p = cwd.replace(/[\\/]+$/, "");
    if (!p) return [];
    const segs = p.split(/[\\/]/);
    return segs.map((name, i) => ({ name: name || "\\", path: segs.slice(0, i + 1).join("\\") + (i === 0 ? "\\" : "") }));
  }
  if (!cwd.startsWith("/")) return cwd ? [{ name: cwd, path: cwd }] : [];
  const segs = cwd.split("/").filter(Boolean);
  return [{ name: "/", path: "/" }, ...segs.map((name, i) => ({ name, path: "/" + segs.slice(0, i + 1).join("/") }))];
}
