import { createEffect, createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { askConfirm } from "../widgets/confirm";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { DockerPreset, Settings } from "../settings/schema";
import { envToText, parseEnvText } from "./agentState";
import { t } from "../i18n";

interface Engine {
  installed: boolean;
  running: boolean;
  version: string | null;
  error: string | null;
  desktop: boolean;
}
interface Container {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  created: string;
}

/** Templates to get started quickly (copied to "Mis contenedores" and can be edited). */
export const TEMPLATES: DockerPreset[] = [
  { name: "postgres", image: "postgres:16", ports: ["5432:5432"], env: { POSTGRES_PASSWORD: "postgres" }, volumes: ["alphaterm-pg:/var/lib/postgresql/data"], command: "" },
  { name: "redis", image: "redis:7", ports: ["6379:6379"], env: {}, volumes: [], command: "" },
  { name: "mysql", image: "mysql:8", ports: ["3306:3306"], env: { MYSQL_ROOT_PASSWORD: "root" }, volumes: ["alphaterm-mysql:/var/lib/mysql"], command: "" },
  { name: "mongo", image: "mongo:7", ports: ["27017:27017"], env: {}, volumes: ["alphaterm-mongo:/data/db"], command: "" },
  { name: "nginx", image: "nginx:alpine", ports: ["8080:80"], env: {}, volumes: [], command: "" },
];

/** Published ports ("0.0.0.0:5432->5432/tcp, :::5432->5432/tcp") → [5432]. */
export function hostPorts(ports: string): number[] {
  return [...new Set([...ports.matchAll(/:(\d+)->/g)].map((m) => Number(m[1])))];
}

interface Props {
  presets: DockerPreset[];
  update: (f: (d: Settings) => void) => void;
  /** Opens a tab with a command (logs -f, exec). */
  onTerminal: (command: string, title: string) => void;
}

export default function DockerPanel(props: Props) {
  const [engine, { refetch: refetchEngine }] = createResource(() => invoke<Engine>("docker_status"));
  const [list, { refetch }] = createResource(
    () => engine()?.running ?? false,
    (running) => (running ? invoke<Container[]>("docker_containers") : Promise.resolve([] as Container[])),
  );
  const [busy, setBusy] = createSignal<string | null>(null);
  const [msg, setMsg] = createSignal<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = createSignal<string | null>(null);
  const [showTemplates, setShowTemplates] = createSignal(false);

  // While the panel is open it refreshes every 4 s.
  createEffect(() => {
    if (!engine()?.running) return;
    const timer = setInterval(() => !document.hidden && !busy() && void refetch(), 4000);
    onCleanup(() => clearInterval(timer));
  });

  const act = async (label: string, f: () => Promise<string>) => {
    setBusy(label);
    setMsg(null);
    try {
      setMsg({ ok: true, text: (await f()) || t("Listo.") });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setBusy(null);
      void refetch();
    }
  };
  const action = async (c: Container, a: string) => {
    if (a === "rm" && !(await askConfirm(t("¿Borrar el contenedor {name}? Se pierde lo que tenga adentro que no esté en un volumen. No se puede deshacer.", { name: c.name }), t("Borrar")))) return;
    void act(`${a} ${c.name}`, () => invoke<string>("docker_action", { target: c.name, act: a }));
  };
  const startPreset = (p: DockerPreset) => void act(`iniciar ${p.name}`, () => invoke<string>("docker_start_preset", { preset: p }));
  const setPreset = (name: string, f: (p: DockerPreset) => void) =>
    props.update((d) => {
      const p = d.docker.presets.find((x) => x.name === name);
      if (p) f(p);
    });
  const existing = (p: DockerPreset) => (list() ?? []).find((c) => c.name === p.name.toLowerCase().replace(/[^a-z0-9_.-]/g, "-"));

  return (
    <div class="panel docker-panel">
      <header class="panel-head">
        <h2>Docker</h2>
        <button
          class="icon-btn"
          classList={{ spin: !!busy() || engine.loading || list.loading }}
          title={t("Actualizar")}
          onClick={() => {
            void refetchEngine();
            void refetch();
          }}
        >
          ↻
        </button>
      </header>

      <Show when={!engine.loading} fallback={<p class="muted small">{t("Mirando Docker…")}</p>}>
        <Show
          when={engine()?.running}
          fallback={
            <div class="git-empty">
              <p class="muted small">
                {!engine()?.installed ? t("Docker no está instalado (no se encontró docker en el PATH).") : t("El motor de Docker no está corriendo.")}
              </p>
              <Show when={engine()?.desktop}>
                <button
                  class="btn"
                  onClick={() =>
                    void invoke("docker_desktop")
                      .then(() => setMsg({ ok: true, text: t("Abriendo Docker Desktop… tarda unos segundos. Después tocá ↻.") }))
                      .catch((e) => setMsg({ ok: false, text: String(e) }))
                  }
                >
                  {t("Abrir Docker Desktop")}
                </button>
              </Show>
            </div>
          }
        >
          <p class="muted small">{t("Motor {version}. Los agentes pueden verlos y manejarlos por la API de control (docker_list, docker_action, docker_logs, docker_start).", { version: engine()!.version ?? "" })}</p>
        </Show>
      </Show>
      <Show when={msg()}>
        <div class="banner pre" classList={{ ok: msg()!.ok }} onClick={() => setMsg(null)}>
          {msg()!.text}
        </div>
      </Show>

      <h3>
        {t("Mis contenedores")}
        <button class="link small" onClick={() => setShowTemplates(!showTemplates())}>
          {showTemplates() ? t("cerrar") : t("+ agregar")}
        </button>
      </h3>
      <Show when={showTemplates()}>
        <div class="templates">
          <For each={TEMPLATES}>
            {(tpl) => (
              <button
                class="chip add"
                disabled={props.presets.some((p) => p.name === tpl.name)}
                title={`${tpl.image} · ${tpl.ports.join(", ")}`}
                onClick={() => {
                  props.update((d) => void d.docker.presets.push({ ...tpl, env: { ...tpl.env }, ports: [...tpl.ports], volumes: [...tpl.volumes] }));
                  setShowTemplates(false);
                }}
              >
                {tpl.name}
              </button>
            )}
          </For>
          <button
            class="chip add"
            onClick={() => {
              // Example values to edit: they are saved in the language in use when they were created.
              const base = t("mi-contenedor");
              let name = base;
              for (let i = 2; props.presets.some((p) => p.name === name); i++) name = `${base}-${i}`;
              props.update((d) => void d.docker.presets.push({ name, image: t("imagen:tag"), ports: [], env: {}, volumes: [], command: "" }));
              setEditing(name);
              setShowTemplates(false);
            }}
          >
            {t("vacío…")}
          </button>
        </div>
      </Show>
      <ul class="recipe-list">
        <For each={props.presets} fallback={<li class="muted small">{t("Agregá uno para iniciarlo con un clic (Postgres, Redis…).")}</li>}>
          {(p) => (
            <>
              <li class="recipe">
                <span class={`state ${existing(p)?.state === "running" ? "st-working" : existing(p) ? "st-starting" : "st-exited"}`} />
                <div class="agent-info">
                  <b>{p.name}</b>
                  <small title={`${p.image}\n${p.ports.join(", ")}`}>
                    {p.image}
                    {p.ports.length ? ` · ${p.ports.join(" ")}` : ""}
                  </small>
                </div>
                <button class="btn" disabled={!engine()?.running || !!busy() || existing(p)?.state === "running"} onClick={() => startPreset(p)}>
                  {t("Iniciar")}
                </button>
                <button class="icon-btn" title={t("Editar")} onClick={() => setEditing(editing() === p.name ? null : p.name)}>
                  ✎
                </button>
              </li>
              <Show when={editing() === p.name}>
                <li class="agent-edit">
                  <label>
                    {t("Nombre (del contenedor)")}
                    <input class="text mono" value={p.name} onChange={(e) => setPreset(p.name, (x) => void (x.name = e.currentTarget.value.trim() || x.name))} />
                  </label>
                  <label>
                    {t("Imagen")}
                    <input class="text mono" value={p.image} onChange={(e) => setPreset(p.name, (x) => void (x.image = e.currentTarget.value.trim()))} />
                  </label>
                  <label>
                    {t("Puertos (host:contenedor, separados por coma)")}
                    <input class="text mono" value={p.ports.join(", ")} onChange={(e) => setPreset(p.name, (x) => void (x.ports = e.currentTarget.value.split(/[,\s]+/).filter(Boolean)))} />
                  </label>
                  <label>
                    {t("Variables (CLAVE=valor, una por línea)")}
                    <textarea class="text mono" rows={3} value={envToText(p.env)} onChange={(e) => setPreset(p.name, (x) => void (x.env = parseEnvText(e.currentTarget.value)))} />
                  </label>
                  <label>
                    {t("Volúmenes (uno por línea: nombre:/ruta o C:\\carpeta:/ruta)")}
                    <textarea class="text mono" rows={2} value={p.volumes.join("\n")} onChange={(e) => setPreset(p.name, (x) => void (x.volumes = e.currentTarget.value.split(/\r?\n/).map((v) => v.trim()).filter(Boolean)))} />
                  </label>
                  <label>
                    {t("Comando (opcional)")}
                    <input class="text mono" value={p.command} onChange={(e) => setPreset(p.name, (x) => void (x.command = e.currentTarget.value))} />
                  </label>
                  <div class="row-actions">
                    <button
                      class="link danger"
                      onClick={async () => {
                        if (!(await askConfirm(t('¿Sacar "{name}" de la lista? El contenedor (si existe) no se borra.', { name: p.name }), t("Sacar")))) return;
                        props.update((d) => void (d.docker.presets = d.docker.presets.filter((x) => x.name !== p.name)));
                        setEditing(null);
                      }}
                    >
                      {t("Sacar de la lista")}
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

      <h3>{t("Contenedores")}</h3>
      <ul class="server-list">
        <For each={list() ?? []} fallback={<li class="muted small">{engine()?.running ? (list.loading ? t("Cargando…") : t("No hay contenedores.")) : "—"}</li>}>
          {(c) => (
            <li class="server" classList={{ ours: c.state === "running" }}>
              <div class="server-top">
                <span class={`state ${c.state === "running" ? "st-working" : c.state === "exited" ? "st-exited" : "st-starting"}`} />
                <b class="server-name" title={c.id}>
                  {c.name}
                </b>
                <span class="ports">
                  <For each={hostPorts(c.ports)}>
                    {(port) => (
                      <button class="port" title={t("Abrir {url}", { url: `http://localhost:${port}` })} onClick={() => void openUrl(`http://localhost:${port}`)}>
                        :{port}
                      </button>
                    )}
                  </For>
                </span>
              </div>
              <small class="server-meta" title={`${c.image}\n${c.status}\n${c.ports}`}>
                {c.image} · {c.status}
              </small>
              <div class="server-actions">
                <Show when={c.state !== "running"} fallback={<button class="link" disabled={!!busy()} onClick={() => action(c, "stop")}>{t("Detener")}</button>}>
                  <button class="link" disabled={!!busy()} onClick={() => action(c, "start")}>
                    {t("Iniciar")}
                  </button>
                </Show>
                <button class="link" disabled={!!busy()} onClick={() => action(c, "restart")}>
                  {t("Reiniciar")}
                </button>
                <button class="link" onClick={() => props.onTerminal(`docker logs -f --tail 200 ${c.name}`, `logs · ${c.name}`)}>
                  Logs
                </button>
                <Show when={c.state === "running"}>
                  <button class="link" onClick={() => props.onTerminal(`docker exec -it ${c.name} sh`, `shell · ${c.name}`)}>
                    Shell
                  </button>
                </Show>
                <button class="link danger" disabled={!!busy()} onClick={() => action(c, "rm")}>
                  {t("Borrar")}
                </button>
              </div>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
