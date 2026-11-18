import { createMemo, createResource, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import type { TermInfo } from "../terminal/pty";
import { invoke } from "@tauri-apps/api/core";
import { COMMANDS, FIXED_HELP, comboOf, comboProblem, comboWarning, conflicts, effectiveBindings } from "../layout/shortcuts";
import { activeTheme, createOsDark, fontStack, storeBackground } from "./apply";
import { monospaceFonts } from "./fonts";
import { COLOR_KEYS, DEFAULT_FONT, LIMITS, type ColorKey, type Effect, type Settings } from "./schema";
import { revealSettings, type SettingsStore } from "./store";
import { allThemes, findTheme, importThemes, themeId, type Theme } from "./themes";
import "./settings.css";

type Section = "apariencia" | "fuente" | "fondo" | "terminal" | "consumo" | "atajos" | "proximo";
const SECTIONS: [Section, string][] = [
  ["apariencia", "Tema y colores"],
  ["fuente", "Fuente y cursor"],
  ["fondo", "Fondo de la ventana"],
  ["terminal", "Terminal e interfaz"],
  ["consumo", "Consumo y widgets"],
  ["atajos", "Atajos de teclado"],
  ["proximo", "Próximas fases"],
];
const SECTION_PREF = "novaterm.settings.section";

const COLOR_LABELS: Record<ColorKey, string> = {
  background: "Fondo", foreground: "Texto", cursor: "Cursor", cursorAccent: "Texto bajo el cursor",
  selectionBackground: "Selección", black: "Negro", red: "Rojo", green: "Verde", yellow: "Amarillo",
  blue: "Azul", magenta: "Magenta", cyan: "Cian", white: "Blanco", brightBlack: "Negro claro",
  brightRed: "Rojo claro", brightGreen: "Verde claro", brightYellow: "Amarillo claro", brightBlue: "Azul claro",
  brightMagenta: "Magenta claro", brightCyan: "Cian claro", brightWhite: "Blanco brillante",
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

export default function SettingsView(props: { info: TermInfo; store: SettingsStore }) {
  const s = () => props.store.settings();
  const set = (f: (d: Settings) => void) => props.store.update(f);
  const osDark = createOsDark();
  document.title = "Configuración — NovaTerm";
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
        <h1>Configuración</h1>
        <For each={SECTIONS}>
          {([id, label]) => (
            <button classList={{ on: section() === id }} onClick={() => go(id)}>
              {label}
            </button>
          )}
        </For>
        <div class="nav-foot">
          <small title={props.store.path}>Se guarda sola en settings.json y se aplica al instante en todas las ventanas.</small>
          <button class="link" onClick={() => void revealSettings()}>
            Mostrar el archivo
          </button>
          <button
            class="link danger"
            onClick={() => {
              if (confirm("¿Volver toda la configuración a los valores de fábrica? Se borran también los temas propios.")) {
                props.store.reset();
              }
            }}
          >
            Restablecer todo
          </button>
        </div>
      </nav>
      <main class="settings-main">
        <Show when={props.store.warning()}>
          <div class="banner">{props.store.warning()}</div>
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
        <Show when={section() === "consumo"}>
          <UsageSection s={s()} set={set} />
        </Show>
        <Show when={section() === "atajos"}>
          <ShortcutSection s={s()} set={set} />
        </Show>
        <Show when={section() === "proximo"}>
          <NextSection />
        </Show>
      </main>
    </div>
  );
}

interface SectionProps {
  s: Settings;
  set: (f: (d: Settings) => void) => void;
}

// --- Tema y colores ------------------------------------------------------------------------------

function ThemeSection(props: SectionProps & { osDark: boolean }) {
  const lightActive = () => props.s.appearance.mode === "light" || (props.s.appearance.mode === "auto" && !props.osDark);
  const [slot, setSlot] = createSignal<"dark" | "light" | null>(null);
  const target = () => slot() ?? (lightActive() ? "light" : "dark");
  const themes = createMemo(() => allThemes(props.s.customThemes));
  const selectedId = () => (target() === "light" ? props.s.appearance.themeLight : props.s.appearance.theme);
  const selected = () => findTheme(selectedId(), props.s.customThemes, target() === "light" ? "nova-light" : "nova-dark");
  const [message, setMessage] = createSignal<{ ok: boolean; text: string } | null>(null);
  let fileInput!: HTMLInputElement;

  const choose = (id: string) =>
    props.set((d) => {
      if (target() === "light") d.appearance.themeLight = id;
      else d.appearance.theme = id;
    });

  const takenIds = () => new Set(themes().map((t) => t.id));

  const duplicate = () => {
    const base = selected();
    const name = `${base.name} (copia)`;
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
      const added = found.map((t) => {
        const id = themeId(t.name, taken);
        taken.add(id);
        return { id, name: t.name, colors: t.colors, missing: t.missing };
      });
      props.set((d) => {
        for (const t of added) d.customThemes.push({ id: t.id, name: t.name, colors: t.colors });
        if (target() === "light") d.appearance.themeLight = added[0].id;
        else d.appearance.theme = added[0].id;
      });
      const incomplete = added.filter((t) => t.missing.length > 0);
      setMessage({
        ok: true,
        text:
          `Se importó ${added.length === 1 ? `"${added[0].name}"` : `${added.length} temas`}.` +
          (incomplete.length ? ` A ${incomplete.length === 1 ? "uno" : incomplete.length} le faltaban colores y se completaron con Nova oscuro.` : ""),
      });
    } catch (e) {
      setMessage({ ok: false, text: `No se pudo importar ${file.name}: ${(e as Error).message}` });
    }
  };

  const editColor = (key: ColorKey, value: string) =>
    props.set((d) => {
      const t = d.customThemes.find((x) => x.id === selected().id);
      if (t) t.colors[key] = value;
    });

  const remove = () => {
    const t = selected();
    if (!confirm(`¿Borrar el tema "${t.name}"? No se puede deshacer (salvo volviéndolo a importar).`)) return;
    props.set((d) => {
      d.customThemes = d.customThemes.filter((x) => x.id !== t.id);
      if (d.appearance.theme === t.id) d.appearance.theme = "nova-dark";
      if (d.appearance.themeLight === t.id) d.appearance.themeLight = "nova-light";
    });
  };

  return (
    <section>
      <h2>Tema y colores</h2>
      <Row label="Modo" hint="Con «Según Windows» cambia solo cuando Windows pasa de claro a oscuro.">
        <Segmented
          value={props.s.appearance.mode}
          options={[["dark", "Oscuro"], ["light", "Claro"], ["auto", "Según Windows"]]}
          onChange={(v) => {
            setSlot(null);
            props.set((d) => void (d.appearance.mode = v));
          }}
        />
      </Row>
      <Row label="Elegir el tema del modo">
        <Segmented value={target()} options={[["dark", `Oscuro · ${findTheme(props.s.appearance.theme, props.s.customThemes).name}`], ["light", `Claro · ${findTheme(props.s.appearance.themeLight, props.s.customThemes, "nova-light").name}`]]} onChange={setSlot} />
      </Row>
      <div class="theme-grid">
        <For each={themes()}>
          {(t) => (
            <button class="theme-card" classList={{ on: t.id === selected().id }} onClick={() => choose(t.id)} title={t.builtin ? "Tema de fábrica" : "Tema propio"}>
              <Swatches theme={t} />
              <span>
                {t.name}
                {t.builtin ? "" : " ✎"}
              </span>
            </button>
          )}
        </For>
      </div>
      <div class="actions">
        <button class="btn" onClick={duplicate}>
          Duplicar para editar
        </button>
        <button class="btn" onClick={() => fileInput.click()}>
          Importar tema…
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
        <small>Acepta esquemas de Windows Terminal (o su settings.json entero), .itermcolors de iTerm2 y temas de xterm.js.</small>
      </div>
      <Show when={message()}>
        <div class="banner" classList={{ ok: message()!.ok }}>
          {message()!.text}
        </div>
      </Show>
      <Show
        when={!selected().builtin}
        fallback={<p class="muted">Los temas de fábrica no se editan: «Duplicar para editar» crea una copia propia.</p>}
      >
        <h3>Editar «{selected().name}»</h3>
        <Row label="Nombre">
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
                <span>{COLOR_LABELS[key]}</span>
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
            Borrar este tema
          </button>
        </div>
      </Show>
    </section>
  );
}

// --- Fuente y cursor -------------------------------------------------------------------------------

const SAMPLE = ["PS C:\\NovaTerm> git log --oneline -3", "c91ef04 F2: pestañas, splits y shell integration", "=> != === <= >= -> |> :: www 0O1lI ñ á"];

function FontSection(props: SectionProps & { theme: Theme }) {
  const [fonts] = createResource(monospaceFonts);
  const a = () => props.s.appearance;
  const inList = () => (fonts() ?? []).includes(a().fontFamily);
  const [custom, setCustom] = createSignal(false);
  const showCustom = () => custom() || (fonts.state === "ready" && !inList());
  const set = (f: (x: Settings["appearance"]) => void) => props.set((d) => f(d.appearance));

  return (
    <section>
      <h2>Fuente y cursor</h2>
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
        <For each={SAMPLE}>{(l) => <div>{l}</div>}</For>
      </div>
      <Row label="Fuente" hint={fonts.loading ? "Buscando las fuentes monoespaciadas instaladas…" : `${fonts()?.length ?? 0} monoespaciadas instaladas`}>
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
          <option value="__otra">Otra (escribir el nombre)…</option>
        </select>
        <Show when={showCustom()}>
          <input
            class="text"
            value={a().fontFamily}
            placeholder="Nombre exacto de la familia"
            onChange={(e) => set((x) => void (x.fontFamily = e.currentTarget.value))}
          />
        </Show>
      </Row>
      <Row label="Tamaño">
        <Slider value={a().fontSize} range={LIMITS.fontSize} step={0.5} format={(v) => `${v} px`} onChange={(v) => set((x) => void (x.fontSize = v))} />
      </Row>
      <Row label="Interlineado">
        <Slider value={a().lineHeight} range={LIMITS.lineHeight} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => set((x) => void (x.lineHeight = v))} />
      </Row>
      <Row label="Espacio entre letras">
        <Slider value={a().letterSpacing} range={LIMITS.letterSpacing} step={0.5} format={(v) => `${v} px`} onChange={(v) => set((x) => void (x.letterSpacing = v))} />
      </Row>
      <Row label="Grosor">
        <Segmented
          value={a().fontWeight}
          options={[["300", "Fina"], ["normal", "Normal"], ["500", "Media"], ["600", "Seminegrita"], ["bold", "Negrita"]]}
          onChange={(v) => set((x) => void (x.fontWeight = v))}
        />
      </Row>
      <Row label="Ligaduras" hint="Une => != === en un solo símbolo. Solo en fuentes que las traen: Cascadia Code, Fira Code, JetBrains Mono (Cascadia Mono no).">
        <Toggle checked={a().ligatures} label={a().ligatures ? "Activadas" : "Desactivadas"} onChange={(v) => set((x) => void (x.ligatures = v))} />
      </Row>
      <Row label="Cursor">
        <Segmented
          value={a().cursorStyle}
          options={[["block", "Bloque ▮"], ["bar", "Barra ▏"], ["underline", "Subrayado ▁"]]}
          onChange={(v) => set((x) => void (x.cursorStyle = v))}
        />
      </Row>
      <Row label="Parpadeo del cursor">
        <Toggle checked={a().cursorBlink} label={a().cursorBlink ? "Parpadea" : "Fijo"} onChange={(v) => set((x) => void (x.cursorBlink = v))} />
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
  const pct = (v: number) => `${Math.round(v * 100)} %`;
  const fileName = () => b().image.split(/[\\/]/).pop();

  return (
    <section>
      <h2>Fondo de la ventana</h2>
      <Row label="Efecto de Windows 11" hint="Mica toma el tono del fondo de pantalla; Acrylic deja ver lo que hay detrás, desenfocado. Solo se ven si el fondo no es opaco.">
        <Segmented<Effect>
          value={b().effect}
          options={[["none", "Ninguno"], ["mica", "Mica"], ["tabbed", "Mica alternativo"], ["acrylic", "Acrylic"], ["blur", "Desenfoque"]]}
          onChange={(v) =>
            set((x) => {
              x.effect = v;
              // Con el fondo opaco el efecto no se vería.
              if (v !== "none" && x.opacity >= 1) x.opacity = 0.75;
            })
          }
        />
      </Row>
      <Row label="Opacidad del fondo" hint="Por debajo de 100 % se ve el efecto (o el escritorio, si no hay efecto).">
        <Slider value={b().opacity} range={LIMITS.opacity} step={0.01} format={pct} onChange={(v) => set((x) => void (x.opacity = v))} />
      </Row>
      <Row label="Imagen" hint="Se guarda una copia en %APPDATA%\NovaTerm\fondos, así sigue andando si movés el original.">
        <div class="actions tight">
          <button class="btn" onClick={() => fileInput.click()}>
            {b().image ? "Cambiar imagen…" : "Elegir imagen…"}
          </button>
          <Show when={b().image}>
            <span class="muted" title={b().image}>
              {fileName()}
            </span>
            <button class="btn" onClick={() => set((x) => void (x.image = ""))}>
              Quitar
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
        <Row label="Opacidad de la imagen">
          <Slider value={b().imageOpacity} range={LIMITS.imageOpacity} step={0.01} format={pct} onChange={(v) => set((x) => void (x.imageOpacity = v))} />
        </Row>
        <Row label="Ajuste">
          <Segmented value={b().imageFit} options={[["cover", "Cubrir"], ["contain", "Entera"], ["tile", "Mosaico"]]} onChange={(v) => set((x) => void (x.imageFit = v))} />
        </Row>
      </Show>
    </section>
  );
}

// --- Terminal e interfaz -----------------------------------------------------------------------------

function TerminalSection(props: SectionProps & { info: TermInfo }) {
  const auto = () => props.info.profiles.find((p) => p.id === props.info.defaultProfile)?.name ?? props.info.defaultProfile;
  return (
    <section>
      <h2>Terminal e interfaz</h2>
      <Row label="Barra de pestañas" hint="También con Ctrl+Shift+B.">
        <Segmented
          value={props.s.tabBar.position}
          options={[["top", "Arriba"], ["left", "A la izquierda"]]}
          onChange={(v) => props.set((d) => void (d.tabBar.position = v))}
        />
      </Row>
      <Row label="Shell por defecto" hint="La de las pestañas y ventanas nuevas.">
        <select class="text" value={props.s.terminal.defaultProfile} onChange={(e) => props.set((d) => void (d.terminal.defaultProfile = e.currentTarget.value))}>
          <option value="">Automática ({auto()})</option>
          <For each={props.info.profiles}>
            {(p) => (
              <option value={p.id} disabled={!p.available}>
                {p.name}
                {p.available ? "" : " (no detectado)"}
              </option>
            )}
          </For>
        </select>
      </Row>
      <Row label="Líneas de historial" hint="Por pestaña. Más líneas, más memoria (unas 10 000 líneas ≈ 5–10 MB).">
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
      <Row label="Detectar el programa en uso cada" hint="Para el nombre de la pestaña cuando la shell no tiene integración. Se pausa con la ventana minimizada.">
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
  const [msg, setMsg] = createSignal<{ ok: boolean; text: string } | null>(null);
  const install = async () => {
    const cur = status()?.current;
    const ok = confirm(
      "Esto cambia la statusline de Claude Code (~/.claude/settings.json) por la de NovaTerm, que guarda los límites de 5 h y semana para el footer." +
        (cur ? `\n\nHoy está configurada: ${cur}` : "") +
        "\n\nAntes se guarda una copia del archivo (settings.json.antes-de-novaterm). ¿Seguir?",
    );
    if (!ok) return;
    try {
      const backup = await invoke<string>("usage_statusline_install");
      setMsg({ ok: true, text: `Listo. Copia del archivo anterior en ${backup}. Se ve en la próxima respuesta de Claude Code.` });
      void refetch();
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    }
  };
  return (
    <section>
      <h2>Consumo y widgets</h2>
      <Row label="Claude" hint="Porcentaje exacto de 5 h y de la semana, tomado de la statusline de Claude Code. Sin ella, solo una estimación en tokens.">
        <Toggle checked={u().claude} label={u().claude ? "En el footer" : "Oculto"} onChange={(v) => set((x) => void (x.claude = v))} />
      </Row>
      <Row label="Statusline de Claude Code">
        <Show when={status()} fallback={<span class="muted">Revisando…</span>}>
          <Show
            when={status()!.ours}
            fallback={
              <>
                <span class="muted">
                  {status()!.current
                    ? `Hoy: ${status()!.current}${status()!.currentExists === false ? " (ese script ya no existe)" : ""}`
                    : "Claude Code no tiene statusline configurada."}
                </span>
                <button class="btn" onClick={() => void install()}>
                  Usar la statusline de NovaTerm
                </button>
              </>
            }
          >
            <span>Conectada (la de NovaTerm).</span>
          </Show>
        </Show>
        <Show when={msg()}>
          <div class="banner" classList={{ ok: msg()!.ok }}>
            {msg()!.text}
          </div>
        </Show>
      </Row>
      <Row label="Codex" hint="Último dato de límites que dejó Codex en sus sesiones: se actualiza cuando lo usás.">
        <Toggle checked={u().codex} label={u().codex ? "En el footer" : "Oculto"} onChange={(v) => set((x) => void (x.codex = v))} />
      </Row>
      <Row label="Antigravity (agy)" hint="Dato oficial de agy /quota (no gasta cuota). Se corre agy directo, sin shell.">
        <Toggle checked={u().agy} label={u().agy ? "En el footer" : "Oculto"} onChange={(v) => set((x) => void (x.agy = v))} />
      </Row>
      <Row label="Leer Claude y Codex cada">
        <select class="text" value={String(u().filesEverySec)} onChange={(e) => set((x) => void (x.filesEverySec = Number(e.currentTarget.value)))}>
          <For each={[15, 30, 60, 300, 900]}>{(v) => <option value={v}>{v < 60 ? `${v} s` : `${v / 60} min`}</option>}</For>
        </select>
      </Row>
      <Row label="Consultar agy cada">
        <select class="text" value={String(u().agyEveryMin)} onChange={(e) => set((x) => void (x.agyEveryMin = Number(e.currentTarget.value)))}>
          <For each={[2, 5, 10, 30, 60]}>{(v) => <option value={v}>{v} min</option>}</For>
        </select>
      </Row>
      <Row label="Widget de CPU y RAM" hint="En la barra de pestañas; clic para ver los procesos y lo que consume cada pestaña.">
        <Toggle checked={props.s.sysmon.enabled} label={props.s.sysmon.enabled ? "Visible" : "Oculto"} onChange={(v) => props.set((d) => void (d.sysmon.enabled = v))} />
      </Row>
      <Row label="Actualizar CPU y RAM cada">
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
  const [note, setNote] = createSignal<{ id: string; text: string; bad: boolean } | null>(null);
  const label = (id: string) => COMMANDS.find((c) => c.id === id)?.label ?? id;

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
      setNote({ id, text: comboProblem("Ctrl+Alt+X")!, bad: true });
      return;
    }
    const combo = comboOf(e);
    if (!combo) return; // solo un modificador: seguir esperando
    const problem = comboProblem(combo);
    if (problem) {
      setNote({ id, text: `${combo}: ${problem}`, bad: true });
      return;
    }
    setRecording(null);
    const list = eff()[id];
    if (!list.includes(combo)) setList(id, [...list, combo]);
    const other = COMMANDS.find((c) => c.id !== id && eff()[c.id].includes(combo));
    const warn = comboWarning(combo);
    setNote(
      other
        ? { id, text: `${combo} también lo usa «${other.label}»: gana el primero de la lista. Cambiá uno de los dos.`, bad: true }
        : warn
          ? { id, text: warn, bad: false }
          : null,
    );
  };
  window.addEventListener("keydown", onKey, true);
  onCleanup(() => window.removeEventListener("keydown", onKey, true));

  return (
    <section>
      <h2>Atajos de teclado</h2>
      <p class="muted">
        Se interceptan antes de que la tecla llegue a la shell. Ctrl+Alt no se puede usar: en el teclado en español es AltGr (para escribir @, # o [).
      </p>
      <table class="shortcuts">
        <tbody>
          <For each={COMMANDS}>
            {(c) => (
              <>
                <tr>
                  <td>{c.label}</td>
                  <td class="combos">
                    <For each={eff()[c.id]}>
                      {(combo) => (
                        <span
                          class="chip"
                          classList={{ clash: clash().has(combo) }}
                          title={clash().has(combo) ? `También: ${clash().get(combo)!.filter((x) => x !== c.id).map(label).join(", ")}` : ""}
                        >
                          <kbd>{combo}</kbd>
                          <button title="Quitar" onClick={() => setList(c.id, eff()[c.id].filter((x) => x !== combo))}>
                            ×
                          </button>
                        </span>
                      )}
                    </For>
                    <Show when={recording() === c.id} fallback={<button class="chip add" onClick={() => (setNote(null), setRecording(c.id))}>+ agregar</button>}>
                      <span class="chip recording">Presioná la combinación… (Esc cancela)</span>
                    </Show>
                    <Show when={eff()[c.id].length === 0 && recording() !== c.id}>
                      <span class="muted">sin atajo</span>
                    </Show>
                  </td>
                  <td class="reset">
                    <Show when={props.s.shortcuts[c.id] !== undefined}>
                      <button class="link" onClick={() => props.set((d) => void delete d.shortcuts[c.id])}>
                        De fábrica
                      </button>
                    </Show>
                  </td>
                </tr>
                <Show when={note()?.id === c.id}>
                  <tr>
                    <td />
                    <td colSpan={2} classList={{ "note-bad": note()!.bad, "note-warn": !note()!.bad }}>
                      {note()!.text}
                    </td>
                  </tr>
                </Show>
              </>
            )}
          </For>
          <tr class="fixed">
            <td>{FIXED_HELP[1]}</td>
            <td class="combos">
              <span class="chip">
                <kbd>{FIXED_HELP[0]}</kbd>
              </span>
            </td>
            <td class="reset muted">fijo</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

// --- Próximas fases --------------------------------------------------------------------------------

function NextSection() {
  return (
    <section>
      <h2>Próximas fases</h2>
      <p class="muted">Estas opciones del plan llegan con su fase; acá van a aparecer cuando estén hechas y probadas:</p>
      <ul class="next">
        <li>
          <b>Agentes</b> (F4): catálogo de Claude Code, Codex, Antigravity (agy) y OpenCode, comandos y variables de entorno.
        </li>
        <li>
          <b>Consumo por suscripción</b> (F5): prender o apagar cada proveedor y cada cuánto se consulta.
        </li>
        <li>
          <b>CPU y RAM</b> (F5): frecuencia del widget.
        </li>
        <li>
          <b>Resumen de pestañas con un modelo</b> (F9): endpoint compatible con OpenAI (Ollama o vLLM) y cada cuánto resume.
        </li>
      </ul>
    </section>
  );
}
