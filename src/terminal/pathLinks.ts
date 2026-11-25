import type { IDisposable, ILink, Terminal } from "@xterm/xterm";
import { invoke } from "@tauri-apps/api/core";
import { findPaths, mimeOf, previewKind, resolvePath } from "./paths";
import { t } from "../i18n";

interface Stat {
  dir: boolean;
  size: number;
}

// Short existence cache (an agent's output repeats paths many times).
const statCache = new Map<string, { at: number; stat: Stat | null }>();
async function statAll(paths: string[]): Promise<(Stat | null)[]> {
  const now = Date.now();
  const missing = paths.filter((p) => !statCache.has(p) || now - statCache.get(p)!.at > 10_000);
  if (missing.length) {
    const res = await invoke<(Stat | null)[]>("fs_stat", { paths: missing }).catch(() => missing.map(() => null));
    missing.forEach((p, i) => statCache.set(p, { at: now, stat: res[i] ?? null }));
  }
  return paths.map((p) => statCache.get(p)?.stat ?? null);
}

export const openPath = (path: string, dir: boolean) =>
  invoke("fs_open", { path, with: dir ? "explorer" : "default" }).catch((e) => console.warn("No se pudo abrir", path, e));

// --- Floating preview -------------------------------------------------------------------------

let pop: HTMLDivElement | null = null;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let currentUrl: string | null = null;
let token = 0;

function hidePreview() {
  clearTimeout(showTimer);
  token++;
  if (pop) pop.style.display = "none";
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = null;
}

function place(x: number, y: number) {
  if (!pop) return;
  const r = pop.getBoundingClientRect();
  const left = Math.min(x + 14, window.innerWidth - r.width - 8);
  const top = y + 18 + r.height > window.innerHeight ? Math.max(8, y - r.height - 10) : y + 18;
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top = `${top}px`;
}

function showPreview(path: string, stat: Stat, x: number, y: number) {
  clearTimeout(showTimer);
  const my = ++token;
  showTimer = setTimeout(async () => {
    pop ??= Object.assign(document.createElement("div"), { className: "path-preview" });
    if (!pop.isConnected) document.body.appendChild(pop);
    const name = path.split("\\").pop() || path;
    const head = `<div class="pp-head"><b></b><small></small></div>`;
    pop.innerHTML = head;
    pop.querySelector("b")!.textContent = name;
    pop.querySelector("small")!.textContent = stat.dir ? t("carpeta · clic para abrirla") : t("{size} · clic para abrir", { size: fmtSize(stat.size) });
    const body = document.createElement("div");
    body.className = "pp-body";
    pop.appendChild(body);
    pop.style.display = "block";
    place(x, y);
    try {
      if (stat.dir) {
        const entries = await invoke<{ name: string; dir: boolean }[]>("fs_list", { dir: path });
        if (my !== token) return;
        body.className = "pp-body pp-list";
        body.textContent = entries.slice(0, 18).map((e) => (e.dir ? `▸ ${e.name}` : `  ${e.name}`)).join("\n") + (entries.length > 18 ? `\n  ${t("… y {n} más", { n: entries.length - 18 })}` : "") || t("(vacía)");
      } else if (previewKind(path) === "image") {
        const bytes = await invoke<ArrayBuffer>("fs_head", { path, max: 0, wholeIfUnder: true });
        if (my !== token) return;
        currentUrl = URL.createObjectURL(new Blob([bytes], { type: mimeOf(path) }));
        const img = document.createElement("img");
        img.src = currentUrl;
        img.onload = () => place(x, y);
        body.appendChild(img);
      } else if (previewKind(path) === "text") {
        const bytes = await invoke<ArrayBuffer>("fs_head", { path, max: 8192 });
        if (my !== token) return;
        const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        if (/\u0000/.test(text)) body.textContent = t("(archivo binario)");
        else {
          body.className = "pp-body pp-text";
          body.textContent = text.split(/\r?\n/).slice(0, 24).join("\n");
        }
      } else {
        body.textContent = t("Sin vista previa para este tipo de archivo.");
      }
      place(x, y);
    } catch (e) {
      if (my === token) body.textContent = String(e);
    }
  }, 350);
}

const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/** Links to existing paths in the output: click opens (folder in Explorer, file with its program). */
export function registerPathLinks(term: Terminal, getCwd: () => string | undefined): IDisposable {
  const provider = term.registerLinkProvider({
    provideLinks(y, callback) {
      const line = term.buffer.active.getLine(y - 1)?.translateToString(true) ?? "";
      const found = findPaths(line);
      if (!found.length) return callback(undefined);
      const cwd = getCwd();
      const resolved = found.map((m) => resolvePath(m.raw, cwd));
      const valid = resolved.map((r, i) => (r ? i : -1)).filter((i) => i >= 0);
      void statAll(valid.map((i) => resolved[i]!)).then((stats) => {
        const links: ILink[] = [];
        valid.forEach((i, k) => {
          const st = stats[k];
          if (!st) return;
          const m = found[i];
          const path = resolved[i]!;
          links.push({
            range: { start: { x: m.start + 1, y }, end: { x: m.end, y } },
            text: line.slice(m.start, m.end),
            decorations: { underline: true, pointerCursor: true },
            activate: () => {
              hidePreview();
              void openPath(path, st.dir);
            },
            hover: (e) => showPreview(path, st, e.clientX, e.clientY),
            leave: hidePreview,
          });
        });
        callback(links.length ? links : undefined);
      });
    },
  });
  return {
    dispose() {
      provider.dispose();
      hidePreview();
    },
  };
}
