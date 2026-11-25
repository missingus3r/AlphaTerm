import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { AgentDef, Settings } from "../settings/schema";
import { fmtBytes } from "../widgets/format";
import { mergeProjects, projectName, type Found, type Project } from "./projects";
import { t } from "../i18n";
import { isInside, isWindows } from "../platform";

interface Entry {
  name: string;
  path: string;
  dir: boolean;
  size: number;
}

interface Props {
  manual: string[];
  hidden: string[];
  recentDirs: string[];
  agents: AgentDef[];
  update: (f: (d: Settings) => void) => void;
  onTerminal: (dir: string) => void;
  onAgent: (agent: AgentDef, dir: string) => void;
  onGit: (dir: string) => void;
}

export default function ProjectsPanel(props: Props) {
  const [found, { refetch }] = createResource(() => invoke<Found[]>("projects_discover"));
  const [query, setQuery] = createSignal("");
  const [showHidden, setShowHidden] = createSignal(false);
  const projects = createMemo(() => mergeProjects(found() ?? [], props.manual, props.recentDirs, props.hidden));
  const visible = createMemo(() => {
    const q = query().trim().toLowerCase();
    return projects().filter((p) => (showHidden() || !p.hidden) && (!q || p.path.toLowerCase().includes(q)));
  });

  // Tree: open folders and their contents (loaded on open).
  const [children, setChildren] = createStore<Record<string, Entry[] | "loading" | { error: string }>>({});
  const [openDirs, setOpenDirs] = createSignal<string[]>([]);
  const load = async (dir: string) => {
    if (!children[dir]) setChildren(dir, "loading");
    try {
      setChildren(dir, await invoke<Entry[]>("fs_list", { dir }));
    } catch (e) {
      setChildren(dir, { error: String(e) });
    }
  };
  const toggle = (dir: string) => {
    if (openDirs().includes(dir)) {
      // Also close whatever hangs from it.
      setOpenDirs(openDirs().filter((d) => d !== dir && !isInside(d, dir)));
    } else {
      setOpenDirs([...openDirs(), dir]);
      void load(dir);
    }
  };
  // Watcher: the backend reports which folders changed; the open ones are reloaded.
  let watchTimer: ReturnType<typeof setTimeout> | undefined;
  const syncWatch = () => {
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => void invoke("fs_watch", { dirs: openDirs() }).catch(() => {}), 200);
  };
  onMount(async () => {
    const pending = new Set<string>();
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    const un = await listen<{ dirs: string[] }>("fs-changed", (e) => {
      for (const d of e.payload.dirs) if (openDirs().some((o) => o.toLowerCase() === d.toLowerCase())) pending.add(openDirs().find((o) => o.toLowerCase() === d.toLowerCase())!);
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        pending.forEach((d) => void load(d));
        pending.clear();
      }, 300);
    });
    onCleanup(() => {
      un();
      clearTimeout(reloadTimer);
      clearTimeout(watchTimer);
      void invoke("fs_watch", { dirs: [] }).catch(() => {});
    });
  });
  const isOpen = (d: string) => openDirs().includes(d);
  const toggleAndWatch = (d: string) => {
    toggle(d);
    syncWatch();
  };

  const addManual = async () => {
    const dir = await open({ directory: true, title: t("Agregar un proyecto") });
    if (typeof dir === "string") props.update((s) => void (s.projects.manual = [...new Set([...s.projects.manual, dir])]));
  };
  const setHidden = (p: Project, hide: boolean) =>
    props.update((s) => {
      s.projects.hidden = hide ? [...new Set([...s.projects.hidden, p.path])] : s.projects.hidden.filter((h) => h.toLowerCase() !== p.path.toLowerCase());
      if (!hide) return;
      s.projects.manual = s.projects.manual.filter((m) => m.toLowerCase() !== p.path.toLowerCase());
    });

  const [agentMenu, setAgentMenu] = createSignal<string | null>(null);
  const openWith = (path: string, how: string) => void invoke("fs_open", { path, with: how }).catch((e) => alert(String(e)));
  // Visible name of each source ("manual" and "reciente" are ids, they aren't shown as they are).
  const sourceTitle = (s: string) =>
    s === "manual" ? t("Agregado a mano") : s === "reciente" ? t("Carpeta usada hace poco") : t("Visto en {source}", { source: s === "claude" ? "Claude" : s === "codex" ? "Codex" : s });

  function Tree(tp: { dir: string; depth: number }) {
    const list = () => children[tp.dir];
    return (
      <Show when={list() !== undefined}>
        <Show when={list() !== "loading"} fallback={<div class="tree-row muted" style={{ "padding-left": `${tp.depth * 14 + 22}px` }}>…</div>}>
          <Show
            when={Array.isArray(list())}
            fallback={<div class="tree-row err" style={{ "padding-left": `${tp.depth * 14 + 22}px` }}>{(list() as { error: string }).error}</div>}
          >
            <For each={list() as Entry[]} fallback={<div class="tree-row muted" style={{ "padding-left": `${tp.depth * 14 + 22}px` }}>{t("(vacía)")}</div>}>
              {(e) => (
                <>
                  <div
                    class="tree-row"
                    classList={{ dir: e.dir }}
                    style={{ "padding-left": `${tp.depth * 14 + 8}px` }}
                    title={e.dir ? e.path : `${e.path}\n${t("{size} · doble clic para abrir", { size: fmtBytes(e.size) })}`}
                    onClick={() => e.dir && toggleAndWatch(e.path)}
                    onDblClick={() => !e.dir && openWith(e.path, "default")}
                  >
                    <span class="caret">{e.dir ? (isOpen(e.path) ? "▾" : "▸") : ""}</span>
                    <span class="tree-name">{e.name}</span>
                    <Show when={e.dir}>
                      <button
                        class="icon-btn tiny"
                        title={t("Terminal acá")}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          props.onTerminal(e.path);
                        }}
                      >
                        ⌨
                      </button>
                    </Show>
                  </div>
                  <Show when={e.dir && isOpen(e.path)}>
                    <Tree dir={e.path} depth={tp.depth + 1} />
                  </Show>
                </>
              )}
            </For>
          </Show>
        </Show>
      </Show>
    );
  }

  return (
    <div class="panel projects-panel">
      <header class="panel-head">
        <h2>{t("Proyectos")}</h2>
        <span>
          <button class="icon-btn" title={t("Agregar una carpeta")} onClick={() => void addManual()}>
            +
          </button>
          <button class="icon-btn" classList={{ spin: found.loading }} title={t("Volver a buscar")} onClick={() => void refetch()}>
            ↻
          </button>
        </span>
      </header>
      <input class="text" placeholder={t("Filtrar…")} value={query()} onInput={(e) => setQuery(e.currentTarget.value)} />
      <Show when={found.error}>
        <div class="banner">{String(found.error)}</div>
      </Show>
      <ul class="project-list">
        <For each={visible()} fallback={<li class="muted small">{found.loading ? t("Buscando proyectos…") : t("Nada para mostrar.")}</li>}>
          {(p) => (
            <li class="project" classList={{ missing: !p.exists, hidden: p.hidden }}>
              <div class="project-row" onClick={() => p.exists && toggleAndWatch(p.path)} title={p.path}>
                <span class="caret">{p.exists ? (isOpen(p.path) ? "▾" : "▸") : "✕"}</span>
                <div class="agent-info">
                  <b>{projectName(p.path)}</b>
                  <small>{p.path}</small>
                </div>
                <span class="project-badges">
                  <For each={p.sources}>{(s) => <span class="badge" title={sourceTitle(s)}>{s === "claude" ? "Claude" : s === "codex" ? "Codex" : s === "manual" ? "★" : t("reciente")}</span>}</For>
                  <Show when={p.git}>
                    <span class="badge git">git</span>
                  </Show>
                </span>
              </div>
              <Show when={p.exists}>
                <div class="project-actions">
                  <button class="link" onClick={() => props.onTerminal(p.path)}>
                    {t("Terminal")}
                  </button>
                  <span class="agent-pick">
                    <button class="link" onClick={() => setAgentMenu(agentMenu() === p.path ? null : p.path)}>
                      {t("Agente")} ▾
                    </button>
                    <Show when={agentMenu() === p.path}>
                      <span class="menu">
                        <For each={props.agents.filter((a) => !a.hidden)}>
                          {(a) => (
                            <button
                              onClick={() => {
                                setAgentMenu(null);
                                props.onAgent(a, p.path);
                              }}
                            >
                              {a.name}
                            </button>
                          )}
                        </For>
                      </span>
                    </Show>
                  </span>
                  <button class="link" onClick={() => openWith(p.path, "explorer")}>
                    {isWindows() ? t("Explorador") : t("Archivos")}
                  </button>
                  <button class="link" onClick={() => openWith(p.path, "vscode")}>
                    VS Code
                  </button>
                  <Show when={p.git}>
                    <button class="link" onClick={() => props.onGit(p.path)}>
                      Git
                    </button>
                  </Show>
                  <button class="link muted" title={p.hidden ? t("Volver a mostrar") : t("Ocultar de la lista")} onClick={() => setHidden(p, !p.hidden)}>
                    {p.hidden ? t("Mostrar") : t("Ocultar")}
                  </button>
                </div>
              </Show>
              <Show when={isOpen(p.path)}>
                <div class="tree">
                  <Tree dir={p.path} depth={0} />
                </div>
              </Show>
            </li>
          )}
        </For>
      </ul>
      <Show when={props.hidden.length > 0}>
        <button class="link small" onClick={() => setShowHidden(!showHidden())}>
          {showHidden() ? t("Esconder los ocultos") : t("Ver los ocultos ({n})", { n: props.hidden.length })}
        </button>
      </Show>
      <p class="muted small hint">{t("Salen de las sesiones de Claude Code y Codex, de las carpetas donde lanzaste agentes y de las que agregues con +.")}</p>
    </div>
  );
}
