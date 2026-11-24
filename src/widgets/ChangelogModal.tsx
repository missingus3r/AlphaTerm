import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { t } from "../i18n";
import { between, CHANGELOG, commitText, fmtDate } from "./changelog";

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
  const summary = () => {
    const n = total();
    const v = shown().length;
    if (v !== 1) return t("{n} commits en {v} versiones", { n, v });
    return n === 1 ? t("1 commit en 1 versión") : t("{n} commits en 1 versión", { n });
  };
  const commits = (n: number) => (n === 1 ? t("1 commit") : t("{n} commits", { n }));

  onMount(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", esc);
    onCleanup(() => window.removeEventListener("keydown", esc));
  });

  return (
    <div class="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="changelog" role="dialog" aria-label={t("Novedades de AlphaTerm")}>
        <header class="cl-head">
          <b>{t("Novedades")}</b>
          <span class="muted">{summary()}</span>
          <button class="icon-btn" title={t("Cerrar (Esc)")} onClick={props.onClose}>
            ×
          </button>
        </header>
        <div class="cl-range">
          <label>
            {t("Después de")}
            <select class="text" value={from()} onChange={(e) => setFrom(e.currentTarget.value)}>
              <option value="">{t("el principio")}</option>
              <For each={versions}>{(v) => <option value={v}>{v}</option>}</For>
            </select>
          </label>
          <label>
            {t("hasta")}
            <select class="text" value={to()} onChange={(e) => setTo(e.currentTarget.value)}>
              <option value="">{t("lo último")}</option>
              <For each={versions}>{(v) => <option value={v}>{v}</option>}</For>
            </select>
          </label>
          <button class="link small" onClick={() => setOpen(new Set(shown().map((v) => keyOf(v.version))))}>
            {t("abrir todas")}
          </button>
          <button class="link small" onClick={() => setOpen(new Set<string>())}>
            {t("cerrar todas")}
          </button>
        </div>
        <div class="cl-list">
          <For each={shown()} fallback={<p class="muted small">{t("No hay versiones en ese rango.")}</p>}>
            {(v) => {
              const k = keyOf(v.version);
              return (
                <section class="cl-version" classList={{ current: v.version === props.current }}>
                  <button class="cl-vhead" onClick={() => toggle(k)}>
                    <span class="caret">{open().has(k) ? "▾" : "▸"}</span>
                    <b>{v.version ? `v${v.version}` : t("Sin publicar")}</b>
                    <Show when={v.version === props.current}>
                      <span class="badge nt">{t("la que usás")}</span>
                    </Show>
                    <span class="muted">
                      {fmtDate(v.date)} · {commits(v.commits.length)}
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
                                title={`${c.hash}\n${t("Clic: copiar")}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void writeText(c.hash);
                                }}
                              >
                                {c.short}
                              </code>
                              <span class="cl-subject">{commitText(c).subject}</span>
                              <span class="muted small">{fmtDate(c.date)}</span>
                              <Show when={c.body}>
                                <span class="muted small">{body() === c.hash ? "▾" : "…"}</span>
                              </Show>
                            </div>
                            <Show when={body() === c.hash}>
                              <pre class="cl-body">{commitText(c).body}</pre>
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
