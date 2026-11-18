import { createSignal, type Accessor } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { clone, DEFAULTS, normalize, type Settings } from "./schema";
import { BASE_COLORS } from "./themes";

interface Loaded {
  path: string;
  value: unknown;
  warning: string | null;
}

export interface SettingsStore {
  settings: Accessor<Settings>;
  /** Ruta de settings.json (para mostrarla). */
  path: string;
  warning: Accessor<string | null>;
  /** Cambia la configuración (se aplica ya en esta ventana y se guarda, y le llega a las demás). */
  update: (f: (draft: Settings) => void) => void;
  /** Vuelve todo a los valores de fábrica. */
  reset: () => void;
}

const SAVE_DELAY_MS = 150;
// Preferencia de F2 (antes de que existiera settings.json).
const OLD_VERTICAL_PREF = "novaterm.tabbar.vertical";

let pending: Promise<SettingsStore> | null = null;

/** Una sola vez por ventana. */
export function loadSettings(): Promise<SettingsStore> {
  pending ??= create();
  return pending;
}

async function create(): Promise<SettingsStore> {
  const me = getCurrentWindow().label;
  const loaded = await invoke<Loaded>("settings_load");
  const [settings, setSettings] = createSignal<Settings>(normalize(loaded.value, BASE_COLORS));
  // Al arrancar con el archivo roto se usan los valores de fábrica; si se rompe después, sigue
  // valiendo lo último que andaba. En los dos casos, guardar desde acá lo reemplaza (con copia .bak).
  const [warning, setWarning] = createSignal<string | null>(
    loaded.warning && `${loaded.warning} Mientras tanto se usan los valores de fábrica; si cambiás algo acá, se guarda un archivo nuevo y el roto queda como settings.json.bak.`,
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      invoke("settings_save", { value: settings() })
        .then(() => setWarning(null))
        .catch((e) => setWarning(`No se pudo guardar: ${e}`));
    }, SAVE_DELAY_MS);
  };

  const update = (f: (draft: Settings) => void) => {
    const draft = clone(settings());
    f(draft);
    setSettings(normalize(draft, BASE_COLORS));
    save();
  };

  // Migración: la barra vertical de F2 vivía en localStorage.
  if (loaded.value == null && !loaded.warning) {
    let vertical = false;
    try {
      vertical = localStorage.getItem(OLD_VERTICAL_PREF) === "1";
      localStorage.removeItem(OLD_VERTICAL_PREF);
    } catch {
      /* sin almacenamiento */
    }
    if (vertical && me !== "settings") update((d) => void (d.tabBar.position = "left"));
  }

  await listen<{ source: string; value: unknown }>("settings-changed", (e) => {
    if (e.payload.source === me) return; // lo guardó esta misma ventana
    setSettings(normalize(e.payload.value, BASE_COLORS));
    setWarning(null);
  });
  await listen<string | null>("settings-error", (e) =>
    setWarning(e.payload && `${e.payload} Sigue valiendo la última configuración que andaba hasta que se corrija.`),
  );

  return {
    settings,
    path: loaded.path,
    warning,
    update,
    reset: () => update((d) => Object.assign(d, clone(DEFAULTS))),
  };
}

export const openSettings = () => invoke("settings_open");
export const revealSettings = () => invoke("settings_reveal");
