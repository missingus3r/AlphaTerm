import { createMemo, createSignal, For, Show } from "solid-js";
import { askConfirm } from "../widgets/confirm";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import type { Recipe, Settings } from "../settings/schema";
import { fmtUptime, isRunning, recipeFor, urlFor, type PaneRef, type Server } from "./servers";
import { t } from "../i18n";

interface Props {
  servers: Server[];
  loading: boolean;
  error: string | null;
  /** Tab of each shell (by PID). */
  paneOf: (shellPid: number | null) => PaneRef | undefined;
  recipes: Recipe[];
  update: (f: (d: Settings) => void) => void;
  onRefresh: () => void;
  onStart: (r: Recipe) => void;
  onFocus: (tabId: string, paneId: string) => void;
  /** Open the URL in the built-in browser (next to the tab where it started, if known). */
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
      /* doesn't matter */
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
    const what = t("{name} (PID {pid}, puerto {ports})", { name: s.name, pid: s.pid, ports: s.ports.join(", ") });
    const question = ours
      ? t("¿Detener {what}? Se corta ese proceso y lo que cuelga de él.", { what })
      : t("{what} no lo lanzó AlphaTerm.\n\n¿Detenerlo igual? Se corta ese proceso y lo que cuelga de él; si es de otro programa, ese programa puede fallar.", { what });
    if (!(await askConfirm(question, t("Detener")))) return;
    try {
      await invoke<string>("ports_kill", { pid: s.pid });
      setMsg({ ok: true, text: t("Se detuvo {name}.", { name: s.name }) });
      if (restart) setTimeout(() => props.onStart(restart), 800);
    } catch (e) {
      setMsg({ ok: false, text: t("No se pudo detener {name}: {error}", { name: s.name, error: String(e) }) });
    }
    setTimeout(props.onRefresh, 500);
  };

  const setRecipe = (id: string, f: (r: Recipe) => void) =>
    props.update((d) => {
      const r = d.recipes.find((x) => x.id === id);
      if (r) f(r);
    });

  const addRecipe = async () => {
    const dir = await open({ directory: true, title: t("Carpeta del servidor") });
    if (typeof dir !== "string") return;
    const id = `m${Date.now().toString(36)}`;
    // The name is for display only (it can be changed): it stays in the language in use when it was created.
    props.update((d) => void d.recipes.push({ id, name: t("Servidor nuevo"), command: "npm run dev", cwd: dir, env: {}, ports: [], auto: false }));
    setEditing(id);
  };

  return (
    <div class="panel servers-panel">
      <header class="panel-head">
        <h2>{t("Servidores")}</h2>
        <button class="icon-btn" classList={{ spin: props.loading }} title={t("Actualizar")} onClick={props.onRefresh}>
          ↻
        </button>
      </header>
      <div class="segmented small">
        <button classList={{ on: filter() === "all" }} onClick={() => setFilter("all")}>
          {t("Todos")}
        </button>
        <button classList={{ on: filter() === "alphaterm" }} onClick={() => setFilter("alphaterm")}>
          {t("De AlphaTerm")}
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
        <For each={visible()} fallback={<li class="muted small">{props.loading ? t("Buscando…") : t("Nada escuchando.")}</li>}>
          {(s) => {
            const pane = () => props.paneOf(s.shellPid);
            const recipe = () => recipeFor(s, props.recipes);
            return (
              <li class="server" classList={{ ours: s.shellPid !== null, system: s.system }}>
                <div class="server-top">
                  <span class="ports">
                    <For each={s.ports}>
                      {(p) => (
                        <button class="port" title={t("Abrir {url} en el navegador", { url: urlFor(s, p) })} onClick={() => void openUrl(urlFor(s, p))}>
                          :{p}
                        </button>
                      )}
                    </For>
                  </span>
                  <b class="server-name" title={s.cmdline || s.name}>
                    {s.name}
                  </b>
                  <Show when={s.shellPid !== null}>
                    <span class="badge nt" title={t("Nació en una pestaña de AlphaTerm")}>
                      AlphaTerm
                    </span>
                  </Show>
                </div>
                <small class="server-meta" title={`${s.cmdline}\n${s.cwd ?? ""}\n${t("Escucha en {addrs}", { addrs: s.addrs.join(", ") })}`}>
                  PID {s.pid} · {fmtUptime(s.uptime)}
                  {s.cwd ? ` · ${s.cwd}` : ""}
                </small>
                <div class="server-actions">
                  <Show when={props.onBrowse && s.ports.length > 0}>
                    <button
                      class="link"
                      title={
                        pane()
                          ? t("Abrir {url} en el navegador de AlphaTerm, al lado de su pestaña (para verlo, marcar elementos y pedirle cambios al agente)", { url: urlFor(s, s.ports[0]) })
                          : t("Abrir {url} en el navegador de AlphaTerm (para verlo, marcar elementos y pedirle cambios al agente)", { url: urlFor(s, s.ports[0]) })
                      }
                      onClick={() => props.onBrowse!(urlFor(s, s.ports[0]), pane())}
                    >
                      {t("Abrir en el navegador")}
                    </button>
                  </Show>
                  <Show when={pane()}>
                    <button class="link" onClick={() => props.onFocus(pane()!.tabId, pane()!.paneId)}>
                      {t("Ir a la pestaña")}
                    </button>
                  </Show>
                  <Show when={recipe()}>
                    <button class="link" title={t("Detener y volver a iniciar con: {command}", { command: recipe()!.command })} onClick={() => void stop(s, recipe())}>
                      {t("Reiniciar")}
                    </button>
                  </Show>
                  <button class="link danger" disabled={s.pid <= 4} onClick={() => void stop(s)}>
                    {t("Detener")}
                  </button>
                </div>
              </li>
            );
          }}
        </For>
      </ul>
      <Show when={filter() === "all" && hiddenSystem() > 0}>
        <button class="link small" onClick={() => setShowSystem(!showSystem())}>
          {showSystem() ? t("Esconder los del sistema") : t("Ver los del sistema ({n})", { n: hiddenSystem() })}
        </button>
      </Show>

      <h3>{t("Recetas")}</h3>
      <p class="muted small">
        {t("Se guardan solas cuando un servidor nace en una pestaña (comando + carpeta). Un proceso externo sin receta se puede detener, pero no iniciar: no se sabe con qué comando arrancó.")}
      </p>
      <ul class="recipe-list">
        <For each={props.recipes} fallback={<li class="muted small">{t("Todavía no hay recetas.")}</li>}>
          {(r) => (
            <>
              <li class="recipe">
                <span class={`state ${isRunning(r, props.servers) ? "st-working" : "st-starting"}`} />
                <div class="agent-info">
                  <b title={r.command}>{r.name}</b>
                  <small title={r.cwd}>
                    {r.ports.length ? `:${r.ports.join(" :")} · ` : ""}
                    {r.cwd}
                    {r.auto ? ` · ${t("vista")}` : ""}
                  </small>
                </div>
                <button class="btn" disabled={isRunning(r, props.servers)} onClick={() => props.onStart(r)} title={t("Abre una pestaña de fondo y corre: {command}", { command: r.command })}>
                  {t("Iniciar")}
                </button>
                <button class="icon-btn" title={t("Editar")} onClick={() => setEditing(editing() === r.id ? null : r.id)}>
                  ✎
                </button>
              </li>
              <Show when={editing() === r.id}>
                <li class="agent-edit">
                  <label>
                    {t("Nombre")}
                    <input class="text" value={r.name} onChange={(e) => setRecipe(r.id, (x) => void (x.name = e.currentTarget.value))} />
                  </label>
                  <label>
                    {t("Comando")}
                    <input class="text mono" value={r.command} spellcheck={false} onChange={(e) => setRecipe(r.id, (x) => void (x.command = e.currentTarget.value))} />
                  </label>
                  <label>
                    {t("Carpeta")}
                    <input class="text mono" value={r.cwd} spellcheck={false} onChange={(e) => setRecipe(r.id, (x) => void (x.cwd = e.currentTarget.value))} />
                  </label>
                  <label>
                    {t("Puertos (separados por coma)")}
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
                      onClick={async () => {
                        if (!(await askConfirm(t('¿Borrar la receta "{name}"?', { name: r.name }), t("Borrar")))) return;
                        props.update((d) => void (d.recipes = d.recipes.filter((x) => x.id !== r.id)));
                        setEditing(null);
                      }}
                    >
                      {t("Borrar")}
                    </button>
                    <button class="link" onClick={() => setEditing(null)}>
                      {t("Listo")}
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
          {t("+ Agregar una receta a mano")}
        </button>
      </div>
    </div>
  );
}
