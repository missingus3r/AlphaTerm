import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { t } from "../i18n";

export interface Ask {
  id: number;
  kind: "delete" | "modify";
  agent: string;
  tool: string;
  summary: string;
  paths: string[];
  detail: string | null;
  cwd: string | null;
  session: string | null;
}

/** Guardian question: appears in all windows; the first answer decides. */
export function GuardianModal() {
  const [queue, setQueue] = createSignal<Ask[]>([]);
  const [busy, setBusy] = createSignal(false);
  onMount(async () => {
    setQueue(await invoke<Ask[]>("guardian_open").catch(() => []));
    const un1 = await listen<Ask>("guardian-ask", (e) => setQueue((q) => (q.some((x) => x.id === e.payload.id) ? q : [...q, e.payload])));
    const un2 = await listen<number>("guardian-done", (e) => setQueue((q) => q.filter((x) => x.id !== e.payload)));
    onCleanup(() => {
      un1();
      un2();
    });
  });
  const answer = async (a: Ask, decision: "allow" | "allowSession" | "deny") => {
    setBusy(true);
    try {
      await invoke("guardian_answer", { id: a.id, decision });
    } finally {
      setBusy(false);
      setQueue((q) => q.filter((x) => x.id !== a.id));
    }
  };
  const current = () => queue()[0];

  return (
    <Show when={current()}>
      {(a) => (
        <div class="guardian-backdrop" role="dialog" aria-modal="true" aria-label={t("Guardián de AlphaTerm")}>
          <div class="guardian" classList={{ del: a().kind === "delete" }}>
            <div class="g-head">
              <span class="g-icon">{a().kind === "delete" ? "🗑" : "✎"}</span>
              <div>
                <b>{a().kind === "delete" ? t("Un agente quiere borrar") : t("Un agente quiere modificar")}</b>
                <small>
                  {a().agent} · {a().tool}
                  {queue().length > 1 ? ` · ${t("{n} más esperando", { n: queue().length - 1 })}` : ""}
                </small>
              </div>
            </div>
            <p class="g-summary">{a().summary}</p>
            <Show when={a().paths.length}>
              <ul class="g-paths">
                <For each={a().paths}>{(p) => <li class="mono">{p}</li>}</For>
              </ul>
            </Show>
            <Show when={a().cwd}>
              <p class="muted small">{t("Carpeta: {path}", { path: a().cwd ?? "" })}</p>
            </Show>
            <Show when={a().detail}>
              <pre class="g-detail">{a().detail}</pre>
            </Show>
            <div class="g-actions">
              <button class="btn danger" disabled={busy()} onClick={() => void answer(a(), "deny")}>
                {t("Bloquear")}
              </button>
              <Show when={a().session}>
                <button class="btn" disabled={busy()} title={t("Lo mismo de este tipo, de esta sesión del agente, se permite solo durante 30 minutos")} onClick={() => void answer(a(), "allowSession")}>
                  {t("Permitir 30 min a esta sesión")}
                </button>
              </Show>
              <button class="btn primary" disabled={busy()} onClick={() => void answer(a(), "allow")}>
                {t("Permitir esta vez")}
              </button>
            </div>
            <p class="muted small">{t("Si nadie contesta en 10 minutos, se bloquea. El guardián se apaga en Configuración → Agentes y guardián.")}</p>
          </div>
        </div>
      )}
    </Show>
  );
}
