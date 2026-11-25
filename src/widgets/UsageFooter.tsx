import { createEffect, createResource, For, onCleanup, onMount, Show, createSignal, untrack } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { Settings } from "../settings/schema";
import { ago, fmtPct, level } from "./format";

import { headline, PROVIDER_NAMES, type ProviderId } from "./usage";
import { listenUsage, loadUsage, usageBusy, usageError, usageOf } from "./usageStore";
import { UsageDetail, windowName } from "./UsageDetail";
import { appInfo, versionTooltip } from "./appInfo";
import { ChangelogModal } from "./ChangelogModal";
import { t } from "../i18n";
import { pathSegments } from "./pathSegments";
export { providerFor, type ProviderId } from "./usage";

const NAMES = PROVIDER_NAMES;

function Provider(props: { id: ProviderId; everyMs: number; active: boolean; open: boolean; onOpen: (open: boolean) => void }) {
  const u = () => usageOf(props.id);
  const err = () => usageError(props.id);
  const busy = () => usageBusy(props.id);
  // The cheap stuff (files and the latest live-query result) is re-read often; the live query
  // is run by the backend when AlphaTerm opens and every so many minutes.
  createEffect(() => {
    const ms = props.everyMs;
    untrack(() => void loadUsage(props.id));
    const timer = setInterval(() => !document.hidden && void loadUsage(props.id), ms);
    onCleanup(() => clearInterval(timer));
  });

  return (
    <span class="usage-wrap">
      <button
        class="usage-item"
        classList={{ busy: busy(), "active-agent": props.active }}
        title={props.active ? t("{name}: el agente de la pestaña activa (clic para el detalle)", { name: NAMES[props.id] }) : t("{name} (clic para el detalle)", { name: NAMES[props.id] })}
        onClick={() => props.onOpen(!props.open)}
      >
        <b>{NAMES[props.id]}</b>
        <Show when={u()} fallback={<span class="muted">{err() ? t("error") : "…"}</span>}>
          <Show when={headline(u()!).length > 0} fallback={<span class="muted">{u()!.refreshing ? t("consultando…") : u()!.exact ? t("sin datos") : t("estimado")}</span>}>
            <For each={headline(u()!)}>
              {(w) => (
                <span class="usage-win" classList={{ stale: w.stale }}>
                  <span class="usage-label">{windowName(w.label.includes(" · ") ? w.label.split(" · ")[1] : w.label)}</span>
                  <span class="usage-bar">
                    <i class={`lv-${level(w.usedPct)}`} style={{ width: `${w.stale ? 0 : Math.max(2, w.usedPct)}%` }} />
                  </span>
                  <span class="usage-pct">{w.stale ? "–" : fmtPct(w.usedPct)}</span>
                </span>
              )}
            </For>
          </Show>
          <Show when={!u()!.exact}>
            <span class="badge" title={t("Dato estimado")}>≈</span>
          </Show>
          <Show when={u()!.updatedAt && Date.now() - u()!.updatedAt! > 6 * 3_600_000}>
            <span class="badge old">{ago(u()!.updatedAt!)}</span>
          </Show>
        </Show>
      </button>
      <Show when={props.open}>
        <div class="usage-pop" role="dialog" aria-label={t("Consumo de {name}", { name: NAMES[props.id] })}>
          <UsageDetail id={props.id} />
        </div>
      </Show>
    </span>
  );
}

/** Location of the active pane: each segment opens that folder; button to copy the path. */
function Location(props: { cwd?: string; branch?: string }) {
  const parts = () => {
    return pathSegments(props.cwd ?? "");
  };
  const openDir = (path: string) => void invoke("fs_open", { path, with: "explorer" }).catch(() => {});
  return (
    <div class="location" title={props.cwd ?? t("Sin carpeta conocida")}>
      <span class="loc-icon">📁</span>
      <Show when={parts().length} fallback={<span class="muted">—</span>}>
        <For each={parts()}>
          {(s, i) => (
            <>
              <Show when={i() > 0}>
                <span class="loc-sep">›</span>
              </Show>
              <button class="loc-seg" classList={{ last: i() === parts().length - 1 }} title={t("Abrir {path}", { path: s.path })} onClick={() => openDir(s.path)}>
                {s.name}
              </button>
            </>
          )}
        </For>
        <button class="loc-copy" title={t("Copiar la ruta")} onClick={() => props.cwd && void writeText(props.cwd)}>
          ⧉
        </button>
      </Show>
      <Show when={props.branch}>
        <span class="loc-branch" title={t("Rama git")}>
          ⎇ {props.branch}
        </span>
      </Show>
    </div>
  );
}

/** Running version (the tooltip carries the commit, build date and where the executable is). */
function Version(props: { onClick: () => void }) {
  const [info] = createResource(appInfo);
  return (
    <Show when={info()}>
      <button class="app-version" title={`${versionTooltip(info()!)}\n\n${t("Clic: configuración (Acerca y límites)")}`} onClick={props.onClick}>
        v{info()!.version}
        <Show when={info()!.commit.endsWith("+")}>
          <span class="dirty">+</span>
        </Show>
      </button>
    </Show>
  );
}

/** "Novedades" button: changelog between versions with their commits. */
function Novedades() {
  const [info] = createResource(appInfo);
  const [show, setShow] = createSignal(false);
  return (
    <>
      <button class="app-version news" title={t("Novedades: qué trae cada versión (sus commits)")} onClick={() => setShow(true)}>
        ✦ {t("Novedades")}
      </button>
      <Show when={show()}>
        <ChangelogModal current={info()?.version} onClose={() => setShow(false)} />
      </Show>
    </>
  );
}

/** Footer: location of the active pane and usage (the open agent's first and highlighted). */
export function UsageFooter(props: { usage: Settings["usage"]; onSettings: () => void; cwd?: string; branch?: string; activeProvider: ProviderId | null }) {
  const [open, setOpen] = createSignal<ProviderId | null>(null);
  let root!: HTMLElement;
  onMount(() => {
    const away = (e: MouseEvent) => !root.contains(e.target as Node) && setOpen(null);
    window.addEventListener("mousedown", away);
    onCleanup(() => window.removeEventListener("mousedown", away));
  });
  onMount(listenUsage);
  const enabled = () => (["claude", "codex", "agy"] as ProviderId[]).filter((p) => props.usage[p]);
  // The active agent's goes first (even if it is off in the settings: it is the one in use).
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
              everyMs={props.usage.filesEverySec * 1000}
              active={p === props.activeProvider}
              open={open() === p}
              onOpen={(o) => setOpen(o ? p : null)}
            />
          )}
        </For>
        <button class="usage-gear" title={t("Configurar el consumo")} onClick={props.onSettings}>
          ⚙
        </button>
        <Version onClick={props.onSettings} />
        <Novedades />
      </div>
    </footer>
  );
}
