import { onCleanup, onMount } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@xterm/xterm/css/xterm.css";
import { AckBatcher } from "./ack";
import { decideKey } from "./keys";
import { PtySession } from "./pty";
import { novaDark } from "./theme";

export type Renderer = "webgl" | "dom";

export interface TerminalStatus {
  renderer: Renderer;
  pid: number | null;
  exited: boolean;
  exitCode: number | null;
}

interface Props {
  profileId: string;
  windowsBuild: number;
  cwd?: string;
  onStatus?: (s: TerminalStatus) => void;
  onTitle?: (title: string) => void;
}

/** Usa WebGL si se puede; si el contexto se pierde o no hay WebGL, queda el renderer DOM de xterm. */
function loadRenderer(term: Terminal, onFallback: () => void): Renderer {
  try {
    const gl = new WebglAddon();
    gl.onContextLoss(() => {
      gl.dispose();
      onFallback();
    });
    term.loadAddon(gl);
    return "webgl";
  } catch (err) {
    console.warn("WebGL no disponible, se usa el renderer DOM", err);
    return "dom";
  }
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
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_e, uri) => void openUrl(uri)));
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.open(host);

    // Al desmontar, el backend todavía avisa el fin de la sesión vieja: eso no debe pisar a la nueva.
    let disposed = false;
    const status: TerminalStatus = { renderer: "dom", pid: null, exited: false, exitCode: null };
    const report = () => {
      if (!disposed) props.onStatus?.({ ...status });
    };
    status.renderer = loadRenderer(term, () => {
      status.renderer = "dom";
      report();
    });
    fit.fit();

    let session: PtySession | null = null;
    let ack: AckBatcher | null = null;

    const start = async () => {
      status.exited = false;
      status.exitCode = null;
      const batch = new AckBatcher((n) => void current?.ack(n));
      let current: PtySession | null = null;
      try {
        current = await PtySession.spawn({
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
            status.exited = true;
            status.exitCode = ev.code;
            report();
            const code = ev.code ?? "?";
            term.write(`\r\n\x1b[2m[proceso terminado, código ${code}. Enter para reiniciar]\x1b[0m\r\n`);
          },
        });
      } catch (err) {
        term.write(`\x1b[31mNo se pudo iniciar la shell: ${err}\x1b[0m\r\n`);
        return;
      }
      if (disposed) {
        void current.kill();
        return;
      }
      session = current;
      ack = batch;
      status.pid = current.info.pid;
      report();
    };

    term.onData((data) => {
      if (session) void session.write(data);
      else if (status.exited && data === "\r") void start();
    });
    term.onResize(({ cols, rows }) => void session?.resize(cols, rows));
    term.onTitleChange((t) => props.onTitle?.(t));

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
      const action = decideKey(e, term.hasSelection());
      if (action === "pass") return true;
      e.preventDefault();
      if (action === "copy") copy();
      else void paste();
      return false;
    });
    // Clic derecho: copia si hay selección, si no pega (como Windows Terminal).
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      if (term.hasSelection()) copy();
      else void paste();
    };
    host.addEventListener("contextmenu", onContext);

    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => fit.fit());
    });
    ro.observe(host);

    term.focus();
    void start();

    onCleanup(() => {
      disposed = true;
      ro.disconnect();
      cancelAnimationFrame(raf);
      host.removeEventListener("contextmenu", onContext);
      ack?.dispose();
      void session?.kill();
      term.dispose();
    });
  });

  return <div class="term-host" ref={host} />;
}
