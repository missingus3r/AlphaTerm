import { createEffect, createMemo, createResource, createSignal, For, lazy, on, onCleanup, onMount, Show, Suspense, untrack } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { createStore, produce } from "solid-js/store";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as M from "./model";
import { buildKeymap, matchShortcut, shortcutHelp, type Action } from "./shortcuts";
import { TabBar, type TabItem, type TabStatus } from "./TabBar";
import { tabTitle, type PaneInfo } from "./title";
import { TerminalView, type TermHandle, type TermPatch } from "../terminal/TerminalView";
import { foreground, gitBranch, newWindow, type TermInfo, profileLabel } from "../terminal/pty";
import type { TermLook } from "../settings/apply";
import { closeSettings, openSettings, settingsOpen, type SettingsStore } from "../settings/store";
import type { AgentDef } from "../settings/schema";
import { agentRunning, agentState, paneBusy, pushRecent } from "../panels/agentState";
import { PaneBar, PaneMenu } from "./PaneBar";
import { startPaneDrag } from "./paneDrag";
import { askConfirm } from "../widgets/confirm";
import { ConfirmModal } from "../widgets/ConfirmModal";
import { agentKind, buildCommand, launchParts, shellKindOf } from "../panels/agentLaunch";
import type { RunningAgent } from "../panels/AgentsPanel";
import { ActivityBar, PANELS, type PanelId } from "../panels/ActivityBar";
import * as D from "../panels/dock";
import { SysWidget, type TabProcs } from "../widgets/SysWidget";
import { providerFor, UsageFooter } from "../widgets/UsageFooter";
import { candidate, mergeRecipe, type PaneRef, type Server } from "../panels/servers";
import type { Recipe } from "../settings/schema";
import { restore as restoreSession, serialize, type SavedWindow } from "./session";
import { handleControl } from "./control";
import { GuardianModal } from "../widgets/GuardianModal";
import { listen } from "@tauri-apps/api/event";
import { BrowserView, whenReady, type OwnerLive, type Target } from "../browser/BrowserView";
import { k, t } from "../i18n";

const AgentsPanel = lazy(() => import("../panels/AgentsPanel"));
const ServersPanel = lazy(() => import("../panels/ServersPanel"));
const ProjectsPanel = lazy(() => import("../panels/ProjectsPanel"));
const GitPanel = lazy(() => import("../panels/GitPanel"));
const HistoryPanel = lazy(() => import("../panels/HistoryPanel"));
const DockerPanel = lazy(() => import("../panels/DockerPanel"));
const ChangesPanel = lazy(() => import("../panels/ChangesPanel"));
const SettingsView = lazy(() => import("../settings/SettingsView"));
const DOCK_PREF = "alphaterm.dock";

/** Live state of each pane (key: pane id). */
interface PaneState extends PaneInfo {
  sessionId?: number;
  pid?: number | null;
  renderer?: string;
  exited?: boolean;
  ended?: number;
  agentId?: string;
  agentStarted?: boolean;
  active?: boolean;
  bell?: boolean;
}

const pct = (n: number) => `${(n * 100).toFixed(4)}%`;

export function Workspace(props: { info: TermInfo; store: SettingsStore; look: TermLook; initial?: unknown }) {
  const settings = props.store.settings;
  const profileName = (id: string) => {
    const name = props.info.profiles.find((p) => p.id === id)?.name;
    return name ? profileLabel(name) : id;
  };
  // Default shell: the one from settings if it's installed; otherwise, the one the backend detected.
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
  // Saved state from the previous session (if there is one and a restore was requested).
  const restored: SavedWindow | null = props.initial
    ? restoreSession(props.initial, {
        relaunch: settings().session.relaunchAgents,
        agents: settings().agents,
        profileOk: (id) => props.info.profiles.some((p) => p.id === id && p.available),
        fallbackProfile: defaultProfile(),
      })
    : null;
  const [windowTitle, setWindowTitle] = createSignal<string | undefined>(restored?.windowTitle);
  const [layout, setLayout] = createSignal<M.Layout>((() => {
    if (restored) return restored.layout;
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
  createEffect(() => layout().tabs.forEach((t) => M.leaves(t.root).filter((l) => !l.browser).forEach(ensurePane)));

  // Clears the state of panes that no longer exist.
  createEffect(() => {
    const alive = new Set(layout().tabs.flatMap((t) => M.leaves(t.root).filter((l) => !l.browser).map((l) => l.id)));
    for (const id of Object.keys(panes)) {
      if (!alive.has(id)) {
        handles.delete(id);
        setPanes(produce((s) => delete s[id]));
      }
    }
  });

  // With no tabs, the window closes (like Windows Terminal).
  createEffect(() => {
    if (layout().tabs.length === 0) void getCurrentWindow().close();
  });

  // With the browser focused, the title comes from the tab's terminal (if any).
  const titlePane = (t: M.Tab) => panes[t.activePane] ?? panes[M.leaves(t.root).find((l) => !l.browser)?.id ?? ""];
  const titleOf = (tab: M.Tab) => {
    const first = M.leaves(tab.root).find((l) => !l.browser);
    return tabTitle(tab.manualTitle, titlePane(tab), first ? profileName(first.profileId) : t("Navegador"));
  };

  // An agent "started" when its command began running (by integration or by process).
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
    layout().tabs.map((tab) => {
      const p = panes[tab.activePane];
      const tip = [
        titleOf(tab),
        p?.cwd ? t("Carpeta: {cwd}", { cwd: p.cwd }) : "",
        p ? `${p.shellName}${p.pid ? ` · PID ${p.pid}` : ""}${p.renderer ? ` · ${p.renderer === "webgl" ? "WebGL" : "DOM"}` : ""}` : "",
        p?.lastCommand ? t("Último comando: {command}", { command: p.lastCommand }) : "",
      ]
        .filter(Boolean)
        .join("\n");
      const changes = p?.cwd ? gitCounts()[p.cwd] : undefined;
      return { id: tab.id, title: titleOf(tab), status: statusOf(tab), tooltip: tip, panes: M.leaves(tab.root).length, changes: changes ?? undefined, color: tab.color, groupId: tab.groupId };
    }),
  );

  // Window title = title of the active tab.
  createEffect(() => {
    const t = active();
    const title = windowTitle() ? windowTitle()! : t ? `${titleOf(t)} — AlphaTerm` : "AlphaTerm";
    document.title = title;
    void getCurrentWindow().setTitle(title).catch(() => {});
  });

  // Git branch: looked up when the folder changes or a command ends (the branch may have changed).
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

  // Foreground process of all sessions (a single process snapshot per query).
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
            // Without integration, the program's title goes away with the program.
            if (!name && !panes[paneId].integrated) setPanes(paneId, "agentTitle", undefined);
          }
        }
      } catch {
        /* the next round retries */
      }
    };
    const timer = setInterval(poll, ms);
    onCleanup(() => clearInterval(timer));
  });

  // --- Actions --------------------------------------------------------------------------------
  /** Splits a pane (the bar's, or the active one with the shortcuts). */
  const splitAt = (tabId: string, paneId: string, dir: M.SplitDir | "auto") => {
    const t = tabById(tabId);
    const l = t ? M.findLeaf(t.root, paneId) : undefined;
    if (!t || !l) return;
    // From a browser, a terminal is opened in its owner's folder.
    const base = l.browser ? M.findLeaf(t.root, l.browser.owner ?? "") ?? M.leaves(t.root).find((x) => !x.browser) : l;
    let d: M.SplitDir = dir === "auto" ? "row" : dir;
    if (dir === "auto") {
      const r = M.paneRects(t.root).get(l.id);
      const el = document.querySelector(".tab-view.visible");
      const w = (r?.w ?? 1) * (el?.clientWidth ?? 1);
      const h = (r?.h ?? 1) * (el?.clientHeight ?? 1);
      d = w >= h * 1.6 ? "row" : "column"; // in a terminal, width "is worth" less than height
    }
    // The new pane inherits the current one's profile and folder.
    update((x) => M.splitPane(x, t.id, l.id, d, M.leaf(base?.profileId || defaultProfile(), (base && panes[base.id]?.cwd) ?? base?.cwd)));
  };
  const doSplit = (dir: M.SplitDir | "auto") => {
    const t = active();
    if (t) splitAt(t.id, t.activePane, dir);
  };

  const closePane = (tabId: string, paneId: string) => update((x) => M.closePane(x, tabId, paneId));
  /** Close from the bar or the menu: if something is running, it asks first (inside the app). */
  const askClose = async (tabId: string, paneId: string) => {
    const p = panes[paneId];
    if (p && paneBusy(p)) {
      const yes = await askConfirm(t("¿Cerrar este panel? Se corta lo que está corriendo en él ({name}).", { name: paneLabel(paneId) }), t("Cerrar"));
      if (!yes) return void handles.get(paneId)?.focus();
    }
    closePane(tabId, paneId);
  };
  /** Focuses a pane right away (clicking the bar doesn't focus the terminal by itself). */
  const focusNow = (tabId: string, paneId: string) => {
    if (tabById(tabId)?.activePane !== paneId) update((x) => M.focusPane(x, tabId, paneId));
    queueMicrotask(() => handles.get(paneId)?.focus());
  };
  const [paneMenu, setPaneMenu] = createSignal<{ x: number; y: number; tabId: string; paneId: string } | null>(null);
  const openPaneMenu = (e: MouseEvent, tabId: string, paneId: string) => {
    focusNow(tabId, paneId);
    setPaneMenu({ x: Math.min(e.clientX, window.innerWidth - 230), y: Math.min(e.clientY, window.innerHeight - 180), tabId, paneId });
  };
  /** What is drawn while a pane is dragged: where it will end up. */
  const [dropHint, setDropHint] = createSignal<{ tabId: string; rect: M.Rect; center: boolean } | null>(null);
  /** Grab the bar: focuses the pane and, if dragged, moves it when dropped onto another. */
  const grab = (tabId: string, paneId: string, e: PointerEvent) => {
    focusNow(tabId, paneId);
    const container = (e.target as HTMLElement)?.closest?.(".tab-view");
    const t = tabById(tabId);
    if (!container || !t || M.leaves(t.root).length < 2) return;
    startPaneDrag({
      e,
      container,
      paneId,
      rects: () => M.paneRects(tabById(tabId)?.root ?? t.root),
      onHover: (h) => {
        const r = h && M.paneRects(tabById(tabId)?.root ?? t.root).get(h.target);
        setDropHint(h && r ? { tabId, rect: M.zoneRect(r, h.zone), center: h.zone === "center" } : null);
      },
      onDrop: (target, zone) => update((x) => M.movePane(x, tabId, paneId, target, zone)),
      onClick: () => {},
    });
  };

  // --- Tiled side panels ----------------------------------------------------------------------
  // Saved in the window's session and, as a preference, for new windows.
  const readDock = (): D.Dock => {
    try {
      return D.normalizeDock(JSON.parse(localStorage.getItem(DOCK_PREF) ?? "null"));
    } catch {
      return { cols: [] };
    }
  };
  const initialDock = (): D.Dock => {
    if (restored?.dock) return D.normalizeDock(restored.dock);
    // Old sessions (a single panel).
    if (restored && typeof restored.panel === "string" && PANELS.some((x) => x.id === restored.panel)) {
      return D.openPanel({ cols: [] }, restored.panel as PanelId);
    }
    return restored ? { cols: [] } : readDock();
  };
  const [dock, setDockRaw] = createSignal<D.Dock>(initialDock());
  const setDock = (d: D.Dock) => {
    setDockRaw(d);
    try {
      localStorage.setItem(DOCK_PREF, JSON.stringify(d));
    } catch {
      /* doesn't matter */
    }
  };
  const panelOpen = (p: PanelId) => D.isOpen(dock(), p);
  const togglePanel = (p: PanelId) => setDock(D.togglePanel(dock(), p));
  const showPanel = (p: PanelId) => setDock(D.openPanel(dock(), p));
  /** Repository shown by the git panel (null = the one of the active pane's folder). */
  const [gitRoot, setGitRoot] = createSignal<string | null>(null);

  // Width of a column: its left edge is dragged.
  const startColDrag = (colId: string, e: PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = dock().cols.find((c) => c.id === colId)?.width ?? D.DEFAULT_W;
    document.body.classList.add("resizing", "resizing-row");
    const move = (ev: PointerEvent) => setDockRaw(D.setColWidth(dock(), colId, Math.min(startW + (startX - ev.clientX), window.innerWidth - 360)));
    const up = () => {
      document.body.classList.remove("resizing", "resizing-row");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDock(dock());
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  // Height between two panels in a column.
  const startSplitDrag = (colId: string, i: number, e: PointerEvent) => {
    e.preventDefault();
    const col = (e.target as HTMLElement).closest(".dock-col");
    if (!col) return;
    const box = col.getBoundingClientRect();
    document.body.classList.add("resizing", "resizing-column");
    const move = (ev: PointerEvent) => setDockRaw(D.resizeSplit(dock(), colId, i, (ev.clientY - box.top) / box.height));
    const up = () => {
      document.body.classList.remove("resizing", "resizing-column");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDock(dock());
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  // Reorder: drag a panel's title bar.
  const [dragPanel, setDragPanel] = createSignal<PanelId | null>(null);
  const dropOn = (to: D.DropTarget) => {
    const p = dragPanel();
    setDragPanel(null);
    if (p) setDock(D.movePanel(dock(), p, to));
  };
  // Git change counter per tab (folder of each one's active pane). Every 10 s with the
  // window visible and when a command ends.
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

  // Full PATH (process + registry + agent folders): an agent installed after
  // opening AlphaTerm is still found.
  const [pathEnv] = createResource(() => invoke<string>("agents_path_env").catch(() => ""));

  // --- Command history: every command that ends is saved (shells with integration) -------------
  const [historyVersion, setHistoryVersion] = createSignal(0);
  const wasRunning = new Map<string, boolean>();
  createEffect(() => {
    for (const [id, p] of Object.entries(panes)) {
      const before = wasRunning.get(id) ?? false;
      wasRunning.set(id, p.running);
      if (before && !p.running && p.lastCommand) {
        void invoke("history_add", {
          entry: { command: p.lastCommand, cwd: p.cwd ?? null, exitCode: p.exitCode ?? null, at: Date.now(), shell: p.shellName ?? null },
        })
          .then(() => setHistoryVersion((v) => v + 1))
          .catch(() => {});
      }
    }
  });
  const useCommand = (command: string, runIt: boolean) => {
    const id = activePaneId();
    if (!id) return;
    handles.get(id)?.send(command, runIt);
    handles.get(id)?.focus();
  };
  // Usage provider of the active tab's agent (launched from the panel or typed).
  const activeProvider = () => {
    const id = activePaneId();
    const p = id ? panes[id] : undefined;
    if (!p) return null;
    return providerFor(p.agentId, p.running ? p.lastCommand : undefined, p.fgProcess);
  };

  // --- Tab summary with a model (optional): every N s (minimum 30), only the ones that had
  // output since last time, 3 per round. If it fails, it stops trying until the next change.
  const hadOutput = new Set<string>();
  createEffect(() => {
    for (const [id, p] of Object.entries(panes)) if (p.active) hadOutput.add(id);
  });
  createEffect(() => {
    const l = settings().llm;
    if (!l.enabled || !l.model) return;
    const t = setInterval(async () => {
      if (document.hidden) return;
      const ids = layout()
        .tabs.map((tab) => tab.activePane)
        .filter((id) => hadOutput.has(id))
        .slice(0, 3);
      for (const id of ids) {
        hadOutput.delete(id);
        const text = handles.get(id)?.text(80);
        if (!text?.trim()) continue;
        try {
          const title = await invoke<string>("llm_summarize", { endpoint: l.endpoint, model: l.model, apiKey: l.apiKey || null, text });
          if (panes[id]) setPanes(id, "llmTitle", title);
        } catch (e) {
          console.warn("Resumen con modelo:", e);
        }
      }
    }, l.everySec * 1000);
    onCleanup(() => clearInterval(t));
  });

  // --- Control API: this window answers for its panes ---------------------------------------------
  onMount(async () => {
    const label = getCurrentWindow().label;
    const un = await listen<{ id: number; method: string; params: Record<string, unknown>; window: string; windows: string[] }>("control-request", async (e) => {
      if (e.payload.window !== label) return;
      let reply: unknown;
      try {
        reply = await handleControl(e.payload, {
          label,
          layout,
          pane: (id) => panes[id],
          handle: (id) => handles.get(id),
          titleOf,
          openBrowser: async (o) => {
            const id = openBrowser(o);
            if (!id) return undefined;
            return (await whenReady(id)) ? id : undefined;
          },
          update,
          defaultProfile,
          env: (): Record<string, string> => (pathEnv() ? { PATH: pathEnv()! } : {}),
        });
      } catch (err) {
        reply = { error: String(err) };
      }
      void invoke("control_respond", { id: e.payload.id, reply });
    });
    onCleanup(un);
  });

  // --- Session: saved a moment after each change (layout, folders, title, panel) -------------------
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const snapshot = serialize(layout(), (id) => (panes[id] ? { cwd: panes[id].cwd, agentId: panes[id].agentId } : undefined), {
      windowTitle: windowTitle(),
      dock: dock(),
    });
    const json = JSON.stringify(snapshot);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void invoke("session_put", { value: JSON.parse(json) }).catch(() => {}), 800);
  });
  onCleanup(() => clearTimeout(saveTimer));

  // --- Servers ---------------------------------------------------------------------------------
  // Queried every 3 s with the panel open; with the panel closed, every 10 s and only if some
  // tab is running something (to save the recipe of whatever starts there).
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
      // Recipes: what started in a tab with a known command.
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
    const ms = panelOpen("servers") ? 3000 : anyRunning() ? 10_000 : 0;
    if (!ms) return;
    if (panelOpen("servers")) untrack(() => void refreshServers());
    const t = setInterval(() => !document.hidden && void refreshServers(), ms);
    onCleanup(() => clearInterval(t));
  });
  /** Launches a recipe in a background tab (doesn't take focus from the current one). */
  const startRecipe = (r: Recipe) => {
    const env: Record<string, string> = { ...(pathEnv() ? { PATH: pathEnv()! } : {}), ...r.env };
    update((x) => ({ ...M.addTab(x, M.newTab(defaultProfile(), r.cwd || undefined, { command: r.command, env })), activeTab: x.activeTab }));
    setTimeout(() => void refreshServers(), 4000);
  };
  // Files to launch Claude Code with AlphaTerm's MCP and the Guardian hook.
  const [controlFiles] = createResource(() => invoke<{ claudeSettings: string; claudeStop: string; claudeMcp: string; mcpScript: string }>("control_files").catch(() => null));
  /**
   * Command an agent starts with: its own, the options chosen in the panel (with the
   * quotes of the profile's shell) and, for Claude and Codex, the Guardian and the control API.
   */
  const agentCommand = (agent: AgentDef, profileId: string) => {
    const first = agentKind(agent.command);
    const s = settings();
    const extra: string[] = [];
    const f = controlFiles();
    if (first === "claude" && f) {
      if (s.control.enabled) extra.push(`--mcp-config "${f.claudeMcp}"`);
      // The same file carries the Guardian hook and the one that records the changes.
      if ((s.guardian.enabled && s.guardian.claude) || (s.changes.enabled && s.changes.claude)) extra.push(`--settings "${f.claudeSettings}"`);
      // Only the Stop hook: the browser knows when it finished answering ("working… done").
      else if (s.control.enabled && f.claudeStop) extra.push(`--settings "${f.claudeStop}"`);
    }
    // Codex has no hooks: its own approval mode is used (asks permission to write), unless
    // the command or the options already say how to approve (otherwise it clashes with what was chosen).
    const chosen = [agent.command, ...launchParts(agent).flag].join(" ");
    if (first === "codex" && s.guardian.enabled && s.guardian.codex && !/(\s|^)(-s|--sandbox|-a|--ask-for-approval|--approve-for-me|--dangerously-bypass-approvals-and-sandbox)(\s|=|$)/.test(chosen)) {
      extra.push("-s read-only -a on-request");
    }
    return buildCommand(agent, shellKindOf(profileId), extra);
  };
  const launchAgent = (agent: AgentDef, cwd: string | undefined) => {
    const env: Record<string, string> = { ...(pathEnv() ? { PATH: pathEnv()! } : {}), ...agent.env };
    const profile = defaultProfile();
    update((x) => M.addTab(x, M.newTab(profile, cwd, { command: agentCommand(agent, profile), env, agentId: agent.id })));
    if (cwd) props.store.update((d) => void (d.recentDirs = pushRecent(d.recentDirs, cwd)));
  };
  // --- Built-in browser ---------------------------------------------------------------------------
  /** Probable URL for a new browser: the last server that started in that tab. */
  const guessUrl = (tabId: string) => {
    const s = [...servers()].reverse().find((x) => paneOf(x.shellPid)?.tabId === tabId && x.ports.length);
    return s ? `http://localhost:${s.ports[0]}` : undefined;
  };
  /**
   * Opens a browser next to a pane (or reuses the tab's). Returns its id. The owner (who
   * the requests go to) is the terminal it's opened next to.
   */
  const openBrowser = (o: { url?: string; tabId?: string; pane?: string; dir?: M.SplitDir; reuse?: boolean; focus?: boolean }) => {
    const t = o.tabId ? tabById(o.tabId) : active();
    if (!t) return undefined;
    const existing = o.reuse === false ? undefined : M.browserOf(t);
    if (existing) {
      if (o.url) void invoke("browser_navigate", { id: existing.id, url: o.url }).catch(() => {});
      update((x) => M.focusPane(M.selectTab(x, t.id), t.id, existing.id));
      return existing.id;
    }
    const at = o.pane && M.findLeaf(t.root, o.pane) ? o.pane : t.activePane;
    const atLeaf = M.findLeaf(t.root, at);
    const owner = atLeaf?.browser ? atLeaf.browser.owner : at;
    const b = M.browserLeaf(o.url || guessUrl(t.id) || "about:blank", owner);
    update((x) => {
      const y = M.splitPane(x, t.id, at, o.dir ?? "row", b);
      return o.focus === false ? y : M.focusPane(M.selectTab(y, t.id), t.id, b.id);
    });
    return b.id;
  };
  const askBrowser = () => {
    const tab = active();
    if (!tab) return;
    if (M.browserOf(tab)) return void openBrowser({});
    const u = prompt(t("¿Qué dirección abro en el navegador?"), guessUrl(tab.id) ?? "http://localhost:5173");
    if (u !== null && u.trim()) openBrowser({ url: u.trim() });
  };
  /** Short name of a terminal pane: agent (or program, or shell) · folder. */
  const paneLabel = (id: string) => {
    const p = panes[id];
    if (!p) return "";
    const agent = settings().agents.find((a) => a.id === (p.agentId ?? providerFor(p.agentId, p.running ? p.lastCommand : undefined, p.fgProcess)));
    const where = p.cwd ? p.cwd.split(/[\\/]/).filter(Boolean).pop() : "";
    return `${agent?.name ?? p.fgProcess ?? p.shellName}${where ? ` · ${where}` : ""}`;
  };
  /** Terminals in the tab that a request can be sent to. */
  const targetsOf = (tabId: string): Target[] => {
    const t = tabById(tabId);
    if (!t) return [];
    return M.leaves(t.root)
      .filter((l) => !l.browser && panes[l.id])
      .map((l) => ({ id: l.id, label: paneLabel(l.id) }));
  };
  const ownerLive = (id: string): OwnerLive | undefined => {
    const p = panes[id];
    if (!p) return undefined;
    const def = settings().agents.find((a) => a.id === p.agentId);
    // Only a Claude Code launched by AlphaTerm with the API on has the Stop hook.
    const hook = !!def && agentKind(def.command) === "claude" && settings().control.enabled;
    return { active: p.active, bell: p.bell, hook };
  };
  /** Pastes the request into the agent's terminal and sends it (Enter separately: otherwise it stays in the paste). */
  const sendToAgent = (pane: string, message: string) => {
    const h = handles.get(pane);
    if (!h || !h.paste(message)) return false;
    setTimeout(() => h.send("", true), 350);
    return true;
  };

  // --- Changes: the folder of each pane with a running agent is watched -------------------------
  // (the backend copies the folder at the start and compares each change against that copy).
  const watching = new Map<string, string>(); // pane → folder
  createEffect(() => {
    const c = settings().changes;
    const agents = settings().agents;
    const want = new Map<string, { dir: string; agent: string }>();
    if (c.enabled && c.folders) {
      for (const [id, p] of Object.entries(panes)) {
        const prov = providerFor(p.agentId, p.running ? p.lastCommand : undefined, p.fgProcess);
        if (!p.cwd || !((p.agentId && agentRunning(p)) || prov)) continue;
        const def = agents.find((a) => a.id === (p.agentId ?? prov));
        want.set(id, { dir: p.cwd, agent: def?.name ?? prov ?? t("Agente") });
      }
    }
    untrack(() => {
      for (const [id, dir] of [...watching]) {
        if (want.get(id)?.dir === dir) continue;
        watching.delete(id);
        void invoke("changes_unwatch", { pane: id }).catch(() => {});
      }
      for (const [id, w] of want) {
        if (watching.has(id)) continue;
        watching.set(id, w.dir);
        void invoke("changes_watch", { pane: id, dir: w.dir, agent: w.agent }).catch(() => {});
      }
    });
  });
  onCleanup(() => {
    for (const id of watching.keys()) void invoke("changes_unwatch", { pane: id }).catch(() => {});
  });

  // Shells of this window (for the per-tab usage of the CPU/RAM widget).
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
    const tab = active();
    switch (a.type) {
      case "newTab":
        update((x) => M.addTab(x, M.newTab(newTabProfile())));
        break;
      case "newWindow":
        void newWindow();
        break;
      case "closePane":
        if (tab) closePane(tab.id, tab.activePane);
        break;
      case "split":
        doSplit(a.dir);
        break;
      case "focus": {
        if (!tab) break;
        const n = M.neighbor(tab.root, tab.activePane, a.dir);
        if (n) update((x) => M.focusPane(x, tab.id, n));
        break;
      }
      case "cycleTab":
        update((x) => M.cycleTab(x, a.delta));
        break;
      case "goTab":
        update((x) => M.selectTabIndex(x, a.index));
        break;
      case "rename":
        if (tab) setEditingId(tab.id);
        break;
      case "toggleTabBar":
        toggleBar();
        break;
      case "renameWindow": {
        const v = prompt(t("Título de esta ventana (vacío = el de la pestaña activa):"), windowTitle() ?? "");
        if (v !== null) setWindowTitle(v.trim() || undefined);
        break;
      }
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
      case "openBrowser":
        askBrowser();
        break;
      case "copyLastOutput": {
        const id = activePaneId();
        if (id) void handles.get(id)?.copyLastOutput();
        break;
      }
    }
  };

  // Shortcuts when focus isn't in a terminal (for example, after clicking the bar).
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.(".xterm, input, select, textarea")) return;
      const a = match(e);
      // With settings open, the shortcuts don't touch the tabs behind.
      if (settingsOpen() && a?.type !== "openSettings") return;
      if (a) {
        e.preventDefault();
        run(a);
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  // On tab change, focus goes to the active pane.
  createEffect(on(activePaneId, (id) => id && queueMicrotask(() => handles.get(id)?.focus())));

  // --- Dividers --------------------------------------------------------------------------------
  const startDrag = (tabId: string, area: M.SplitArea, e: PointerEvent) => {
    // The real element (with delegated events, currentTarget isn't always the divider).
    const el = e.target as HTMLElement;
    const container = el.closest(".tab-view");
    if (!container) return;
    e.preventDefault(); // so it doesn't select text while dragging
    const box = container.getBoundingClientRect();
    document.body.classList.add("resizing", area.dir === "row" ? "resizing-row" : "resizing-column");
    const move = (ev: PointerEvent) => {
      const fx = (ev.clientX - box.left) / box.width;
      const fy = (ev.clientY - box.top) / box.height;
      const ratio = area.dir === "row" ? (fx - area.rect.x) / area.rect.w : (fy - area.rect.y) / area.rect.h;
      // Snaps at ⅓, ½ and ⅔ if it's within a few pixels.
      const extentPx = area.dir === "row" ? box.width * area.rect.w : box.height * area.rect.h;
      update((x) => M.setRatio(x, tabId, area.id, M.snapRatio(ratio, extentPx)));
    };
    const up = () => {
      document.body.classList.remove("resizing", "resizing-row", "resizing-column");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const PANEL_LABEL: Record<PanelId, string> = { agents: k("Agentes"), servers: k("Servidores"), projects: k("Proyectos"), git: "Git", history: k("Historial"), docker: "Docker", changes: k("Modificaciones") };
  const renderPanel = (id: PanelId) => {
    switch (id) {
      case "servers":
        return (
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
                onBrowse={(url, pane) => void openBrowser({ url, tabId: pane?.tabId, pane: pane?.paneId })}
              />
        );
      case "projects":
        return (
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
                  showPanel("git");
                }}
              />
        );
      case "git":
        return (
              <GitPanel
                dir={gitRoot() ?? activeCwd()}
                onChanged={() => void refreshCounts()}
                onTerminal={(dir) => update((x) => M.addTab(x, M.newTab(newTabProfile(), dir)))}
              />
        );
      case "docker":
        return (
              <DockerPanel
                presets={settings().docker.presets}
                update={props.store.update}
                onTerminal={(command, title) =>
                  update((x) => {
                    const t = M.newTab(defaultProfile(), undefined, { command, env: pathEnv() ? { PATH: pathEnv()! } : {} });
                    return M.addTab(x, { ...t, manualTitle: title });
                  })
                }
              />
        );
      case "changes":
        return <ChangesPanel />;
      case "history":
        return (
              <HistoryPanel onUse={useCommand} version={historyVersion()} />
        );
      case "agents":
        return (
              <AgentsPanel
                agents={settings().agents}
                running={runningAgents()}
                activeCwd={activeCwd()}
                recentDirs={settings().recentDirs}
                onLaunch={launchAgent}
                shell={shellKindOf(defaultProfile())}
                onFocus={focusPane}
                update={props.store.update}
              />
        );
    }
  };

  return (
    <div class="workspace-root">
    <div class="workspace" classList={{ vertical: vertical(), "with-panel": dock().cols.length > 0 }}>
      <TabBar
        tabs={tabItems()}
        activeId={layout().activeTab}
        vertical={vertical()}
        collapsed={settings().tabBar.collapsed}
        onCollapse={() => props.store.update((d) => void (d.tabBar.collapsed = !d.tabBar.collapsed))}
        width={settings().tabBar.width}
        onWidth={(w) => props.store.update((d) => void (d.tabBar.width = w))}
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
          // If the automatic name is confirmed without touching it, it stays automatic.
          const untouched = t && !t.manualTitle && title?.trim() === titleOf(t);
          if (title !== null && !untouched) update((x) => M.renameTab(x, id, title));
          setEditingId(null);
          const pid = activePaneId();
          if (pid) setTimeout(() => handles.get(pid)?.focus(), 0);
        }}
        onMove={(id, to) => update((x) => M.moveTab(x, id, to))}
        groups={layout().groups ?? []}
        onColor={(id, c) => update((x) => M.setTabColor(x, id, c))}
        onGroupNew={(id) => {
          const name = prompt(t("Nombre de la carpeta de pestañas:"), t("Carpeta"));
          if (name !== null) update((x) => M.createGroup(x, name, [id]));
        }}
        onGroupMove={(id, g) => update((x) => M.moveToGroup(x, id, g))}
        onGroupUpdate={(g, patch) => update((x) => M.updateGroup(x, g, patch))}
        onGroupUngroup={(g) => update((x) => M.ungroup(x, g))}
        onGroupClose={async (g) => {
          const n = layout().tabs.filter((t) => t.groupId === g).length;
          if (await askConfirm(t("¿Cerrar las {n} pestañas de la carpeta? Se cierran sus shells y lo que esté corriendo en ellas.", { n }), t("Cerrar"))) {
            update((x) => x.tabs.filter((t) => t.groupId === g).reduce((acc, t) => M.closeTab(acc, t.id), x));
          }
        }}
        onRenameWindow={() => run({ type: "renameWindow" })}
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
        {/* Iterated by id (text) so Solid doesn't recreate terminals when the tree changes. */}
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
                    if (leafAt.browser) {
                      const spec = () => M.findLeaf(tab()!.root, paneId)?.browser ?? leafAt.browser!;
                      return (
                        <div
                          class="pane"
                          classList={{ focused: focused() && multi() }}
                          style={{ left: pct(r().x), top: pct(r().y), width: pct(r().w), height: pct(r().h) }}
                        >
                          <BrowserView
                            id={paneId}
                            url={leafAt.browser.url}
                            owner={spec().owner}
                            visible={visible()}
                            focused={focused()}
                            targets={targetsOf(tabId)}
                            ownerLive={ownerLive}
                            onFocus={() => {
                              if (tab()?.activePane !== paneId) update((x) => M.focusPane(x, tabId, paneId));
                            }}
                            onUrl={(u) => update((x) => M.setBrowser(x, paneId, { url: u }))}
                            onOwner={(o) => {
                              update((x) => M.setBrowser(x, paneId, { owner: o }));
                              void invoke("browser_set_owner", { id: paneId, owner: o ?? null }).catch(() => {});
                            }}
                            onSend={sendToAgent}
                            onClose={() => closePane(tabId, paneId)}
                            onSplit={(d) => splitAt(tabId, paneId, d)}
                            onGrab={(e) => grab(tabId, paneId, e)}
                            onMenu={(e) => openPaneMenu(e, tabId, paneId)}
                          />
                        </div>
                      );
                    }
                    return (
                      <div
                        class="pane"
                        classList={{ focused: focused() && multi() }}
                        style={{ left: pct(r().x), top: pct(r().y), width: pct(r().w), height: pct(r().h) }}
                      >
                        <PaneBar
                          title={paneLabel(paneId)}
                          tooltip={[panes[paneId]?.cwd, t("Arrastrar para mover el panel · clic derecho: más opciones")].filter(Boolean).join("\n")}
                          highlight={focused() && multi()}
                          onSplit={(d) => splitAt(tabId, paneId, d)}
                          onClose={() => askClose(tabId, paneId)}
                          onGrab={(e) => grab(tabId, paneId, e)}
                          onMenu={(e) => openPaneMenu(e, tabId, paneId)}
                        />
                        <div class="pane-body">
                        <TerminalView
                          paneId={paneId}
                          profileId={leafAt.profileId}
                          cwd={leafAt.cwd}
                          startup={leafAt.startup}
                          windowsBuild={props.info.windowsBuild}
                          look={props.look}
                          suggest={props.store.settings().terminal.suggest}
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
                            // Clean exit (for example `exit`): the pane closes, like Windows Terminal.
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
                      title={t("Arrastrar para cambiar el tamaño · doble clic: mitad y mitad")}
                      onPointerDown={(e) => startDrag(tabId, area, e)}
                      onDblClick={() => update((x) => M.setRatio(x, tabId, area.id, 0.5))}
                    />
                  )}
                </For>
                <Show when={dropHint()?.tabId === tabId && dropHint()}>
                  {(h) => (
                    <div
                      class="pane-drop"
                      classList={{ center: h().center }}
                      style={{ left: pct(h().rect.x), top: pct(h().rect.y), width: pct(h().rect.w), height: pct(h().rect.h) }}
                    />
                  )}
                </Show>
              </div>
            );
          }}
        </For>
      </main>
      <Show when={dock().cols.length > 0}>
        <aside class="dock" classList={{ dragging: !!dragPanel() }}>
          <For each={dock().cols.map((c) => c.id)}>
            {(colId, ci) => {
              const col = () => dock().cols.find((c) => c.id === colId);
              return (
                <>
                  <div class="dock-drop" onDragOver={(e) => e.preventDefault()} onDrop={() => dropOn({ kind: "newCol", index: ci() })} title={t("Soltar acá: columna nueva")} />
                  <div class="dock-col" style={{ width: `${col()?.width ?? D.DEFAULT_W}px` }}>
                    <div class="dock-col-resize" onPointerDown={(e) => startColDrag(colId, e)} title={t("Arrastrar para cambiar el ancho")} />
                    <For each={col()?.panels.map((p) => p.id) ?? []}>
                      {(pid, pi) => {
                        const size = () => col()?.panels.find((p) => p.id === pid)?.size ?? 1;
                        return (
                          <>
                            <Show when={pi() > 0}>
                              <div class="dock-split" onPointerDown={(e) => startSplitDrag(colId, pi() - 1, e)} title={t("Arrastrar para cambiar el alto")} />
                            </Show>
                            <section
                              class="dock-panel"
                              classList={{ dragged: dragPanel() === pid }}
                              style={{ "flex-grow": String(size()) }}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => {
                                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                dropOn({ kind: "panel", target: pid, after: e.clientY > r.top + r.height / 2 });
                              }}
                            >
                              <header
                                class="dock-head"
                                draggable={true}
                                onDragStart={(e) => {
                                  setDragPanel(pid);
                                  e.dataTransfer?.setData("text/plain", pid);
                                }}
                                onDragEnd={() => setDragPanel(null)}
                                title={t("Arrastrar para mover el panel")}
                              >
                                <span class="grip">⋮⋮</span>
                                <b>{t(PANEL_LABEL[pid])}</b>
                                <button class="icon-btn tiny-x" title={t("Cerrar el panel")} onClick={() => setDock(D.closePanel(dock(), pid))}>
                                  ×
                                </button>
                              </header>
                              <div class="dock-body">
                                <Suspense>{renderPanel(pid)}</Suspense>
                              </div>
                            </section>
                          </>
                        );
                      }}
                    </For>
                  </div>
                </>
              );
            }}
          </For>
          <div class="dock-drop end" onDragOver={(e) => e.preventDefault()} onDrop={() => dropOn({ kind: "newCol", index: dock().cols.length })} title={t("Soltar acá: columna nueva")} />
        </aside>
      </Show>
      <ActivityBar isOpen={panelOpen} onToggle={togglePanel} help={shortcutHelp(settings().shortcuts)} />
      </div>
      <Show when={settingsOpen()}>
        <div class="settings-overlay">
          <Suspense>
            <SettingsView
              info={props.info}
              store={props.store}
              onClose={() => {
                closeSettings();
                const id = activePaneId();
                if (id) setTimeout(() => handles.get(id)?.focus(), 0);
              }}
            />
          </Suspense>
        </div>
      </Show>
    </div>
    <Show when={paneMenu()}>
      {(m) => (
        <PaneMenu
          x={m().x}
          y={m().y}
          onSplit={(d) => splitAt(m().tabId, m().paneId, d)}
          onEqualize={() => update((x) => M.equalize(x, m().tabId))}
          onClose={() => askClose(m().tabId, m().paneId)}
          onDismiss={() => setPaneMenu(null)}
        />
      )}
    </Show>
    <GuardianModal />
    <ConfirmModal />
    <UsageFooter
      usage={settings().usage}
      onSettings={() => void openSettings()}
      cwd={activeCwd()}
      branch={activePaneId() ? panes[activePaneId()!]?.branch : undefined}
      activeProvider={activeProvider()}
    />
    </div>
  );
}
