import { createEffect, on, onCleanup, onMount } from "solid-js";
import { Terminal, type IDisposable, type IMarker } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@xterm/xterm/css/xterm.css";
import { AckBatcher } from "./ack";
import { parse133, parse633, parseOsc7, parseOsc9 } from "./integration";
import { decideKey } from "./keys";
import { PtySession } from "./pty";
import { novaDark } from "./theme";
import { cmdRunningCommand, isShellTitle } from "../layout/title";
import { matchShortcut, type Action } from "../layout/shortcuts";

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
}

/** Acciones que la vista sabe hacer sobre su terminal (las pide el contenedor). */
export interface TermHandle {
  jumpPrompt(delta: 1 | -1): void;
  copyLastOutput(): Promise<boolean>;
  focus(): void;
}

interface Props {
  profileId: string;
  cwd?: string;
  windowsBuild: number;
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
    const term = new Terminal({
      allowProposedApi: true,
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 14,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 10_000,
      theme: novaDark,
      windowsPty: { backend: "conpty", buildNumber: props.windowsBuild },
      overviewRuler: { width: 8 },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_e, uri) => void openUrl(uri)));
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.open(host);

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
        if (cwd) patch({ cwd });
        return true;
      }),
      term.parser.registerOscHandler(9, (data) => {
        const cwd = parseOsc9(data);
        if (!cwd) return false;
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
          cols: term.cols,
          rows: term.rows,
          // El ack va cuando xterm terminó de procesar el trozo: eso es lo que frena al backend.
          onData: (bytes) => {
            if (!disposed) term.write(bytes, () => batch.add(bytes.byteLength));
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
      ack = batch;
      patch({ sessionId: current_session.id, pid: current_session.info.pid, exited: false });
    };

    term.onData((data) => {
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
      const action = matchShortcut(e);
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
    const onFocusIn = () => props.onFocus();
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

    props.ref?.({ jumpPrompt, copyLastOutput, focus: () => term.focus() });
    void start();

    onCleanup(() => {
      disposed = true;
      ro.disconnect();
      cancelAnimationFrame(raf);
      host.removeEventListener("contextmenu", onContext);
      host.removeEventListener("focusin", onFocusIn);
      oscs.forEach((d) => d.dispose());
      ack?.dispose();
      void session?.kill();
      detachGl();
      term.dispose();
    });
  });

  return <div class="term-host" ref={host} />;
}
