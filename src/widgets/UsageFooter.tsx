import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "../settings/schema";
import { ago, fmtPct, level, until } from "./format";

export interface UsageWindow {
  label: string;
  usedPct: number;
  resetsAt: number | null;
  stale: boolean;
}
export interface Usage {
  provider: string;
  exact: boolean;
  source: string;
  updatedAt: number | null;
  windows: UsageWindow[];
  note: string | null;
}

const NAMES: Record<string, string> = { claude: "Claude", codex: "Codex", agy: "Antigravity" };

/** Ventanas a mostrar en el footer (agy tiene muchas: se muestran las del grupo más usado). */
export function headline(u: Usage): UsageWindow[] {
  if (u.provider !== "agy" || u.windows.length <= 2) return u.windows;
  const groups = new Map<string, UsageWindow[]>();
  for (const w of u.windows) {
    const g = w.label.split(" · ")[0];
    groups.set(g, [...(groups.get(g) ?? []), w]);
  }
  const worst = [...groups.values()].sort((a, b) => Math.max(...b.map((w) => w.usedPct)) - Math.max(...a.map((w) => w.usedPct)))[0];
  return worst ?? u.windows.slice(0, 2);
}

function Provider(props: { id: "claude" | "codex" | "agy"; everyMs: number }) {
  const [u, setU] = createSignal<Usage | null>(null);
  const [err, setErr] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const load = async (force = false) => {
    if (busy()) return;
    setBusy(true);
    try {
      setU(await invoke<Usage>("usage_get", { provider: props.id, force }));
      setErr(null);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };
  createEffect(() => {
    const ms = props.everyMs;
    void load();
    const t = setInterval(() => !document.hidden && void load(), ms);
    onCleanup(() => clearInterval(t));
  });

  const tooltip = () => {
    const x = u();
    if (!x) return err() ?? "Consultando…";
    const lines = [
      `${NAMES[props.id]} — ${x.exact ? "dato exacto" : "estimado"}`,
      `Fuente: ${x.source}`,
      x.updatedAt ? `Actualizado ${ago(x.updatedAt)}` : "",
      ...x.windows.map((w) => `${w.label}: ${w.stale ? "se reinició después del dato" : `${fmtPct(w.usedPct)} usado`}${w.resetsAt ? ` · reinicia ${until(w.resetsAt)}` : ""}`),
      x.note ?? "",
      "Clic: actualizar ahora",
    ];
    return lines.filter(Boolean).join("\n");
  };

  return (
    <button class="usage-item" classList={{ busy: busy() }} title={tooltip()} onClick={() => void load(true)}>
      <b>{NAMES[props.id]}</b>
      <Show when={u()} fallback={<span class="muted">{err() ? "error" : "…"}</span>}>
        <Show when={headline(u()!).length > 0} fallback={<span class="muted">{u()!.exact ? "sin datos" : "estimado"}</span>}>
          <For each={headline(u()!)}>
            {(w) => (
              <span class="usage-win" classList={{ stale: w.stale }}>
                <span class="usage-label">{w.label.includes(" · ") ? w.label.split(" · ")[1] : w.label}</span>
                <span class="usage-bar">
                  <i class={`lv-${level(w.usedPct)}`} style={{ width: `${w.stale ? 0 : Math.max(2, w.usedPct)}%` }} />
                </span>
                <span class="usage-pct">{w.stale ? "–" : fmtPct(w.usedPct)}</span>
              </span>
            )}
          </For>
        </Show>
        <Show when={!u()!.exact}>
          <span class="badge" title="Dato estimado">≈</span>
        </Show>
        <Show when={u()!.updatedAt && Date.now() - u()!.updatedAt! > 6 * 3_600_000}>
          <span class="badge old" title={`Dato de ${ago(u()!.updatedAt!)}`}>
            {ago(u()!.updatedAt!)}
          </span>
        </Show>
      </Show>
    </button>
  );
}

/** Footer de consumo: cada proveedor se prende o apaga en Configuración. */
export function UsageFooter(props: { usage: Settings["usage"]; onSettings: () => void }) {
  const any = () => props.usage.claude || props.usage.codex || props.usage.agy;
  return (
    <Show when={any()}>
      <footer class="usage-footer">
        <Show when={props.usage.claude}>
          <Provider id="claude" everyMs={props.usage.filesEverySec * 1000} />
        </Show>
        <Show when={props.usage.codex}>
          <Provider id="codex" everyMs={props.usage.filesEverySec * 1000} />
        </Show>
        <Show when={props.usage.agy}>
          <Provider id="agy" everyMs={props.usage.agyEveryMin * 60_000} />
        </Show>
        <button class="usage-gear" title="Configurar el consumo" onClick={props.onSettings}>
          ⚙
        </button>
      </footer>
    </Show>
  );
}
