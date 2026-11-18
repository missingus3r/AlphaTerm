import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { Settings } from "../settings/schema";
import { ago, fmtPct, level, until } from "./format";

import { headline, type ProviderId, type Usage } from "./usage";
export { providerFor, type ProviderId } from "./usage";

const NAMES: Record<ProviderId, string> = { claude: "Claude", codex: "Codex", agy: "Antigravity" };

function Provider(props: { id: ProviderId; everyMs: number; active: boolean; open: boolean; onOpen: (open: boolean) => void }) {
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

  return (
    <span class="usage-wrap">
      <button
        class="usage-item"
        classList={{ busy: busy(), "active-agent": props.active }}
        title={props.active ? `${NAMES[props.id]}: el agente de la pestaña activa (clic para el detalle)` : `${NAMES[props.id]} (clic para el detalle)`}
        onClick={() => props.onOpen(!props.open)}
      >
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
            <span class="badge old">{ago(u()!.updatedAt!)}</span>
          </Show>
        </Show>
      </button>
      <Show when={props.open}>
        <div class="usage-pop" role="dialog" aria-label={`Consumo de ${NAMES[props.id]}`}>
          <div class="up-head">
            <b>{NAMES[props.id]}</b>
            <span class="badge">{u()?.exact ? "exacto" : "estimado"}</span>
            <button class="link small" disabled={busy()} onClick={() => void load(true)}>
              {busy() ? "Actualizando…" : "Actualizar"}
            </button>
          </div>
          <Show when={err()}>
            <div class="banner">{err()}</div>
          </Show>
          <Show when={u()}>
            <table>
              <tbody>
                <For each={u()!.windows}>
                  {(w) => (
                    <tr classList={{ stale: w.stale }}>
                      <td>{w.label}</td>
                      <td class="bar-cell">
                        <span class="usage-bar wide">
                          <i class={`lv-${level(w.usedPct)}`} style={{ width: `${w.stale ? 0 : Math.max(1, w.usedPct)}%` }} />
                        </span>
                      </td>
                      <td class="num">{w.stale ? "–" : fmtPct(w.usedPct)}</td>
                      <td class="muted">{w.resetsAt ? `reinicia ${until(w.resetsAt)}` : ""}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
            <p class="muted small">
              Fuente: {u()!.source}
              {u()!.updatedAt ? ` · ${ago(u()!.updatedAt!)}` : ""}
            </p>
            <Show when={u()!.note}>
              <p class="small">{u()!.note}</p>
            </Show>
          </Show>
        </div>
      </Show>
    </span>
  );
}

/** Ubicación del panel activo: cada tramo abre esa carpeta; botón para copiar la ruta. */
function Location(props: { cwd?: string; branch?: string }) {
  const parts = () => {
    const p = (props.cwd ?? "").replace(/[\\/]+$/, "");
    if (!p) return [];
    const segs = p.split(/[\\/]/);
    return segs.map((name, i) => ({ name: name || "\\", path: segs.slice(0, i + 1).join("\\") + (i === 0 ? "\\" : "") }));
  };
  const openDir = (path: string) => void invoke("fs_open", { path, with: "explorer" }).catch(() => {});
  return (
    <div class="location" title={props.cwd ?? "Sin carpeta conocida"}>
      <span class="loc-icon">📁</span>
      <Show when={parts().length} fallback={<span class="muted">—</span>}>
        <For each={parts()}>
          {(s, i) => (
            <>
              <Show when={i() > 0}>
                <span class="loc-sep">›</span>
              </Show>
              <button class="loc-seg" classList={{ last: i() === parts().length - 1 }} title={`Abrir ${s.path}`} onClick={() => openDir(s.path)}>
                {s.name}
              </button>
            </>
          )}
        </For>
        <button class="loc-copy" title="Copiar la ruta" onClick={() => props.cwd && void writeText(props.cwd)}>
          ⧉
        </button>
      </Show>
      <Show when={props.branch}>
        <span class="loc-branch" title="Rama git">
          ⎇ {props.branch}
        </span>
      </Show>
    </div>
  );
}

/** Footer: ubicación del panel activo y consumo (el del agente abierto, primero y resaltado). */
export function UsageFooter(props: { usage: Settings["usage"]; onSettings: () => void; cwd?: string; branch?: string; activeProvider: ProviderId | null }) {
  const [open, setOpen] = createSignal<ProviderId | null>(null);
  let root!: HTMLElement;
  onMount(() => {
    const away = (e: MouseEvent) => !root.contains(e.target as Node) && setOpen(null);
    window.addEventListener("mousedown", away);
    onCleanup(() => window.removeEventListener("mousedown", away));
  });
  const enabled = () => (["claude", "codex", "agy"] as ProviderId[]).filter((p) => props.usage[p]);
  // El del agente activo va primero (aunque esté apagado en la configuración: es el que se está usando).
  const order = () => {
    const a = props.activeProvider;
    const list = enabled().filter((p) => p !== a);
    return a ? [a, ...list] : list;
  };
  return (
    <footer class="usage-footer" ref={root}>
      <Location cwd={props.cwd} branch={props.branch} />
      <div class="usage-list">
        <For each={order()}>
          {(p) => (
            <Provider
              id={p}
              everyMs={p === "agy" ? props.usage.agyEveryMin * 60_000 : props.usage.filesEverySec * 1000}
              active={p === props.activeProvider}
              open={open() === p}
              onOpen={(o) => setOpen(o ? p : null)}
            />
          )}
        </For>
        <button class="usage-gear" title="Configurar el consumo" onClick={props.onSettings}>
          ⚙
        </button>
      </div>
    </footer>
  );
}
