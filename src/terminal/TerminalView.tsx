import { createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js";
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
import { cmdRunningCommand, isShellTitle, preferTyped } from "../layout/title";
import type { Action } from "../layout/shortcuts";
import type { TermLook } from "../settings/apply";
import type { Startup } from "../layout/model";
import { registerPathLinks } from "./pathLinks";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { createSuggest, type SuggestCtl } from "../suggest/controller";
import { SuggestMenu, type Geom } from "../suggest/SuggestMenu";
import type { SuggestSettings } from "../settings/schema";
import { t } from "../i18n";

const windowLabel = getCurrentWindow().label;

export type Renderer = "webgl" | "dom";

/** What the terminal reports to the container (applied as a patch). */
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
  /** There was output in the last few seconds (to tell whether an agent is working or waiting). */
  active?: boolean;
  /** The bell (BEL) rang and nobody has typed since. */
  bell?: boolean;
  /** How many commands finished in this pane (to wait for one). */
  ended?: number;
}

const QUIET_MS = 2500;

/** Actions the view can perform on its terminal (requested by the container). */
export interface TermHandle {
  jumpPrompt(delta: 1 | -1): void;
  copyLastOutput(): Promise<boolean>;
  focus(): void;
  /** Writes text to the shell as if typed (with Enter at the end if `enter`). */
  send(text: string, enter: boolean): boolean;
  /** Pastes text like a real paste (with bracketed paste if the program asked for it). */
  paste(text: string): boolean;
  /** Last `n` lines of the buffer (what is visible and the history), as text. */
  text(n: number): string;
  /** Output of the last finished command (with integration), or null. */
  lastOutput(): { command?: string; output: string; exitCode?: number | null } | null;
}

interface Props {
  /** Pane id (goes in ALPHATERM_PANE for the control API). */
  paneId: string;
  profileId: string;
  cwd?: string;
  /** Command to run when the shell is ready (agents). */
  startup?: Startup;
  /** Extra variables for the shell (e.g. the full PATH for agents). */
  env?: Record<string, string>;
  windowsBuild: number;
  look: TermLook;
  /** Command suggestions (cmd, PowerShell and the Linux shells). */
  suggest: SuggestSettings;
  /** App shortcut for this key (or null if it goes to the shell). */
  match: (e: KeyboardEvent) => Action | null;
  visible: boolean;
  focused: boolean;
  onFocus: () => void;
  onPatch: (p: TermPatch) => void;
  /** The shell ended. Returns true if the container closes the pane. */
  onExit: (code: number | null) => boolean;
  onAction: (a: Action) => void;
  ref?: (h: TermHandle) => void;
}

interface Block {
  command?: string;
  prompt: IMarker;
  output?: IMarker;
  end?: IMarker;
  exitCode?: number | null;
}

export function TerminalView(props: Props) {
  let host!: HTMLDivElement;
  // xterm opens here, inside the host and without padding: FitAddon measures the height and width of the
  // terminal's parent with its padding included, so on `.term-host` it gave one row (or column) too many
  // depending on the size, and the last one was cut off.
  let fitBox!: HTMLDivElement;
  // Buttons to jump to the start or the end when the output is long.
  const [canTop, setCanTop] = createSignal(false);
  const [canBottom, setCanBottom] = createSignal(false);
  let scrollTo: ((where: "top" | "bottom") => void) | undefined;
  // Suggestion menu: the controller is born with the terminal (onMount).
  const [suggestCtl, setSuggestCtl] = createSignal<SuggestCtl | null>(null);
  let measure: (() => Geom) | undefined;
  let focusTerm: (() => void) | undefined;

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
      // Only with ConPTY (Windows): on Linux the PTY is the real thing and xterm.js mustn't compensate.
      ...(props.windowsBuild > 0 ? { windowsPty: { backend: "conpty" as const, buildNumber: props.windowsBuild } } : {}),
      overviewRuler: { width: 8 },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_e, uri) => void openUrl(uri)));
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.open(fitBox);
    // Paths in the output: links that open the folder or the file, with a preview on mouse hover.
    let cwdNow = props.cwd;
    const pathLinks = registerPathLinks(term, () => cwdNow);

    // Command suggestions: everything going to the shell passes through `toShell` (so the controller sees every Enter).
    /** Last line typed in cmd (cmd's title carries the same command with an extra space). */
    let typedCmd: string | undefined;
    const suggest = createSuggest({
      term,
      profileId: props.profileId,
      write: (s) => session?.write(s),
      cwd: () => cwdNow,
      settings: () => props.suggest,
      // cmd doesn't report which command is running: the line is taken on Enter (the next prompt's 133;D closes it).
      patchCmdCommand: (line) => {
        typedCmd = line;
        running = true;
        patch({ lastCommand: line, running: true });
      },
    });
    setSuggestCtl(suggest);
    // Development only: to test through CDP (xterm with WebGL doesn't leave the text in the DOM).
    if (import.meta.env.DEV) {
      const w = window as unknown as { __alphaterm?: Record<string, unknown> };
      (w.__alphaterm ??= {})[props.paneId] = { term, suggest };
    }
    const toShell = (s: PtySession, data: string) => {
      suggest.onWrite(data);
      s.write(data);
    };
    measure = () => {
      const pane = host.parentElement ?? host;
      const pr = pane.getBoundingClientRect();
      const sr = (host.querySelector(".xterm-screen") ?? host).getBoundingClientRect();
      return { x: sr.left - pr.left, y: sr.top - pr.top, cw: sr.width / term.cols, ch: sr.height / term.rows, w: pr.width, h: pr.height };
    };
    focusTerm = () => term.focus();

    let disposed = false;
    const patch = (p: TermPatch) => {
      if (!disposed) props.onPatch(p);
    };

    // WebGL only while the pane is visible: browsers limit WebGL contexts (~16),
    // and a hidden tab doesn't need to paint (xterm still keeps loading its buffer).
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
    let endedCount = 0;
    let firstPromptMarked = false;
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
        el.title = ok ? t("Terminó bien") : t("Código de salida {code}", { code: String(b.exitCode) });
      });
    };

    oscs.push(
      term.parser.registerOscHandler(133, (data) => {
        const m = parse133(data);
        if (!m) return false;
        if (m.type === "promptStart") {
          // The first prompt with OSC 133 already proves the shell has integration.
          if (!integrated) {
            integrated = true;
            patch({ integrated: true });
          }
          runStartup();
          if (!firstPromptMarked) {
            firstPromptMarked = true;
            void invoke("bench_mark", { name: "first_prompt" }).catch(() => {});
          }
          current = { prompt: term.registerMarker(0) };
          blocks.push(current);
          if (blocks.length > 2000) blocks.splice(0, blocks.length - 2000).forEach((b) => b.prompt.dispose());
        } else if (m.type === "promptEnd") {
          suggest.onPromptEnd();
        } else if (m.type === "commandStart") {
          suggest.onCommandStart();
          integrated = true;
          running = true;
          if (current) current.output = term.registerMarker(0);
          patch({ integrated, running: true });
        } else if (m.type === "commandEnd" && running) {
          running = false;
          endedCount++;
          if (current) {
            current.end = term.registerMarker(0);
            current.exitCode = m.exitCode;
            markExit(current);
          }
          patch({ running: false, exitCode: m.exitCode, agentTitle: undefined, ended: endedCount });
        }
        return true;
      }),
      term.parser.registerOscHandler(633, (data) => {
        const m = parse633(data);
        if (!m) return false;
        integrated = true;
        if (current) current.command = m.command;
        patch({ integrated: true, lastCommand: m.command });
        return true;
      }),
      term.parser.registerOscHandler(7717, (data) => suggest.onOsc7717(data)),
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

    // OSC title: counts as a summary if a program set it (not the shell prompt).
    term.onTitleChange((title) => {
      const cmdLine = cmdRunningCommand(title);
      if (cmdLine) {
        patch({ lastCommand: preferTyped(typedCmd, cmdLine) });
        return;
      }
      if (isShellTitle(title)) return;
      if (integrated && !running) return;
      patch({ agentTitle: title });
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

    // --- Initial command (agents) ------------------------------------------------------------
    // It is written to the shell when the first prompt appears (integration) or, if the shell has no
    // integration, after 2.5 s. This way the agent runs inside the shell: on exit, it stays there.
    let startupPending = !!props.startup?.command;
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    const runStartup = () => {
      if (!startupPending || !session) return;
      startupPending = false;
      clearTimeout(startupTimer);
      const s = session;
      const ENTER = String.fromCharCode(13); // what the Enter key sends
      setTimeout(() => toShell(s, props.startup!.command + ENTER), 60);
    };

    // --- Activity and bell --------------------------------------------------------------------
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

    // --- Session --------------------------------------------------------------------------
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
          env: { ...props.env, ...props.startup?.env, ALPHATERM_PANE: props.paneId, ALPHATERM_WINDOW: windowLabel, ALPHATERM_NONCE: suggest.nonce },
          cols: term.cols,
          rows: term.rows,
          // The ack goes when xterm finishes processing the chunk: that is what throttles the backend.
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
            term.write(`\r\n\x1b[2m[${t("proceso terminado, código {code}. Enter para reiniciar", { code })}]\x1b[0m\r\n`);
          },
        });
      } catch (err) {
        term.write(`\x1b[31m${t("No se pudo iniciar la shell: {error}", { error: String(err) })}\x1b[0m\r\n`);
        return;
      }
      if (disposed) {
        void current_session.kill();
        return;
      }
      session = current_session;
      // If the pane was resized while the session was starting, that resize was lost: it is sent now.
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
      if (session) toShell(session, data);
      else if (exited && data === "\r") void start();
    });
    term.onResize(({ cols, rows }) => void session?.resize(cols, rows));

    // Jumps: shown if there are more than 3 screens of output and we aren't already at that end.
    let jumpRaf = 0;
    const updateJumps = () => {
      cancelAnimationFrame(jumpRaf);
      jumpRaf = requestAnimationFrame(() => {
        const buf = term.buffer.active;
        const long = buf.length > term.rows * 3;
        setCanTop(long && buf.viewportY > 0);
        setCanBottom(long && buf.viewportY < buf.baseY);
      });
    };
    term.onScroll(updateJumps);
    term.onWriteParsed(updateJumps);
    term.onWriteParsed(() => suggest.onParsed());
    scrollTo = (where) => {
      if (where === "top") term.scrollToTop();
      else term.scrollToBottom();
      term.focus();
      updateJumps();
    };

    const copy = () => {
      const sel = term.getSelection();
      if (sel) void writeText(sel);
      term.clearSelection();
    };
    // Text, or an image: saved as PNG and its path is pasted (Claude Code and Codex attach it).
    const paste = async () => {
      const text = await readText().catch(() => "");
      if (text) return term.paste(text);
      const img = await invoke<string | null>("clipboard_image_to_file").catch(() => null);
      if (img) term.paste(/\s/.test(img) ? `"${img}"` : img);
    };
    term.attachCustomKeyEventHandler((e) => {
      // The suggestion menu goes first: it only takes keys with the menu open (or Ctrl+Space).
      if (suggest.key(e)) {
        e.preventDefault();
        return false;
      }
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
    const onFocusOut = (e: FocusEvent) => {
      if (!host.contains(e.relatedTarget as Node | null)) suggest.close();
    };
    host.addEventListener("focusout", onFocusOut);

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
            suggest.close();
            detachGl();
          }
        },
      ),
    );
    createEffect(() => {
      if (props.visible && props.focused) term.focus();
    });

    // --- Live settings -----------------------------------------------------------------------
    // The addon brings a font reader (~300 KB): it is loaded only if ligatures are enabled.
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
          if (key === lastLook) return; // another part of the settings changed
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
            // WebGL builds its texture according to transparency: it is recreated.
            if (gl) {
              detachGl();
              attachGl();
            }
          }
          // The ligatures addon reads the font when activated: if the font changed, it is restarted.
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

    const bufferText = (from: number, to: number) => {
      const buf = term.buffer.active;
      let out = "";
      for (let i = Math.max(0, from); i < Math.min(to, buf.length); i++) {
        const line = buf.getLine(i);
        if (!line) continue;
        const next = buf.getLine(i + 1);
        out += line.translateToString(true) + (next?.isWrapped ? "" : "\n");
      }
      return out;
    };
    props.ref?.({
      jumpPrompt,
      copyLastOutput,
      focus: () => term.focus(),
      send: (text, enter) => {
        if (!session) return false;
        toShell(session, enter ? text + String.fromCharCode(13) : text);
        return true;
      },
      paste: (text) => {
        if (!session) return false;
        term.paste(text);
        return true;
      },
      text: (n) => {
        // Up to the cursor line: below it there are only empty screen rows.
        const buf = term.buffer.active;
        const end = buf.baseY + buf.cursorY + 1;
        return bufferText(end - Math.max(1, Math.min(n, 5000)), end).replace(/\n+$/, "\n");
      },
      lastOutput: () => {
        const b = [...blocks].reverse().find((x) => x.output && x.end && x.output.line >= 0 && x.end.line >= 0);
        if (!b) return null;
        return { output: bufferText(b.output!.line, b.end!.line).replace(/\n+$/, "\n"), exitCode: b.exitCode, command: b.command };
      },
    });
    void start();

    onCleanup(() => {
      disposed = true;
      clearInterval(activity);
      cancelAnimationFrame(jumpRaf);
      clearTimeout(startupTimer);
      ro.disconnect();
      cancelAnimationFrame(raf);
      host.removeEventListener("contextmenu", onContext);
      host.removeEventListener("focusin", onFocusIn);
      host.removeEventListener("focusout", onFocusOut);
      suggest.dispose();
      oscs.forEach((d) => d.dispose());
      ligatures?.dispose();
      pathLinks.dispose();
      ack?.dispose();
      void session?.kill();
      detachGl();
      term.dispose();
    });
  });

  return (
    <>
      <div class="term-host" ref={host}>
        <div class="term-fit" ref={fitBox} />
      </div>
      <div class="jumps">
        <Show when={canTop()}>
          <button class="jump" title={t("Ir al principio de la salida")} onMouseDown={(e) => e.preventDefault()} onClick={() => scrollTo?.("top")}>
            ⤒
          </button>
        </Show>
        <Show when={canBottom()}>
          <button class="jump" title={t("Ir al final (lo último)")} onMouseDown={(e) => e.preventDefault()} onClick={() => scrollTo?.("bottom")}>
            ⤓
          </button>
        </Show>
      </div>
      <Show when={suggestCtl()?.menu()}>
        {(m) => (
          <SuggestMenu
            view={m()}
            geom={measure!()}
            font={props.look.fontFamily}
            onPick={(i) => {
              suggestCtl()?.pick(i);
              focusTerm?.();
            }}
          />
        )}
      </Show>
    </>
  );
}
