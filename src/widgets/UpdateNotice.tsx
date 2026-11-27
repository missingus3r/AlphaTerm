/**
 * Footer notice of an update between computers (app-versions): updating / installed / blocked / failed.
 * Reads status/alphaterm.json through `update_status` every 3 s during the first minute (the check runs a few
 * seconds after startup) and while an update is in progress. The × hides it until the next start.
 */
import { invoke } from "@tauri-apps/api/core";
import { createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { lang, t } from "../i18n";
import { appInfo } from "./appInfo";
import { changeText, IN_PROGRESS, noticeFor, type UpdateStatus } from "./updateStatus";

const POLL_MS = 3000;
const FIRST_MINUTE_MS = 60_000;

export function UpdateNotice() {
  const [info] = createResource(appInfo);
  const [status, setStatus] = createSignal<UpdateStatus | null>(null);
  const [closed, setClosed] = createSignal(false);
  const [showChanges, setShowChanges] = createSignal(false);
  let since = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const poll = async () => {
    const s = await invoke<UpdateStatus | null>("update_status").catch(() => null);
    setStatus(s);
    if ((s && IN_PROGRESS.has(s.state)) || Date.now() - since < FIRST_MINUTE_MS) timer = setTimeout(poll, POLL_MS);
  };
  onMount(poll);
  onCleanup(() => clearTimeout(timer));

  const retry = async () => {
    await invoke("update_retry").catch(() => undefined);
    clearTimeout(timer);
    since = Date.now();
    poll();
  };
  const notice = () => (info() ? noticeFor(status(), info()!.version) : null);
  const changes = () => status()?.changes ?? [];

  return (
    <Show when={!closed() && notice()}>
      {(n) => (
        <div class={`update-notice ${n().kind}`} role="status">
          <span class="un-dot" />
          <span class="un-text" title={n().text}>
            {n().text}
            <Show when={n().step}>
              <span class="un-step"> · {n().step}</span>
            </Show>
          </span>
          <Show when={n().kind !== "failed" && changes().length > 0}>
            <button class="un-btn" onClick={() => setShowChanges(!showChanges())}>
              {t("Ver cambios")}
            </button>
          </Show>
          <Show when={n().kind === "failed"}>
            <button class="un-btn" onClick={() => invoke("update_open_log").catch(() => undefined)}>
              {t("Ver registro")}
            </button>
            <button class="un-btn" onClick={retry}>
              {t("Reintentar")}
            </button>
          </Show>
          <button class="un-close" title={t("Cerrar")} onClick={() => setClosed(true)}>
            ×
          </button>
          <Show when={showChanges()}>
            <div class="un-changes">
              <div class="un-changes-title">{t("Qué trae {version}", { version: status()?.version ?? "" })}</div>
              <ul>
                <For each={changes()}>{(c) => <li>{changeText(c, lang())}</li>}</For>
              </ul>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}
