import { createResource, createSignal, For, onMount, Show } from "solid-js";
import { askConfirm } from "../widgets/confirm";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { AgentDef, Settings } from "../settings/schema";
import { AGENT_STATE_LABEL, type AgentState } from "./agentState";
import { AgentOptions } from "./AgentOptions";
import { buildCommand, launchSummary, type ShellKind } from "./agentLaunch";
import { providerFor } from "../widgets/usage";
import { listenUsage, loadUsage } from "../widgets/usageStore";
import { UsageDetail } from "../widgets/UsageDetail";
import { t } from "../i18n";

const FOLD_PREF = "alphaterm.agents.usageFolded";
const readFolded = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(FOLD_PREF) ?? "[]");
  } catch {
    return [];
  }
};

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
  /** Shell de las pestañas nuevas (para mostrar el comando con sus comillas). */
  shell: ShellKind;
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
  // Consumo debajo de cada agente que lo tiene (Claude, Codex, agy): el mismo dato del footer, con detalle.
  const providerOf = (a: AgentDef) => providerFor(a.id, a.command);
  const [folded, setFolded] = createSignal<string[]>(readFolded());
  const toggleFold = (id: string) => {
    const next = folded().includes(id) ? folded().filter((x) => x !== id) : [...folded(), id];
    setFolded(next);
    try {
      localStorage.setItem(FOLD_PREF, JSON.stringify(next));
    } catch {
      /* no importa */
    }
  };
  onMount(() => {
    listenUsage();
    for (const p of new Set(props.agents.filter((a) => !a.hidden).map(providerOf))) if (p) void loadUsage(p);
  });

  const pick = async () => {
    const d = await open({ directory: true, defaultPath: cwd(), title: t("Carpeta donde lanzar el agente") });
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
    props.update((s) => void s.agents.push({ id, name: t("Agente propio"), command: "mi-agente", env: {}, hidden: false, builtin: false }));
    setEditing(id);
  };

  return (
    <div class="panel agents-panel">
      <header class="panel-head">
        <h2>{t("Agentes")}</h2>
        <button class="icon-btn" title={t("Volver a buscar los instalados")} onClick={() => void refetch()}>
          ↻
        </button>
      </header>

      <div class="field">
        <label>{t("Carpeta")}</label>
        <div class="dir-row">
          <select
            class="text"
            value={dir() ?? ""}
            onChange={(e) => setDir(e.currentTarget.value || null)}
            title={cwd() ?? t("Carpeta de inicio")}
          >
            <option value="">
              {props.activeCwd ? t("La del panel activo ({folder})", { folder: folderName(props.activeCwd) }) : t("La del panel activo")}
            </option>
            <For each={props.recentDirs}>{(d) => <option value={d}>{d}</option>}</For>
            <Show when={dir() && !props.recentDirs.includes(dir()!)}>
              <option value={dir()!}>{dir()}</option>
            </Show>
          </select>
          <button class="btn" onClick={() => void pick()} title={t("Elegir otra carpeta")}>
            …
          </button>
        </div>
      </div>

      <ul class="agent-list">
        {/* Por id, no por objeto: cada cambio de la configuración trae objetos nuevos y la fila
            entera (con las opciones abiertas y lo que se está escribiendo) se volvería a crear. */}
        <For each={props.agents.map((x) => x.id)}>
          {(id) => {
            const i = () => props.agents.findIndex((x) => x.id === id);
            return (
              <Show when={props.agents[i()]}>
                {(ag) => {
                  const a = () => ag();
                  return (
                    <Show when={!a().hidden || showHidden()}>
                      <li class="agent" classList={{ missing: detected.state === "ready" && !pathOf(i()), hidden: a().hidden }}>
                        <span class="avatar" style={{ background: colorOf(id) }}>
                          {initials(a().name)}
                        </span>
                        <div class="agent-info">
                          <b>{a().name}</b>
                          <small title={[pathOf(i()), launchSummary(a())].filter(Boolean).join("\n")}>
                            {detected.loading ? t("buscando…") : pathOf(i()) ? launchSummary(a()) || a().command : t("{command} · no detectado", { command: a().command })}
                          </small>
                        </div>
                        <button
                          class="btn launch"
                          disabled={!pathOf(i())}
                          title={
                            pathOf(i())
                              ? `${t("Abrir una pestaña con {name} en {folder}", { name: a().name, folder: cwd() ?? t("la carpeta de inicio") })}\n${buildCommand(a(), props.shell)}`
                              : t("No está instalado (o no está en el PATH)")
                          }
                          onClick={() => props.onLaunch(a(), cwd())}
                        >
                          {t("Lanzar")}
                        </button>
                        <Show when={providerOf(a())}>
                          <button
                            class="icon-btn"
                            title={folded().includes(id) ? t("Ver el consumo") : t("Ocultar el consumo")}
                            aria-expanded={!folded().includes(id)}
                            onClick={() => toggleFold(id)}
                          >
                            {folded().includes(id) ? "▸" : "▾"}
                          </button>
                        </Show>
                        <button
                          class="icon-btn"
                          classList={{ on: editing() === id || !!launchSummary(a()) }}
                          title={t("Opciones de arranque: modelo, esfuerzo, permisos…")}
                          aria-expanded={editing() === id}
                          onClick={() => setEditing(editing() === id ? null : id)}
                        >
                          {/* Deslizadores: las opciones se eligen antes de lanzar. */}
                          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
                            <path d="M2 4h12M2 8h12M2 12h12" opacity=".55" />
                            <circle cx="5" cy="4" r="1.8" fill="currentColor" stroke="none" />
                            <circle cx="11" cy="8" r="1.8" fill="currentColor" stroke="none" />
                            <circle cx="7" cy="12" r="1.8" fill="currentColor" stroke="none" />
                          </svg>
                        </button>
                      </li>
                      {/* Las opciones van pegadas a la fila, antes del consumo (que es largo). */}
                      <Show when={editing() === id}>
                        <AgentOptions
                          agent={a()}
                          shell={props.shell}
                          set={(f) => setAgent(id, f)}
                          canLaunch={!!pathOf(i())}
                          onLaunch={() => props.onLaunch(a(), cwd())}
                          onClose={() => setEditing(null)}
                          onDelete={
                            a().builtin
                              ? undefined
                              : async () => {
                                  if (!(await askConfirm(t('¿Borrar "{name}" del catálogo?', { name: a().name }), t("Borrar")))) return;
                                  props.update((s) => void (s.agents = s.agents.filter((x) => x.id !== id)));
                                  setEditing(null);
                                }
                          }
                        />
                      </Show>
                      <Show when={providerOf(a()) && !folded().includes(id)}>
                        <li class="agent-usage">
                          <UsageDetail id={providerOf(a())!} compact />
                        </li>
                      </Show>
                    </Show>
                  );
                }}
              </Show>
            );
          }}
        </For>
      </ul>
      <div class="panel-actions">
        <button class="link" onClick={addAgent}>
          {t("+ Agregar un agente")}
        </button>
        <Show when={props.agents.some((a) => a.hidden)}>
          <button class="link" onClick={() => setShowHidden(!showHidden())}>
            {showHidden() ? t("Esconder los ocultos") : t("Ver los ocultos")}
          </button>
        </Show>
      </div>

      <h3>{t("En curso")}</h3>
      <Show when={props.running.length > 0} fallback={<p class="muted small">{t("Ningún agente abierto en esta ventana.")}</p>}>
        <ul class="running-list">
          <For each={props.running}>
            {(r) => (
              <li class="running" onClick={() => props.onFocus(r.tabId, r.paneId)} title={`${r.title}\n${r.cwd ?? ""}`}>
                <span class={`state st-${r.state}`} />
                <div class="agent-info">
                  <b>{r.name}</b>
                  <small>
                    {t(AGENT_STATE_LABEL[r.state])}
                    {r.state === "done" && r.exitCode != null && r.exitCode !== 0 ? ` ${t("(código {code})", { code: r.exitCode })}` : ""}
                    {r.cwd ? ` · ${folderName(r.cwd)}` : ""}
                  </small>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <p class="muted small hint">
        {t('"Esperando input" sale de que el agente dejó de escribir en la pantalla hace unos segundos; "Te necesita", de la campana de la terminal.')}
      </p>
    </div>
  );
}
