# AlphaTerm (formerly NovaTerm) — context for Claude Code

> Translated from the Spanish original (`CLAUDE.md`). The Spanish version is the source of truth.

A Warp-style terminal of our own, lighter, built for working with AI agents.
The plan is in `Documentacion\en\Terminal_Plan.txt` (with addenda at the end: home environment and AlphaTerm);
the code guide is in `Documentacion\en\Code_Guide.txt` (and its PDF); the log of each phase is in
`Documentacion\en\Process_Report.md`.

## Status
- F0 through F9 are done, plus the requested extras (control API for agents + MCP, Docker, Guardian,
  tiled panes, History, session, paths with preview, folders and color for tabs…).
- Renamed to AlphaTerm: binary `alphaterm.exe`, identifier `uy.alphaterm.app`, data in
  `%APPDATA%\AlphaTerm` (NovaTerm's data is copied the first time). The project folder is
  `Desktop\AlphaTerm` (renamed on 18/11/2026; previously `Desktop\NovaTerm`).
- Built-in browser with marking (20/11/2026): browser pane (a leaf with `browser` in the model)
  with an edit mode to mark elements and ask the tab's agent for changes. See Gotchas.
- Pending: decide whether, besides the per-version install (`compilar-version.bat`), an NSIS installer
  is needed; test Docker with a real container and Claude Code with a real task going through
  the Guardian; the RAM (<120 MB) and startup (<500 ms) goals are not met (~225 MB and 1.2–1.4 s,
  dominated by WebView2).

## Run and test
- Development: `npx tauri dev`. Release: `npx tauri build --no-bundle` → `src-tauri\target\release\alphaterm.exe`.
- New version: double-click `compilar-version.bat` (or `npm run release`, which is `scripts/release.mjs`).
  It bumps the version by itself (patch by default; `--minor`, `--major`, or `--misma` to rebuild without bumping)
  in `package.json`, `tauri.conf.json`, `Cargo.toml` and `Cargo.lock`, makes the commit "Versión X" and the
  annotated tag `vX`, builds (into `target\prueba` if `target\release\alphaterm.exe` is open) and installs with
  `scripts/instalar.mjs` into `%LOCALAPPDATA%\AlphaTerm\versiones\<v>` (a shortcut "AlphaTerm <v>" on the
  desktop, renames the previous one, and the taskbar pin). If it fails, it undoes the commit and the
  tag. It can run with AlphaTerm open. `npm run instalar -- --desde <folder>` installs an already-built build.
  The .bat files, with CRLF. The footer shows the version (tooltip: commit, "+" if there were uncommitted changes,
  date and path of the exe) and the "What's new" button (changelog per version).
- Changelog: `scripts/changelog.mjs` generates it from git (tags `vX.Y.Z`) into `src/generated/changelog.json`
  (ignored by git); `npm run dev`, `build` and `typecheck` run it. Pure logic in
  `scripts/changelog-lib.mjs` (tests in `scripts/changelog.test.mjs`). Commits from before the tags
  end up in the oldest version (0.1.0 = everything up to 18/11/2026).
- Tests: `cargo test` in `src-tauri` (prepend `~/.cargo/bin` to the PATH), `npx vitest run`, `npx tsc --noEmit`.
- Inspect the WebView: `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`
  before opening the app and talk to it over CDP (Runtime.evaluate, Input.dispatchMouseEvent). If there is already
  an AlphaTerm open without that flag, WebView2 won't start (they share the data folder).
- Control API: `node %APPDATA%\AlphaTerm\alphaterm-mcp.mjs list` (or `call <method> '<json>'`).
- Measure startup: `ALPHATERM_BENCH=<file>` records the ms until the first prompt.

## Gotchas
- Terminal panes: they are iterated by id and positioned by rectangles (nesting them re-mounts the
  terminals and kills the shell). The same goes for the side panels of the tiled layout: iterate ids, not objects.
  Each one has the 22 px pane bar (`PaneBar`) on top and the terminal goes in `.pane-body`. Moving a
  pane (`movePane`) just changes the tree: the leaf is the same and the terminal is not recreated.
  Dragging uses the body's `resizing` class (hides the browser and removes the pointer from the
  panes) plus `pane-dragging`; Esc is handled in capture so it doesn't reach the terminal.
- `window.confirm` does NOT ask: Tauri's dialog plugin replaces it with an async function
  (it returns a promise, which is always "yes") and the `dialog:allow-confirm` permission is missing. Use
  `askConfirm` (`src/widgets/confirm.ts`), which asks inside the app (`ConfirmModal`, mounted
  in Workspace and in the settings window). The test `scripts/sin-confirm.test.mjs` fails if
  a stray `confirm(` shows up again in `src`.
- With `npx tauri dev`/Vite, hot reload of `Workspace.tsx` leaves the old instance alive
  (it keeps answering the control API and can overwrite the session): reload the page before testing.
- PTY writes go through `WriteQueue` (otherwise keys get reversed). Never Ctrl+Alt shortcuts (AltGr).
- Solid: inside a `createEffect`, a function that reads and changes a signal triggers it again in a
  loop (it happened in the footer: 180 MB). Use `untrack` or `on`. And in a `<Show>` with a callback, don't read `m()`
  after closing (that's why the menu applies the action before closing).
- Enter to the shell: `String.fromCharCode(13)`, never a literal line break in a template.
- Patch scripts: write them with Write to a .py; bash heredocs eat `\\` and `\n`.
- Settings opens inside the same window (`settingsOpen` in `src/settings/store.ts`,
  `.settings-overlay` on top of `.workspace`); with it open, shortcuts don't touch the tabs.
  The separate "settings" window (`settings_open`) is now unused.
- The settings schema lives in `src/settings/schema.ts`; the backend stores opaque JSON.
- Transparent windows: the body paints the background; xterm has a transparent viewport via CSS.
- Codex stores sessions as `.jsonl.zst`. agy: never from Git Bash (MSYS converts `/quota`).
- agy always with `AGY_CLI_DISABLE_AUTO_UPDATE=true` (exactly "true"): otherwise every query may
  launch its updater outside the hidden console and a cmd window flashes for an instant.
- Live usage (`usage_live.rs`, like the System dashboard): claude `/usage` and codex `/status` are
  read by opening them in a windowless ConPTY + `vt100`. Don't answer `ESC[6n`: with ConPTY's input
  mode the reply reaches the program as typed text. Claude runs with `--strict-mcp-config`
  and `disableAllHooks`. `ALPHATERM_PROBE_DUMP=<folder>` saves the screens that were read.
- Claude: between live queries, usage comes from the statusline (no credentials are read).
- Rust tests: the Windows manifest (common controls v6) is embedded by the linker
  (`build.rs` + `windows-app-manifest.xml`), not tauri-build: without it the test binary doesn't start
  (STATUS_ENTRYPOINT_NOT_FOUND, TaskDialogIndirect).
- Changes panel (`changes.rs`): Claude's Pre/PostToolUse hook + a copy and watcher of the
  folder of each tab with an agent. In Solid, the cards are iterated by id (otherwise a new
  list re-mounts everything and whatever is being edited is lost).
- Pasting images (`clip.rs`): with no text on the clipboard, the image is saved as a PNG in
  `%TEMP%\AlphaTerm\pegadas` and its path is pasted (Claude Code and Codex attach it).
- Testing a new version with another AlphaTerm open: build with `CARGO_TARGET_DIR=target\prueba`
  (cargo takes it relative to `src-tauri`, so it ends up in `src-tauri\target\prueba`; or an absolute
  path) and open it with its own `ALPHATERM_DATA_DIR` and `WEBVIEW2_USER_DATA_FOLDER` (it doesn't touch the
  open one's session or settings).
- `alphaterm-mcp.mjs` reads `%APPDATA%\AlphaTerm\control.json` even if `ALPHATERM_DATA_DIR` is set: to
  talk to a test AlphaTerm, pass it `ALPHATERM_CONTROL_URL` and `ALPHATERM_CONTROL_TOKEN` from the
  `control.json` in its data folder (otherwise you talk to Bruno's).
- Agent launch options: catalog in `src/panels/agentLaunch.ts` (surveyed from the `--help` output;
  review it whenever an agent is updated). Live model lists: `agent_models` in `agents.rs`.
- computer use: the desktop sometimes ends up in front and blocks clicks; use CDP for the interface.
- Shells don't inherit the environment of whoever opened AlphaTerm (`src-tauri/src/pty/env.rs`): Claude Code
  sets NO_COLOR=1 and dozens of CLAUDE_CODE_* (with tokens) for its tools. They are honored if they are
  in the persistent Windows environment.
- `build.rs`: paths with `std::env::var("CARGO_MANIFEST_DIR")`, not `env!()` (it gets fixed when the
  build script is compiled and breaks when the folder is moved).

- Built-in browser (`src-tauri/src/browser.rs`, `src/browser/`): a child WebView2
  (`Window::add_child`, tauri's `unstable` feature) placed on top of its pane's `.bp-view`; the
  frontend sends it the rectangle every 150 ms and hides it if any floating part of the interface
  overlaps it (`FLOATING` in `src/browser/marks.ts`: add the classes of new menus/modals there,
  because nothing in the interface can cover the WebView2). It is driven over CDP with
  `CallDevToolsProtocolMethod` (it blocks: never from the main thread; neither is `add_child`).
  The marking layer is `scripts/browser-overlay.js` (initialization_script) and it talks to the backend
  through `Runtime.addBinding("__alphaterm")`. The request is pasted into the owner's terminal with
  `term.paste` (bracketed paste) and Enter goes separately 350 ms later. "Done": Claude
  Code's Stop hook (`claude-stop.json` or inside `claude-guardian.json` → `agent_stop`); the other agents,
  by the terminal going silent after having worked. With `--remote-debugging-port`, the
  child browser shows up as another target in `/json` (useful for testing).

## Decisions already made (don't re-discuss without a reason)
- Tauri 2 + Rust; Vite + TypeScript + SolidJS 1.9; xterm.js 6 with WebGL (DOM fallback).
- Tab name: manual > the program's OSC title > model summary (optional) > heuristic.
- PTY output batched through a binary `tauri::ipc::Channel` with backpressure.
- Git through the CLI. Docker through the CLI. No shell in the middle for commands the app builds.

## Environment
- Home (`C:\Users\Br1`): Rust 1.99.1 outside the PATH, Node 22, PowerShell 5.1 (no pwsh), Docker
  Desktop installed, Ollama with no models.
- Work PC: SSL inspection, PowerShell blocks `.ps1`, no Rust when the plan was put together.

## Way of working
- Each phase closes verified and logged in the Report; anything unverified is marked as such.
- Bruno prefers answers in Spanish, direct, in paragraphs and with honest pushback.
