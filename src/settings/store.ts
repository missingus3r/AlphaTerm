import { createSignal, type Accessor } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { clone, DEFAULTS, normalize, type Settings } from "./schema";
import { BASE_COLORS } from "./themes";
import { detectLang, setLang, t } from "../i18n";

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
const OLD_VERTICAL_PREF = "alphaterm.tabbar.vertical";

let pending: Promise<SettingsStore> | null = null;

/** Una sola vez por ventana. */
export function loadSettings(): Promise<SettingsStore> {
  pending ??= create();
  return pending;
}

async function create(): Promise<SettingsStore> {
  const me = getCurrentWindow().label;
  const loaded = await invoke<Loaded>("settings_load");
  // Instalación nueva (sin settings.json): el idioma del sistema. Una configuración de antes de que
  // hubiera idiomas no trae la clave y queda en español (lo pone `normalize`).
  const fresh = loaded.value == null && !loaded.warning;
  const [settings, setSettings] = createSignal<Settings>(normalize(fresh ? { language: detectLang() } : loaded.value, BASE_COLORS));
  setLang(settings().language);
  // Al arrancar con el archivo roto se usan los valores de fábrica; si se rompe después, sigue
  // valiendo lo último que andaba. En los dos casos, guardar desde acá lo reemplaza (con copia .bak).
  const [warning, setWarning] = createSignal<string | null>(
    loaded.warning &&
      t("{warning} Mientras tanto se usan los valores de fábrica; si cambiás algo acá, se guarda un archivo nuevo y el roto queda como settings.json.bak.", {
        warning: loaded.warning,
      }),
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      invoke("settings_save", { value: settings() })
        .then(() => setWarning(null))
        .catch((e) => setWarning(t("No se pudo guardar: {error}", { error: String(e) })));
    }, SAVE_DELAY_MS);
  };

  const update = (f: (draft: Settings) => void) => {
    const draft = clone(settings());
    f(draft);
    setSettings(normalize(draft, BASE_COLORS));
    save();
  };

  // Instalación nueva. Migración: la barra vertical de F2 vivía en localStorage.
  if (fresh) {
    let vertical = false;
    try {
      vertical = localStorage.getItem(OLD_VERTICAL_PREF) === "1";
      localStorage.removeItem(OLD_VERTICAL_PREF);
    } catch {
      /* sin almacenamiento */
    }
    if (vertical && me !== "settings") update((d) => void (d.tabBar.position = "left"));
    else if (me !== "settings") save(); // que el idioma detectado quede guardado
  }

  await listen<{ source: string; value: unknown }>("settings-changed", (e) => {
    if (e.payload.source === me) return; // lo guardó esta misma ventana
    setSettings(normalize(e.payload.value, BASE_COLORS));
    setWarning(null);
  });
  await listen<string | null>("settings-error", (e) =>
    setWarning(e.payload && t("{warning} Sigue valiendo la última configuración que andaba hasta que se corrija.", { warning: e.payload })),
  );

  return {
    settings,
    path: loaded.path,
    warning,
    update,
    reset: () => update((d) => Object.assign(d, clone(DEFAULTS))),
  };
}

// La configuración se abre dentro de la misma ventana (encima de las pestañas), no en otra.
const [settingsOpen, setSettingsOpen] = createSignal(false);
export { settingsOpen };
export const openSettings = () => {
  // Que las teclas no sigan yendo a la terminal que tenía el foco.
  (document.activeElement as HTMLElement | null)?.blur?.();
  setSettingsOpen(true);
};
export const closeSettings = () => setSettingsOpen(false);
export const revealSettings = () => invoke("settings_reveal");
