/**
 * Hooks command suggestions up to a terminal: it knows whether the tab is at the prompt, reads the line,
 * builds the menu, takes the keys that belong to it, inserts the chosen suggestion and, in PowerShell, asks
 * the session itself for completions with the hidden shortcut (see `pwsh.ts`).
 *
 * `TerminalView` notifies it: end of prompt (133;B), start of command (133;C), every write going
 * to the shell (`onWrite`, before sending it) and every time xterm finishes processing output.
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
  /** Cursor row within the screen. */
  row: number;
  /** Column where the word being completed starts. */
  col: number;
}

export interface SuggestOptions {
  term: TermLike;
  profileId: string;
  /** Writes straight to the shell (without going through `onWrite`). */
  write(s: string): void;
  cwd(): string | undefined;
  settings(): SuggestSettings;
  /** cmd doesn't report which command is running: the view passes it on Enter. */
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
  /** true if the menu took the key (it must not reach xterm). */
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
  /**
   * Line the shell should show after what was sent to it (null: unknown). Until the
   * screen shows it, an insertion waits: otherwise the backspaces would be computed over the old line.
   * A "something arrived" mark won't do: xterm reports foreign output before the key's echo.
   */
  let expected: { line: string; at: number } | null = null;
  /** Key with unpredictable effect (arrows, the shell's Tab…): wait for the line to change. */
  let waitChange: { from: string | null; at: number } | null = null;
  /** After ↑/↓, the shell's Tab, Esc or an insertion: doesn't open by itself until something is typed. */
  let suppressAuto = false;
  /** Requested by hand (Ctrl+Space) or a folder just inserted: shown even if it wouldn't open on its own. */
  let wantOpen = false;
  let navigating = false;
  let swallowPress = false;
  /** Line the last menu was built with: recomputed when the screen's line changes. */
  let lastLine: string | null = null;
  /** The last key leaves PSReadLine waiting for another (Tab, Ctrl+R…): don't send it the shortcut. */
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

  const cancelPending = () => {
    if (pending) clearTimeout(pending.timer);
    pending = null;
  };

  const close = () => {
    cancelPending();
    seq++;
    navigating = false;
    wantOpen = false;
    setMenu(null);
  };

  /** What was written from the end of the prompt to the cursor, if the cursor is at the end. */
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

  /** Something was sent to the shell that isn't visible on screen yet. */
  function echoPending(): boolean {
    const t = now();
    // If the shell shows something other than expected (or doesn't react), don't wait forever.
    if (expected && t - expected.at > ECHO_WAIT_MS) expected = null;
    if (waitChange && t - waitChange.at > ECHO_WAIT_MS) waitChange = null;
    const line = currentLine();
    if (expected) return line !== expected.line;
    if (waitChange) return line === waitChange.from;
    return false;
  }

  function schedulePs(a: Analysis, line: string) {
    clearTimeout(psTimer);
    if (shell !== "ps" || !psReady || !o.settings().pwsh || chainKey || !line.trim()) return;
    if (!forcePs && (!a.askPwsh || demoted)) return;
    if (lastPs?.type === "completions" && lastPs.buffer === line) return;
    psTimer = setTimeout(() => {
      if (disposed || !atPrompt || echoPending() || chainKey || currentLine() !== line) return;
      forcePs = false;
      psSentAt = now();
      o.write(PS_CHORD);
    }, PS_IDLE_MS);
  }

  async function recompute() {
    if (disposed) return;
    if (!enabled() || !atPrompt) return close();
    const line = currentLine();
    lastLine = line;
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
    // An Enter was already sent (or a command started): no keys for the running program.
    if (!atPrompt) return close();
    const line = currentLine();
    if (line === null) return close();
    const cur = parseLine(line, shell).current;
    const text = insertion(line, item, cur, shell);
    o.write(text);
    const dels = text.length - text.replace(/^\x7f+/, "").length;
    expected = { line: line.slice(0, Math.max(0, line.length - dels)) + text.slice(dels), at: now() };
    waitChange = null;
    lastPs = undefined;
    const reopen = item.dir && !/['"]$/.test(item.insert);
    close();
    if (reopen) wantOpen = true;
    else suppressAuto = true;
  }

  function accept(item: Suggestion | undefined) {
    if (!item) return;
    if (!echoPending()) return doAccept(item);
    // There are keys the shell hasn't shown yet: insert when the echo arrives (or after 300 ms).
    cancelPending();
    pending = {
      item,
      timer: setTimeout(() => {
        const p = pending;
        pending = null;
        expected = null;
        waitChange = null;
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
      lastLine = null;
      expected = null;
      waitChange = null;
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
      chainKey = data === "\t" || data === "\x12" || data === "\x13" || data.startsWith("\x1b");
      const typed = data === "\x7f" || data === "\b" || !/[\x00-\x1f]/.test(data);
      if (typed && !waitChange) {
        // What the shell is going to show: what was expected so far (or the screen) plus this key.
        const base = expected?.line ?? currentLine();
        if (base !== null) {
          const line = data === "\x7f" || data === "\b" ? base.slice(0, -1) : base + data;
          expected = { line, at: now() };
        }
      } else if (!typed) {
        expected = null;
        waitChange = { from: currentLine(), at: now() };
      }
      if (typed) suppressAuto = false;
      else {
        suppressAuto = true;
        if (!wantOpen) close();
      }
    },
    onParsed() {
      const pend = echoPending();
      if (expected && !pend) expected = null;
      if (waitChange && !pend) waitChange = null;
      if (pending && !pend) {
        const p = pending;
        pending = null;
        clearTimeout(p.timer);
        doAccept(p.item);
        return;
      }
      if (!atPrompt) return;
      // "Something was typed" isn't enough: xterm can report an earlier output before the key's
      // echo, and if the notice were consumed then, the echo would no longer recompute. The line is compared.
      if (wantOpen || currentLine() !== lastLine) void recompute();
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
