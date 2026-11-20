import { createMemo, createSignal, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import type { Recipe, Settings } from "../settings/schema";
import { fmtUptime, isRunning, recipeFor, urlFor, type PaneRef, type Server } from "./servers";

interface Props {
  servers: Server[];
  loading: boolean;
  error: string | null;
  /** Pestaña de cada shell (por PID). */
  paneOf: (shellPid: number | null) => PaneRef | undefined;
  recipes: Recipe[];
  update: (f: (d: Settings) => void) => void;
  onRefresh: () => void;
  onStart: (r: Recipe) => void;
  onFocus: (tabId: string, paneId: string) => void;
  /** Abrir la URL en el navegador integrado (al lado de la pestaña donde nació, si se sabe). */
  onBrowse?: (url: string, pane?: PaneRef) => void;
}

const FILTER_PREF = "alphaterm.servers.filter";
type Filter = "all" | "alphaterm";

export default function ServersPanel(props: Props) {
  const readFilter = (): Filter => {
    try {
      return localStorage.getItem(FILTER_PREF) === "alphaterm" ? "alphaterm" : "all";
    } catch {
      return "all";
    }
  };
  const [filter, setFilterRaw] = createSignal<Filter>(readFilter());
  const setFilter = (f: Filter) => {
    setFilterRaw(f);
    try {
      localStorage.setItem(FILTER_PREF, f);
    } catch {
      /* no importa */
    }
  };
  const [showSystem, setShowSystem] = createSignal(false);
  const [msg, setMsg] = createSignal<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = createSignal<string | null>(null);

  const visible = createMemo(() =>
    props.servers.filter((s) => (filter() === "alphaterm" ? s.shellPid !== null : showSystem() || !s.system || s.shellPid !== null)),
  );
  const hiddenSystem = () => props.servers.filter((s) => s.system && s.shellPid === null).length;

  const stop = async (s: Server, restart?: Recipe) => {
    const ours = s.shellPid !== null;
    const what = `${s.name} (PID ${s.pid}, puerto ${s.ports.join(", ")})`;
    const question = ours
      ? `¿Detener ${what}? Se corta ese proceso y lo que cuelga de él.`
      : `${what} no lo lanzó AlphaTerm.\n\n¿Detenerlo igual? Se corta ese proceso y lo que cuelga de él; si es de otro programa, ese programa puede fallar.`;
    if (!confirm(question)) return;
    try {
      await invoke<string>("ports_kill", { pid: s.pid });
      setMsg({ ok: true, text: `Se detuvo ${s.name}.` });
      if (restart) setTimeout(() => props.onStart(restart), 800);
    } catch (e) {
      setMsg({ ok: false, text: `No se pudo detener ${s.name}: ${e}` });
    }
    setTimeout(props.onRefresh, 500);
  };

  const setRecipe = (id: string, f: (r: Recipe) => void) =>
    props.update((d) => {
      const r = d.recipes.find((x) => x.id === id);
      if (r) f(r);
    });

  const addRecipe = async () => {
    const dir = await open({ directory: true, title: "Carpeta del servidor" });
    if (typeof dir !== "string") return;
    const id = `m${Date.now().toString(36)}`;
    props.update((d) => void d.recipes.push({ id, name: "Servidor nuevo", command: "npm run dev", cwd: dir, env: {}, ports: [], auto: false }));
    setEditing(id);
  };

  return (
    <div class="panel servers-panel">
      <header class="panel-head">
        <h2>Servidores</h2>
        <button class="icon-btn" classList={{ spin: props.loading }} title="Actualizar" onClick={props.onRefresh}>
          ↻
        </button>
      </header>
      <div class="segmented small">
        <button classList={{ on: filter() === "all" }} onClick={() => setFilter("all")}>
          Todos
        </button>
        <button classList={{ on: filter() === "alphaterm" }} onClick={() => setFilter("alphaterm")}>
          De AlphaTerm
        </button>
      </div>
      <Show when={msg()}>
        <div class="banner" classList={{ ok: msg()!.ok }} onClick={() => setMsg(null)}>
          {msg()!.text}
        </div>
      </Show>
      <Show when={props.error}>
        <div class="banner">{props.error}</div>
      </Show>

      <ul class="server-list">
        <For each={visible()} fallback={<li class="muted small">{props.loading ? "Buscando…" : "Nada escuchando."}</li>}>
          {(s) => {
            const pane = () => props.paneOf(s.shellPid);
            const recipe = () => recipeFor(s, props.recipes);
            return (
              <li class="server" classList={{ ours: s.shellPid !== null, system: s.system }}>
                <div class="server-top">
                  <span class="ports">
                    <For each={s.ports}>
                      {(p) => (
                        <button class="port" title={`Abrir ${urlFor(s, p)} en el navegador`} onClick={() => void openUrl(urlFor(s, p))}>
                          :{p}
                        </button>
                      )}
                    </For>
                  </span>
                  <b class="server-name" title={s.cmdline || s.name}>
                    {s.name}
                  </b>
                  <Show when={s.shellPid !== null}>
                    <span class="badge nt" title="Nació en una pestaña de AlphaTerm">
                      AlphaTerm
                    </span>
                  </Show>
                </div>
                <small class="server-meta" title={`${s.cmdline}\n${s.cwd ?? ""}\nEscucha en ${s.addrs.join(", ")}`}>
                  PID {s.pid} · {fmtUptime(s.uptime)}
                  {s.cwd ? ` · ${s.cwd}` : ""}
                </small>
                <div class="server-actions">
                  <Show when={props.onBrowse && s.ports.length > 0}>
                    <button
                      class="link"
                      title={`Abrir ${urlFor(s, s.ports[0])} en el navegador de AlphaTerm${pane() ? ", al lado de su pestaña" : ""} (para verlo, marcar elementos y pedirle cambios al agente)`}
                      onClick={() => props.onBrowse!(urlFor(s, s.ports[0]), pane())}
                    >
                      Abrir en el navegador
                    </button>
                  </Show>
                  <Show when={pane()}>
                    <button class="link" onClick={() => props.onFocus(pane()!.tabId, pane()!.paneId)}>
                      Ir a la pestaña
                    </button>
                  </Show>
                  <Show when={recipe()}>
                    <button class="link" title={`Detener y volver a iniciar con: ${recipe()!.command}`} onClick={() => void stop(s, recipe())}>
                      Reiniciar
                    </button>
                  </Show>
                  <button class="link danger" disabled={s.pid <= 4} onClick={() => void stop(s)}>
                    Detener
                  </button>
                </div>
              </li>
            );
          }}
        </For>
      </ul>
      <Show when={filter() === "all" && hiddenSystem() > 0}>
        <button class="link small" onClick={() => setShowSystem(!showSystem())}>
          {showSystem() ? "Esconder los del sistema" : `Ver los del sistema (${hiddenSystem()})`}
        </button>
      </Show>

      <h3>Recetas</h3>
      <p class="muted small">
        Se guardan solas cuando un servidor nace en una pestaña (comando + carpeta). Un proceso externo sin receta se puede detener, pero no
        iniciar: no se sabe con qué comando arrancó.
      </p>
      <ul class="recipe-list">
        <For each={props.recipes} fallback={<li class="muted small">Todavía no hay recetas.</li>}>
          {(r) => (
            <>
              <li class="recipe">
                <span class={`state ${isRunning(r, props.servers) ? "st-working" : "st-starting"}`} />
                <div class="agent-info">
                  <b title={r.command}>{r.name}</b>
                  <small title={r.cwd}>
                    {r.ports.length ? `:${r.ports.join(" :")} · ` : ""}
                    {r.cwd}
                    {r.auto ? " · vista" : ""}
                  </small>
                </div>
                <button class="btn" disabled={isRunning(r, props.servers)} onClick={() => props.onStart(r)} title={`Abre una pestaña de fondo y corre: ${r.command}`}>
                  Iniciar
                </button>
                <button class="icon-btn" title="Editar" onClick={() => setEditing(editing() === r.id ? null : r.id)}>
                  ✎
                </button>
              </li>
              <Show when={editing() === r.id}>
                <li class="agent-edit">
                  <label>
                    Nombre
                    <input class="text" value={r.name} onChange={(e) => setRecipe(r.id, (x) => void (x.name = e.currentTarget.value))} />
                  </label>
                  <label>
                    Comando
                    <input class="text mono" value={r.command} spellcheck={false} onChange={(e) => setRecipe(r.id, (x) => void (x.command = e.currentTarget.value))} />
                  </label>
                  <label>
                    Carpeta
                    <input class="text mono" value={r.cwd} spellcheck={false} onChange={(e) => setRecipe(r.id, (x) => void (x.cwd = e.currentTarget.value))} />
                  </label>
                  <label>
                    Puertos (separados por coma)
                    <input
                      class="text mono"
                      value={r.ports.join(", ")}
                      onChange={(e) =>
                        setRecipe(r.id, (x) => {
                          x.ports = e.currentTarget.value
                            .split(/[,\s]+/)
                            .map(Number)
                            .filter((p) => Number.isInteger(p) && p > 0 && p < 65536);
                          x.auto = false;
                        })
                      }
                    />
                  </label>
                  <div class="row-actions">
                    <button
                      class="link danger"
                      onClick={() => {
                        if (!confirm(`¿Borrar la receta "${r.name}"?`)) return;
                        props.update((d) => void (d.recipes = d.recipes.filter((x) => x.id !== r.id)));
                        setEditing(null);
                      }}
                    >
                      Borrar
                    </button>
                    <button class="link" onClick={() => setEditing(null)}>
                      Listo
                    </button>
                  </div>
                </li>
              </Show>
            </>
          )}
        </For>
      </ul>
      <div class="panel-actions">
        <button class="link" onClick={() => void addRecipe()}>
          + Agregar una receta a mano
        </button>
      </div>
    </div>
  );
}
