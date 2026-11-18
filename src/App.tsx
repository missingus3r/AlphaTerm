import { createMemo, createResource, lazy, Show, Suspense } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { killOwned, termInfo } from "./terminal/pty";
import { Workspace } from "./layout/Workspace";
import { loadSettings, type SettingsStore } from "./settings/store";
import { termLook, useAppearance } from "./settings/apply";

// La ventana de configuración se carga solo cuando se abre.
const SettingsView = lazy(() => import("./settings/SettingsView"));

const IS_SETTINGS = getCurrentWindow().label === "settings";

function Themed(props: { store: SettingsStore }) {
  const { theme } = useAppearance(props.store.settings, !IS_SETTINGS);
  const [info] = createResource(async () => {
    // Si la vista se recargó, no dejar shells huérfanas de la carga anterior de esta ventana.
    if (!IS_SETTINGS) await killOwned();
    return termInfo();
  });
  const look = createMemo(() => termLook(props.store.settings(), theme()));
  return (
    <>
      <Show when={info.error}>
        <div class="error">No se pudo hablar con el backend: {String(info.error)}</div>
      </Show>
      <Show when={info()}>
        {(ti) =>
          IS_SETTINGS ? (
            <Suspense>
              <SettingsView info={ti()} store={props.store} />
            </Suspense>
          ) : (
            <Workspace info={ti()} store={props.store} look={look()} />
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
        <div class="error">No se pudo leer la configuración: {String(store.error)}</div>
      </Show>
      <Show when={store()}>{(s) => <Themed store={s()} />}</Show>
    </div>
  );
}
