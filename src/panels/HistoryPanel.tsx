import { createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { ago } from "../widgets/format";
import { projectName } from "./projects";
import { locale, t } from "../i18n";

export interface HistEntry {
  command: string;
  cwd: string | null;
  exitCode: number | null;
  at: number;
  shell: string | null;
}

interface Props {
  /** Escribe el comando en la terminal activa (con Enter si `run`). */
  onUse: (command: string, run: boolean) => void;
  /** Cambia cada vez que se agrega un comando (para refrescar). */
  version: number;
}

export default function HistoryPanel(props: Props) {
  const [query, setQuery] = createSignal("");
  const [items, { refetch }] = createResource(
    () => ({ q: query(), v: props.version }),
    ({ q }) => invoke<HistEntry[]>("history_search", { query: q, limit: 400 }),
  );
  let input!: HTMLInputElement;
  onMount(() => setTimeout(() => input?.focus(), 50));
  // El tiempo relativo ("hace 3 min") se refresca cada minuto.
  const [, setTick] = createSignal(0);
  onMount(() => {
    const timer = setInterval(() => setTick((x) => x + 1), 60_000);
    onCleanup(() => clearInterval(timer));
  });

  return (
    <div class="panel history-panel">
      <header class="panel-head">
        <h2>{t("Historial")}</h2>
        <button class="icon-btn" title={t("Actualizar")} onClick={() => void refetch()}>
          ↻
        </button>
      </header>
      <input
        ref={input}
        class="text"
        placeholder={t("Buscar (palabras del comando o de la carpeta)…")}
        value={query()}
        onInput={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && items()?.[0]) props.onUse(items()![0].command, e.ctrlKey);
        }}
      />
      <p class="muted small">{t("Clic: lo escribe en la terminal activa. Doble clic o ▶: lo ejecuta. Enter usa el primero (Ctrl+Enter lo ejecuta).")}</p>
      <ul class="hist-list">
        <For each={items() ?? []} fallback={<li class="muted small">{items.loading ? t("Buscando…") : t("Nada todavía: se guardan los comandos de las shells con integración.")}</li>}>
          {(h) => (
            <li class="hist" onClick={() => props.onUse(h.command, false)} onDblClick={() => props.onUse(h.command, true)} title={`${h.command}\n${h.cwd ?? ""}\n${new Date(h.at).toLocaleString(locale())}`}>
              <span class={`hist-mark ${h.exitCode === null || h.exitCode === 0 ? "ok" : "err"}`} title={h.exitCode ? t("Código {code}", { code: h.exitCode }) : t("Terminó bien")} />
              <div class="agent-info">
                <code class="hist-cmd">{h.command}</code>
                <small>
                  {h.cwd ? projectName(h.cwd) : ""} · {ago(h.at)}
                  {h.exitCode ? ` · ${t("código {code}", { code: h.exitCode })}` : ""}
                </small>
              </div>
              <button
                class="icon-btn tiny show"
                title={t("Copiar")}
                onClick={(e) => {
                  e.stopPropagation();
                  void writeText(h.command);
                }}
              >
                ⧉
              </button>
              <button
                class="icon-btn tiny show"
                title={t("Ejecutar en la terminal activa")}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onUse(h.command, true);
                }}
              >
                ▶
              </button>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
