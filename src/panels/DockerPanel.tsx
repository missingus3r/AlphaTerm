import { createEffect, createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { DockerPreset, Settings } from "../settings/schema";
import { envToText, parseEnvText } from "./agentState";

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

/** Plantillas para arrancar rápido (se copian a "Mis contenedores" y se pueden editar). */
export const TEMPLATES: DockerPreset[] = [
  { name: "postgres", image: "postgres:16", ports: ["5432:5432"], env: { POSTGRES_PASSWORD: "postgres" }, volumes: ["alphaterm-pg:/var/lib/postgresql/data"], command: "" },
  { name: "redis", image: "redis:7", ports: ["6379:6379"], env: {}, volumes: [], command: "" },
  { name: "mysql", image: "mysql:8", ports: ["3306:3306"], env: { MYSQL_ROOT_PASSWORD: "root" }, volumes: ["alphaterm-mysql:/var/lib/mysql"], command: "" },
  { name: "mongo", image: "mongo:7", ports: ["27017:27017"], env: {}, volumes: ["alphaterm-mongo:/data/db"], command: "" },
  { name: "nginx", image: "nginx:alpine", ports: ["8080:80"], env: {}, volumes: [], command: "" },
];

/** Puertos publicados ("0.0.0.0:5432->5432/tcp, :::5432->5432/tcp") → [5432]. */
export function hostPorts(ports: string): number[] {
  return [...new Set([...ports.matchAll(/:(\d+)->/g)].map((m) => Number(m[1])))];
}

interface Props {
  presets: DockerPreset[];
  update: (f: (d: Settings) => void) => void;
  /** Abre una pestaña con un comando (logs -f, exec). */
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

  // Con el panel abierto se actualiza cada 4 s.
  createEffect(() => {
    if (!engine()?.running) return;
    const t = setInterval(() => !document.hidden && !busy() && void refetch(), 4000);
    onCleanup(() => clearInterval(t));
  });

  const act = async (label: string, f: () => Promise<string>) => {
    setBusy(label);
    setMsg(null);
    try {
      setMsg({ ok: true, text: (await f()) || "Listo." });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setBusy(null);
      void refetch();
    }
  };
  const action = (c: Container, a: string) => {
    if (a === "rm" && !confirm(`¿Borrar el contenedor ${c.name}? Se pierde lo que tenga adentro que no esté en un volumen. No se puede deshacer.`)) return;
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
          title="Actualizar"
          onClick={() => {
            void refetchEngine();
            void refetch();
          }}
        >
          ↻
        </button>
      </header>

      <Show when={!engine.loading} fallback={<p class="muted small">Mirando Docker…</p>}>
        <Show
          when={engine()?.running}
          fallback={
            <div class="git-empty">
              <p class="muted small">
                {!engine()?.installed ? "Docker no está instalado (no se encontró docker en el PATH)." : "El motor de Docker no está corriendo."}
              </p>
              <Show when={engine()?.desktop}>
                <button
                  class="btn"
                  onClick={() =>
                    void invoke("docker_desktop")
                      .then(() => setMsg({ ok: true, text: "Abriendo Docker Desktop… tarda unos segundos. Después tocá ↻." }))
                      .catch((e) => setMsg({ ok: false, text: String(e) }))
                  }
                >
                  Abrir Docker Desktop
                </button>
              </Show>
            </div>
          }
        >
          <p class="muted small">Motor {engine()!.version}. Los agentes pueden verlos y manejarlos por la API de control (docker_list, docker_action, docker_logs, docker_start).</p>
        </Show>
      </Show>
      <Show when={msg()}>
        <div class="banner pre" classList={{ ok: msg()!.ok }} onClick={() => setMsg(null)}>
          {msg()!.text}
        </div>
      </Show>

      <h3>
        Mis contenedores
        <button class="link small" onClick={() => setShowTemplates(!showTemplates())}>
          {showTemplates() ? "cerrar" : "+ agregar"}
        </button>
      </h3>
      <Show when={showTemplates()}>
        <div class="templates">
          <For each={TEMPLATES}>
            {(t) => (
              <button
                class="chip add"
                disabled={props.presets.some((p) => p.name === t.name)}
                title={`${t.image} · ${t.ports.join(", ")}`}
                onClick={() => {
                  props.update((d) => void d.docker.presets.push({ ...t, env: { ...t.env }, ports: [...t.ports], volumes: [...t.volumes] }));
                  setShowTemplates(false);
                }}
              >
                {t.name}
              </button>
            )}
          </For>
          <button
            class="chip add"
            onClick={() => {
              let name = "mi-contenedor";
              for (let i = 2; props.presets.some((p) => p.name === name); i++) name = `mi-contenedor-${i}`;
              props.update((d) => void d.docker.presets.push({ name, image: "imagen:tag", ports: [], env: {}, volumes: [], command: "" }));
              setEditing(name);
              setShowTemplates(false);
            }}
          >
            vacío…
          </button>
        </div>
      </Show>
      <ul class="recipe-list">
        <For each={props.presets} fallback={<li class="muted small">Agregá uno para iniciarlo con un clic (Postgres, Redis…).</li>}>
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
                  Iniciar
                </button>
                <button class="icon-btn" title="Editar" onClick={() => setEditing(editing() === p.name ? null : p.name)}>
                  ✎
                </button>
              </li>
              <Show when={editing() === p.name}>
                <li class="agent-edit">
                  <label>
                    Nombre (del contenedor)
                    <input class="text mono" value={p.name} onChange={(e) => setPreset(p.name, (x) => void (x.name = e.currentTarget.value.trim() || x.name))} />
                  </label>
                  <label>
                    Imagen
                    <input class="text mono" value={p.image} onChange={(e) => setPreset(p.name, (x) => void (x.image = e.currentTarget.value.trim()))} />
                  </label>
                  <label>
                    Puertos (host:contenedor, separados por coma)
                    <input class="text mono" value={p.ports.join(", ")} onChange={(e) => setPreset(p.name, (x) => void (x.ports = e.currentTarget.value.split(/[,\s]+/).filter(Boolean)))} />
                  </label>
                  <label>
                    Variables (CLAVE=valor, una por línea)
                    <textarea class="text mono" rows={3} value={envToText(p.env)} onChange={(e) => setPreset(p.name, (x) => void (x.env = parseEnvText(e.currentTarget.value)))} />
                  </label>
                  <label>
                    Volúmenes (uno por línea: nombre:/ruta o C:\carpeta:/ruta)
                    <textarea class="text mono" rows={2} value={p.volumes.join("\n")} onChange={(e) => setPreset(p.name, (x) => void (x.volumes = e.currentTarget.value.split(/\r?\n/).map((v) => v.trim()).filter(Boolean)))} />
                  </label>
                  <label>
                    Comando (opcional)
                    <input class="text mono" value={p.command} onChange={(e) => setPreset(p.name, (x) => void (x.command = e.currentTarget.value))} />
                  </label>
                  <div class="row-actions">
                    <button
                      class="link danger"
                      onClick={() => {
                        if (!confirm(`¿Sacar "${p.name}" de la lista? El contenedor (si existe) no se borra.`)) return;
                        props.update((d) => void (d.docker.presets = d.docker.presets.filter((x) => x.name !== p.name)));
                        setEditing(null);
                      }}
                    >
                      Sacar de la lista
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

      <h3>Contenedores</h3>
      <ul class="server-list">
        <For each={list() ?? []} fallback={<li class="muted small">{engine()?.running ? (list.loading ? "Cargando…" : "No hay contenedores.") : "—"}</li>}>
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
                      <button class="port" title={`Abrir http://localhost:${port}`} onClick={() => void openUrl(`http://localhost:${port}`)}>
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
                <Show when={c.state !== "running"} fallback={<button class="link" disabled={!!busy()} onClick={() => action(c, "stop")}>Detener</button>}>
                  <button class="link" disabled={!!busy()} onClick={() => action(c, "start")}>
                    Iniciar
                  </button>
                </Show>
                <button class="link" disabled={!!busy()} onClick={() => action(c, "restart")}>
                  Reiniciar
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
                  Borrar
                </button>
              </div>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
