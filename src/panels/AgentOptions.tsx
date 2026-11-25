import { createResource, createSignal, For, Match, Show, Switch, untrack } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import type { AgentDef } from "../settings/schema";
import { envToText, parseEnvText } from "./agentState";
import { agentKind, blockedBy, buildCommand, optionsFor, type LaunchOpt, type LaunchValue, type ShellKind } from "./agentLaunch";
import { t } from "../i18n";

/** What the backend reads from each agent (`agent_models`). */
export interface ModelInfo {
  id: string;
  label: string;
  efforts: string[];
  defaultEffort: string | null;
}

// Once per app session: `agy models` takes a few seconds.
const cache = new Map<string, Promise<ModelInfo[]>>();
const loadModels = (kind: string, command: string, fresh = false) => {
  const key = `${kind}\n${command}`;
  if (fresh) cache.delete(key);
  if (!cache.has(key)) {
    const p = invoke<ModelInfo[]>("agent_models", { kind, command });
    p.catch(() => cache.delete(key)); // an error is not kept
    cache.set(key, p);
  }
  return cache.get(key)!;
};

let uid = 0;

interface Props {
  agent: AgentDef;
  shell: ShellKind;
  /** Changes the agent in the settings (saved automatically). */
  set: (f: (a: AgentDef) => void) => void;
  canLaunch: boolean;
  onLaunch: () => void;
  onDelete?: () => void;
  onClose: () => void;
}

/**
 * Launch options of an agent: model, effort, permissions, session and the rest of its flags,
 * with the resulting command line. What is chosen is saved and used on every "Lanzar".
 */
export function AgentOptions(props: Props) {
  const id = `ao${++uid}`;
  const opts = () => optionsFor(props.agent.command);
  const kind = () => agentKind(props.agent.command);
  const val = (k: string) => props.agent.launch?.[k];
  const str = (k: string) => {
    const v = val(k);
    return typeof v === "string" ? v : "";
  };
  const setVal = (k: string, v: LaunchValue) =>
    props.set((a) => {
      const l = { ...(a.launch ?? {}) };
      if (v === false || (typeof v === "string" && v.trim() === "")) delete l[k];
      else l[k] = v;
      a.launch = l;
    });

  const wantsModels = () => opts().some((o) => o.kind === "combo" && o.models);
  const [fresh, setFresh] = createSignal(0);
  const [models] = createResource(
    () => (wantsModels() ? { kind: kind(), command: props.agent.command, n: fresh() } : false),
    (k) => loadModels(k.kind, k.command, k.n > 0),
  );
  const modelInfo = () => (models.state === "ready" ? models()?.find((m) => m.id === str("model")) : undefined);

  /** Slider levels: those of the chosen model if the agent reports them (Codex). */
  const levelsOf = (o: Extract<LaunchOpt, { kind: "level" }>) => {
    const m = modelInfo();
    return m && m.efforts.length ? m.efforts : o.levels;
  };

  const sectionHasValues = (s: LaunchOpt["section"]) => opts().some((o) => o.section === s && val(o.key) !== undefined);
  const preview = () => buildCommand(props.agent, props.shell);
  const isDanger = (o: LaunchOpt) => o.danger || (o.kind === "choice" && /bypass|danger/i.test(str(o.key)));

  const field = (o: LaunchOpt) => {
    const blk = () => blockedBy(props.agent, o.key);
    return (
      <div class="opt" classList={{ off: !!blk() }}>
        <Switch>
          <Match when={o.kind === "bool" && o}>
            <label class="check" classList={{ danger: o.danger }} title={o.hint ? t(o.hint) : ""}>
              <input type="checkbox" checked={val(o.key) === true} onChange={(e) => setVal(o.key, e.currentTarget.checked)} />
              {t(o.label)}
            </label>
          </Match>
          <Match when={o.kind === "choice" && o}>
            {(c) => (
              <label classList={{ danger: isDanger(o) }}>
                {t(c().label)}
                <select class="text" value={str(o.key)} onChange={(e) => setVal(o.key, e.currentTarget.value)}>
                  <option value="">{t("Por defecto")}</option>
                  <For each={c().choices}>{(ch) => <option value={ch.value}>{t(ch.label)}</option>}</For>
                </select>
                <Show when={c().choices.find((ch) => ch.value === str(o.key))?.hint}>{(h) => <small class="muted">{t(h())}</small>}</Show>
              </label>
            )}
          </Match>
          <Match when={o.kind === "combo" && o}>
            {(c) => (
              <label>
                <span class="opt-head">
                  {t(c().label)}
                  <Show when={c().models}>
                    <small class="muted">
                      {models.loading ? t("leyendo la lista…") : models.error ? t("no se pudo leer la lista") : t("{n} disponibles", { n: models()?.length ?? 0 })}
                    </small>
                    <button
                      class="icon-btn tiny-x"
                      title={t("Volver a leer la lista de modelos del agente")}
                      onClick={(e) => (e.preventDefault(), setFresh(fresh() + 1))}
                    >
                      ↻
                    </button>
                  </Show>
                </span>
                <div class="dir-row">
                  <input
                    class="text mono"
                    list={`${id}-${o.key}`}
                    value={str(o.key)}
                    placeholder={t("por defecto")}
                    spellcheck={false}
                    onChange={(e) => setVal(o.key, e.currentTarget.value.trim())}
                  />
                  <Show when={str(o.key)}>
                    <button class="icon-btn" title={t("Volver al de por defecto")} onClick={(e) => (e.preventDefault(), setVal(o.key, ""))}>
                      ×
                    </button>
                  </Show>
                </div>
                <datalist id={`${id}-${o.key}`}>
                  <For each={c().suggestions}>{(s) => <option value={s.value}>{t(s.label)}</option>}</For>
                  <Show when={c().models}>
                    <For each={models() ?? []}>{(m) => <option value={m.id}>{m.label}</option>}</For>
                  </Show>
                </datalist>
                <Show when={c().models && models.error}>
                  <small class="muted">{String(models.error)}</small>
                </Show>
              </label>
            )}
          </Match>
          <Match when={o.kind === "level" && o}>
            {(l) => {
              const levels = () => levelsOf(l());
              const pos = () => {
                const i = levels().indexOf(str(o.key));
                return i < 0 ? 0 : i + 1;
              };
              const [drag, setDrag] = createSignal<number | null>(null);
              const shown = () => drag() ?? pos();
              return (
                <label>
                  <span class="opt-head">
                    {t(l().label)}
                    <b class="level-val">
                      {shown() === 0
                        ? modelInfo()?.defaultEffort
                          ? t("por defecto ({effort})", { effort: modelInfo()!.defaultEffort! })
                          : t("por defecto")
                        : levels()[shown() - 1]}
                    </b>
                  </span>
                  <input
                    type="range"
                    class="level"
                    min={0}
                    max={levels().length}
                    step={1}
                    value={shown()}
                    onInput={(e) => setDrag(+e.currentTarget.value)}
                    onChange={(e) => {
                      const n = +e.currentTarget.value;
                      setDrag(null);
                      setVal(o.key, n === 0 ? "" : levels()[n - 1]);
                    }}
                  />
                  <span class="level-ticks">
                    <span>—</span>
                    <For each={levels()}>{(x) => <span>{x}</span>}</For>
                  </span>
                </label>
              );
            }}
          </Match>
          <Match when={o.kind === "text" && o}>
            {(tx) => (
              <label title={tx().hint ? t(tx().hint!) : ""}>
                {t(tx().label)}
                <Show
                  when={tx().multiline}
                  fallback={
                    <input
                      class="text mono"
                      value={str(o.key)}
                      placeholder={tx().placeholder ? t(tx().placeholder!) : ""}
                      spellcheck={false}
                      onChange={(e) => setVal(o.key, e.currentTarget.value)}
                    />
                  }
                >
                  <textarea
                    class="text mono"
                    rows={2}
                    value={str(o.key)}
                    placeholder={tx().placeholder ? t(tx().placeholder!) : ""}
                    onChange={(e) => setVal(o.key, e.currentTarget.value)}
                  />
                </Show>
                <Show when={tx().hint}>
                  {(h) => <small class="muted">{t(h())}</small>}
                </Show>
              </label>
            )}
          </Match>
        </Switch>
        <Show when={blk()}>{(b) => <small class="muted">{t("No se usa junto con «{label}».", { label: t(b().label) })}</small>}</Show>
      </div>
    );
  };

  const section = (s: LaunchOpt["section"]) => <For each={opts().filter((o) => o.section === s)}>{field}</For>;

  return (
    <li class="agent-edit agent-options">
      <Show
        when={opts().length > 0}
        fallback={
          <p class="muted small">{t("No tengo el catálogo de opciones de «{command}»: escribilas en el comando (Avanzado).", { command: props.agent.command })}</p>
        }
      >
        {section("main")}
        <details open={untrack(() => sectionHasValues("session"))}>
          <summary>{t("Sesión")}</summary>
          <div class="opt-group">{section("session")}</div>
        </details>
        <details open={untrack(() => sectionHasValues("more"))}>
          <summary>{t("Más opciones")}</summary>
          <div class="opt-group">{section("more")}</div>
        </details>
      </Show>

      <div class="cmd-preview">
        <small class="muted">{t("Va a correr")}</small>
        <code class="mono">{preview()}</code>
        <Show when={kind() === "claude" || kind() === "codex"}>
          <small class="muted">{t("AlphaTerm le suma el guardián y su conexión (MCP) al lanzar.")}</small>
        </Show>
      </div>

      <details open={untrack(() => opts().length === 0)}>
        <summary>{t("Avanzado")}</summary>
        <div class="opt-group">
          <label>
            {t("Nombre")}
            <input class="text" value={props.agent.name} onChange={(e) => props.set((x) => void (x.name = e.currentTarget.value))} />
          </label>
          <label>
            {t("Comando")}
            <input
              class="text mono"
              value={props.agent.command}
              spellcheck={false}
              onChange={(e) => props.set((x) => void (x.command = e.currentTarget.value))}
            />
          </label>
          <label>
            {t("Variables de entorno (CLAVE=valor, una por línea)")}
            <textarea
              class="text mono"
              rows={3}
              spellcheck={false}
              value={envToText(props.agent.env)}
              onChange={(e) => props.set((x) => void (x.env = parseEnvText(e.currentTarget.value)))}
            />
          </label>
          <div class="row-actions">
            <label class="check">
              <input type="checkbox" checked={props.agent.hidden} onChange={(e) => props.set((x) => void (x.hidden = e.currentTarget.checked))} />
              {t("Ocultar")}
            </label>
            <Show when={props.onDelete}>
              <button class="link danger" onClick={() => props.onDelete?.()}>
                {t("Borrar")}
              </button>
            </Show>
          </div>
        </div>
      </details>

      <div class="row-actions">
        <button
          class="link"
          disabled={!Object.keys(props.agent.launch ?? {}).length}
          onClick={() => props.set((a) => void (a.launch = {}))}
          title={t("Sacar todas las opciones elegidas")}
        >
          {t("Restablecer")}
        </button>
        <button class="link" onClick={() => props.onClose()}>
          {t("Cerrar")}
        </button>
        <button class="btn primary launch" disabled={!props.canLaunch} onClick={() => props.onLaunch()}>
          {t("Lanzar")}
        </button>
      </div>
    </li>
  );
}
