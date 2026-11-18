import { createEffect, on, onCleanup, onMount } from "solid-js";
import { Terminal, type IDisposable, type IMarker } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import type { LigaturesAddon } from "@xterm/addon-ligatures";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@xterm/xterm/css/xterm.css";
import { AckBatcher } from "./ack";
import { parse133, parse633, parseOsc7, parseOsc9 } from "./integration";
import { decideKey } from "./keys";
import { PtySession } from "./pty";
import { cmdRunningCommand, isShellTitle } from "../layout/title";
import type { Action } from "../layout/shortcuts";
import type { TermLook } from "../settings/apply";
import type { Startup } from "../layout/model";
import { registerPathLinks } from "./pathLinks";

export type Renderer = "webgl" | "dom";

/** Lo que la terminal le cuenta al contenedor (se aplica como parche). */
export interface TermPatch {
  sessionId?: number;
  pid?: number | null;
  renderer?: Renderer;
  integrated?: boolean;
  running?: boolean;
  cwd?: string;
  lastCommand?: string;
  exitCode?: number | null;
  agentTitle?: string | undefined;
  exited?: boolean;
  /** Hubo salida en los últimos segundos (para saber si un agente trabaja o espera). */
  active?: boolean;
  /** Sonó la campana (BEL) y nadie escribió desde entonces. */
  bell?: boolean;
}

const QUIET_MS = 2500;

/** Acciones que la vista sabe hacer sobre su terminal (las pide el contenedor). */
export interface TermHandle {
  jumpPrompt(delta: 1 | -1): void;
  copyLastOutput(): Promise<boolean>;
  focus(): void;
}

interface Props {
  profileId: string;
  cwd?: string;
  /** Comando a correr cuando la shell esté lista (agentes). */
  startup?: Startup;
  /** Variables extra para la shell (ej. el PATH completo para agentes). */
  env?: Record<string, string>;
  windowsBuild: number;
  look: TermLook;
  /** Atajo de la app para esta tecla (o null si va a la shell). */
  match: (e: KeyboardEvent) => Action | null;
  visible: boolean;
  focused: boolean;
  onFocus: () => void;
  onPatch: (p: TermPatch) => void;
  /** El shell terminó. Devuelve true si el contenedor cierra el panel. */
  onExit: (code: number | null) => boolean;
  onAction: (a: Action) => void;
  ref?: (h: TermHandle) => void;
}

interface Block {
  prompt: IMarker;
  output?: IMarker;
  end?: IMarker;
  exitCode?: number | null;
}

export function TerminalView(props: Props) {
  let host!: HTMLDivElement;

  onMount(() => {
    const look0 = props.look;
    const term = new Terminal({
      allowProposedApi: true,
      fontFamily: look0.fontFamily,
      fontSize: look0.fontSize,
      lineHeight: look0.lineHeight,
      letterSpacing: look0.letterSpacing,
      fontWeight: look0.fontWeight,
      cursorStyle: look0.cursorStyle,
      cursorBlink: look0.cursorBlink,
      scrollback: look0.scrollback,
      allowTransparency: look0.transparent,
      theme: look0.theme,
      windowsPty: { backend: "conpty", buildNumber: props.windowsBuild },
      overviewRuler: { width: 8 },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_e, uri) => void openUrl(uri)));
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.open(host);
    // Rutas en la salida: links que abren la carpeta o el archivo, con vista previa al pasar el mouse.
    let cwdNow = props.cwd;
    const pathLinks = registerPathLinks(term, () => cwdNow);

    let disposed = false;
    const patch = (p: TermPatch) => {
      if (!disposed) props.onPatch(p);
    };

    // WebGL solo mientras el panel se ve: los navegadores limitan los contextos WebGL (~16),
    // y una pestaña oculta no necesita pintar (xterm igual sigue cargando su buffer).
    let gl: WebglAddon | null = null;
    const attachGl = () => {
      if (gl) return;
      try {
        const addon = new WebglAddon();
        addon.onContextLoss(() => {
          addon.dispose();
          if (gl === addon) gl = null;
          patch({ renderer: "dom" });
        });
        term.loadAddon(addon);
        gl = addon;
        patch({ renderer: "webgl" });
      } catch (err) {
        console.warn("WebGL no disponible, se usa el renderer DOM", err);
        patch({ renderer: "dom" });
      }
    };
    const detachGl = () => {
      gl?.dispose();
      gl = null;
    };
    const safeFit = () => {
      if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit();
    };

    // --- Shell integration ---------------------------------------------------------------
    let integrated = false;
    let running = false;
    const blocks: Block[] = [];
    let current: Block | null = null;
    const oscs: IDisposable[] = [];

    const markExit = (b: Block) => {
      if (b.exitCode === undefined) return;
      const ok = b.exitCode === 0 || b.exitCode === null;
      const deco = term.registerDecoration({
        marker: b.prompt,
        overviewRulerOptions: { color: ok ? "#8bd49c" : "#ef6b73", position: "left" },
      });
      deco?.onRender((el) => {
        el.classList.add("nt-mark", ok ? "nt-ok" : "nt-err");
        el.title = ok ? "Terminó bien" : `Código de salida ${b.exitCode}`;
      });
    };

    oscs.push(
      term.parser.registerOscHandler(133, (data) => {
        const m = parse133(data);
        if (!m) return false;
        if (m.type === "promptStart") {
          runStartup();
          current = { prompt: term.registerMarker(0) };
          blocks.push(current);
          if (blocks.length > 2000) blocks.splice(0, blocks.length - 2000).forEach((b) => b.prompt.dispose());
        } else if (m.type === "commandStart") {
          integrated = true;
          running = true;
          if (current) current.output = term.registerMarker(0);
          patch({ integrated, running: true });
        } else if (m.type === "commandEnd" && running) {
          running = false;
          if (current) {
            current.end = term.registerMarker(0);
            current.exitCode = m.exitCode;
            markExit(current);
          }
          patch({ running: false, exitCode: m.exitCode, agentTitle: undefined });
        }
        return true;
      }),
      term.parser.registerOscHandler(633, (data) => {
        const m = parse633(data);
        if (!m) return false;
        integrated = true;
        patch({ integrated: true, lastCommand: m.command });
        return true;
      }),
      term.parser.registerOscHandler(7, (data) => {
        const cwd = parseOsc7(data);
        if (cwd) {
          cwdNow = cwd;
          patch({ cwd });
        }
        return true;
      }),
      term.parser.registerOscHandler(9, (data) => {
        const cwd = parseOsc9(data);
        if (!cwd) return false;
        cwdNow = cwd;
        patch({ cwd });
        return true;
      }),
    );

    // Título OSC: vale como resumen si lo puso un programa (no el prompt del shell).
    term.onTitleChange((t) => {
      const cmdLine = cmdRunningCommand(t);
      if (cmdLine) {
        patch({ lastCommand: cmdLine });
        return;
      }
      if (isShellTitle(t)) return;
      if (integrated && !running) return;
      patch({ agentTitle: t });
    });

    const promptLines = () => blocks.map((b) => b.prompt.line).filter((l) => l >= 0);
    const jumpPrompt = (delta: 1 | -1) => {
      const top = term.buffer.active.viewportY;
      const lines = promptLines();
      const target = delta < 0 ? [...lines].reverse().find((l) => l < top) : lines.find((l) => l > top);
      if (target !== undefined) term.scrollToLine(target);
      else if (delta > 0) term.scrollToBottom();
    };
    const copyLastOutput = async () => {
      const b = [...blocks].reverse().find((x) => x.output && x.end && x.output.line >= 0 && x.end.line >= 0);
      if (!b || !b.output || !b.end) return false;
      const buf = term.buffer.active;
      let text = "";
      for (let i = b.output.line; i < b.end.line; i++) {
        const line = buf.getLine(i);
        if (!line) continue;
        const next = buf.getLine(i + 1);
        text += line.translateToString(true) + (next?.isWrapped ? "" : "\n");
      }
      await writeText(text.replace(/\n+$/, "\n"));
      return true;
    };

    // --- Comando inicial (agentes) ------------------------------------------------------------
    // Se escribe en la shell cuando aparece el primer prompt (integración) o, si la shell no
    // tiene integración, a los 2,5 s. Así el agente corre dentro de la shell: al salir, queda ahí.
    let startupPending = !!props.startup?.command;
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    const runStartup = () => {
      if (!startupPending || !session) return;
      startupPending = false;
      clearTimeout(startupTimer);
      const s = session;
      const ENTER = String.fromCharCode(13); // lo que manda la tecla Enter
      setTimeout(() => s.write(props.startup!.command + ENTER), 60);
    };

    // --- Actividad y campana ------------------------------------------------------------------
    let lastData = 0;
    let active = false;
    let bell = false;
    const activity = setInterval(() => {
      if (active && Date.now() - lastData > QUIET_MS) {
        active = false;
        patch({ active: false });
      }
    }, 1000);
    term.onBell(() => {
      if (!bell) {
        bell = true;
        patch({ bell: true });
      }
    });

    // --- Sesión ----------------------------------------------------------------------------
    let session: PtySession | null = null;
    let ack: AckBatcher | null = null;
    let exited = false;

    const start = async () => {
      exited = false;
      const batch = new AckBatcher((n) => void current_session?.ack(n));
      let current_session: PtySession | null = null;
      try {
        current_session = await PtySession.spawn({
          profileId: props.profileId,
          cwd: props.cwd,
          env: { ...props.env, ...props.startup?.env },
          cols: term.cols,
          rows: term.rows,
          // El ack va cuando xterm terminó de procesar el trozo: eso es lo que frena al backend.
          onData: (bytes) => {
            if (disposed) return;
            term.write(bytes, () => batch.add(bytes.byteLength));
            lastData = Date.now();
            if (!active) {
              active = true;
              patch({ active: true });
            }
          },
          onEvent: (ev) => {
            if (ev.type !== "exit") return;
            batch.dispose();
            if (disposed) return;
            session = null;
            exited = true;
            running = false;
            patch({ exited: true, running: false, exitCode: ev.code });
            if (props.onExit(ev.code)) return;
            const code = ev.code ?? "?";
            term.write(`\r\n\x1b[2m[proceso terminado, código ${code}. Enter para reiniciar]\x1b[0m\r\n`);
          },
        });
      } catch (err) {
        term.write(`\x1b[31mNo se pudo iniciar la shell: ${err}\x1b[0m\r\n`);
        return;
      }
      if (disposed) {
        void current_session.kill();
        return;
      }
      session = current_session;
      // Si el panel se ajustó mientras la sesión arrancaba, ese resize se perdió: se manda ahora.
      if (current_session.spawnedCols !== term.cols || current_session.spawnedRows !== term.rows) {
        void current_session.resize(term.cols, term.rows);
      }
      ack = batch;
      patch({ sessionId: current_session.id, pid: current_session.info.pid, exited: false });
      if (startupPending) startupTimer = setTimeout(runStartup, 2500);
    };

    term.onData((data) => {
      if (bell) {
        bell = false;
        patch({ bell: false });
      }
      if (session) void session.write(data);
      else if (exited && data === "\r") void start();
    });
    term.onResize(({ cols, rows }) => void session?.resize(cols, rows));

    const copy = () => {
      const sel = term.getSelection();
      if (sel) void writeText(sel);
      term.clearSelection();
    };
    const paste = async () => {
      const text = await readText().catch(() => "");
      if (text) term.paste(text);
    };
    term.attachCustomKeyEventHandler((e) => {
      const action = props.match(e);
      if (action) {
        e.preventDefault();
        props.onAction(action);
        return false;
      }
      const clip = decideKey(e, term.hasSelection());
      if (clip === "pass") return true;
      e.preventDefault();
      if (clip === "copy") copy();
      else void paste();
      return false;
    });
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      if (term.hasSelection()) copy();
      else void paste();
    };
    host.addEventListener("contextmenu", onContext);
    const onFocusIn = () => {
      props.onFocus();
      if (bell) {
        bell = false;
        patch({ bell: false });
      }
    };
    host.addEventListener("focusin", onFocusIn);

    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(safeFit);
    });
    ro.observe(host);

    createEffect(
      on(
        () => props.visible,
        (visible) => {
          if (visible) {
            attachGl();
            requestAnimationFrame(() => {
              safeFit();
              term.refresh(0, term.rows - 1);
              if (props.focused) term.focus();
            });
          } else {
            detachGl();
          }
        },
      ),
    );
    createEffect(() => {
      if (props.visible && props.focused) term.focus();
    });

    // --- Configuración en vivo ---------------------------------------------------------------
    // El addon trae un lector de fuentes (~300 KB): se carga solo si se activan las ligaduras.
    let ligatures: LigaturesAddon | null = null;
    let wantLigatures = false;
    const setLigatures = (on: boolean) => {
      wantLigatures = on;
      if (on && !ligatures) {
        void import("@xterm/addon-ligatures")
          .then(({ LigaturesAddon }) => {
            if (disposed || !wantLigatures || ligatures) return;
            ligatures = new LigaturesAddon();
            term.loadAddon(ligatures);
          })
          .catch((err) => console.warn("No se pudieron activar las ligaduras", err));
      } else if (!on && ligatures) {
        ligatures.dispose();
        ligatures = null;
      }
    };
    setLigatures(look0.ligatures);
    let lastLook = JSON.stringify(look0);
    createEffect(
      on(
        () => props.look,
        (look) => {
          const key = JSON.stringify(look);
          if (key === lastLook) return; // cambió otra parte de la configuración
          const before = JSON.parse(lastLook) as TermLook;
          lastLook = key;
          term.options.fontFamily = look.fontFamily;
          term.options.fontSize = look.fontSize;
          term.options.lineHeight = look.lineHeight;
          term.options.letterSpacing = look.letterSpacing;
          term.options.fontWeight = look.fontWeight;
          term.options.cursorStyle = look.cursorStyle;
          term.options.cursorBlink = look.cursorBlink;
          term.options.scrollback = look.scrollback;
          term.options.theme = look.theme;
          if (before.transparent !== look.transparent) {
            term.options.allowTransparency = look.transparent;
            // WebGL arma su textura según la transparencia: se vuelve a crear.
            if (gl) {
              detachGl();
              attachGl();
            }
          }
          // El addon de ligaduras lee la fuente al activarse: si cambió la fuente, se reinicia.
          if (before.fontFamily !== look.fontFamily && ligatures) setLigatures(false);
          setLigatures(look.ligatures);
          requestAnimationFrame(() => {
            safeFit();
            term.refresh(0, term.rows - 1);
          });
        },
        { defer: true },
      ),
    );

    props.ref?.({ jumpPrompt, copyLastOutput, focus: () => term.focus() });
    void start();

    onCleanup(() => {
      disposed = true;
      clearInterval(activity);
      clearTimeout(startupTimer);
      ro.disconnect();
      cancelAnimationFrame(raf);
      host.removeEventListener("contextmenu", onContext);
      host.removeEventListener("focusin", onFocusIn);
      oscs.forEach((d) => d.dispose());
      ligatures?.dispose();
      pathLinks.dispose();
      ack?.dispose();
      void session?.kill();
      detachGl();
      term.dispose();
    });
  });

  return <div class="term-host" ref={host} />;
}
