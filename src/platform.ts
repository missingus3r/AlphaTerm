/**
 * The operating system AlphaTerm runs on, and what changes with it: path separators, absolute paths,
 * the shells. It's known synchronously by the WebView's user agent (WebView2 says "Windows";
 * WebKitGTK, "X11; Linux"), so it can be used in module constants. The backend confirms it in
 * `term_info().os`.
 *
 * Tests run in Node (user agent "Node.js/…"): they count as Windows, like the app was born, unless
 * they call `setOs("linux")`.
 */

export type Os = "windows" | "linux";

function detect(): Os {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  return /Linux|X11/.test(ua) && !/Windows/.test(ua) ? "linux" : "windows";
}

let os: Os = detect();

export const currentOs = (): Os => os;
export const isWindows = (): boolean => os === "windows";

/** Only for tests: pretend to be on the other system. */
export function setOs(o: Os): void {
  os = o;
}

/** The separator the system's paths use. */
export const sep = (): "\\" | "/" => (os === "windows" ? "\\" : "/");

/** Is it an absolute path for this system? (`C:\x`, `\\server\x` on Windows; `/x` on Linux). */
export function isAbsolute(p: string): boolean {
  return os === "windows" ? /^([A-Za-z]:[\\/]|\\\\)/.test(p) : p.startsWith("/");
}

/** Joins a folder and a relative path with the system's separator. */
export function joinPath(dir: string, rel: string): string {
  const s = sep();
  if (os === "linux" && dir === "/") return `/${rel.replace(/^\/+/, "")}`;
  return `${dir.replace(/[\\/]+$/, "")}${s}${rel.replace(/^[\\/]+/, "")}`;
}

/** Last component of a path (with either slash). */
export const baseName = (p: string): string => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;

/** Is `child` inside `dir` (or the same)? Case-insensitive only on Windows. */
export function isInside(child: string, dir: string): boolean {
  const norm = (x: string) => {
    const t = x.replace(/[\\/]+$/, "");
    return os === "windows" ? t.toLowerCase().replace(/\//g, "\\") : t;
  };
  const c = norm(child);
  const d = norm(dir);
  if (c === d) return true;
  if (os === "linux" && d === "") return c.startsWith("/");
  return c.startsWith(d + sep());
}
