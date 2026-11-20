import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { coveredBy, markLabel, type Mark } from "./marks";

/** Panel de terminal al que se le puede mandar el pedido. */
export interface Target {
  id: string;
  label: string;
}

/** Lo que el navegador necesita saber del agente dueño para el "trabajando… listo". */
export interface OwnerLive {
  active?: boolean;
  bell?: boolean;
  /** Avisa por el hook Stop de Claude Code (si no, se adivina por el silencio de la terminal). */
  hook: boolean;
}

interface Props {
  id: string;
  url: string;
  owner?: string;
  visible: boolean;
  focused: boolean;
  targets: Target[];
  ownerLive: (id: string) => OwnerLive | undefined;
  onFocus: () => void;
  onUrl: (url: string) => void;
  onOwner: (id: string | undefined) => void;
  /** Escribe el pedido en la terminal del agente. */
  onSend: (pane: string, message: string) => boolean;
  onClose: () => void;
}

type Status = { kind: "idle" } | { kind: "busy"; text: string } | { kind: "working"; since: number } | { kind: "attention" } | { kind: "done" } | { kind: "error"; text: string };

// Navegadores ya creados en el backend (la API de control espera a que estén).
const ready = new Map<string, Array<() => void>>();
const created = new Set<string>();
export function whenReady(id: string, ms = 15000): Promise<boolean> {
  if (created.has(id)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), ms);
    const list = ready.get(id) ?? [];
    list.push(() => {
      clearTimeout(t);
      resolve(true);
    });
    ready.set(id, list);
  });
}
function markReady(id: string) {
  created.add(id);
  for (const f of ready.get(id) ?? []) f();
  ready.delete(id);
}

const ev = (id: string, js: string) => invoke<unknown>("browser_eval", { id, js }).catch(() => null);

export function BrowserView(props: Props) {
  let area!: HTMLDivElement;
  let urlInput!: HTMLInputElement;
  let textBox: HTMLTextAreaElement | undefined;
  const [url, setUrl] = createSignal(props.url);
  const [typed, setTyped] = createSignal(props.url);
  const [title, setTitle] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const [edit, setEdit] = createSignal(false);
  const [global, setGlobal] = createSignal(false);
  const [marks, setMarks] = createSignal<Mark[]>([]);
  const [text, setText] = createSignal("");
  const [status, setStatus] = createSignal<Status>({ kind: "idle" });
  const [hmr, setHmr] = createSignal(false);
  const [errors, setErrors] = createSignal<string[]>([]);
  const [failed, setFailed] = createSignal<string | null>(null);
  const [hidden, setHidden] = createSignal(false);
  let isCreated = false;
  let sent: { owner: string; sawActive: boolean; hook: boolean } | null = null;

  const owner = () => (props.owner && props.targets.some((t) => t.id === props.owner) ? props.owner : undefined);

  // --- Posición: el WebView2 hijo va encima del rectángulo del área ---------------------------
  let last = "";
  const sync = () => {
    if (!isCreated) return;
    const r = area.getBoundingClientRect();
    const covered = coveredBy(r, document);
    const show = props.visible && r.width > 2 && r.height > 2 && !covered && !document.body.classList.contains("resizing");
    setHidden(props.visible && !show);
    const key = show ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}` : "hidden";
    if (key === last) return;
    last = key;
    void invoke("browser_bounds", { id: props.id, x: r.left, y: r.top, w: r.width, h: r.height, visible: show }).catch(() => {});
  };

  onMount(() => {
    const create = async () => {
      const r = area.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) {
        setTimeout(create, 100);
        return;
      }
      try {
        await invoke("browser_open", { id: props.id, url: props.url, x: r.left, y: r.top, w: r.width, h: r.height, owner: owner() ?? null });
        isCreated = true;
        last = "";
        sync();
        markReady(props.id);
      } catch (e) {
        setFailed(String(e));
      }
    };
    void create();
    const ro = new ResizeObserver(sync);
    ro.observe(area);
    const timer = setInterval(sync, 150);
    window.addEventListener("resize", sync);
    const uns: Array<Promise<() => void>> = [
      listen<{ id: string; url: string; loading: boolean }>("browser-nav", (e) => {
        if (e.payload.id !== props.id) return;
        setLoading(e.payload.loading);
        // Documento nuevo: los errores de consola que cuentan son los de esta página.
        if (e.payload.loading) setErrors([]);
        setUrl(e.payload.url);
        if (document.activeElement !== urlInput) setTyped(e.payload.url);
        if (!e.payload.loading) props.onUrl(e.payload.url);
      }),
      listen<{ id: string; title: string }>("browser-title", (e) => e.payload.id === props.id && setTitle(e.payload.title)),
      listen<{ id: string; marks: Mark[] }>("browser-marks", (e) => e.payload.id === props.id && setMarks(e.payload.marks ?? [])),
      listen<{ id: string; on: boolean }>("browser-edit", (e) => e.payload.id === props.id && setEdit(!!e.payload.on)),
      listen<{ id: string; hmr: boolean; title?: string }>("browser-page", (e) => {
        if (e.payload.id !== props.id) return;
        setHmr(!!e.payload.hmr);
        setMarks([]);
        if (e.payload.title) setTitle(e.payload.title);
        // Página nueva: si estaba en modo edición, sigue.
        if (edit()) void ev(props.id, "window.__alphaOverlay && __alphaOverlay.setEdit(true)");
      }),
      listen<{ id: string; text: string }>("browser-error", (e) => e.payload.id === props.id && setErrors((x) => [...x.slice(-19), e.payload.text])),
      listen<{ pane: string }>("agent-stop", (e) => {
        if (sent && e.payload.pane === sent.owner && status().kind !== "idle") finish();
      }),
    ];
    onCleanup(() => {
      ro.disconnect();
      clearInterval(timer);
      window.removeEventListener("resize", sync);
      for (const u of uns) void u.then((f) => f());
      created.delete(props.id);
      void invoke("browser_close", { id: props.id }).catch(() => {});
    });
  });
  createEffect(on(() => props.visible, () => sync(), { defer: true }));

  // --- Trabajando… listo ----------------------------------------------------------------------
  let doneTimer: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    sent = null;
    setStatus({ kind: "done" });
    void ev(props.id, "window.__alphaOverlay && __alphaOverlay.clear()");
    setMarks([]);
    setGlobal(false);
    // Sin recarga en caliente detectada, se recarga a mano (con ella, ya se ve el cambio).
    if (!hmr()) setTimeout(() => void invoke("browser_go", { id: props.id, action: "reload" }).catch(() => {}), 600);
    clearTimeout(doneTimer);
    doneTimer = setTimeout(() => status().kind === "done" && setStatus({ kind: "idle" }), 8000);
  };
  createEffect(() => {
    const s = status();
    if (!sent || (s.kind !== "working" && s.kind !== "attention")) return;
    const live = props.ownerLive(sent.owner);
    if (!live) return;
    if (live.active) sent.sawActive = true;
    if (live.bell && !live.active) setStatus({ kind: "attention" });
    else if (s.kind === "attention" && live.active) setStatus({ kind: "working", since: Date.now() });
    // Sin hook: listo cuando el agente trabajó y la terminal quedó en silencio.
    if (!sent.hook && sent.sawActive && !live.active && !live.bell) finish();
  });
  onCleanup(() => clearTimeout(doneTimer));

  // --- Acciones -------------------------------------------------------------------------------
  const go = (u: string) => {
    if (!u.trim()) return;
    setFailed(null);
    void invoke<string>("browser_navigate", { id: props.id, url: u }).then(setTyped, (e) => setFailed(String(e)));
  };
  const toggleEdit = async () => {
    const on = !edit();
    setEdit(on);
    await ev(props.id, `window.__alphaOverlay && __alphaOverlay.setEdit(${on})`);
    if (on) queueMicrotask(() => textBox?.focus());
  };
  const removeMark = (n: number) => void ev(props.id, `window.__alphaOverlay && __alphaOverlay.remove(${n})`);
  const clearMarks = () => {
    void ev(props.id, "window.__alphaOverlay && __alphaOverlay.clear()");
    setGlobal(false);
  };
  const canSend = () => !!owner() && !!text().trim() && (marks().length > 0 || global()) && status().kind !== "busy";
  const send = async () => {
    const to = owner();
    if (!to) return setStatus({ kind: "error", text: "Elegí a qué terminal (agente) va el pedido." });
    if (!text().trim()) return setStatus({ kind: "error", text: "Escribí qué querés cambiar." });
    setStatus({ kind: "busy", text: "Armando el pedido (capturas)…" });
    try {
      const r = await invoke<{ message: string; dir: string }>("browser_request", { id: props.id, text: text(), global: global() });
      if (!props.onSend(to, r.message)) throw new Error("Esa terminal no está lista");
      const live = props.ownerLive(to);
      sent = { owner: to, sawActive: false, hook: !!live?.hook };
      setText("");
      if (edit()) await toggleEdit();
      setStatus({ kind: "working", since: Date.now() });
    } catch (e) {
      setStatus({ kind: "error", text: String(e) });
    }
  };

  const host = () => {
    try {
      return new URL(url()).host || url();
    } catch {
      return url();
    }
  };
  const statusText = () => {
    const s = status();
    switch (s.kind) {
      case "busy":
        return s.text;
      case "working":
        return "Trabajando… (mirá la terminal del agente)";
      case "attention":
        return "El agente te necesita en su terminal";
      case "done":
        return hmr() ? "Listo ✓" : "Listo ✓ — recargando";
      case "error":
        return s.text;
      default:
        return "";
    }
  };
  const composer = () => edit() || marks().length > 0 || global() || status().kind !== "idle";

  return (
    <div class="browser-pane" classList={{ focused: props.focused }} onMouseDown={props.onFocus}>
      <div class="bp-bar">
        <button class="icon-btn" title="Atrás" onClick={() => void invoke("browser_go", { id: props.id, action: "back" })}>
          ←
        </button>
        <button class="icon-btn" title="Adelante" onClick={() => void invoke("browser_go", { id: props.id, action: "forward" })}>
          →
        </button>
        <button class="icon-btn" classList={{ spin: loading() }} title="Recargar (Shift+clic: sin caché)" onClick={(e) => void invoke("browser_go", { id: props.id, action: e.shiftKey ? "hard-reload" : "reload" })}>
          ↻
        </button>
        <input
          ref={urlInput}
          class="bp-url"
          spellcheck={false}
          value={typed()}
          title={title() ? `${title()}\n${url()}` : url()}
          onInput={(e) => setTyped(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") go(typed());
            if (e.key === "Escape") setTyped(url());
          }}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button class="bp-tool" classList={{ on: edit() }} title="Modo edición: pasá el mouse para ver cada elemento y hacé clic para marcarlo (Alt+clic: el de afuera). Esc sale." onClick={() => void toggleEdit()}>
          ✎ Editar
        </button>
        <button class="bp-tool" classList={{ on: global() }} title="Pedir un cambio sobre todo el sitio (con o sin elementos marcados)" onClick={() => setGlobal(!global())}>
          ◎ Todo el sitio
        </button>
        <Show when={errors().length > 0}>
          <span class="bp-errors" title={errors().join("\n\n")} onClick={() => setErrors([])}>
            ⚠ {errors().length}
          </span>
        </Show>
        <button class="icon-btn tiny-x" title="Cerrar el navegador" onClick={props.onClose}>
          ×
        </button>
      </div>
      <div class="bp-view" ref={area}>
        <Show when={failed()}>
          <div class="bp-msg">
            <b>No se pudo abrir {host()}</b>
            <span class="muted small">{failed()}</span>
          </div>
        </Show>
        <Show when={hidden() && !failed()}>
          <div class="bp-msg muted small">{title() || host()}</div>
        </Show>
      </div>
      <Show when={composer()}>
        <div class="bp-composer">
          <Show when={marks().length > 0 || global()}>
            <div class="bp-marks">
              <Show when={global()}>
                <span class="bp-mark global">
                  ◎ Todo el sitio
                  <button class="x" title="Quitar" onClick={() => setGlobal(false)}>
                    ×
                  </button>
                </span>
              </Show>
              <For each={marks()}>
                {(m) => (
                  <span class="bp-mark" title={`${m.selector}${m.component ? `\n${m.component.framework}: ${m.component.name}${m.component.source?.file ? ` (${m.component.source.file}${m.component.source.line ? `:${m.component.source.line}` : ""})` : ""}` : ""}`}>
                    <b>{m.n}</b> {markLabel(m)}
                    <button class="x" title="Desmarcar" onClick={() => removeMark(m.n)}>
                      ×
                    </button>
                  </span>
                )}
              </For>
              <Show when={marks().length > 1}>
                <button class="link small" onClick={clearMarks}>
                  desmarcar todo
                </button>
              </Show>
            </div>
          </Show>
          <Show when={edit() && marks().length === 0 && !global()}>
            <p class="muted small bp-hint">Hacé clic en los elementos que querés cambiar (o elegí «Todo el sitio»).</p>
          </Show>
          <div class="bp-ask">
            <textarea
              ref={textBox}
              rows={2}
              placeholder="¿Qué querés cambiar? Ctrl+Enter manda el pedido al agente."
              value={text()}
              onInput={(e) => setText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  if (canSend()) void send();
                }
              }}
            />
            <div class="bp-send">
              <label class="muted small">
                A
                <select class="text" value={owner() ?? ""} onChange={(e) => props.onOwner(e.currentTarget.value || undefined)}>
                  <option value="">elegí la terminal…</option>
                  <For each={props.targets}>{(t) => <option value={t.id}>{t.label}</option>}</For>
                </select>
              </label>
              <button class="primary" disabled={!canSend()} onClick={() => void send()}>
                Pedir al agente
              </button>
            </div>
          </div>
          <Show when={statusText()}>
            <div class="bp-status" classList={{ [status().kind]: true }}>
              <Show when={status().kind === "working" || status().kind === "busy"}>
                <span class="bp-spinner" />
              </Show>
              {statusText()}
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
