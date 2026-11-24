/**
 * Respuestas de esta ventana a la API de control (la llama el backend por el evento
 * `control-request`). Cada ventana contesta por sus paneles; el resto dice "no es mío".
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as M from "./model";
import type { TermHandle } from "../terminal/TerminalView";
import { t } from "../i18n";

export interface PaneLive {
  cwd?: string;
  running: boolean;
  integrated: boolean;
  lastCommand?: string;
  agentId?: string;
  pid?: number | null;
  ended?: number;
  exitCode?: number | null;
  fgProcess?: string;
}

export interface ControlCtx {
  label: string;
  layout: () => M.Layout;
  pane: (id: string) => PaneLive | undefined;
  handle: (id: string) => TermHandle | undefined;
  titleOf: (t: M.Tab) => string;
  update: (f: (l: M.Layout) => M.Layout) => void;
  defaultProfile: () => string;
  /** Variables para comandos lanzados por la API (PATH completo). */
  env: () => Record<string, string>;
  /** Abre (o reusa) el navegador de una pestaña; devuelve su id cuando está listo. */
  openBrowser: (o: { url?: string; tabId?: string; pane?: string; dir?: M.SplitDir; reuse?: boolean; focus?: boolean }) => Promise<string | undefined>;
}

interface Req {
  id: number;
  method: string;
  params: Record<string, unknown>;
  window: string;
  windows: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function tabOfPane(l: M.Layout, paneId: string) {
  return l.tabs.find((t) => M.findLeaf(t.root, paneId));
}

/** Espera a que el panel exista en el estado (recién creado) y tenga sesión. */
async function waitPane(ctx: ControlCtx, id: string, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (ctx.handle(id) && ctx.pane(id)?.pid) return true;
    await sleep(100);
  }
  return !!ctx.handle(id);
}

async function runIn(ctx: ControlCtx, paneId: string, command: string, wait: boolean, timeoutMs: number) {
  const h = ctx.handle(paneId);
  const p = ctx.pane(paneId);
  if (!h || !p) throw new Error(t("Ese panel no tiene una terminal lista"));
  const before = p.ended ?? 0;
  if (!h.send(command, true)) throw new Error(t("La shell de ese panel no está corriendo"));
  if (!wait) return { sent: true };
  if (!p.integrated) {
    await sleep(Math.min(timeoutMs, 3000));
    return { sent: true, integrated: false, note: t("La shell no tiene integración: no se sabe cuándo terminó. Esto es lo que se ve:"), text: h.text(60) };
  }
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await sleep(120);
    const now = ctx.pane(paneId);
    if ((now?.ended ?? 0) > before) {
      const out = h.lastOutput();
      return { exitCode: out?.exitCode ?? now?.exitCode ?? null, output: out?.output ?? "", command: out?.command ?? command };
    }
  }
  return { timeout: true, note: t("Sigue corriendo después de {ms} ms. Esto es lo que se ve:", { ms: timeoutMs }), text: h.text(80) };
}

/** ¿Esta ventana tiene que contestar? (pedidos sin panel: la ventana pedida o la principal). */
function mineForNew(req: Req, label: string) {
  const want = str(req.params.window);
  if (want) return want === label;
  return label === (req.windows.includes("main") ? "main" : req.windows[0]);
}

export async function handleControl(req: Req, ctx: ControlCtx): Promise<unknown> {
  const p = req.params;
  const paneId = str(p.pane);
  const l = ctx.layout();
  const notMine = { notMine: true };

  switch (req.method) {
    case "list":
      return {
        result: {
          window: ctx.label,
          activeTab: l.activeTab,
          tabs: l.tabs.map((t) => ({
            tab: t.id,
            title: ctx.titleOf(t),
            group: t.groupId ? l.groups?.find((g) => g.id === t.groupId)?.name : undefined,
            activePane: t.activePane,
            panes: M.leaves(t.root).map((leaf) => {
              const s = ctx.pane(leaf.id);
              if (leaf.browser) return { pane: leaf.id, browser: leaf.browser.url, owner: leaf.browser.owner };
              return {
                pane: leaf.id,
                cwd: s?.cwd,
                running: s?.running ?? false,
                lastCommand: s?.lastCommand,
                foreground: s?.fgProcess,
                agent: s?.agentId,
                shellPid: s?.pid,
                integrated: s?.integrated ?? false,
              };
            }),
          })),
        },
      };
    case "open_tab": {
      if (!mineForNew(req, ctx.label)) return notMine;
      const command = str(p.command);
      const tab = M.newTab(ctx.defaultProfile(), str(p.cwd), command ? { command, env: ctx.env() } : undefined);
      ctx.update((x) => (p.background ? { ...M.addTab(x, tab), activeTab: x.activeTab } : M.addTab(x, tab)));
      await waitPane(ctx, tab.activePane);
      return { result: { window: ctx.label, tab: tab.id, pane: tab.activePane } };
    }
  }

  if (req.method === "browser_open") {
    // Al lado del panel pedido, o del que llama (el agente); si no, en la pestaña activa.
    const at = str(p.pane) ?? str(p.caller);
    const tb = at ? tabOfPane(l, at) : undefined;
    if (at && !tb) return notMine;
    if (!at && !mineForNew(req, ctx.label)) return notMine;
    const url = str(p.url);
    if (!url) return { error: t("Falta 'url'") };
    const id = await ctx.openBrowser({ url, tabId: tb?.id, pane: at, dir: p.direction === "down" ? "column" : "row", reuse: !p.new, focus: true });
    if (!id) return { error: t("No se pudo abrir el navegador") };
    return { result: { window: ctx.label, tab: tb?.id ?? l.activeTab, browser: id, url } };
  }

  // Lo demás es sobre un panel: contesta la ventana que lo tiene.
  if (!paneId) return { error: t("Falta 'pane' (usá list para ver los ids)") };
  const tab = tabOfPane(l, paneId);
  if (!tab) return notMine;
  const h = ctx.handle(paneId);

  switch (req.method) {
    case "read": {
      const n = typeof p.lines === "number" ? p.lines : 200;
      return { result: { pane: paneId, text: h?.text(n) ?? "" } };
    }
    case "last_output":
      return { result: h?.lastOutput() ?? null };
    case "run": {
      const command = str(p.command);
      if (!command) return { error: t("Falta 'command'") };
      const timeout = typeof p.timeout_ms === "number" ? p.timeout_ms : 120_000;
      return { result: await runIn(ctx, paneId, command, p.wait !== false, timeout) };
    }
    case "send": {
      const text = typeof p.text === "string" ? p.text : "";
      return { result: { sent: h?.send(text, !!p.enter) ?? false } };
    }
    case "split": {
      const leaf = M.findLeaf(tab.root, paneId)!;
      const command = str(p.command);
      const fresh = M.leaf(leaf.profileId, str(p.cwd) ?? ctx.pane(paneId)?.cwd ?? leaf.cwd, command ? { command, env: ctx.env() } : undefined);
      ctx.update((x) => M.splitPane(x, tab.id, paneId, p.direction === "down" ? "column" : "row", fresh));
      await waitPane(ctx, fresh.id);
      return { result: { window: ctx.label, tab: tab.id, pane: fresh.id } };
    }
    case "close":
      ctx.update((x) => M.closePane(x, tab.id, paneId));
      return { result: { closed: true } };
    case "focus":
      ctx.update((x) => M.focusPane(M.selectTab(x, tab.id), tab.id, paneId));
      void getCurrentWindow().setFocus().catch(() => {});
      return { result: { focused: true } };
  }
  return { error: t("Método no soportado por la ventana: {method}", { method: req.method }) };
}
