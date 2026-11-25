import { createEffect, createMemo, createResource, lazy, Show, Suspense } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { killOwned, termInfo } from "./terminal/pty";
import { Workspace } from "./layout/Workspace";
import { ConfirmModal } from "./widgets/ConfirmModal";
import { loadSettings, type SettingsStore } from "./settings/store";
import { termLook, useAppearance } from "./settings/apply";
import { invoke } from "@tauri-apps/api/core";
import { newWindow } from "./terminal/pty";
import { setLang, t } from "./i18n";

// The settings window is loaded only when it's opened.
const SettingsView = lazy(() => import("./settings/SettingsView"));

const IS_SETTINGS = getCurrentWindow().label === "settings";

function Themed(props: { store: SettingsStore }) {
  const { theme } = useAppearance(props.store.settings, !IS_SETTINGS);
  const [info] = createResource(async () => {
    // If the view was reloaded, don't leave orphaned shells from this window's previous load.
    if (!IS_SETTINGS) await killOwned();
    return termInfo();
  });
  // Saved state of this window: the main one recovers the previous session (and reopens the
  // other windows); the others receive theirs when they open.
  const [initial] = createResource(async () => {
    if (IS_SETTINGS) return null;
    try {
      if (getCurrentWindow().label !== "main") return await invoke<unknown>("session_claim");
      const windows = await invoke<unknown[]>("session_restore");
      if (!props.store.settings().session.restore || windows.length === 0) return null;
      for (const w of windows.slice(1)) void newWindow(w);
      return windows[0];
    } catch {
      return null;
    }
  });
  const look = createMemo(() => termLook(props.store.settings(), theme()));
  // The backend needs to know whether the control API and the Guardian are on (and the Docker recipes,
  // so an agent can launch them by name).
  createEffect(() => {
    const s = props.store.settings();
    void invoke("control_config", {
      enabled: s.control.enabled,
      guardianOn: s.guardian.enabled,
      guardianModify: s.guardian.modify,
      guardianClaude: s.guardian.claude,
      presets: s.docker.presets,
    }).catch(() => {});
  });
  // Live usage (like the System dashboard): what to query and how often. The first time the
  // backend queries right away.
  createEffect(() => {
    const u = props.store.settings().usage;
    void invoke("usage_config", { claude: u.claude, codex: u.codex, agy: u.agy, everyMin: u.liveEveryMin }).catch(() => {});
  });
  // Language: the one from settings (also when another window changes it). The backend uses it for
  // its messages and passes it to new tabs (ALPHATERM_LANG) for the agent scripts.
  createEffect(() => {
    const l = props.store.settings().language;
    setLang(l);
    void invoke("set_locale", { lang: l }).catch(() => {});
  });
  createEffect(() => {
    const c = props.store.settings().changes;
    void invoke("changes_config", { enabled: c.enabled, claude: c.claude, folders: c.folders }).catch(() => {});
  });
  return (
    <>
      <Show when={info.error}>
        <div class="error">{t("No se pudo hablar con el backend: {error}", { error: String(info.error) })}</div>
      </Show>
      <Show when={!initial.loading && info()}>
        {(ti) =>
          IS_SETTINGS ? (
            <Suspense>
              <SettingsView info={ti()} store={props.store} />
              <ConfirmModal />
            </Suspense>
          ) : (
            <Workspace info={ti()} store={props.store} look={look()} initial={initial() ?? undefined} />
          )
        }
      </Show>
    </>
  );
}

export function App() {
  const [store] = createResource(loadSettings);
  return (
    <div class="app" classList={{ "settings-window": IS_SETTINGS }}>
      <Show when={store.error}>
        <div class="error">{t("No se pudo leer la configuración: {error}", { error: String(store.error) })}</div>
      </Show>
      <Show when={store()}>{(s) => <Themed store={s()} />}</Show>
    </div>
  );
}
