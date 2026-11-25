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
  /** Path of settings.json (to display it). */
  path: string;
  warning: Accessor<string | null>;
  /** Changes the settings (applied right away in this window, saved, and sent to the others). */
  update: (f: (draft: Settings) => void) => void;
  /** Resets everything to the default values. */
  reset: () => void;
}

const SAVE_DELAY_MS = 150;
// F2 preference (from before settings.json existed).
const OLD_VERTICAL_PREF = "alphaterm.tabbar.vertical";

let pending: Promise<SettingsStore> | null = null;

/** Once per window. */
export function loadSettings(): Promise<SettingsStore> {
  pending ??= create();
  return pending;
}

async function create(): Promise<SettingsStore> {
  const me = getCurrentWindow().label;
  const loaded = await invoke<Loaded>("settings_load");
  // New install (no settings.json): the system language. A configuration from before
  // languages existed has no such key and stays in Spanish (set by `normalize`).
  const fresh = loaded.value == null && !loaded.warning;
  const [settings, setSettings] = createSignal<Settings>(normalize(fresh ? { language: detectLang() } : loaded.value, BASE_COLORS));
  setLang(settings().language);
  // When starting with a broken file the defaults are used; if it breaks later, the last
  // working one stays in effect. In both cases, saving from here replaces it (with a .bak copy).
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

  // New install. Migration: F2's vertical bar used to live in localStorage.
  if (fresh) {
    let vertical = false;
    try {
      vertical = localStorage.getItem(OLD_VERTICAL_PREF) === "1";
      localStorage.removeItem(OLD_VERTICAL_PREF);
    } catch {
      /* no storage */
    }
    if (vertical && me !== "settings") update((d) => void (d.tabBar.position = "left"));
    else if (me !== "settings") save(); // so the detected language gets saved
  }

  await listen<{ source: string; value: unknown }>("settings-changed", (e) => {
    if (e.payload.source === me) return; // this same window saved it
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

// Settings open inside the same window (on top of the tabs), not in another one.
const [settingsOpen, setSettingsOpen] = createSignal(false);
export { settingsOpen };
export const openSettings = () => {
  // So keys don't keep going to the terminal that had focus.
  (document.activeElement as HTMLElement | null)?.blur?.();
  setSettingsOpen(true);
};
export const closeSettings = () => setSettingsOpen(false);
export const revealSettings = () => invoke("settings_reveal");
