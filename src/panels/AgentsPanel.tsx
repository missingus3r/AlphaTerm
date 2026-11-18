import { createResource, createSignal, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { AgentDef, Settings } from "../settings/schema";
import { AGENT_STATE_LABEL, envToText, parseEnvText, type AgentState } from "./agentState";

export interface RunningAgent {
  tabId: string;
  paneId: string;
  agentId: string;
  name: string;
  cwd?: string;
  state: AgentState;
  title: string;
  exitCode?: number | null;
}

interface Props {
  agents: AgentDef[];
  running: RunningAgent[];
  /** Carpeta del panel activo (la propuesta por defecto). */
  activeCwd?: string;
  recentDirs: string[];
  onLaunch: (agent: AgentDef, cwd: string | undefined) => void;
  onFocus: (tabId: string, paneId: string) => void;
  update: (f: (d: Settings) => void) => void;
}

const COLORS = ["#d97757", "#10a37f", "#4285f4", "#a855f7", "#eab308", "#ec4899", "#14b8a6", "#f97316"];
const colorOf = (id: string) => COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const initials = (name: string) =>
  name
    .replace(/\(.*?\)/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
const folderName = (p?: string) => (p ? p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p : "");

interface Detected {
  path: string | null;
}

export default function AgentsPanel(props: Props) {
  const [detected, { refetch }] = createResource(
    () => props.agents.map((a) => a.command).join("\n"),
    async () => invoke<Detected[]>("agents_detect", { commands: props.agents.map((a) => a.command) }),
  );
  const pathOf = (i: number) => detected()?.[i]?.path ?? null;
  const [dir, setDir] = createSignal<string | null>(null); // null = la del panel activo
  const cwd = () => dir() ?? props.activeCwd;
  const [editing, setEditing] = createSignal<string | null>(null);
  const [showHidden, setShowHidden] = createSignal(false);

  const pick = async () => {
    const d = await open({ directory: true, defaultPath: cwd(), title: "Carpeta donde lanzar el agente" });
    if (typeof d === "string") setDir(d);
  };

  const setAgent = (id: string, f: (a: AgentDef) => void) =>
    props.update((s) => {
      const a = s.agents.find((x) => x.id === id);
      if (a) f(a);
    });

  const addAgent = () => {
    const taken = new Set(props.agents.map((a) => a.id));
    let id = "propio";
    for (let i = 2; taken.has(id); i++) id = `propio-${i}`;
    props.update((s) => void s.agents.push({ id, name: "Agente propio", command: "mi-agente", env: {}, hidden: false, builtin: false }));
    setEditing(id);
  };

  return (
    <div class="panel agents-panel">
      <header class="panel-head">
        <h2>Agentes</h2>
        <button class="icon-btn" title="Volver a buscar los instalados" onClick={() => void refetch()}>
          ↻
        </button>
      </header>

      <div class="field">
        <label>Carpeta</label>
        <div class="dir-row">
          <select
            class="text"
            value={dir() ?? ""}
            onChange={(e) => setDir(e.currentTarget.value || null)}
            title={cwd() ?? "Carpeta de inicio"}
          >
            <option value="">La del panel activo{props.activeCwd ? ` (${folderName(props.activeCwd)})` : ""}</option>
            <For each={props.recentDirs}>{(d) => <option value={d}>{d}</option>}</For>
            <Show when={dir() && !props.recentDirs.includes(dir()!)}>
              <option value={dir()!}>{dir()}</option>
            </Show>
          </select>
          <button class="btn" onClick={() => void pick()} title="Elegir otra carpeta">
            …
          </button>
        </div>
      </div>

      <ul class="agent-list">
        <For each={props.agents}>
          {(a, i) => (
            <Show when={!a.hidden || showHidden()}>
              <li class="agent" classList={{ missing: detected.state === "ready" && !pathOf(i()), hidden: a.hidden }}>
                <span class="avatar" style={{ background: colorOf(a.id) }}>
                  {initials(a.name)}
                </span>
                <div class="agent-info">
                  <b>{a.name}</b>
                  <small title={pathOf(i()) ?? ""}>
                    {detected.loading ? "buscando…" : pathOf(i()) ? a.command : `${a.command} · no detectado`}
                  </small>
                </div>
                <button
                  class="btn launch"
                  disabled={!pathOf(i())}
                  title={pathOf(i()) ? `Abrir una pestaña con ${a.name} en ${cwd() ?? "la carpeta de inicio"}` : "No está instalado (o no está en el PATH)"}
                  onClick={() => props.onLaunch(a, cwd())}
                >
                  Lanzar
                </button>
                <button class="icon-btn" title="Editar" onClick={() => setEditing(editing() === a.id ? null : a.id)}>
                  ✎
                </button>
              </li>
              <Show when={editing() === a.id}>
                <li class="agent-edit">
                  <label>
                    Nombre
                    <input class="text" value={a.name} onChange={(e) => setAgent(a.id, (x) => void (x.name = e.currentTarget.value))} />
                  </label>
                  <label>
                    Comando
                    <input
                      class="text mono"
                      value={a.command}
                      spellcheck={false}
                      onChange={(e) => setAgent(a.id, (x) => void (x.command = e.currentTarget.value))}
                    />
                  </label>
                  <label>
                    Variables de entorno (CLAVE=valor, una por línea)
                    <textarea
                      class="text mono"
                      rows={3}
                      spellcheck={false}
                      value={envToText(a.env)}
                      onChange={(e) => setAgent(a.id, (x) => void (x.env = parseEnvText(e.currentTarget.value)))}
                    />
                  </label>
                  <div class="row-actions">
                    <label class="check">
                      <input type="checkbox" checked={a.hidden} onChange={(e) => setAgent(a.id, (x) => void (x.hidden = e.currentTarget.checked))} />
                      Ocultar
                    </label>
                    <Show when={!a.builtin}>
                      <button
                        class="link danger"
                        onClick={() => {
                          if (!confirm(`¿Borrar "${a.name}" del catálogo?`)) return;
                          props.update((s) => void (s.agents = s.agents.filter((x) => x.id !== a.id)));
                          setEditing(null);
                        }}
                      >
                        Borrar
                      </button>
                    </Show>
                    <button class="link" onClick={() => setEditing(null)}>
                      Listo
                    </button>
                  </div>
                </li>
              </Show>
            </Show>
          )}
        </For>
      </ul>
      <div class="panel-actions">
        <button class="link" onClick={addAgent}>
          + Agregar un agente
        </button>
        <Show when={props.agents.some((a) => a.hidden)}>
          <button class="link" onClick={() => setShowHidden(!showHidden())}>
            {showHidden() ? "Esconder los ocultos" : "Ver los ocultos"}
          </button>
        </Show>
      </div>

      <h3>En curso</h3>
      <Show when={props.running.length > 0} fallback={<p class="muted small">Ningún agente abierto en esta ventana.</p>}>
        <ul class="running-list">
          <For each={props.running}>
            {(r) => (
              <li class="running" onClick={() => props.onFocus(r.tabId, r.paneId)} title={`${r.title}\n${r.cwd ?? ""}`}>
                <span class={`state st-${r.state}`} />
                <div class="agent-info">
                  <b>{r.name}</b>
                  <small>
                    {AGENT_STATE_LABEL[r.state]}
                    {r.state === "done" && r.exitCode != null && r.exitCode !== 0 ? ` (código ${r.exitCode})` : ""}
                    {r.cwd ? ` · ${folderName(r.cwd)}` : ""}
                  </small>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <p class="muted small hint">
        "Esperando input" sale de que el agente dejó de escribir en la pantalla hace unos segundos; "Te necesita", de la campana de la terminal.
      </p>
    </div>
  );
}
