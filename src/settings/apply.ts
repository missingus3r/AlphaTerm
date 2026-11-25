/**
 * Applies the settings live: interface colors, window effect (Mica/Acrylic),
 * light/dark title bar theme, background image and the look of the terminals.
 */
import { createEffect, createMemo, createSignal, on, onCleanup, type Accessor } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { Effect, getCurrentWindow } from "@tauri-apps/api/window";
import type { ITheme } from "@xterm/xterm";
import { DEFAULT_FONT, type CursorStyle, type Settings } from "./schema";
import { findTheme, isDark, uiPalette, type Theme } from "./themes";

/** What a terminal needs to know about the settings. */
export interface TermLook {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  fontWeight: "normal" | "bold" | "300" | "500" | "600";
  ligatures: boolean;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  scrollback: number;
  transparent: boolean;
  theme: ITheme;
}

/** Is Windows in dark mode? (for the "follow Windows" mode). */
export function createOsDark(): Accessor<boolean> {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const [dark, setDark] = createSignal(mq.matches);
  const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
  mq.addEventListener("change", onChange);
  onCleanup(() => mq.removeEventListener("change", onChange));
  return dark;
}

export function activeTheme(s: Settings, osDark: boolean): Theme {
  const a = s.appearance;
  const light = a.mode === "light" || (a.mode === "auto" && !osDark);
  return light ? findTheme(a.themeLight, s.customThemes, "nova-light") : findTheme(a.theme, s.customThemes);
}

/** The terminal has to be transparent if something has to show behind it. */
export const isTransparent = (s: Settings) =>
  s.background.effect !== "none" || s.background.opacity < 1 || s.background.image !== "";

export const fontStack = (family: string) => {
  const f = family.replace(/["\\]/g, "");
  const fallback = f === DEFAULT_FONT ? "" : `, "${DEFAULT_FONT}"`;
  return `"${f}"${fallback}, Consolas, monospace`;
};

export function termLook(s: Settings, theme: Theme): TermLook {
  const a = s.appearance;
  const transparent = isTransparent(s);
  return {
    fontFamily: fontStack(a.fontFamily),
    fontSize: a.fontSize,
    lineHeight: a.lineHeight,
    letterSpacing: a.letterSpacing,
    fontWeight: a.fontWeight,
    ligatures: a.ligatures,
    cursorStyle: a.cursorStyle,
    cursorBlink: a.cursorBlink,
    scrollback: s.terminal.scrollback,
    transparent,
    // The window paints the background (with its opacity); the terminal lets it through.
    theme: {
      ...theme.colors,
      ...(transparent ? { background: "#00000000" } : {}),
      // Without the ruler's right border (it looked like a light line) and with a discreet
      // scrollbar.
      overviewRulerBorder: "#00000000",
      scrollbarSliderBackground: `${theme.colors.foreground.slice(0, 7)}22`,
      scrollbarSliderHoverBackground: `${theme.colors.foreground.slice(0, 7)}44`,
      scrollbarSliderActiveBackground: `${theme.colors.foreground.slice(0, 7)}66`,
    },
  };
}

const EFFECTS: Record<Exclude<Settings["background"]["effect"], "none">, Effect> = {
  mica: Effect.Mica,
  tabbed: Effect.Tabbed,
  acrylic: Effect.Acrylic,
  blur: Effect.Blur,
};

/**
 * Hooks this window's appearance up to the settings.
 * `terminalWindow` = false for the settings window (opaque and without effects).
 */
export function useAppearance(settings: Accessor<Settings>, terminalWindow: boolean) {
  const osDark = createOsDark();
  const theme = createMemo(() => activeTheme(settings(), osDark()));
  const win = getCurrentWindow();
  const root = document.documentElement;

  // Interface colors.
  createEffect(() => {
    const opacity = terminalWindow && isTransparent(settings()) ? settings().background.opacity : 1;
    for (const [k, v] of Object.entries(uiPalette(theme().colors, opacity))) {
      if (k === "color-scheme") root.style.colorScheme = v;
      else root.style.setProperty(k, v);
    }
  });

  // Light or dark title bar (in "follow Windows" Windows decides).
  createEffect(
    on(
      () => (settings().appearance.mode === "auto" ? null : isDark(theme().colors) ? "dark" : "light"),
      (t) => void win.setTheme(t).catch(() => {}),
    ),
  );

  if (!terminalWindow) return { theme, osDark };

  // Window effect. Mica and Acrylic only show where the background is transparent.
  createEffect(
    on(
      () => settings().background.effect,
      (effect) => {
        const p = effect === "none" ? win.clearEffects() : win.setEffects({ effects: [EFFECTS[effect]] });
        void p.catch((e) => console.warn("No se pudo aplicar el efecto", effect, e));
      },
    ),
  );

  // Background image: the saved copy is read and used as a blob (no need to open the
  // WebView's local file protocol).
  let url: string | null = null;
  createEffect(
    on(
      () => settings().background.image,
      async (path) => {
        if (url) URL.revokeObjectURL(url);
        url = null;
        root.style.removeProperty("--bg-image");
        if (!path) return;
        try {
          const bytes = await invoke<ArrayBuffer>("background_read", { path });
          if (settings().background.image !== path) return;
          url = URL.createObjectURL(new Blob([bytes]));
          root.style.setProperty("--bg-image", `url("${url}")`);
        } catch (e) {
          console.warn("No se pudo cargar la imagen de fondo", e);
        }
      },
    ),
  );
  createEffect(() => {
    const b = settings().background;
    root.style.setProperty("--bg-image-opacity", String(b.imageOpacity));
    root.style.setProperty("--bg-size", b.imageFit === "tile" ? "auto" : b.imageFit);
    root.style.setProperty("--bg-repeat", b.imageFit === "tile" ? "repeat" : "no-repeat");
  });

  return { theme, osDark };
}

/** Saves an image chosen by the user as the background and returns the path of the copy. */
export async function storeBackground(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return invoke<string>("background_store", bytes, { headers: { "x-name": encodeURIComponent(file.name) } });
}
