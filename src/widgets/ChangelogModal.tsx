import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { between, CHANGELOG, fmtDate } from "./changelog";

/** Novedades: cada versión con sus commits; se puede filtrar "de tal versión a tal otra". */
export function ChangelogModal(props: { current?: string; onClose: () => void }) {
  const versions = CHANGELOG.filter((v) => v.version).map((v) => v.version!);
  const [from, setFrom] = createSignal<string>("");
  const [to, setTo] = createSignal<string>("");
  const shown = createMemo(() => between(CHANGELOG, from() || undefined, to() || undefined));
  // Abierta de entrada: la versión que corre (o la primera de la lista).
  const [open, setOpen] = createSignal<Set<string>>(new Set([props.current ?? CHANGELOG[0]?.version ?? "sin publicar"]));
  const keyOf = (v: string | null) => v ?? "sin publicar";
  const toggle = (k: string) => {
    const s = new Set(open());
    if (s.has(k)) s.delete(k);
    else s.add(k);
    setOpen(s);
  };
  const [body, setBody] = createSignal<string | null>(null);
  const total = () => shown().reduce((n, v) => n + v.commits.length, 0);

  onMount(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", esc);
    onCleanup(() => window.removeEventListener("keydown", esc));
  });

  return (
    <div class="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="changelog" role="dialog" aria-label="Novedades de AlphaTerm">
        <header class="cl-head">
          <b>Novedades</b>
          <span class="muted">
            {total()} commits en {shown().length} {shown().length === 1 ? "versión" : "versiones"}
          </span>
          <button class="icon-btn" title="Cerrar (Esc)" onClick={props.onClose}>
            ×
          </button>
        </header>
        <div class="cl-range">
          <label>
            Después de
            <select class="text" value={from()} onChange={(e) => setFrom(e.currentTarget.value)}>
              <option value="">el principio</option>
              <For each={versions}>{(v) => <option value={v}>{v}</option>}</For>
            </select>
          </label>
          <label>
            hasta
            <select class="text" value={to()} onChange={(e) => setTo(e.currentTarget.value)}>
              <option value="">lo último</option>
              <For each={versions}>{(v) => <option value={v}>{v}</option>}</For>
            </select>
          </label>
          <button class="link small" onClick={() => setOpen(new Set(shown().map((v) => keyOf(v.version))))}>
            abrir todas
          </button>
          <button class="link small" onClick={() => setOpen(new Set<string>())}>
            cerrar todas
          </button>
        </div>
        <div class="cl-list">
          <For each={shown()} fallback={<p class="muted small">No hay versiones en ese rango.</p>}>
            {(v) => {
              const k = keyOf(v.version);
              return (
                <section class="cl-version" classList={{ current: v.version === props.current }}>
                  <button class="cl-vhead" onClick={() => toggle(k)}>
                    <span class="caret">{open().has(k) ? "▾" : "▸"}</span>
                    <b>{v.version ? `v${v.version}` : "Sin publicar"}</b>
                    <Show when={v.version === props.current}>
                      <span class="badge nt">la que usás</span>
                    </Show>
                    <span class="muted">
                      {fmtDate(v.date)} · {v.commits.length} {v.commits.length === 1 ? "commit" : "commits"}
                    </span>
                  </button>
                  <Show when={open().has(k)}>
                    <ul class="cl-commits">
                      <For each={v.commits}>
                        {(c) => (
                          <li>
                            <div class="cl-commit" onClick={() => c.body && setBody(body() === c.hash ? null : c.hash)} classList={{ expandable: !!c.body }}>
                              <code
                                class="cl-hash"
                                title={`${c.hash}\nClic: copiar`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void writeText(c.hash);
                                }}
                              >
                                {c.short}
                              </code>
                              <span class="cl-subject">{c.subject}</span>
                              <span class="muted small">{fmtDate(c.date)}</span>
                              <Show when={c.body}>
                                <span class="muted small">{body() === c.hash ? "▾" : "…"}</span>
                              </Show>
                            </div>
                            <Show when={body() === c.hash}>
                              <pre class="cl-body">{c.body}</pre>
                            </Show>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </section>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
}
