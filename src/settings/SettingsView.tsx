import { profileLabel } from "../terminal/pty";
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { askConfirm } from "../widgets/confirm";
import type { TermInfo } from "../terminal/pty";
import { invoke } from "@tauri-apps/api/core";
import { COMMANDS, FIXED_HELP, comboOf, comboProblem, comboWarning, conflicts, effectiveBindings } from "../layout/shortcuts";
import { activeTheme, createOsDark, fontStack, storeBackground } from "./apply";
import { monospaceFonts } from "./fonts";
import { COLOR_KEYS, DEFAULT_FONT, LIMITS, type ColorKey, type Effect, type Settings } from "./schema";
import { revealSettings, type SettingsStore } from "./store";
import { appInfo, versionTooltip } from "../widgets/appInfo";
import { allThemes, findTheme, importThemes, themeId, themeLabel, type Theme } from "./themes";
import { k, LANGS, locale, t, type Lang } from "../i18n";
import "./settings.css";

type Section = "idioma" | "apariencia" | "fuente" | "fondo" | "terminal" | "agentes" | "consumo" | "atajos" | "proximo";
const SECTIONS: [Section, string][] = [
  ["idioma", k("Idioma")],
  ["apariencia", k("Tema y colores")],
  ["fuente", k("Fuente y cursor")],
  ["fondo", k("Fondo de la ventana")],
  ["terminal", k("Terminal e interfaz")],
  ["agentes", k("Agentes y guardián")],
  ["consumo", k("Consumo y widgets")],
  ["atajos", k("Atajos de teclado")],
  ["proximo", k("Acerca y límites")],
];
const SECTION_PREF = "alphaterm.settings.section";

const COLOR_LABELS: Record<ColorKey, string> = {
  background: k("Fondo"), foreground: k("Texto"), cursor: k("Cursor"), cursorAccent: k("Texto bajo el cursor"),
  selectionBackground: k("Selección"), black: k("Negro"), red: k("Rojo"), green: k("Verde"), yellow: k("Amarillo"),
  blue: k("Azul"), magenta: k("Magenta"), cyan: k("Cian"), white: k("Blanco"), brightBlack: k("Negro claro"),
  brightRed: k("Rojo claro"), brightGreen: k("Verde claro"), brightYellow: k("Amarillo claro"), brightBlue: k("Azul claro"),
  brightMagenta: k("Magenta claro"), brightCyan: k("Cian claro"), brightWhite: k("Blanco brillante"),
};

// --- Piezas de formulario -------------------------------------------------------------------

function Row(props: { label: string; hint?: string; children: JSX.Element }) {
  return (
    <div class="row">
      <div class="row-label">
        <span>{props.label}</span>
        <Show when={props.hint}>
          <small>{props.hint}</small>
        </Show>
      </div>
      <div class="row-control">{props.children}</div>
    </div>
  );
}

function Segmented<T extends string>(props: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div class="segmented" role="radiogroup">
      <For each={props.options}>
        {([v, label]) => (
          <button role="radio" aria-checked={props.value === v} classList={{ on: props.value === v }} onClick={() => props.onChange(v)}>
            {label}
          </button>
        )}
      </For>
    </div>
  );
}

function Slider(props: {
  value: number;
  range: readonly [number, number];
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div class="slider">
      <input
        type="range"
        min={props.range[0]}
        max={props.range[1]}
        step={props.step}
        value={props.value}
        onInput={(e) => props.onChange(Number(e.currentTarget.value))}
      />
      <span class="slider-value">{props.format ? props.format(props.value) : props.value}</span>
    </div>
  );
}

function Toggle(props: { checked: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <label class="toggle">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.currentTarget.checked)} />
      <span class="track" />
      {props.label}
    </label>
  );
}

function Swatches(props: { theme: Theme }) {
  const c = () => props.theme.colors;
  return (
    <div class="swatch" style={{ background: c().background.slice(0, 7), color: c().foreground.slice(0, 7) }}>
      <span class="swatch-text">$ ls</span>
      <span class="swatch-dots">
        <For each={["red", "green", "yellow", "blue", "magenta", "cyan"] as const}>
          {(k) => <i style={{ background: c()[k].slice(0, 7) }} />}
        </For>
      </span>
    </div>
  );
}

// --- Ventana -----------------------------------------------------------------------------------

export default function SettingsView(props: { info: TermInfo; store: SettingsStore; onClose?: () => void }) {
  const s = () => props.store.settings();
  const set = (f: (d: Settings) => void) => props.store.update(f);
  const osDark = createOsDark();
  if (!props.onClose) createEffect(() => (document.title = t("Configuración — AlphaTerm")));
  // Dentro de la ventana de terminal: Esc cierra (salvo que una tecla la esté usando un campo).
  if (props.onClose) {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
      props.onClose!();
    };
    window.addEventListener("keydown", esc);
    onCleanup(() => window.removeEventListener("keydown", esc));
  }
  const readSection = (): Section => {
    try {
      const v = localStorage.getItem(SECTION_PREF) as Section | null;
      return v && SECTIONS.some(([id]) => id === v) ? v : "apariencia";
    } catch {
      return "apariencia";
    }
  };
  const [section, setSection] = createSignal<Section>(readSection());
  const go = (id: Section) => {
    setSection(id);
    try {
      localStorage.setItem(SECTION_PREF, id);
    } catch {
      /* no importa */
    }
  };

  return (
    <div class="settings">
      <nav class="settings-nav">
        <h1>
          {t("Configuración")}
          <Show when={props.onClose}>
            <button class="icon-btn settings-close" title={t("Cerrar la configuración (Esc)")} onClick={() => props.onClose!()}>
              ×
            </button>
          </Show>
        </h1>
        <For each={SECTIONS}>
          {([id, label]) => (
            <button classList={{ on: section() === id }} onClick={() => go(id)}>
              {id === "idioma" ? <span class="lang-globe" aria-hidden="true">🌐 </span> : null}
              {t(label)}
            </button>
          )}
        </For>
        <div class="nav-foot">
          <small title={props.store.path}>{t("Se guarda sola en settings.json y se aplica al instante en todas las ventanas.")}</small>
          <button class="link" onClick={() => void revealSettings()}>
            {t("Mostrar el archivo")}
          </button>
          <button
            class="link danger"
            onClick={async () => {
              if (await askConfirm(t("¿Volver toda la configuración a los valores de fábrica? Se borran también los temas propios."), t("Volver a fábrica"))) {
                props.store.reset();
              }
            }}
          >
            {t("Restablecer todo")}
          </button>
        </div>
      </nav>
      <main class="settings-main">
        <Show when={props.store.warning()}>
          <div class="banner">{props.store.warning()}</div>
        </Show>
        <Show when={section() === "idioma"}>
          <LanguageSection s={s()} set={set} />
        </Show>
        <Show when={section() === "apariencia"}>
          <ThemeSection s={s()} set={set} osDark={osDark()} />
        </Show>
        <Show when={section() === "fuente"}>
          <FontSection s={s()} set={set} theme={activeTheme(s(), osDark())} />
        </Show>
        <Show when={section() === "fondo"}>
          <BackgroundSection s={s()} set={set} />
        </Show>
        <Show when={section() === "terminal"}>
          <TerminalSection s={s()} set={set} info={props.info} />
        </Show>
        <Show when={section() === "agentes"}>
          <AgentsSection s={s()} set={set} />
        </Show>
        <Show when={section() === "consumo"}>
          <UsageSection s={s()} set={set} />
        </Show>
        <Show when={section() === "atajos"}>
          <ShortcutSection s={s()} set={set} />
        </Show>
        <Show when={section() === "proximo"}>
          <AboutSection path={props.store.path} />
        </Show>
      </main>
    </div>
  );
}

interface SectionProps {
  s: Settings;
  set: (f: (d: Settings) => void) => void;
}

// --- Idioma ----------------------------------------------------------------------------------------

function LanguageSection(props: SectionProps) {
  return (
    <section>
      <h2>{t("Idioma")}</h2>
      <Row
        label={t("Idioma de la interfaz")}
        hint={t("Menús, paneles, avisos y los textos que AlphaTerm les pasa a los agentes. Lo que muestran los programas dentro de la terminal no cambia.")}
      >
        <Segmented<Lang> value={props.s.language} options={LANGS} onChange={(v) => props.set((d) => void (d.language = v))} />
      </Row>
    </section>
  );
}

// --- Tema y colores ------------------------------------------------------------------------------

function ThemeSection(props: SectionProps & { osDark: boolean }) {
  const lightActive = () => props.s.appearance.mode === "light" || (props.s.appearance.mode === "auto" && !props.osDark);
  const [slot, setSlot] = createSignal<"dark" | "light" | null>(null);
  const target = () => slot() ?? (lightActive() ? "light" : "dark");
  const themes = createMemo(() => allThemes(props.s.customThemes));
  const selectedId = () => (target() === "light" ? props.s.appearance.themeLight : props.s.appearance.theme);
  const selected = () => findTheme(selectedId(), props.s.customThemes, target() === "light" ? "nova-light" : "nova-dark");
  // El texto se arma al mostrarlo (así sigue el idioma si se cambia con el aviso a la vista).
  const [message, setMessage] = createSignal<{ ok: boolean; text: () => string } | null>(null);
  let fileInput!: HTMLInputElement;

  const choose = (id: string) =>
    props.set((d) => {
      if (target() === "light") d.appearance.themeLight = id;
      else d.appearance.theme = id;
    });

  const takenIds = () => new Set(themes().map((x) => x.id));

  const duplicate = () => {
    const base = selected();
    const name = t("{name} (copia)", { name: themeLabel(base) });
    const id = themeId(name, takenIds());
    props.set((d) => {
      d.customThemes.push({ id, name, colors: { ...base.colors } });
      if (target() === "light") d.appearance.themeLight = id;
      else d.appearance.theme = id;
    });
  };

  const onImport = async (file: File) => {
    try {
      const found = importThemes(await file.text(), file.name);
      const taken = takenIds();
      const added = found.map((x) => {
        const id = themeId(x.name, taken);
        taken.add(id);
        return { id, name: x.name, colors: x.colors, missing: x.missing };
      });
      props.set((d) => {
        for (const x of added) d.customThemes.push({ id: x.id, name: x.name, colors: x.colors });
        if (target() === "light") d.appearance.themeLight = added[0].id;
        else d.appearance.theme = added[0].id;
      });
      const incomplete = added.filter((x) => x.missing.length > 0).length;
      setMessage({
        ok: true,
        text: () =>
          [
            added.length === 1 ? t('Se importó "{name}".', { name: added[0].name }) : t("Se importó {n} temas.", { n: added.length }),
            incomplete === 0
              ? ""
              : incomplete === 1
                ? t("A uno le faltaban colores y se completaron con Alpha oscuro.")
                : t("A {n} le faltaban colores y se completaron con Alpha oscuro.", { n: incomplete }),
          ]
            .filter(Boolean)
            .join(" "),
      });
    } catch (e) {
      const error = (e as Error).message;
      setMessage({ ok: false, text: () => t("No se pudo importar {file}: {error}", { file: file.name, error }) });
    }
  };

  const editColor = (key: ColorKey, value: string) =>
    props.set((d) => {
      const theme = d.customThemes.find((x) => x.id === selected().id);
      if (theme) theme.colors[key] = value;
    });

  const remove = async () => {
    const theme = selected();
    if (!(await askConfirm(t('¿Borrar el tema "{name}"? No se puede deshacer (salvo volviéndolo a importar).', { name: theme.name }), t("Borrar")))) return;
    props.set((d) => {
      d.customThemes = d.customThemes.filter((x) => x.id !== theme.id);
      if (d.appearance.theme === theme.id) d.appearance.theme = "nova-dark";
      if (d.appearance.themeLight === theme.id) d.appearance.themeLight = "nova-light";
    });
  };

  return (
    <section>
      <h2>{t("Tema y colores")}</h2>
      <Row label={t("Modo")} hint={t("Con «Según Windows» cambia solo cuando Windows pasa de claro a oscuro.")}>
        <Segmented
          value={props.s.appearance.mode}
          options={[["dark", t("Oscuro")], ["light", t("Claro")], ["auto", t("Según Windows")]]}
          onChange={(v) => {
            setSlot(null);
            props.set((d) => void (d.appearance.mode = v));
          }}
        />
      </Row>
      <Row label={t("Elegir el tema del modo")}>
        <Segmented value={target()} options={[["dark", t("Oscuro · {theme}", { theme: themeLabel(findTheme(props.s.appearance.theme, props.s.customThemes)) })], ["light", t("Claro · {theme}", { theme: themeLabel(findTheme(props.s.appearance.themeLight, props.s.customThemes, "nova-light")) })]]} onChange={setSlot} />
      </Row>
      <div class="theme-grid">
        <For each={themes()}>
          {(th) => (
            <button class="theme-card" classList={{ on: th.id === selected().id }} onClick={() => choose(th.id)} title={th.builtin ? t("Tema de fábrica") : t("Tema propio")}>
              <Swatches theme={th} />
              <span>
                {themeLabel(th)}
                {th.builtin ? "" : " ✎"}
              </span>
            </button>
          )}
        </For>
      </div>
      <div class="actions">
        <button class="btn" onClick={duplicate}>
          {t("Duplicar para editar")}
        </button>
        <button class="btn" onClick={() => fileInput.click()}>
          {t("Importar tema…")}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,.itermcolors,application/json"
          hidden
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (f) void onImport(f);
          }}
        />
        <small>{t("Acepta esquemas de Windows Terminal (o su settings.json entero), .itermcolors de iTerm2 y temas de xterm.js.")}</small>
      </div>
      <Show when={message()}>
        <div class="banner" classList={{ ok: message()!.ok }}>
          {message()!.text()}
        </div>
      </Show>
      <Show
        when={!selected().builtin}
        fallback={<p class="muted">{t("Los temas de fábrica no se editan: «Duplicar para editar» crea una copia propia.")}</p>}
      >
        <h3>{t("Editar «{name}»", { name: selected().name })}</h3>
        <Row label={t("Nombre")}>
          <input
            class="text"
            value={selected().name}
            onChange={(e) => {
              const name = e.currentTarget.value.trim();
              if (name) props.set((d) => void (d.customThemes.find((x) => x.id === selected().id)!.name = name));
            }}
          />
        </Row>
        <div class="color-grid">
          <For each={COLOR_KEYS}>
            {(key) => (
              <label class="color">
                <input type="color" value={selected().colors[key].slice(0, 7)} onInput={(e) => editColor(key, e.currentTarget.value)} />
                <span>{t(COLOR_LABELS[key])}</span>
                <input
                  class="hex"
                  value={selected().colors[key]}
                  spellcheck={false}
                  onChange={(e) => {
                    const v = e.currentTarget.value.trim();
                    if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) editColor(key, v);
                    else e.currentTarget.value = selected().colors[key];
                  }}
                />
              </label>
            )}
          </For>
        </div>
        <div class="actions">
          <button class="btn danger" onClick={remove}>
            {t("Borrar este tema")}
          </button>
        </div>
      </Show>
    </section>
  );
}

// --- Fuente y cursor -------------------------------------------------------------------------------

// Función (no constante) para que el mensaje de commit de muestra siga el idioma.
const sample = () => ["PS C:\\AlphaTerm> git log --oneline -3", `c91ef04 F2: ${t("pestañas, splits y shell integration")}`, "=> != === <= >= -> |> :: www 0O1lI ñ á"];

function FontSection(props: SectionProps & { theme: Theme }) {
  const [fonts] = createResource(monospaceFonts);
  const a = () => props.s.appearance;
  const inList = () => (fonts() ?? []).includes(a().fontFamily);
  const [custom, setCustom] = createSignal(false);
  const showCustom = () => custom() || (fonts.state === "ready" && !inList());
  const set = (f: (x: Settings["appearance"]) => void) => props.set((d) => f(d.appearance));

  return (
    <section>
      <h2>{t("Fuente y cursor")}</h2>
      <div
        class="font-preview"
        style={{
          "font-family": fontStack(a().fontFamily),
          "font-size": `${a().fontSize}px`,
          "line-height": String(a().lineHeight),
          "letter-spacing": `${a().letterSpacing}px`,
          "font-weight": a().fontWeight,
          "font-variant-ligatures": a().ligatures ? "normal" : "none",
          "font-feature-settings": a().ligatures ? '"calt" on' : '"calt" off',
          background: props.theme.colors.background.slice(0, 7),
          color: props.theme.colors.foreground.slice(0, 7),
        }}
      >
        <For each={sample()}>{(l) => <div>{l}</div>}</For>
      </div>
      <Row label={t("Fuente")} hint={fonts.loading ? t("Buscando las fuentes monoespaciadas instaladas…") : t("{n} monoespaciadas instaladas", { n: fonts()?.length ?? 0 })}>
        <select
          class="text"
          value={showCustom() ? "__otra" : a().fontFamily}
          onChange={(e) => {
            const v = e.currentTarget.value;
            if (v === "__otra") setCustom(true);
            else {
              setCustom(false);
              set((x) => void (x.fontFamily = v));
            }
          }}
        >
          <For each={fonts() ?? [DEFAULT_FONT]}>{(f) => <option value={f}>{f}</option>}</For>
          <option value="__otra">{t("Otra (escribir el nombre)…")}</option>
        </select>
        <Show when={showCustom()}>
          <input
            class="text"
            value={a().fontFamily}
            placeholder={t("Nombre exacto de la familia")}
            onChange={(e) => set((x) => void (x.fontFamily = e.currentTarget.value))}
          />
        </Show>
      </Row>
      <Row label={t("Tamaño")}>
        <Slider value={a().fontSize} range={LIMITS.fontSize} step={0.5} format={(v) => `${v} px`} onChange={(v) => set((x) => void (x.fontSize = v))} />
      </Row>
      <Row label={t("Interlineado")}>
        <Slider value={a().lineHeight} range={LIMITS.lineHeight} step={0.05} format={(v) => v.toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} onChange={(v) => set((x) => void (x.lineHeight = v))} />
      </Row>
      <Row label={t("Espacio entre letras")}>
        <Slider value={a().letterSpacing} range={LIMITS.letterSpacing} step={0.5} format={(v) => `${v} px`} onChange={(v) => set((x) => void (x.letterSpacing = v))} />
      </Row>
      <Row label={t("Grosor")}>
        <Segmented
          value={a().fontWeight}
          options={[["300", t("Fina")], ["normal", t("Normal")], ["500", t("Media")], ["600", t("Seminegrita")], ["bold", t("Negrita")]]}
          onChange={(v) => set((x) => void (x.fontWeight = v))}
        />
      </Row>
      <Row label={t("Ligaduras")} hint={t("Une => != === en un solo símbolo. Solo en fuentes que las traen: Cascadia Code, Fira Code, JetBrains Mono (Cascadia Mono no).")}>
        <Toggle checked={a().ligatures} label={a().ligatures ? t("Activadas") : t("Desactivadas")} onChange={(v) => set((x) => void (x.ligatures = v))} />
      </Row>
      <Row label={t("Cursor")}>
        <Segmented
          value={a().cursorStyle}
          options={[["block", t("Bloque ▮")], ["bar", t("Barra ▏")], ["underline", t("Subrayado ▁")]]}
          onChange={(v) => set((x) => void (x.cursorStyle = v))}
        />
      </Row>
      <Row label={t("Parpadeo del cursor")}>
        <Toggle checked={a().cursorBlink} label={a().cursorBlink ? t("Parpadea") : t("Fijo")} onChange={(v) => set((x) => void (x.cursorBlink = v))} />
      </Row>
    </section>
  );
}

// --- Fondo ----------------------------------------------------------------------------------------

function BackgroundSection(props: SectionProps) {
  const b = () => props.s.background;
  const set = (f: (x: Settings["background"]) => void) => props.set((d) => f(d.background));
  const [error, setError] = createSignal<string | null>(null);
  let fileInput!: HTMLInputElement;
  const pct = (v: number) => new Intl.NumberFormat(locale(), { style: "percent", maximumFractionDigits: 0 }).format(v);
  const fileName = () => b().image.split(/[\\/]/).pop();

  return (
    <section>
      <h2>{t("Fondo de la ventana")}</h2>
      <Row label={t("Efecto de Windows 11")} hint={t("Mica toma el tono del fondo de pantalla; Acrylic deja ver lo que hay detrás, desenfocado. Solo se ven si el fondo no es opaco.")}>
        <Segmented<Effect>
          value={b().effect}
          options={[["none", t("Ninguno")], ["mica", "Mica"], ["tabbed", t("Mica alternativo")], ["acrylic", "Acrylic"], ["blur", t("Desenfoque")]]}
          onChange={(v) =>
            set((x) => {
              x.effect = v;
              // Con el fondo opaco el efecto no se vería.
              if (v !== "none" && x.opacity >= 1) x.opacity = 0.75;
            })
          }
        />
      </Row>
      <Row label={t("Opacidad del fondo")} hint={t("Por debajo de 100 % se ve el efecto (o el escritorio, si no hay efecto).")}>
        <Slider value={b().opacity} range={LIMITS.opacity} step={0.01} format={pct} onChange={(v) => set((x) => void (x.opacity = v))} />
      </Row>
      <Row label={t("Imagen")} hint={t("Se guarda una copia en %APPDATA%\\AlphaTerm\\fondos, así sigue andando si movés el original.")}>
        <div class="actions tight">
          <button class="btn" onClick={() => fileInput.click()}>
            {b().image ? t("Cambiar imagen…") : t("Elegir imagen…")}
          </button>
          <Show when={b().image}>
            <span class="muted" title={b().image}>
              {fileName()}
            </span>
            <button class="btn" onClick={() => set((x) => void (x.image = ""))}>
              {t("Quitar")}
            </button>
          </Show>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
            hidden
            onChange={async (e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (!f) return;
              try {
                const path = await storeBackground(f);
                setError(null);
                set((x) => void (x.image = path));
              } catch (err) {
                setError(String(err));
              }
            }}
          />
        </div>
      </Row>
      <Show when={error()}>
        <div class="banner">{error()}</div>
      </Show>
      <Show when={b().image}>
        <Row label={t("Opacidad de la imagen")}>
          <Slider value={b().imageOpacity} range={LIMITS.imageOpacity} step={0.01} format={pct} onChange={(v) => set((x) => void (x.imageOpacity = v))} />
        </Row>
        <Row label={t("Ajuste")}>
          <Segmented value={b().imageFit} options={[["cover", t("Cubrir")], ["contain", t("Entera")], ["tile", t("Mosaico")]]} onChange={(v) => set((x) => void (x.imageFit = v))} />
        </Row>
      </Show>
    </section>
  );
}

// --- Terminal e interfaz -----------------------------------------------------------------------------

function TerminalSection(props: SectionProps & { info: TermInfo }) {
  const auto = () => {
    const name = props.info.profiles.find((p) => p.id === props.info.defaultProfile)?.name;
    return name ? profileLabel(name) : props.info.defaultProfile;
  };
  return (
    <section>
      <h2>{t("Terminal e interfaz")}</h2>
      <Row label={t("Barra de pestañas")} hint={t("También con Ctrl+Shift+B.")}>
        <Segmented
          value={props.s.tabBar.position}
          options={[["top", t("Arriba")], ["left", t("A la izquierda")]]}
          onChange={(v) => props.set((d) => void (d.tabBar.position = v))}
        />
      </Row>
      <Row label={t("Shell por defecto")} hint={t("La de las pestañas y ventanas nuevas.")}>
        <select class="text" value={props.s.terminal.defaultProfile} onChange={(e) => props.set((d) => void (d.terminal.defaultProfile = e.currentTarget.value))}>
          <option value="">{t("Automática ({name})", { name: auto() })}</option>
          <For each={props.info.profiles}>
            {(p) => (
              <option value={p.id} disabled={!p.available}>
                {p.available ? profileLabel(p.name) : t("{name} (no detectado)", { name: profileLabel(p.name) })}
              </option>
            )}
          </For>
        </select>
      </Row>
      <Row label={t("Líneas de historial")} hint={t("Por pestaña. Más líneas, más memoria (unas 10 000 líneas ≈ 5–10 MB).")}>
        <input
          class="text num"
          type="number"
          min={LIMITS.scrollback[0]}
          max={LIMITS.scrollback[1]}
          step={1000}
          value={props.s.terminal.scrollback}
          onChange={(e) => props.set((d) => void (d.terminal.scrollback = Number(e.currentTarget.value)))}
        />
      </Row>
      <Row label={t("Sugerencias de comandos")} hint={t("En cmd y PowerShell: carpetas para cd, historial, opciones y valores típicos (ping, git, npm…). Tab inserta, ↓ elige, Esc cierra; ↑ sigue siendo el historial.")}>
        <Toggle
          checked={props.s.terminal.suggest.enabled}
          label={props.s.terminal.suggest.enabled ? t("Activadas") : t("Desactivadas")}
          onChange={(v) => props.set((d) => void (d.terminal.suggest.enabled = v))}
        />
      </Row>
      <Show when={props.s.terminal.suggest.enabled}>
        <Row label={t("Mostrar el menú")} hint={t("Ctrl+Espacio lo abre siempre (en PowerShell reemplaza al menú de completados propio).")}>
          <Segmented
            value={props.s.terminal.suggest.mode}
            options={[["auto", t("Al escribir")], ["manual", t("Solo con Ctrl+Espacio")]]}
            onChange={(v) => props.set((d) => void (d.terminal.suggest.mode = v))}
          />
        </Row>
        <Row label={t("Completados de PowerShell")} hint={t("Le pregunta a la propia sesión (cmdlets, parámetros, módulos). Si una respuesta tarda más de 300 ms, esa pestaña solo pregunta con Ctrl+Espacio.")}>
          <Toggle
            checked={props.s.terminal.suggest.pwsh}
            label={props.s.terminal.suggest.pwsh ? t("Sí") : t("No")}
            onChange={(v) => props.set((d) => void (d.terminal.suggest.pwsh = v))}
          />
        </Row>
      </Show>
      <Row label={t("Detectar el programa en uso cada")} hint={t("Para el nombre de la pestaña cuando la shell no tiene integración. Se pausa con la ventana minimizada.")}>
        <select
          class="text"
          value={String(props.s.behavior.foregroundPollMs)}
          onChange={(e) => props.set((d) => void (d.behavior.foregroundPollMs = Number(e.currentTarget.value)))}
        >
          <For each={[500, 1000, 2000, 5000, 10000]}>{(ms) => <option value={ms}>{ms < 1000 ? `${ms} ms` : `${ms / 1000} s`}</option>}</For>
        </select>
      </Row>
    </section>
  );
}

// --- Agentes, API de control y guardián -----------------------------------------------------------------

// El backend manda la decisión en castellano (se compara con "bloqueado"): se traduce al mostrarla.
const DECISIONS = new Set<string>([
  k("permitido"),
  k("permitido (guardián apagado)"),
  k("permitido (regla de la sesión)"),
  k("permitido (30 min para esta sesión)"),
  k("bloqueado"),
]);
const decisionLabel = (d: string) => (DECISIONS.has(d) ? t(d) : d);

interface GuardLog {
  at: number;
  decision: string;
  ask: { kind: string; agent: string; tool: string; summary: string; paths: string[] };
}

function AgentsSection(props: SectionProps) {
  const [files] = createResource(() => invoke<{ claudeMcp: string; claudeSettings: string; mcpScript: string }>("control_files"));
  const [log, { refetch }] = createResource(() => invoke<GuardLog[]>("guardian_log"));
  const [copied, setCopied] = createSignal<string | null>(null);
  const copy = async (id: string, text: string) => {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };
  const g = () => props.s.guardian;
  const script = () => (files()?.mcpScript ?? "").replace(/\\/g, "/");
  const claudeCmd = () => `claude mcp add --scope user alphaterm -- node "${script()}"`;
  const codexToml = () => `[mcp_servers.alphaterm]\ncommand = "node"\nargs = ["${script()}"]`;
  return (
    <section>
      <h2>{t("Agentes y guardián")}</h2>
      <Row label={t("API de control")} hint={t("Deja que los agentes manejen AlphaTerm: ver pestañas, abrir pestañas, paneles y ventanas, correr comandos y leer su salida, y manejar Docker. Solo escucha en 127.0.0.1 y pide un token que cambia en cada inicio.")}>
        <Toggle checked={props.s.control.enabled} label={props.s.control.enabled ? t("Prendida") : t("Apagada")} onChange={(v) => props.set((d) => void (d.control.enabled = v))} />
      </Row>
      <Row label={t("Cómo la usan los agentes")} hint={t("Claude Code lanzado desde el panel de agentes ya la tiene (como servidor MCP). Cualquier agente puede usar el CLI: node $env:ALPHATERM_CTL list")}>
        <div class="actions tight">
          <button class="btn" onClick={() => void copy("claude", claudeCmd())}>
            {copied() === "claude" ? t("Copiado") : t("Copiar comando para Claude Code (global)")}
          </button>
          <button class="btn" onClick={() => void copy("codex", codexToml())}>
            {copied() === "codex" ? t("Copiado") : t("Copiar bloque para ~/.codex/config.toml")}
          </button>
        </div>
        <small class="muted">{t("Esos dos agregan AlphaTerm a la configuración global del agente: se copian para que los pegues vos (no se cambian solos).")}</small>
      </Row>
      <Row label={t("Guardián")} hint={t("Antes de que un agente borre o modifique archivos, pregunta (en una ventana encima de todo) y espera tu respuesta.")}>
        <Toggle checked={g().enabled} label={g().enabled ? t("Prendido") : t("Apagado")} onChange={(v) => props.set((d) => void (d.guardian.enabled = v))} />
      </Row>
      <Show when={g().enabled}>
        <Row label={t("Qué vigila")}>
          <span>{t("Borrados: siempre.")}</span>
          <Toggle checked={g().modify} label={t("También modificaciones (editar, crear, pisar)")} onChange={(v) => props.set((d) => void (d.guardian.modify = v))} />
        </Row>
        <Row label={t("Dónde frena")} hint={t("Windows no deja frenar escrituras de cualquier programa sin un driver: el guardián actúa donde se puede.")}>
          <Toggle checked={g().claude} label={t("Claude Code lanzado desde AlphaTerm (hook antes de cada edición, escritura o comando que borra)")} onChange={(v) => props.set((d) => void (d.guardian.claude = v))} />
          <Toggle checked={g().codex} label={t("Codex lanzado desde AlphaTerm (con su modo de aprobación: -s read-only -a on-request)")} onChange={(v) => props.set((d) => void (d.guardian.codex = v))} />
          <small class="muted">{t("Siempre: comandos que un agente manda por la API de control (run, send, docker rm). Otros agentes (agy, OpenCode…) no se pueden frenar desde afuera.")}</small>
        </Row>
      </Show>
      <Row label={t("Últimas decisiones")}>
        <button class="link small" onClick={() => void refetch()}>
          {t("Actualizar")}
        </button>
        <ul class="guard-log">
          <For each={(log() ?? []).slice(0, 15)} fallback={<li class="muted">{t("Nada todavía.")}</li>}>
            {(e) => (
              <li title={`${e.ask.agent} · ${e.ask.tool}\n${e.ask.paths.join("\n")}`}>
                <span class={e.decision.startsWith("bloqueado") ? "bad" : "good"}>{decisionLabel(e.decision)}</span> · {e.ask.summary}
                <small class="muted"> · {new Date(e.at).toLocaleTimeString(locale())}</small>
              </li>
            )}
          </For>
        </ul>
      </Row>
      <h3>{t("Modificaciones de archivos")}</h3>
      <Row
        label={t("Panel de modificaciones")}
        hint={t("Muestra lo que cambian los agentes en los archivos (de texto, de código y PDF por su texto), también fuera de git, con lo agregado y lo borrado. Se puede editar y guardar desde ahí.")}
      >
        <Toggle checked={props.s.changes.enabled} label={props.s.changes.enabled ? t("Prendido") : t("Apagado")} onChange={(v) => props.set((d) => void (d.changes.enabled = v))} />
      </Row>
      <Show when={props.s.changes.enabled}>
        <Row label={t("De dónde salen")}>
          <Toggle
            checked={props.s.changes.claude}
            label={t("Claude Code lanzado desde AlphaTerm (hook antes y después de cada edición: exacto)")}
            onChange={(v) => props.set((d) => void (d.changes.claude = v))}
          />
          <Toggle
            checked={props.s.changes.folders}
            label={t("La carpeta de cualquier pestaña con un agente andando (se copia al arrancar y se compara)")}
            onChange={(v) => props.set((d) => void (d.changes.folders = v))}
          />
          <small class="muted">
            {t("De la copia de la carpeta quedan afuera lo que ignora git, las carpetas ocultas, node_modules y target, y los archivos de más de 2 MB; para esos se compara con el último commit o se muestra el archivo entero. No se vigilan la carpeta del usuario ni la raíz de un disco.")}
          </small>
        </Row>
      </Show>
      <h3>{t("Resumen de pestañas con un modelo")}</h3>
      <Row label={t("Resumir con un modelo")} hint={t("Opcional: cada cierto tiempo se le pasan las últimas líneas de las pestañas con actividad a un modelo (Ollama, vLLM, LM Studio…) y su respuesta es el nombre de la pestaña. El título que pone un programa (Claude Code) y el nombre a mano siguen mandando.")}>
        <Toggle checked={props.s.llm.enabled} label={props.s.llm.enabled ? t("Prendido") : t("Apagado")} onChange={(v) => props.set((d) => void (d.llm.enabled = v))} />
      </Row>
      <Show when={props.s.llm.enabled}>
        <Row label={t("Endpoint (compatible con OpenAI)")}>
          <input class="text mono" value={props.s.llm.endpoint} onChange={(e) => props.set((d) => void (d.llm.endpoint = e.currentTarget.value))} />
        </Row>
        <Row label={t("Modelo")} hint={t("Por ejemplo qwen2.5:1.5b en Ollama. Uno chico alcanza.")}>
          <input class="text mono" value={props.s.llm.model} placeholder={t("nombre del modelo")} onChange={(e) => props.set((d) => void (d.llm.model = e.currentTarget.value))} />
        </Row>
        <Row label={t("Clave (si el endpoint la pide)")}>
          <input class="text mono" type="password" value={props.s.llm.apiKey} onChange={(e) => props.set((d) => void (d.llm.apiKey = e.currentTarget.value))} />
        </Row>
        <Row label={t("Cada")}>
          <select class="text" value={String(props.s.llm.everySec)} onChange={(e) => props.set((d) => void (d.llm.everySec = Number(e.currentTarget.value)))}>
            <For each={[30, 60, 120, 300]}>{(v) => <option value={v}>{v < 60 ? `${v} s` : `${v / 60} min`}</option>}</For>
          </select>
        </Row>
      </Show>
      <h3>{t("Al abrir AlphaTerm")}</h3>
      <Row label={t("Recuperar el último estado")} hint={t("Ventanas, pestañas, paneles con su carpeta, colores, carpetas de pestañas y título.")}>
        <Toggle checked={props.s.session.restore} label={props.s.session.restore ? t("Sí") : t("No")} onChange={(v) => props.set((d) => void (d.session.restore = v))} />
      </Row>
      <Row label={t("Relanzar los agentes")} hint={t("Claude Code con --continue y Codex con resume --last (retoman la última conversación de esa carpeta). Si no, quedan como shells en su carpeta.")}>
        <Toggle checked={props.s.session.relaunchAgents} label={props.s.session.relaunchAgents ? t("Sí") : t("No")} onChange={(v) => props.set((d) => void (d.session.relaunchAgents = v))} />
      </Row>
    </section>
  );
}

// --- Consumo y widgets -------------------------------------------------------------------------------

interface StatuslineStatus {
  current: string | null;
  ours: boolean;
  currentExists: boolean | null;
}

function UsageSection(props: SectionProps) {
  const u = () => props.s.usage;
  const set = (f: (x: Settings["usage"]) => void) => props.set((d) => f(d.usage));
  const [status, { refetch }] = createResource(() => invoke<StatuslineStatus>("usage_statusline_status"));
  // El texto se arma al mostrarlo (así sigue el idioma si se cambia con el aviso a la vista).
  const [msg, setMsg] = createSignal<{ ok: boolean; text: () => string } | null>(null);
  const install = async () => {
    const cur = status()?.current;
    const ok = await askConfirm(
      [
        t("Esto cambia la statusline de Claude Code (~/.claude/settings.json) por la de AlphaTerm, que guarda los límites de 5 h y semana para el footer."),
        cur ? t("Hoy está configurada: {current}", { current: cur }) : "",
        t("Antes se guarda una copia del archivo (settings.json.antes-de-alphaterm). ¿Seguir?"),
      ]
        .filter(Boolean)
        .join("\n\n"),
      t("Seguir"),
    );
    if (!ok) return;
    try {
      const backup = await invoke<string>("usage_statusline_install");
      setMsg({ ok: true, text: () => t("Listo. Copia del archivo anterior en {backup}. Se ve en la próxima respuesta de Claude Code.", { backup }) });
      void refetch();
    } catch (e) {
      const error = String(e);
      setMsg({ ok: false, text: () => error });
    }
  };
  return (
    <section>
      <h2>{t("Consumo y widgets")}</h2>
      <Row
        label={t("Consulta en vivo")}
        hint={t("Como el System dashboard: al abrir AlphaTerm y cada tantos minutos se abre cada agente escondido (sin ventana) y se le pregunta su consumo: claude /usage, codex /status y agy /quota. No hace falta haberlos usado y no gasta cuota. Claude tarda unos 10 s.")}
      >
        <select class="text" value={String(u().liveEveryMin)} onChange={(e) => set((x) => void (x.liveEveryMin = Number(e.currentTarget.value)))}>
          <For each={[5, 10, 15, 30, 60, 120]}>{(v) => <option value={v}>{v < 60 ? t("cada {n} min", { n: v }) : t("cada {n} h", { n: v / 60 })}</option>}</For>
        </select>
      </Row>
      <Row label="Claude" hint={t("Sesión de 5 h, semana, semana por modelo, uso extra, plan y modelo (consulta en vivo). Entre consultas, la statusline de Claude Code lo actualiza mientras lo usás.")}>
        <Toggle checked={u().claude} label={u().claude ? t("En el footer") : t("Oculto")} onChange={(v) => set((x) => void (x.claude = v))} />
      </Row>
      <Row label={t("Statusline de Claude Code")}>
        <Show when={status()} fallback={<span class="muted">{t("Revisando…")}</span>}>
          <Show
            when={status()!.ours}
            fallback={
              <>
                <span class="muted">
                  {status()!.current
                    ? status()!.currentExists === false
                      ? t("Hoy: {current} (ese script ya no existe)", { current: status()!.current! })
                      : t("Hoy: {current}", { current: status()!.current! })
                    : t("Claude Code no tiene statusline configurada.")}
                </span>
                <button class="btn" onClick={() => void install()}>
                  {t("Usar la statusline de AlphaTerm")}
                </button>
              </>
            }
          >
            <span>{t("Conectada (la de AlphaTerm).")}</span>
          </Show>
        </Show>
        <Show when={msg()}>
          <div class="banner" classList={{ ok: msg()!.ok }}>
            {msg()!.text()}
          </div>
        </Show>
      </Row>
      <Row label="Codex" hint={t("Límites de 5 h y semanal, plan y modelo (consulta en vivo). Entre consultas, lo que deja Codex en sus sesiones mientras lo usás.")}>
        <Toggle checked={u().codex} label={u().codex ? t("En el footer") : t("Oculto")} onChange={(v) => set((x) => void (x.codex = v))} />
      </Row>
      <Row label="Antigravity (agy)" hint={t("Dato oficial de agy /quota por grupo de modelos (no gasta cuota). Se corre con su actualizador apagado: si no, abría una ventana de cmd un instante.")}>
        <Toggle checked={u().agy} label={u().agy ? t("En el footer") : t("Oculto")} onChange={(v) => set((x) => void (x.agy = v))} />
      </Row>
      <Row label={t("Releer los archivos de Claude y Codex cada")}>
        <select class="text" value={String(u().filesEverySec)} onChange={(e) => set((x) => void (x.filesEverySec = Number(e.currentTarget.value)))}>
          <For each={[15, 30, 60, 300, 900]}>{(v) => <option value={v}>{v < 60 ? `${v} s` : `${v / 60} min`}</option>}</For>
        </select>
      </Row>
      <Row label={t("Widget de CPU y RAM")} hint={t("En la barra de pestañas; clic para ver los procesos y lo que consume cada pestaña.")}>
        <Toggle checked={props.s.sysmon.enabled} label={props.s.sysmon.enabled ? t("Visible") : t("Oculto")} onChange={(v) => props.set((d) => void (d.sysmon.enabled = v))} />
      </Row>
      <Row label={t("Actualizar CPU y RAM cada")}>
        <select class="text" value={String(props.s.sysmon.everyMs)} onChange={(e) => props.set((d) => void (d.sysmon.everyMs = Number(e.currentTarget.value)))}>
          <For each={[500, 1000, 2000, 5000]}>{(v) => <option value={v}>{v < 1000 ? `${v} ms` : `${v / 1000} s`}</option>}</For>
        </select>
      </Row>
    </section>
  );
}

// --- Atajos ------------------------------------------------------------------------------------------

function ShortcutSection(props: SectionProps) {
  const eff = createMemo(() => effectiveBindings(props.s.shortcuts));
  const clash = createMemo(() => conflicts(props.s.shortcuts));
  const [recording, setRecording] = createSignal<string | null>(null);
  // El texto se arma al mostrarlo (así sigue el idioma si se cambia con el aviso a la vista).
  const [note, setNote] = createSignal<{ id: string; text: () => string; bad: boolean } | null>(null);
  const label = (id: string) => {
    const c = COMMANDS.find((x) => x.id === id);
    return c ? t(c.label) : id;
  };

  const setList = (id: string, list: string[]) =>
    props.set((d) => {
      const defaults = COMMANDS.find((c) => c.id === id)!.defaults;
      if (JSON.stringify(list) === JSON.stringify(effectiveBindings({})[id]) || JSON.stringify(list) === JSON.stringify(defaults)) delete d.shortcuts[id];
      else d.shortcuts[id] = list;
    });

  // Mientras se graba, la próxima combinación se la queda este campo.
  const onKey = (e: KeyboardEvent) => {
    const id = recording();
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setRecording(null);
      return;
    }
    if (e.ctrlKey && e.altKey) {
      setNote({ id, text: () => comboProblem("Ctrl+Alt+X")!, bad: true });
      return;
    }
    const combo = comboOf(e);
    if (!combo) return; // solo un modificador: seguir esperando
    if (comboProblem(combo)) {
      setNote({ id, text: () => `${combo}: ${comboProblem(combo)}`, bad: true });
      return;
    }
    setRecording(null);
    const list = eff()[id];
    if (!list.includes(combo)) setList(id, [...list, combo]);
    const other = COMMANDS.find((c) => c.id !== id && eff()[c.id].includes(combo));
    setNote(
      other
        ? { id, text: () => t("{combo} también lo usa «{command}»: gana el primero de la lista. Cambiá uno de los dos.", { combo, command: t(other.label) }), bad: true }
        : comboWarning(combo)
          ? { id, text: () => comboWarning(combo)!, bad: false }
          : null,
    );
  };
  window.addEventListener("keydown", onKey, true);
  onCleanup(() => window.removeEventListener("keydown", onKey, true));

  return (
    <section>
      <h2>{t("Atajos de teclado")}</h2>
      <p class="muted">
        {t("Se interceptan antes de que la tecla llegue a la shell. Ctrl+Alt no se puede usar: en el teclado en español es AltGr (para escribir @, # o [).")}
      </p>
      <table class="shortcuts">
        <tbody>
          <For each={COMMANDS}>
            {(c) => (
              <>
                <tr>
                  <td>{t(c.label)}</td>
                  <td class="combos">
                    <For each={eff()[c.id]}>
                      {(combo) => (
                        <span
                          class="chip"
                          classList={{ clash: clash().has(combo) }}
                          title={clash().has(combo) ? t("También: {commands}", { commands: clash().get(combo)!.filter((x) => x !== c.id).map(label).join(", ") }) : ""}
                        >
                          <kbd>{combo}</kbd>
                          <button title={t("Quitar")} onClick={() => setList(c.id, eff()[c.id].filter((x) => x !== combo))}>
                            ×
                          </button>
                        </span>
                      )}
                    </For>
                    <Show when={recording() === c.id} fallback={<button class="chip add" onClick={() => (setNote(null), setRecording(c.id))}>{t("+ agregar")}</button>}>
                      <span class="chip recording">{t("Presioná la combinación… (Esc cancela)")}</span>
                    </Show>
                    <Show when={eff()[c.id].length === 0 && recording() !== c.id}>
                      <span class="muted">{t("sin atajo")}</span>
                    </Show>
                  </td>
                  <td class="reset">
                    <Show when={props.s.shortcuts[c.id] !== undefined}>
                      <button class="link" onClick={() => props.set((d) => void delete d.shortcuts[c.id])}>
                        {t("De fábrica")}
                      </button>
                    </Show>
                  </td>
                </tr>
                <Show when={note()?.id === c.id}>
                  <tr>
                    <td />
                    <td colSpan={2} classList={{ "note-bad": note()!.bad, "note-warn": !note()!.bad }}>
                      {note()!.text()}
                    </td>
                  </tr>
                </Show>
              </>
            )}
          </For>
          <tr class="fixed">
            <td>{t(FIXED_HELP[1])}</td>
            <td class="combos">
              <span class="chip">
                <kbd>{FIXED_HELP[0]}</kbd>
              </span>
            </td>
            <td class="reset muted">{t("fijo")}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

// --- Acerca y límites ---------------------------------------------------------------------------------

function AboutSection(props: { path: string }) {
  const [info] = createResource(appInfo);
  return (
    <section>
      <h2>{t("Acerca y límites")}</h2>
      <p>
        <b>AlphaTerm</b> {t("(antes NovaTerm): terminal para trabajar con agentes de IA. Tauri 2 + Rust, SolidJS y xterm.js.")}
      </p>
      <Show when={info()}>
        <p>
          {t("Versión")} <b>{info()!.version}</b>
          <span class="muted"> · {versionTooltip(info()!).split("\n").slice(1).join(" · ")}</span>
        </p>
      </Show>
      <p class="muted">{t("Configuración: {path}", { path: props.path })}</p>
      <h3>{t("Lo que no hace (y por qué)")}</h3>
      <ul class="next">
        <li>
          <b>{t("Guardián")}</b>:{" "}
          {t("frena a Claude Code (hooks) y a Codex (su modo de aprobación) lanzados desde AlphaTerm, y a lo que pase por la API. No puede frenar a cualquier programa: Windows no lo permite sin un driver de sistema de archivos.")}
        </li>
        <li>
          <b>{t("Consumo")}</b>:{" "}
          {t("al abrir AlphaTerm y cada tantos minutos se le pregunta a cada agente, abierto escondido (claude /usage, codex /status, agy /quota), como el System dashboard. No se leen credenciales ni se llama a sus servidores. Entre consultas, lo actualizan la statusline de Claude Code y las sesiones de Codex.")}
        </li>
        <li>
          <b>{t("Modificaciones")}</b>:{" "}
          {t("de Claude Code lanzado desde AlphaTerm se sabe exactamente qué cambió; de otros agentes, se compara con una copia de la carpeta tomada al arrancar (sin lo que ignora git ni archivos de más de 2 MB).")}
        </li>
        <li>
          <b>{t("Integración de la shell")}</b>: {t("PowerShell, Git Bash y cmd. WSL no, y en cmd no se sabe el código de salida.")}
        </li>
      </ul>
    </section>
  );
}
