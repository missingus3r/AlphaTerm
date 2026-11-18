import { createEffect, createMemo, createResource, createSignal, For, lazy, on, onCleanup, onMount, Show, Suspense, untrack } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { createStore, produce } from "solid-js/store";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as M from "./model";
import { buildKeymap, matchShortcut, shortcutHelp, type Action } from "./shortcuts";
import { TabBar, type TabItem, type TabStatus } from "./TabBar";
import { tabTitle, type PaneInfo } from "./title";
import { TerminalView, type TermHandle, type TermPatch } from "../terminal/TerminalView";
import { foreground, gitBranch, newWindow, type TermInfo } from "../terminal/pty";
import type { TermLook } from "../settings/apply";
import { openSettings, type SettingsStore } from "../settings/store";
import type { AgentDef } from "../settings/schema";
import { agentRunning, agentState, pushRecent } from "../panels/agentState";
import type { RunningAgent } from "../panels/AgentsPanel";
import { ActivityBar, PANELS, type PanelId } from "../panels/ActivityBar";
import { SysWidget, type TabProcs } from "../widgets/SysWidget";
import { UsageFooter } from "../widgets/UsageFooter";
import { candidate, mergeRecipe, type PaneRef, type Server } from "../panels/servers";
import type { Recipe } from "../settings/schema";

const AgentsPanel = lazy(() => import("../panels/AgentsPanel"));
const ServersPanel = lazy(() => import("../panels/ServersPanel"));
const ProjectsPanel = lazy(() => import("../panels/ProjectsPanel"));
const GitPanel = lazy(() => import("../panels/GitPanel"));
const PANEL_WIDTH_PREF = "novaterm.panel.width";
const PANEL_PREF = "novaterm.panel";

/** Estado vivo de cada panel (clave: id del panel). */
interface PaneState extends PaneInfo {
  sessionId?: number;
  pid?: number | null;
  renderer?: string;
  exited?: boolean;
  agentId?: string;
  agentStarted?: boolean;
  active?: boolean;
  bell?: boolean;
}

const pct = (n: number) => `${(n * 100).toFixed(4)}%`;

export function Workspace(props: { info: TermInfo; store: SettingsStore; look: TermLook }) {
  const settings = props.store.settings;
  const profileName = (id: string) => props.info.profiles.find((p) => p.id === id)?.name ?? id;
  // Shell por defecto: la de la configuración si está instalada; si no, la que detectó el backend.
  const defaultProfile = () => {
    const id = settings().terminal.defaultProfile;
    return props.info.profiles.some((p) => p.id === id && p.available) ? id : props.info.defaultProfile;
  };
  const [newTabProfile, setNewTabProfile] = createSignal(defaultProfile());
  createEffect(on(defaultProfile, (id) => setNewTabProfile(id), { defer: true }));
  const vertical = () => settings().tabBar.position === "left";
  const toggleBar = () => props.store.update((d) => void (d.tabBar.position = vertical() ? "top" : "left"));
  const keymap = createMemo(() => buildKeymap(settings().shortcuts));
  const match = (e: KeyboardEvent) => matchShortcut(e, keymap());
  const [layout, setLayout] = createSignal<M.Layout>((() => {
    const t = M.newTab(defaultProfile());
    return { tabs: [t], activeTab: t.id };
  })());
  const [panes, setPanes] = createStore<Record<string, PaneState>>({});
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const handles = new Map<string, TermHandle>();
  const update = (f: (l: M.Layout) => M.Layout) => setLayout(f(layout()));

  const tabById = (id: string) => layout().tabs.find((t) => t.id === id);
  const active = () => M.activeTab(layout());
  const activePaneId = () => active()?.activePane;

  const ensurePane = (leaf: M.Leaf) => {
    if (!panes[leaf.id]) {
      setPanes(leaf.id, {
        shellName: profileName(leaf.profileId),
        integrated: false,
        running: false,
        cwd: leaf.cwd,
        agentId: leaf.startup?.agentId,
      });
    }
  };
  createEffect(() => layout().tabs.forEach((t) => M.leaves(t.root).forEach(ensurePane)));

  // Limpia el estado de paneles que ya no existen.
  createEffect(() => {
    const alive = new Set(layout().tabs.flatMap((t) => M.leaves(t.root).map((l) => l.id)));
    for (const id of Object.keys(panes)) {
      if (!alive.has(id)) {
        handles.delete(id);
        setPanes(produce((s) => delete s[id]));
      }
    }
  });

  // Sin pestañas, la ventana se cierra (como Windows Terminal).
  createEffect(() => {
    if (layout().tabs.length === 0) void getCurrentWindow().close();
  });

  const titleOf = (t: M.Tab) => tabTitle(t.manualTitle, panes[t.activePane], profileName(M.leaves(t.root)[0]?.profileId ?? ""));

  // Un agente "arrancó" cuando su comando empezó a correr (por integración o por proceso).
  createEffect(() => {
    for (const [id, p] of Object.entries(panes)) {
      if (p.agentId && !p.agentStarted && agentRunning(p)) setPanes(id, "agentStarted", true);
    }
  });

  const statusOf = (t: M.Tab): TabStatus => {
    const ps = M.leaves(t.root).map((l) => panes[l.id]).filter(Boolean);
    const agents = ps.filter((p) => p.agentId).map(agentState);
    if (agents.includes("attention")) return "attention";
    if (agents.includes("working")) return "running";
    if (agents.includes("waiting")) return "waiting";
    if (ps.some((p) => p.running || (!p.integrated && p.fgProcess))) return "running";
    if (ps.some((p) => p.exited)) return "exited";
    if (ps.some((p) => p.exitCode !== undefined && p.exitCode !== null && p.exitCode !== 0)) return "error";
    return "idle";
  };

  const tabItems = createMemo<TabItem[]>(() =>
    layout().tabs.map((t) => {
      const p = panes[t.activePane];
      const tip = [
        titleOf(t),
        p?.cwd ? `Carpeta: ${p.cwd}` : "",
        p ? `${p.shellName}${p.pid ? ` · PID ${p.pid}` : ""}${p.renderer ? ` · ${p.renderer === "webgl" ? "WebGL" : "DOM"}` : ""}` : "",
        p?.lastCommand ? `Último comando: ${p.lastCommand}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const changes = p?.cwd ? gitCounts()[p.cwd] : undefined;
      return { id: t.id, title: titleOf(t), status: statusOf(t), tooltip: tip, panes: M.leaves(t.root).length, changes: changes ?? undefined };
    }),
  );

  // Título de la ventana = título de la pestaña activa.
  createEffect(() => {
    const t = active();
    const title = t ? `${titleOf(t)} — NovaTerm` : "NovaTerm";
    document.title = title;
    void getCurrentWindow().setTitle(title).catch(() => {});
  });

  // Rama git: se busca cuando cambia la carpeta o termina un comando (puede haber cambiado de rama).
  const branchKey = (id: string) => `${panes[id]?.cwd ?? ""}|${panes[id]?.running ? 1 : 0}`;
  const lastBranchKey = new Map<string, string>();
  createEffect(() => {
    for (const id of Object.keys(panes)) {
      const key = branchKey(id);
      const cwd = panes[id]?.cwd;
      if (!cwd || lastBranchKey.get(id) === key || panes[id]?.running) continue;
      lastBranchKey.set(id, key);
      void gitBranch(cwd).then((b) => panes[id] && setPanes(id, "branch", b ?? undefined)).catch(() => {});
    }
  });

  // Proceso en primer plano de todas las sesiones (una sola foto de procesos por consulta).
  createEffect(() => {
    const ms = settings().behavior.foregroundPollMs;
    const poll = async () => {
      if (document.hidden) return;
      const byId = new Map<number, string>();
      for (const [paneId, p] of Object.entries(panes)) if (p.sessionId) byId.set(p.sessionId, paneId);
      if (byId.size === 0) return;
      try {
        const fg = await foreground([...byId.keys()]);
        for (const [sid, paneId] of byId) {
          const f = fg[String(sid)];
          const name = f?.name;
          if (panes[paneId] && panes[paneId].fgProcess !== name) {
            setPanes(paneId, "fgProcess", name);
            // Sin integración, el título del programa se va con el programa.
            if (!name && !panes[paneId].integrated) setPanes(paneId, "agentTitle", undefined);
          }
        }
      } catch {
        /* la próxima vuelta reintenta */
      }
    };
    const timer = setInterval(poll, ms);
    onCleanup(() => clearInterval(timer));
  });

  // --- Acciones -------------------------------------------------------------------------------
  const activeLeaf = () => {
    const t = active();
    return t ? M.findLeaf(t.root, t.activePane) : undefined;
  };

  const doSplit = (dir: M.SplitDir | "auto") => {
    const t = active();
    const l = activeLeaf();
    if (!t || !l) return;
    let d: M.SplitDir = dir === "auto" ? "row" : dir;
    if (dir === "auto") {
      const r = M.paneRects(t.root).get(l.id);
      const el = document.querySelector(".tab-view.visible");
      const w = (r?.w ?? 1) * (el?.clientWidth ?? 1);
      const h = (r?.h ?? 1) * (el?.clientHeight ?? 1);
      d = w >= h * 1.6 ? "row" : "column"; // en una terminal el ancho "vale" menos que el alto
    }
    // El panel nuevo hereda perfil y carpeta del actual.
    update((x) => M.splitPane(x, t.id, l.id, d, M.leaf(l.profileId, panes[l.id]?.cwd ?? l.cwd)));
  };

  const closePane = (tabId: string, paneId: string) => update((x) => M.closePane(x, tabId, paneId));

  // --- Paneles laterales y agentes -------------------------------------------------------------
  const readPanel = (): PanelId | null => {
    try {
      const v = localStorage.getItem(PANEL_PREF);
      return PANELS.some((p) => p.id === v) ? (v as PanelId) : null;
    } catch {
      return null;
    }
  };
  const [panel, setPanelRaw] = createSignal<PanelId | null>(readPanel());
  const setPanel = (p: PanelId | null) => {
    setPanelRaw(p);
    try {
      if (p) localStorage.setItem(PANEL_PREF, p);
      else localStorage.removeItem(PANEL_PREF);
    } catch {
      /* no importa */
    }
  };
  const togglePanel = (p: PanelId) => setPanel(panel() === p ? null : p);
  /** Repositorio que muestra el panel de git (null = el de la carpeta del panel activo). */
  const [gitRoot, setGitRoot] = createSignal<string | null>(null);

  // Ancho del panel lateral (se arrastra el borde izquierdo).
  const readWidth = () => {
    try {
      const v = Number(localStorage.getItem(PANEL_WIDTH_PREF));
      return v >= 240 && v <= 1200 ? v : 340;
    } catch {
      return 340;
    }
  };
  const [panelWidth, setPanelWidth] = createSignal(readWidth());
  const startPanelDrag = (e: PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth();
    document.body.classList.add("resizing", "resizing-row");
    const move = (ev: PointerEvent) => setPanelWidth(Math.min(Math.max(240, startW + (startX - ev.clientX)), Math.max(260, window.innerWidth - 300)));
    const up = () => {
      document.body.classList.remove("resizing", "resizing-row");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try {
        localStorage.setItem(PANEL_WIDTH_PREF, String(panelWidth()));
      } catch {
        /* no importa */
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Contador de cambios git por pestaña (carpeta del panel activo de cada una). Cada 10 s con la
  // ventana visible y cuando termina un comando.
  const [gitCounts, setGitCounts] = createSignal<Record<string, number | null>>({});
  const tabCwds = createMemo(() => [...new Set(layout().tabs.map((t) => panes[t.activePane]?.cwd).filter((c): c is string => !!c))].join("\n"));
  const refreshCounts = async () => {
    const cwds = tabCwds().split("\n").filter(Boolean);
    const out: Record<string, number | null> = {};
    await Promise.all(cwds.map(async (c) => (out[c] = await invoke<number | null>("git_count", { dir: c }).catch(() => null))));
    setGitCounts(out);
  };
  createEffect(
    on([tabCwds, () => Object.values(panes).filter((p) => p.running).length], () => {
      void refreshCounts();
    }),
  );
  onMount(() => {
    const t = setInterval(() => !document.hidden && void refreshCounts(), 10_000);
    onCleanup(() => clearInterval(t));
  });
  const activeCwd = () => {
    const id = activePaneId();
    return id ? panes[id]?.cwd : undefined;
  };

  // PATH completo (proceso + registro + carpetas de agentes): un agente instalado después de
  // abrir NovaTerm igual se encuentra.
  const [pathEnv] = createResource(() => invoke<string>("agents_path_env").catch(() => ""));

  // --- Servidores ------------------------------------------------------------------------------
  // Se consultan cada 3 s con el panel abierto; con el panel cerrado, cada 10 s y solo si alguna
  // pestaña está corriendo algo (para guardar la receta de lo que nazca ahí).
  const [servers, setServers] = createSignal<Server[]>([]);
  const [serversLoading, setServersLoading] = createSignal(false);
  const [serversError, setServersError] = createSignal<string | null>(null);
  const paneByShell = createMemo(() => {
    const m = new Map<number, PaneRef>();
    for (const t of layout().tabs)
      for (const l of M.leaves(t.root)) {
        const p = panes[l.id];
        if (p?.pid) m.set(p.pid, { tabId: t.id, paneId: l.id, title: titleOf(t), cwd: p.cwd, lastCommand: p.lastCommand, running: p.running });
      }
    return m;
  });
  const paneOf = (pid: number | null) => (pid === null ? undefined : paneByShell().get(pid));
  const refreshServers = async () => {
    if (serversLoading()) return;
    setServersLoading(true);
    try {
      const list = await invoke<Server[]>("ports_list");
      setServers(list);
      setServersError(null);
      // Recetas: lo que nació en una pestaña con un comando conocido.
      let recipes = settings().recipes;
      for (const s of list) {
        const c = candidate(s, paneOf(s.shellPid));
        if (c) recipes = mergeRecipe(recipes, c, () => M.newId("r"));
      }
      if (recipes !== settings().recipes) props.store.update((d) => void (d.recipes = recipes));
    } catch (e) {
      setServersError(String(e));
    } finally {
      setServersLoading(false);
    }
  };
  const anyRunning = () => Object.values(panes).some((p) => p.running || (!p.integrated && p.fgProcess));
  createEffect(() => {
    const ms = panel() === "servers" ? 3000 : anyRunning() ? 10_000 : 0;
    if (!ms) return;
    if (panel() === "servers") untrack(() => void refreshServers());
    const t = setInterval(() => !document.hidden && void refreshServers(), ms);
    onCleanup(() => clearInterval(t));
  });
  /** Inicia una receta en una pestaña de fondo (no le saca el foco a la actual). */
  const startRecipe = (r: Recipe) => {
    const env: Record<string, string> = { ...(pathEnv() ? { PATH: pathEnv()! } : {}), ...r.env };
    update((x) => ({ ...M.addTab(x, M.newTab(defaultProfile(), r.cwd || undefined, { command: r.command, env })), activeTab: x.activeTab }));
    setTimeout(() => void refreshServers(), 4000);
  };
  const launchAgent = (agent: AgentDef, cwd: string | undefined) => {
    const env: Record<string, string> = { ...(pathEnv() ? { PATH: pathEnv()! } : {}), ...agent.env };
    update((x) => M.addTab(x, M.newTab(defaultProfile(), cwd, { command: agent.command, env, agentId: agent.id })));
    if (cwd) props.store.update((d) => void (d.recentDirs = pushRecent(d.recentDirs, cwd)));
  };
  // Shells de esta ventana (para el consumo por pestaña del widget de CPU/RAM).
  const tabProcs = createMemo<TabProcs[]>(() =>
    layout().tabs.flatMap((t) =>
      M.leaves(t.root)
        .filter((l) => panes[l.id]?.pid)
        .map((l, i, all) => ({ title: all.length > 1 ? `${titleOf(t)} (${i + 1})` : titleOf(t), pid: panes[l.id]!.pid! })),
    ),
  );
  const focusPane = (tabId: string, paneId: string) => update((x) => M.focusPane(M.selectTab(x, tabId), tabId, paneId));
  const runningAgents = createMemo<RunningAgent[]>(() =>
    layout().tabs.flatMap((t) =>
      M.leaves(t.root)
        .filter((l) => panes[l.id]?.agentId)
        .map((l) => {
          const p = panes[l.id]!;
          return {
            tabId: t.id,
            paneId: l.id,
            agentId: p.agentId!,
            name: settings().agents.find((a) => a.id === p.agentId)?.name ?? p.agentId!,
            cwd: p.cwd,
            state: agentState(p),
            title: titleOf(t),
            exitCode: p.exitCode,
          };
        }),
    ),
  );

  const run = (a: Action) => {
    const t = active();
    switch (a.type) {
      case "newTab":
        update((x) => M.addTab(x, M.newTab(newTabProfile())));
        break;
      case "newWindow":
        void newWindow();
        break;
      case "closePane":
        if (t) closePane(t.id, t.activePane);
        break;
      case "split":
        doSplit(a.dir);
        break;
      case "focus": {
        if (!t) break;
        const n = M.neighbor(t.root, t.activePane, a.dir);
        if (n) update((x) => M.focusPane(x, t.id, n));
        break;
      }
      case "cycleTab":
        update((x) => M.cycleTab(x, a.delta));
        break;
      case "goTab":
        update((x) => M.selectTabIndex(x, a.index));
        break;
      case "rename":
        if (t) setEditingId(t.id);
        break;
      case "toggleTabBar":
        toggleBar();
        break;
      case "openSettings":
        void openSettings();
        break;
      case "togglePanel":
        togglePanel(a.panel);
        break;
      case "jumpPrompt": {
        const id = activePaneId();
        if (id) handles.get(id)?.jumpPrompt(a.delta);
        break;
      }
      case "copyLastOutput": {
        const id = activePaneId();
        if (id) void handles.get(id)?.copyLastOutput();
        break;
      }
    }
  };

  // Atajos cuando el foco no está en una terminal (por ejemplo, después de hacer clic en la barra).
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.(".xterm, input, select, textarea")) return;
      const a = match(e);
      if (a) {
        e.preventDefault();
        run(a);
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  // Al cambiar de pestaña, el foco va al panel activo.
  createEffect(on(activePaneId, (id) => id && queueMicrotask(() => handles.get(id)?.focus())));

  // --- Divisores -------------------------------------------------------------------------------
  const startDrag = (tabId: string, area: M.SplitArea, e: PointerEvent) => {
    // El elemento real (con eventos delegados, currentTarget no siempre es el divisor).
    const el = e.target as HTMLElement;
    const container = el.closest(".tab-view");
    if (!container) return;
    e.preventDefault(); // que no seleccione texto mientras se arrastra
    const box = container.getBoundingClientRect();
    document.body.classList.add("resizing", area.dir === "row" ? "resizing-row" : "resizing-column");
    const move = (ev: PointerEvent) => {
      const fx = (ev.clientX - box.left) / box.width;
      const fy = (ev.clientY - box.top) / box.height;
      const ratio = area.dir === "row" ? (fx - area.rect.x) / area.rect.w : (fy - area.rect.y) / area.rect.h;
      update((x) => M.setRatio(x, tabId, area.id, ratio));    };
    const up = () => {
      document.body.classList.remove("resizing", "resizing-row", "resizing-column");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div class="workspace-root">
    <div class="workspace" classList={{ vertical: vertical(), "with-panel": !!panel() }}>
      <TabBar
        tabs={tabItems()}
        activeId={layout().activeTab}
        vertical={vertical()}
        help={shortcutHelp(settings().shortcuts)}
        editingId={editingId()}
        profiles={props.info.profiles}
        newTabProfile={newTabProfile()}
        onSelect={(id) => update((x) => M.selectTab(x, id))}
        onClose={(id) => update((x) => M.closeTab(x, id))}
        onNew={(p) => update((x) => M.addTab(x, M.newTab(p ?? newTabProfile())))}
        onNewTabProfile={setNewTabProfile}
        onStartRename={setEditingId}
        onRename={(id, title) => {
          const t = tabById(id);
          // Si se confirma el nombre automático sin tocarlo, sigue siendo automático.
          const untouched = t && !t.manualTitle && title?.trim() === titleOf(t);
          if (title !== null && !untouched) update((x) => M.renameTab(x, id, title));
          setEditingId(null);
          const pid = activePaneId();
          if (pid) setTimeout(() => handles.get(pid)?.focus(), 0);
        }}
        onMove={(id, to) => update((x) => M.moveTab(x, id, to))}
        onToggleBar={toggleBar}
        onNewWindow={() => void newWindow()}
        onSettings={() => void openSettings()}
        widgets={
          <Show when={settings().sysmon.enabled}>
            <SysWidget everyMs={settings().sysmon.everyMs} tabs={tabProcs()} vertical={vertical()} />
          </Show>
        }
      />
      <div class="body">
      <main class="tab-area">
        {/* Se itera por id (texto) para que Solid no vuelva a crear terminales cuando cambia el árbol. */}
        <For each={layout().tabs.map((t) => t.id)}>
          {(tabId) => {
            const tab = () => tabById(tabId);
            const visible = () => layout().activeTab === tabId;
            const rects = () => (tab() ? M.paneRects(tab()!.root) : new Map<string, M.Rect>());
            const leafIds = () => (tab() ? M.leaves(tab()!.root).map((l) => l.id) : []);
            const areas = () => (tab() ? M.splitAreas(tab()!.root) : []);
            const multi = () => leafIds().length > 1;
            return (
              <div class="tab-view" classList={{ visible: visible() }}>
                <For each={leafIds()}>
                  {(paneId) => {
                    const leafAt = M.findLeaf(tab()!.root, paneId)!;
                    const r = () => rects().get(paneId) ?? { x: 0, y: 0, w: 1, h: 1 };
                    const focused = () => tab()?.activePane === paneId;
                    return (
                      <div
                        class="pane"
                        classList={{ focused: focused() && multi() }}
                        style={{ left: pct(r().x), top: pct(r().y), width: pct(r().w), height: pct(r().h) }}
                      >
                        <TerminalView
                          profileId={leafAt.profileId}
                          cwd={leafAt.cwd}
                          startup={leafAt.startup}
                          windowsBuild={props.info.windowsBuild}
                          look={props.look}
                          match={match}
                          visible={visible()}
                          focused={focused()}
                          onFocus={() => {
                            if (tab()?.activePane !== paneId) update((x) => M.focusPane(x, tabId, paneId));
                          }}
                          onPatch={(p: TermPatch) => {
                            if (panes[paneId]) setPanes(paneId, p);
                          }}
                          onExit={(code) => {
                            // Salida limpia (por ejemplo `exit`): se cierra el panel, como Windows Terminal.
                            if (code === 0) {
                              closePane(tabId, paneId);
                              return true;
                            }
                            return false;
                          }}
                          onAction={run}
                          ref={(h) => handles.set(paneId, h)}
                        />
                      </div>
                    );
                  }}
                </For>
                <For each={areas()}>
                  {(area) => (
                    <div
                      class="divider"
                      classList={{ row: area.dir === "row", column: area.dir === "column" }}
                      style={
                        area.dir === "row"
                          ? { left: pct(area.rect.x + area.rect.w * area.ratio), top: pct(area.rect.y), height: pct(area.rect.h) }
                          : { top: pct(area.rect.y + area.rect.h * area.ratio), left: pct(area.rect.x), width: pct(area.rect.w) }
                      }
                      onPointerDown={(e) => startDrag(tabId, area, e)}
                    />
                  )}
                </For>
              </div>
            );
          }}
        </For>
      </main>
      <Show when={panel()}>
        <aside class="side-panel" style={{ width: `${panelWidth()}px` }}>
          <div class="panel-resize" onPointerDown={startPanelDrag} title="Arrastrar para cambiar el ancho" />
          <Suspense>
            <Show when={panel() === "servers"}>
              <ServersPanel
                servers={servers()}
                loading={serversLoading()}
                error={serversError()}
                paneOf={paneOf}
                recipes={settings().recipes}
                update={props.store.update}
                onRefresh={() => void refreshServers()}
                onStart={startRecipe}
                onFocus={focusPane}
              />
            </Show>
            <Show when={panel() === "projects"}>
              <ProjectsPanel
                manual={settings().projects.manual}
                hidden={settings().projects.hidden}
                recentDirs={settings().recentDirs}
                agents={settings().agents}
                update={props.store.update}
                onTerminal={(dir) => update((x) => M.addTab(x, M.newTab(newTabProfile(), dir)))}
                onAgent={(a, dir) => launchAgent(a, dir)}
                onGit={(dir) => {
                  setGitRoot(dir);
                  setPanel("git");
                }}
              />
            </Show>
            <Show when={panel() === "git"}>
              <GitPanel
                dir={gitRoot() ?? activeCwd()}
                onChanged={() => void refreshCounts()}
                onTerminal={(dir) => update((x) => M.addTab(x, M.newTab(newTabProfile(), dir)))}
              />
            </Show>
            <Show when={panel() === "agents"}>
              <AgentsPanel
                agents={settings().agents}
                running={runningAgents()}
                activeCwd={activeCwd()}
                recentDirs={settings().recentDirs}
                onLaunch={launchAgent}
                onFocus={focusPane}
                update={props.store.update}
              />
            </Show>
          </Suspense>
        </aside>
      </Show>
      <ActivityBar active={panel()} onToggle={togglePanel} help={shortcutHelp(settings().shortcuts)} />
      </div>
    </div>
    <UsageFooter usage={settings().usage} onSettings={() => void openSettings()} />
    </div>
  );
}
