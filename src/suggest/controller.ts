/**
 * Engancha las predicciones a una terminal: sabe si la pestaña está en el prompt, lee la línea,
 * arma el menú, toma las teclas que le tocan, inserta la sugerencia elegida y, en PowerShell, le
 * pide completados a la propia sesión con el atajo escondido (ver `pwsh.ts`).
 *
 * `TerminalView` le avisa: fin del prompt (133;B), inicio de comando (133;C), cada escritura que va
 * a la shell (`onWrite`, antes de mandarla) y cada vez que xterm terminó de procesar salida.
 */
import { createSignal, type Accessor } from "solid-js";
import { analyze, collect, type Analysis, type Sources, type Suggestion } from "./engine";
import { insertion } from "./insert";
import { menuKey } from "./keys";
import { parseLine, readInput, type BufLine } from "./line";
import { parse7717, PS_CHORD, type PsMsg } from "./pwsh";
import { liveSources } from "./generators";
import type { Shell } from "./types";
import type { SuggestSettings } from "../settings/schema";

export interface TermLike {
  cols: number;
  buffer: { active: { type: string; baseY: number; cursorY: number; cursorX: number; getLine(i: number): BufLine | undefined } };
  registerMarker(offset?: number): { line: number; dispose(): void } | undefined;
}

export interface MenuView {
  items: Suggestion[];
  selected: number;
  navigating: boolean;
  /** Fila del cursor dentro de la pantalla. */
  row: number;
  /** Columna donde empieza la palabra que se completa. */
  col: number;
}

export interface SuggestOptions {
  term: TermLike;
  profileId: string;
  /** Escribe directo a la shell (sin pasar por `onWrite`). */
  write(s: string): void;
  cwd(): string | undefined;
  settings(): SuggestSettings;
  /** cmd no avisa qué comando corre: se lo pasa la vista al Enter. */
  patchCmdCommand(line: string): void;
  sources?: Sources;
  now?: () => number;
}

export interface SuggestCtl {
  readonly nonce: string;
  menu: Accessor<MenuView | null>;
  onPromptEnd(): void;
  onCommandStart(): void;
  onParsed(): void;
  onWrite(data: string): void;
  /** true si la tecla la tomó el menú (no tiene que llegarle a xterm). */
  key(e: KeyboardEvent): boolean;
  onOsc7717(data: string): boolean;
  pick(i: number): void;
  close(): void;
  dispose(): void;
}

export const SUGGEST_PROFILES = ["cmd", "powershell", "pwsh"];
const PS_IDLE_MS = 150;
const PS_SLOW_MS = 300;
const ECHO_WAIT_MS = 300;

function makeNonce(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function createSuggest(o: SuggestOptions): SuggestCtl {
  const shell: Shell = o.profileId === "cmd" ? "cmd" : "ps";
  const supported = SUGGEST_PROFILES.includes(o.profileId);
  const now = o.now ?? Date.now;
  const nonce = makeNonce();
  const sources = o.sources ?? liveSources(() => o.cwd() ?? "");
  const [menu, setMenu] = createSignal<MenuView | null>(null);

  let start: { marker: { line: number; dispose(): void }; x: number } | null = null;
  let atPrompt = false;
  let echoPending = false;
  /** Después de ↑/↓, Tab de la shell, Esc o de insertar: no se abre solo hasta que se tipee. */
  let suppressAuto = false;
  /** Pedido a mano (Ctrl+Espacio) o carpeta recién insertada: se muestra aunque no toque solo. */
  let wantOpen = false;
  let navigating = false;
  let swallowPress = false;
  let dirty = false;
  /** La última tecla deja a PSReadLine esperando otra (Tab, Ctrl+R…): no mandarle el atajo. */
  let chainKey = false;
  let psReady = false;
  let demoted = false;
  let forcePs = false;
  let psTimer: ReturnType<typeof setTimeout> | undefined;
  let psSentAt: number | null = null;
  let lastPs: PsMsg | undefined;
  let pending: { item: Suggestion; timer: ReturnType<typeof setTimeout> } | null = null;
  let seq = 0;
  let disposed = false;

  const enabled = () => supported && o.settings().enabled;

  const close = () => {
    seq++;
    navigating = false;
    wantOpen = false;
    setMenu(null);
  };

  /** Lo escrito desde el fin del prompt hasta el cursor, si el cursor está al final. */
  function currentLine(): string | null {
    if (!start) return null;
    const b = o.term.buffer.active;
    if (b.type === "alternate") return null;
    const cur = { line: b.baseY + b.cursorY, x: b.cursorX };
    const line = readInput(b, { line: start.marker.line, x: start.x }, cur, o.term.cols);
    if (line === null) return null;
    const row = b.getLine(cur.line);
    if (row && row.translateToString(true, cur.x).trim()) return null;
    const next = b.getLine(cur.line + 1);
    if (next?.isWrapped && next.translateToString(true).trim()) return null;
    return line;
  }

  function schedulePs(a: Analysis, line: string) {
    clearTimeout(psTimer);
    if (shell !== "ps" || !psReady || !o.settings().pwsh || chainKey || !line.trim()) return;
    if (!forcePs && (!a.askPwsh || demoted)) return;
    if (lastPs?.type === "completions" && lastPs.buffer === line) return;
    psTimer = setTimeout(() => {
      if (disposed || !atPrompt || echoPending || chainKey || currentLine() !== line) return;
      forcePs = false;
      psSentAt = now();
      o.write(PS_CHORD);
    }, PS_IDLE_MS);
  }

  async function recompute() {
    dirty = false;
    if (disposed) return;
    if (!enabled() || !atPrompt) return close();
    const line = currentLine();
    if (line === null) return close();
    const p = parseLine(line, shell);
    const a = analyze(p, shell);
    const open = !!menu() || wantOpen;
    const autoOk = o.settings().mode === "auto" && a.auto && !suppressAuto;
    if (!open && !autoOk) {
      clearTimeout(psTimer);
      return;
    }
    schedulePs(a, line);
    const my = ++seq;
    const ps = lastPs?.type === "completions" && lastPs.buffer === line ? lastPs : undefined;
    const items = await collect(a, { line, cwd: o.cwd() ?? "", shell }, sources, ps).catch(() => [] as Suggestion[]);
    if (my !== seq || disposed || !atPrompt) return;
    if (items.length === 0) {
      navigating = false;
      setMenu(null);
      return;
    }
    const prev = menu();
    const kept = prev && navigating ? items.findIndex((i) => i.insert === prev.items[prev.selected]?.insert) : -1;
    if (kept < 0) navigating = false;
    const b = o.term.buffer.active;
    setMenu({ items, selected: Math.max(0, kept), navigating, row: b.cursorY, col: Math.max(0, b.cursorX - p.current.raw.length) });
  }

  function doAccept(item: Suggestion) {
    const line = currentLine();
    if (line === null) return close();
    const cur = parseLine(line, shell).current;
    o.write(insertion(line, item, cur, shell));
    echoPending = true;
    lastPs = undefined;
    const reopen = item.dir && !/['"]$/.test(item.insert);
    close();
    if (reopen) wantOpen = true;
    else suppressAuto = true;
  }

  function accept(item: Suggestion | undefined) {
    if (!item) return;
    if (!echoPending) return doAccept(item);
    // Hay teclas que la shell todavía no mostró: se inserta cuando llegue el eco.
    if (pending) clearTimeout(pending.timer);
    pending = {
      item,
      timer: setTimeout(() => {
        const p = pending;
        pending = null;
        if (p) doAccept(p.item);
      }, ECHO_WAIT_MS),
    };
  }

  return {
    nonce,
    menu,
    onPromptEnd() {
      start?.marker.dispose();
      const b = o.term.buffer.active;
      const marker = o.term.registerMarker(0);
      start = marker ? { marker, x: b.cursorX } : null;
      atPrompt = supported;
      suppressAuto = false;
      chainKey = false;
      lastPs = undefined;
      close();
    },
    onCommandStart() {
      atPrompt = false;
      clearTimeout(psTimer);
      close();
    },
    onWrite(data) {
      if (/[\r\n]/.test(data)) {
        if (atPrompt && shell === "cmd") {
          const l = currentLine()?.trim();
          if (l) o.patchCmdCommand(l);
        }
        atPrompt = false;
        clearTimeout(psTimer);
        close();
        return;
      }
      if (!atPrompt) return;
      echoPending = true;
      dirty = true;
      chainKey = data === "\t" || data === "\x12" || data === "\x13" || data.startsWith("\x1b");
      const typed = data === "\x7f" || data === "\b" || !/[\x00-\x1f]/.test(data);
      if (typed) suppressAuto = false;
      else {
        suppressAuto = true;
        if (!wantOpen) close();
      }
    },
    onParsed() {
      echoPending = false;
      if (pending) {
        const p = pending;
        pending = null;
        clearTimeout(p.timer);
        doAccept(p.item);
        return;
      }
      if (!atPrompt) return;
      if (dirty || wantOpen || menu()) void recompute();
    },
    key(e) {
      if (e.type === "keypress") {
        const s = swallowPress;
        swallowPress = false;
        return s;
      }
      if (e.type !== "keydown") return false;
      swallowPress = false;
      const m = menu();
      const r = menuKey(e, { open: !!m, navigating, enabled: enabled() && atPrompt });
      switch (r) {
        case "pass":
          return false;
        case "toShell":
          close();
          return false;
        case "close":
          close();
          suppressAuto = true;
          break;
        case "down":
          if (m) {
            const selected = navigating ? Math.min(m.items.length - 1, m.selected + 1) : m.selected;
            navigating = true;
            setMenu({ ...m, selected, navigating });
          }
          break;
        case "up":
          if (m) {
            if (m.selected === 0) navigating = false;
            setMenu({ ...m, selected: Math.max(0, m.selected - 1), navigating });
          }
          break;
        case "accept":
          if (m) accept(m.items[m.selected]);
          break;
        case "open":
          wantOpen = true;
          forcePs = true;
          suppressAuto = false;
          chainKey = false;
          void recompute();
          break;
      }
      swallowPress = true;
      return true;
    },
    onOsc7717(data) {
      const m = parse7717(data, nonce);
      if (!m) return true;
      if (m.type === "ready") {
        psReady = true;
        return true;
      }
      if (psSentAt !== null) {
        if (now() - psSentAt > PS_SLOW_MS) demoted = true;
        psSentAt = null;
      }
      lastPs = m;
      if (atPrompt) void recompute();
      return true;
    },
    pick(i) {
      const m = menu();
      if (m) accept(m.items[i]);
    },
    close,
    dispose() {
      disposed = true;
      clearTimeout(psTimer);
      if (pending) clearTimeout(pending.timer);
      start?.marker.dispose();
    },
  };
}
