import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { AgentDef, Settings } from "../settings/schema";
import { fmtBytes } from "../widgets/format";
import { mergeProjects, projectName, type Found, type Project } from "./projects";

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

  // Árbol: carpetas abiertas y su contenido (se carga al abrir).
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
      // Cerrar también lo que cuelga de ella.
      setOpenDirs(openDirs().filter((d) => d !== dir && !d.startsWith(dir + "\\")));
    } else {
      setOpenDirs([...openDirs(), dir]);
      void load(dir);
    }
  };
  // Vigilante: el backend avisa qué carpetas cambiaron; se recargan las que estén abiertas.
  let watchTimer: ReturnType<typeof setTimeout> | undefined;
  const syncWatch = () => {
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => void invoke("fs_watch", { dirs: openDirs() }).catch(() => {}), 200);
  };
  onMount(async () => {
    const pending = new Set<string>();
    let t: ReturnType<typeof setTimeout> | undefined;
    const un = await listen<{ dirs: string[] }>("fs-changed", (e) => {
      for (const d of e.payload.dirs) if (openDirs().some((o) => o.toLowerCase() === d.toLowerCase())) pending.add(openDirs().find((o) => o.toLowerCase() === d.toLowerCase())!);
      clearTimeout(t);
      t = setTimeout(() => {
        pending.forEach((d) => void load(d));
        pending.clear();
      }, 300);
    });
    onCleanup(() => {
      un();
      clearTimeout(t);
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
    const dir = await open({ directory: true, title: "Agregar un proyecto" });
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

  function Tree(tp: { dir: string; depth: number }) {
    const list = () => children[tp.dir];
    return (
      <Show when={list() !== undefined}>
        <Show when={list() !== "loading"} fallback={<div class="tree-row muted" style={{ "padding-left": `${tp.depth * 14 + 22}px` }}>…</div>}>
          <Show
            when={Array.isArray(list())}
            fallback={<div class="tree-row err" style={{ "padding-left": `${tp.depth * 14 + 22}px` }}>{(list() as { error: string }).error}</div>}
          >
            <For each={list() as Entry[]} fallback={<div class="tree-row muted" style={{ "padding-left": `${tp.depth * 14 + 22}px` }}>(vacía)</div>}>
              {(e) => (
                <>
                  <div
                    class="tree-row"
                    classList={{ dir: e.dir }}
                    style={{ "padding-left": `${tp.depth * 14 + 8}px` }}
                    title={e.dir ? e.path : `${e.path}\n${fmtBytes(e.size)} · doble clic para abrir`}
                    onClick={() => e.dir && toggleAndWatch(e.path)}
                    onDblClick={() => !e.dir && openWith(e.path, "default")}
                  >
                    <span class="caret">{e.dir ? (isOpen(e.path) ? "▾" : "▸") : ""}</span>
                    <span class="tree-name">{e.name}</span>
                    <Show when={e.dir}>
                      <button
                        class="icon-btn tiny"
                        title="Terminal acá"
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
        <h2>Proyectos</h2>
        <span>
          <button class="icon-btn" title="Agregar una carpeta" onClick={() => void addManual()}>
            +
          </button>
          <button class="icon-btn" classList={{ spin: found.loading }} title="Volver a buscar" onClick={() => void refetch()}>
            ↻
          </button>
        </span>
      </header>
      <input class="text" placeholder="Filtrar…" value={query()} onInput={(e) => setQuery(e.currentTarget.value)} />
      <Show when={found.error}>
        <div class="banner">{String(found.error)}</div>
      </Show>
      <ul class="project-list">
        <For each={visible()} fallback={<li class="muted small">{found.loading ? "Buscando proyectos…" : "Nada para mostrar."}</li>}>
          {(p) => (
            <li class="project" classList={{ missing: !p.exists, hidden: p.hidden }}>
              <div class="project-row" onClick={() => p.exists && toggleAndWatch(p.path)} title={p.path}>
                <span class="caret">{p.exists ? (isOpen(p.path) ? "▾" : "▸") : "✕"}</span>
                <div class="agent-info">
                  <b>{projectName(p.path)}</b>
                  <small>{p.path}</small>
                </div>
                <span class="project-badges">
                  <For each={p.sources}>{(s) => <span class="badge" title={`Visto en ${s}`}>{s === "claude" ? "Claude" : s === "codex" ? "Codex" : s === "manual" ? "★" : "reciente"}</span>}</For>
                  <Show when={p.git}>
                    <span class="badge git">git</span>
                  </Show>
                </span>
              </div>
              <Show when={p.exists}>
                <div class="project-actions">
                  <button class="link" onClick={() => props.onTerminal(p.path)}>
                    Terminal
                  </button>
                  <span class="agent-pick">
                    <button class="link" onClick={() => setAgentMenu(agentMenu() === p.path ? null : p.path)}>
                      Agente ▾
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
                    Explorador
                  </button>
                  <button class="link" onClick={() => openWith(p.path, "vscode")}>
                    VS Code
                  </button>
                  <Show when={p.git}>
                    <button class="link" onClick={() => props.onGit(p.path)}>
                      Git
                    </button>
                  </Show>
                  <button class="link muted" title={p.hidden ? "Volver a mostrar" : "Ocultar de la lista"} onClick={() => setHidden(p, !p.hidden)}>
                    {p.hidden ? "Mostrar" : "Ocultar"}
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
          {showHidden() ? "Esconder los ocultos" : `Ver los ocultos (${props.hidden.length})`}
        </button>
      </Show>
      <p class="muted small hint">Salen de las sesiones de Claude Code y Codex, de las carpetas donde lanzaste agentes y de las que agregues con +.</p>
    </div>
  );
}
