# NovaTerm — Process and stats report (Playbook)

> Translated from the Spanish original (`Documentacion/Informe_Proceso_y_Stats.md`). The Spanish version is the source of truth.

A record of each phase: what was done, how it was verified, how long it took and what was left pending.
Honesty rule: anything not verified with real data from the machine is marked **NOT VERIFIED**.

## Phase summary

| Phase | Status | Date | Verification |
|---|---|---|---|
| F0 — Preparation | Done | 17/11/2026 | Toolchain tested, PDFs generated, gate approved |
| F1 — Terminal core | Done | 17/11/2026 | Tested in the app; throughput on par with Windows Terminal |
| F2 — Layout | Done | 18/11/2026 | Tested in the app: tabs, splits, multi-window, integration and titles |
| F3 — Settings and themes | Done | 18/11/2026 | Tested in the app: themes, Mica/Acrylic, fonts, ligatures, shortcuts, hand-editing the file |
| F4 — Agents | Done | 18/11/2026 | Claude Code launched from the panel, real states and detection |
| F5 — Widgets | Done | 18/11/2026 | CPU/RAM and usage with real data (agy exact, Codex and Claude with their age) |
| F6 — Servers/Ports | Done | 18/11/2026 | Server in a tab detected, recipe saved, stop and start |
| F7 — Projects | Done | 18/11/2026 | Claude/Codex projects and tree with .gitignore |
| F8 — Git | Done | 18/11/2026 | Diff, stage and commit from the panel in a test repo |
| F9 — Polish | Done | 18/11/2026 | Model summary (test server), measurements, code guide |
| Extras — AlphaTerm | Done | 18/11/2026 | Requested during implementation: API for agents, Docker, Guardian, tiled layout, session… |

---

## F0 — Preparation (17/11/2026)

**Machine:** home PC (`C:\Users\Br1`), Windows 11 Pro 10.0.26300. The plan was put together on the work PC
(`C:\Users\usuario`); the differences were left in the addendum at the end of `Plan_Terminal_NovaTerm.txt`.

### Done
- Plan exported to txt (on the work PC, 17/11) and copied to `NovaTerm\Plan_Terminal_NovaTerm.txt`.
- Addendum with the home environment and the version adjustments added to the plan.
- `Documentacion\generar_pdfs.py`: generates `Especificación.pdf` (8 pages) and `Plan.pdf` (3 pages) from
  the txt with fpdf2 2.8.7 and Windows' Segoe UI / Consolas. Regenerable: `python Documentacion\generar_pdfs.py`.
- This Report started.

### Verified environment

| Tool | Version | Note |
|---|---|---|
| rustc / cargo | 1.99.1 / 1.99.1 | `stable-x86_64-pc-windows-msvc` toolchain, in `~/.cargo/bin` outside the PATH |
| Node / npm | 22.22.2 / 11.14.1 | |
| Git | 2.56.0 | |
| Python | 3.11.3 (fpdf2 2.8.7) | 3.14.5 also installed, without fpdf2 |
| Visual Studio | 2022 and 2019 | MSVC linker: `cargo run` of a hello world links and runs |
| WebView2 | 157.0.4341.60 | |

### Network

| Destination | Result |
|---|---|
| index.crates.io | 200 in 0.17 s |
| static.crates.io | 200 in 0.23 s |
| registry.npmjs.org | 200 in 0.19 s |

No SSL inspection or proxy on this network. `~/.cargo/config.toml` wasn't needed.

### Rust dependency test
`cargo check` of a test crate with the plan's dependencies: **OK in 1 min 32 s** (cold).

| Crate | Resolved version |
|---|---|
| tauri | 2.12.6 |
| portable-pty | 0.9.0 |
| sysinfo | 0.40.4 |
| tokio | 1.54.1 |
| reqwest | 0.13.5 (`native-tls`, `json`, `system-proxy`) |
| windows | 0.62.2 (`Win32_NetworkManagement_IpHelper`, `Win32_Networking_WinSock`) |
| ignore / notify | 0.4.34 / 8.2.2 |

Stumble: reqwest 0.13 no longer has the `rustls-tls` feature; `native-tls` (schannel) is used, which also
respects the system certificates as the plan asked for the work network.

### Frontend versions (decided, installed in F1)
- SolidJS **1.9.19**, not 2.0: `vite-plugin-solid` 2.11.16 only declares `solid-js ^1.7.2`.
- xterm.js **6.0.0** with `@xterm/addon-webgl` 0.19; the canvas addon (0.7) only supports xterm 5, so
  the WebGL fallback is xterm's DOM renderer.
- Vite 8.3.8, TypeScript 7.0.2, Vitest 5.1.0, Tauri CLI/API 2.12.5.

### What changes relative to the original plan
- Rust didn't have to be installed; the Electron fallback is dropped.
- Available shells: Windows PowerShell 5.1 (default profile), cmd, Git Bash and WSL. pwsh
  (PowerShell 7) is not installed and isn't needed. The shell integration is written to be compatible with 5.1.
- Installed agents: claude, codex, opencode and **agy (Antigravity CLI 1.4.12)**, which replaced
  Gemini CLI.
- agy usage, **verified**: `agy -p /quota --output-format json` returns the remaining fraction
  of the 5 h and weekly windows per model group, with the reset time, without running a turn
  (`num_turns: 0`, `total_tokens: 0`). The Gemini provider is no longer "estimated".
- Stumble: from Git Bash, `/quota`, `/usage` and `/credits` were converted into Windows paths
  (MSYS) and agy took them as prompts. They were 6 real turns (about 50 thousand tokens) that spent quota
  of the "Claude and GPT models" group (it ended at 86 % of the 5 h window and 93 % of the weekly one).
  Lesson: run agy as a direct process or from PowerShell/cmd.

### Gate
Approved by Bruno on 17/11/2026 ("Yes, start F1").

### Stats
- Duration of F0 at home: one short session (environment verification + documents).

---

## F1 — Terminal core (17/11/2026)

### Done
- Tauri 2.12 + Vite 8 + SolidJS 1.9 + xterm.js 6 project in `NovaTerm\` (git repo started, no commits).
- Backend `src-tauri\src\pty\`:
  - `mod.rs`: ConPTY sessions (portable-pty 0.9) with three threads per session (reader, batcher, watcher).
    The watcher closes the pseudoconsole when the process ends, because without that ConPTY gives no EOF.
  - `batcher.rs`: output batching. The first chunk after a quiet spell goes out right away
    (key echo with no delay); in a burst it gathers 4 ms or 64 KB. Backpressure with a high mark of
    2 MB and a low one of 512 KB: the frontend acknowledges the bytes when xterm finished processing them.
  - `profiles.rs`: Windows PowerShell, PowerShell 7, cmd, Git Bash and WSL, with detection.
- Output through a binary `tauri::ipc::Channel` (`InvokeResponseBody::Raw`, arrives as an ArrayBuffer).
- Frontend: xterm with WebGL (DOM fallback), fit, unicode11, links that open the browser,
  copy/paste like Windows Terminal (Ctrl+C with a selection copies and without a selection interrupts;
  Ctrl+V and Ctrl+Shift+C/V; right click copies or pastes), restart with Enter when the shell ends.

### Tests
- Rust: 9 tests (batching, backpressure, profiles, real ConPTY with cmd and exit code, kill).
- Vitest: 8 tests (copy/paste shortcuts and ack batching).

### Test in the app (driven with computer use)
| Test | Result |
|---|---|
| PowerShell 5.1 prompt | OK |
| 24-bit color, bold, underline, accents, ✓ and double-width CJK | OK |
| `ping -t` + Ctrl+C | OK, stops right away |
| `git log --graph --color` | OK |
| vim (highlighting, alternate screen, quit without saving) | OK |
| Claude Code (TUI, arrows, Esc) and OSC title in the bar | OK |
| Resize (238×54 → 135×37 seen from PowerShell) | OK |
| ssh (`ssh -T git@github.com` connects; rejects for lack of a key on this PC) | OK as transport; interactive session not tested |
| Copy selection with Ctrl+C (verified by reading the clipboard) | OK |
| Paste (bracketed paste in vim and bash) | OK |
| Git Bash: `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=NovaTerm` | OK |
| `exit 3` reports code 3 and Enter restarts | OK |
| Closing the window leaves no orphan shells | OK |

### Bugs found and fixed
- When switching profiles, the old session's end notice overwrote the new one's status bar.
- ConPTY starts by asking for the cursor position (`ESC[6n`) and waits for the answer: xterm
  answers by itself, but the Rust test had to answer it by hand.
- vite-plugin-solid sets jsdom as Vitest's default environment: `vitest.config.ts` pins node.

### Measurements (release, 17/11/2026)
- Executable: 9.1 MB. Release build: 3 min 41 s.
- Frontend bundle: 495 KB (132 KB gzip); almost all of it is xterm + WebGL.
- Idle RAM with 1 tab: **181 MB of private memory** (NovaTerm 6 MB, WebView2 the rest).
  Summed working set: 376 MB (it counts shared memory several times). **Plan goal (< 120 MB): NOT MET.**
- Throughput measured without the frontend (bench `bench_conpty`, system ConPTY):
  - `type` of 20 MB: 0.98 MB/s.
  - `seq 1 300000` (MSYS): 0.08 MB/s.
  - In the app, `seq` gives about 10 thousand lines/s: the limit is the system's ConPTY, not the IPC or xterm.
    With both tests there are about 240 batches/s, as if ConPTY delivered in frames.

### Microsoft's ConPTY (sideload) and comparison with Windows Terminal
- With Bruno's permission, `Microsoft.Windows.Console.ConPTY` 1.25.261109001 was downloaded from NuGet (1.76 MB,
  MIT). Authenticode signatures of `conpty.dll` and `OpenConsole.exe`: valid, Microsoft Corporation.
  They stay in `src-tauri\conpty\`; `build.rs` copies them next to the exe (and to `deps\` for the tests) and
  the installer includes them. portable-pty uses them just by being next to the executable
  (verified: the child process becomes `OpenConsole.exe` instead of `conhost.exe`).
- Diagnosis with `bench_raw` (raw ConPTY reading, with no batcher or frontend):

| Producer | New ConPTY | Windows' ConPTY |
|---|---|---|
| Python writes 20 MB at once | 5.37 MB/s (1,823 reads) | 5.60 MB/s |
| `seq 1 300000` (MSYS, one write per line) | 0.11 MB/s (299 thousand reads) | 0.11 MB/s |
| `type` 20 MB | 1.27 MB/s (279 thousand reads) | 1.24 MB/s |

  Conclusion: the ceiling is the cost of each write going through ConPTY (~70 µs), not NovaTerm (the
  batcher gathers 279 thousand reads into ~3,700 batches). On this PC (Windows 11 build 26300) the new
  ConPTY is not faster than the system's. It is kept anyway: it is the same one Windows Terminal and Warp ship,
  and on older Windows versions (for example, the work PC) the system one is quite a bit worse.
- Comparison with the same script (`bench.ps1`, PowerShell stopwatch) in both terminals:

| Test | Windows Terminal (120×30) | NovaTerm release (135×37) |
|---|---|---|
| `seq 1 300000` | 22.9 s | 22.4 s |
| Python, 20 MB at once | 2.73 s | 2.92 s |
| `type` 20 MB | 14.2 s | 13.5 s |

  **Goal "throughput comparable to Windows Terminal": met** (measured with 20 MB; the 100 MB `type`
  is left for F9's benchmark).

### Pending for later phases
- RAM: 181 MB private against the 120 MB goal (almost all WebView2). Review in F9.
- `term.onBinary` (X10 mouse mode of some old programs) is not forwarded yet.
- Interactive ssh not tested (there is no server or key on this PC).
- clippy is not installed in this PC's toolchain (`rustup component add clippy`).
- ~~Nothing committed yet in the git repo.~~ Commit `b5d6529` (18/11/2026).

### Stats
- Tests: Rust 9 + 2 ignored benchmarks (`bench_conpty`, `bench_raw`); Vitest 8. All green.
- Release build: 3 min 41 s; debug: 1 min 9 s.

---

## F2 — Layout (18/11/2026)

### Done
- **Model** (`src\layout\model.ts`, pure functions): tabs with a tree of panes (leaves and
  two-way splits), add/close/cycle/move/rename tabs, split and close panes,
  proportions, each pane's rectangles and neighbor by direction to move with the keyboard.
- **Rendering without re-mounting**: panes are drawn flat, positioned by rectangles, iterating
  by id (text). If they were nested as components, splitting a pane would re-create its terminal and
  kill the shell.
- **Hidden tabs**: they keep receiving and loading data into the buffer, but without WebGL (the
  context is released when hidden and reloaded when shown). Browsers limit WebGL contexts
  to ~16, so with many tabs this avoids losing the render.
- **Tab bar** on top or on the left (Ctrl+Shift+B; preference in localStorage until
  F3), drag to reorder, middle click closes, double click or Ctrl+Shift+R renames (empty
  goes back to the automatic name), status dot (waiting / running / failed / finished) and pane
  count. Profile selector for new tabs.
- **Marquee**: the name scrolls if it doesn't fit, pauses with the mouse over it, respects
  prefers-reduced-motion (it stays with an ellipsis) and the tooltip shows the whole text plus
  folder, shell, PID, renderer and last command.
- **Multi-window** (Ctrl+Shift+N or button): each window has its tabs and its sessions. Each
  session stores its owner window: when a window closes only its shells die; when the
  view reloads only that window's are killed. With no tabs, the window closes.
- **Shortcuts** (`src\layout\shortcuts.ts`): Ctrl+Shift+T/N/W, Alt+Shift++ / - / D (split), Alt+arrows,
  Ctrl+Tab, Ctrl+1…9, Ctrl+Shift+R/B/O, Ctrl+Shift+↑/↓. **Never Ctrl+Alt**: on a Spanish keyboard it is
  AltGr and is used to type @ # [ ].
- **Clean exit** (`exit` with code 0) closes the pane, like Windows Terminal; with an error the
  message stays and Enter restarts.
- **Shell integration** (`src-tauri\shell\` + `src-tauri\src\pty\integration.rs`):
  - PowerShell 5.1/7: script through `-EncodedCommand` (the execution policy doesn't stop it). It wraps
    `prompt` and `PSConsoleHostReadLine`. OSC 133 A/B/C/D;code, 633;E;command, 7;folder. It forces
    UTF-8 output. 5.1 compatible (`[char]27`).
  - Git Bash: an `--init-file` that first loads /etc/profile and ~/.bash_profile (what
    --login would do). PS0 with the arithmetic-subscript trick to mark the start of the command.
  - cmd: PROMPT variable with 133;A/B/D (no code) and 9;9;folder. No clink.
  - WSL: no integration (pending).
- **Warp-style blocks**: a green/red mark to the left of each prompt and on the side ruler according to
  the exit code (with a tooltip), jump to the previous/next command (Ctrl+Shift+↑/↓) and copy
  the last command's output (Ctrl+Shift+O).
- **Summary title** (`src\layout\title.ts`): manual > the program's OSC title (only while a
  command runs, or if there is no integration and it isn't a shell title) > heuristic (running command +
  folder + git branch). For cmd, the "cmd.exe - command" title that cmd itself sets is used.
  The backend gives the foreground process (the shell's newest descendant, without conhost or
  OpenConsole, with sysinfo; queried every 2 s and paused when the window is minimized) and the git
  branch (reading `.git/HEAD`, with worktree support).

### Tests
- Rust: 17 (+2 benchmarks). New: real integration with PowerShell and Git Bash (133;B,
  633;E, 133;C and 133;D arrive with the right code), encoded script, bash with LF endings, foreground
  process (including a recycled PID) and git branch.
- Vitest: 32. New: tab and pane model (including neighbors in a 2x2 grid), shortcuts
  (including that AltGr triggers nothing), title and heuristic, OSC 133/633/7/9 parsing, write
  queue.

### Test in the app (computer use)
| Test | Result |
|---|---|
| Name by folder ("Br1") and window title | OK |
| Git repo: "NovaTerm (main)"; with a running command: "ping -n 6 · …" | OK |
| Green/red marks by exit code | OK |
| Splits (auto, down), focus with Alt+arrows, active pane border | OK |
| New tab, Ctrl+Tab, the hidden tab keeps running and repaints correctly | OK |
| Rename with a long name: marquee scrolls | OK |
| Bar on the left | OK |
| New window; `exit` closes pane, tab and window; the other window's shells keep going (5 → 4) | OK |
| Claude Code inside a pane | OK |
| A program's OSC title while it runs ("✳ Refactor del login…") and back to the folder | OK (simulated) |
| Ctrl+Shift+O copies exactly the last command's output (read from the clipboard) | OK |
| Git Bash with integration in the app (title with command, red mark on a failed `cd`) | OK |
| cmd: folder through OSC 9;9 and "ping -n 8 · NovaTerm (main)" while running | OK |
| Drag divider | OK (after the fix) |

### Bugs found and fixed
- **Reversed keys** ("cmd" arrived as "cdm"): each key went in an independent `invoke` and the
  backend could serve them in another order. `WriteQueue` sends one at a time and gathers what is typed
  while it waits. It is the most serious bug of the phase.
- The Enter that confirms the rename also reached the shell (an extra empty prompt).
- The divider didn't drag: with Solid's delegated events, `currentTarget` is not the element.
- When writing the shell scripts with a heredoc, every `\\` became `\`: PowerShell's prompt
  failed (it showed `PS>`). The real integration test caught it.
- With `cd X; ping …` the title showed the `cd`: now the last segment of the chain is taken.


### Pending / not verified
- **Claude Code's real title**: not tested with a real task (so as not to spend quota); the
  mechanism was tested by simulating the OSC title. When trying it, a test command reached Claude
  Code as a message (the Ctrl+C presses hadn't closed it) and it consumed a turn (~77 thousand tokens, almost all
  initial context) until it was interrupted with Esc.
- If the `cd` and the program are on the same line, the title's folder is the previous one until
  the prompt comes back.
- When NovaTerm is launched from a Claude Code session, the shells inherit `CLAUDE_CODE_*`
  variables (Claude Code inside warns "Transcript saving is off"). Launched normally it doesn't happen.
- WSL without integration; cmd without exit code or command text (clink would be needed).
- The vertical bar preference lives in localStorage until F3.

### Stats
- New files: 13 (6 of logic with tests, 4 components, 2 shell scripts, 1 Rust module).
- Tests: Rust 17 (+2 ignored), Vitest 32. All green.

---

## F3 — Settings and themes (18/11/2026)

### Done
- **Persistence** in `%APPDATA%\NovaTerm\settings.json`. The backend (`settings.rs`) doesn't know the
  schema: it saves the object atomically (temp file + rename), notifies all windows
  with the `settings-changed` event (with the originating window, so that what is being
  edited isn't overwritten) and watches the file every 1 s to apply edits made by hand. If the file is
  broken it doesn't overwrite it without first copying it to `settings.json.bak`.
- **Schema and normalization** in the frontend (`settings/schema.ts`): any file (old, hand-edited
  or garbage) gives a complete configuration; it clamps out-of-range numbers, discards invalid
  options and keeps the keys it doesn't know (for later phases).
- A **settings window** of its own (Ctrl+, or the ⚙ button), loaded on demand (21 KB):
  theme and colors, font and cursor, background, terminal and interface, shortcuts and "next phases".
- **Themes**: 11 built in (Nova dark/light, Campbell, One Half Dark/Light, Solarized Dark/Light,
  Dracula, Tokyo Night, Gruvbox Dark, Nord), dark / light / follow Windows mode with a theme for
  each mode, duplicate and edit the 21 colors, delete, and **import** Windows Terminal schemes
  (or its whole settings.json, with comments), iTerm2 `.itermcolors` and xterm.js themes.
  The tab bar and the title bar take the theme's colors.
- **Background**: Mica, alternative Mica, Acrylic and blur (Tauri 2's effects API, no extra
  crate), opacity, and an image with opacity and fit. The image is copied to `%APPDATA%\NovaTerm\fondos`
  and the backend only reads from that folder. The windows became transparent.
- **Fonts**: a list of installed monospaced fonts (Windows registry + canvas measurement; symbol
  ones are excluded), or a name by hand; size, line height, spacing, weight, cursor
  (block/bar/underline) and blinking. **Ligatures** with `@xterm/addon-ligatures` 0.10: the addon
  asks for the font with the local fonts API (which in the WebView would ask for permission); we replace it
  with one that reads the file from the backend. It is loaded only when they are turned on (191 KB separately).
- **Configurable shortcuts**: 18 commands with their combinations (added by recording them, removed,
  reset to factory), conflicts marked in red, Ctrl+Alt rejected (AltGr), a warning for
  Ctrl+letter without Shift. Ctrl+1…9 stay fixed. New shortcut: Ctrl+, opens settings.
- **Terminal and interface**: bar position, default shell, history lines and how often the
  program in use is detected.
- The vertical bar preference from F2 (localStorage) migrates by itself to the file the first time.

### Tests
- Rust: 24 (+2 benchmarks). New: save and re-read, nonexistent file, broken file (warning with
  line and .bak copy before overwriting it), BOM, safe image names and decoding, parsing of registry
  font names and a real registry read (Consolas → consola.ttf).
- Vitest: 51. New: normalization (garbage, ranges, unknown keys, custom themes), valid built-in
  themes, light/dark, palette with opacity, import (Windows Terminal, its settings.json
  with comments, own format, iTerm2, errors), theme ids, configurable shortcuts (combination
  from the event, canonical form, rejections, replacement, conflicts, help).

### Test in the app (computer use + WebView2 remote debugging)
| Test | Result |
|---|---|
| Change theme in the settings window: it applies instantly in the terminal and the bar | OK |
| Ctrl+, opens (or brings to the front) settings | OK |
| 75 % opacity without an effect: the desktop shows | OK (after the fix) |
| Mica (wallpaper tint) and Acrylic (blurred) | OK |
| Cascadia Code with ligatures in the preview and in the terminal (WebGL), no permission prompt | OK |
| Record Ctrl+Shift+Y for "New tab" and use it; Ctrl+Alt+T rejected with an explanation | OK |
| Edit settings.json by hand (size 18, light mode): it applies by itself, light title bar | OK |
| Broken file: warning with line and column; the terminals keep the last working settings | OK |
| "Follow Windows" mode with Windows in dark → dark theme | OK |
| Ctrl+Shift+B changes the bar in all windows; a new window with the current settings | OK |
| Background image (copy in `fondos`, name with ñ) visible behind the text | OK (image injected into the picker) |
| Import a Windows Terminal scheme and edit its background: it changes in both windows | OK (file injected into the picker) |
| The terminal stays in WebGL with transparency and ligatures | OK |
| Release: the vertical bar saved in F2 moved by itself to settings.json | OK |

### Bugs found and fixed
- **Black background with transparency**: xterm paints its viewport opaque even if the theme is transparent;
  it was seen by reading the styles with the WebView2 remote debugging. It is forced transparent via CSS
  (the body sets the color).
- Wingdings 2 showed up as monospaced (it passes the width test): symbol ones are excluded.
- The broken-file warning said "default values are used" even when the app keeps the
  last valid configuration: now the message depends on the case.
- The ligatures addon added 190 KB at startup: it now loads only when they are turned on.

### Pending / not verified
- **The native file picker** couldn't be driven with computer use (the capture covers it): the
  image and the theme were tested by injecting the file into the same `<input>`, which runs the same
  code. When trying it, the path was typed into the terminal and PowerShell opened the image in Photos.
- **Live Windows light ↔ dark switching** with automatic mode: not tested by changing the system
  theme (it is a Windows setting); it was verified that it takes the current mode.
- **RAM**: 195 MB private with one tab (release, measured with a script that adds NovaTerm and its
  WebView2 processes). In F1, 181 MB were measured; part may be the transparent window and part the
  method. The 120 MB goal is still unmet: left for F9.
- The agent, usage, CPU/RAM and LLM summary options arrive with F4, F5 and F9 (the "Next phases"
  section says so).

### Stats
- New files: 10 (2 Rust modules, 5 logic/state, 1 component, 1 stylesheet, 1 of tests).
- Main bundle: 557 KB (533 KB in F2); settings 21 KB and ligatures 191 KB separately, on demand.
- Tests: Rust 24 (+2 ignored), Vitest 51. All green.

---

## F4 to F9 and extras (18/11/2026)

Bruno asked to keep going straight through to the end and to test everything at the finish; along the way he added features
(see the plan's addendum) and the rename to **AlphaTerm**. Each phase ended up in its own commit.

### F4 — Agents
- Editable catalog (Claude Code, Codex, Antigravity, OpenCode and custom ones) with command, variables and
  hide. Detection without running anything: the process PATH + the registry's + usual folders
  (it found all four: `.local\bin\claude.exe`, `npm\codex.cmd`, `agy\bin\agy.exe`, `npm\opencode.cmd`).
- Launching opens a tab with the default shell and writes the command at the first prompt (the agent
  runs inside the shell). States: starting, working (there is output), waiting for input
  (silence), needs you (bell), finished (with code). Also on the tab's dot.
- Bug found: Enter was written as a literal line break (in a JS template it becomes
  `\n` and PowerShell takes it as an incomplete line). An F1 bug that showed up here: if the pane
  was resized while the session was starting, the new size was lost and the TUIs were drawn shifted.

### F5 — Widgets
- CPU and RAM with a 60 s sparkline; click: top processes and usage of each tab (the shell's tree).
- Usage: **agy** exact through `/quota` (0 tokens, run without a shell); **Codex** from the last
  `rate_limits` of its sessions, which now come compressed (`.jsonl.zst`, read with ruzstd);
  **Claude** from Claude Code's statusline (credentials are not read: a decision that was already in the
  Claude Control Panel). Without a statusline, a token estimate. Each figure states its source and age.
- Finding: Claude Code's statusline points to `Desktop\claude-control-panel\statusline.js`, which no
  longer exists; settings warns about it and offers to install AlphaTerm's (with a copy of the file).
  It wasn't touched: it changes Claude Code's configuration and is Bruno's decision.

### F6 — Servers and ports
- Listening ports through GetExtendedTcpTable (IPv4 and IPv6), with process, command, folder and uptime;
  it marks the ones born in a tab. Stop with taskkill /T (plus confirmation if it isn't AlphaTerm's;
  never PID ≤ 4). Automatic recipes (command via OSC 633 + folder + ports) or by hand.

### F7 — Projects
- From Claude Code's transcripts (`cwd`) and Codex's sessions (`session_meta`), plus the ones
  added by hand and recent folders. A lazy tree with `.gitignore` (ignore crate) and a watcher
  of the open folders (notify).

### F8 — Git
- The git CLI with no console or prompts: status porcelain v2, unified or side-by-side diff, stage per
  file or all, commit (Ctrl+Enter), history with a graph, branches, fetch/pull --ff-only/push (with -u
  if upstream is missing), clone and init. Change counter on each tab.

### F9 — Polish
- Tab summary with a model (OpenAI-compatible endpoint; off by default). Name order:
  manual > program title > model > heuristic.
- Code guide (`Documentacion\Guia_de_codigo.txt` and `Guía de código.pdf`), addendum in the plan.

### Extras requested
Global command history, current location in the footer, the active agent's usage highlighted,
restoring the session, clickable paths with preview, tab folders and color, window
title, **control API** (local HTTP + token, MCP server and `alphaterm-mcp.mjs` CLI), **Docker**,
**Guardian** and side panels in a **tiled layout** (several at once, resizable and reorderable).

### Tests
- Rust: 55 (+3 ignored). New: agent detection, sysmon, usage (dates, Codex, agy,
  statusline), ports (real table), projects (tree with .gitignore), git (real cycle in a
  temp repo), history, session, Docker (arguments without a shell), Guardian (classifier and hook),
  folder migration, model summary.
- Vitest: 96. New: agent state, formats, recipes, projects, diff, paths, session, tab
  folders, usage, tiled layout.

### Test in the app (release, CDP + computer use)
| Test | Result |
|---|---|
| Launch Claude Code from the panel (with `--mcp-config` and `--settings`), "waiting for input" and "finished (code 1)" state | OK |
| API: ping, list, open_tab, split, open_window (sub-window), run with wait (exact output and code 7), read, send, close; invalid token → 401 | OK |
| MCP over stdio as a client: initialize, tools/list (14), tools/call, error on a nonexistent pane | OK |
| Guardian through the API (Remove-Item): dialog in both windows, Block → the API receives the block | OK |
| Claude Code hook (simulated with the JSON Claude sends): Edit with diff → allow; rm -rf → deny | OK |
| Docker: engine off detected, "Open Docker Desktop" starts it, version 29.7.2 in the panel and the API | OK (no containers: see pending) |
| Python server in a tab: marked as AlphaTerm's, recipe saved, stop and start again (HTTP 200) | OK |
| Git: numbered diff, stage of one file, commit of just that file | OK |
| History with commands from both windows and codes | OK |
| Projects and tree without node_modules/dist/target | OK |
| Tab color and folder, collapse, window title | OK (after fixing the menu) |
| Restore the session on reopening: title, 5 tabs, split, folders, panel | OK |
| Paths in the output: image preview (3840 px) and folder preview | OK |
| Model summary against a test server: 3 requests per round, clean name | OK |
| Tiled layout: 3 panels at once, move above another and to a new column, width and height, saved | OK |
| Jumps to the start/end with 300 lines | OK |
| Footer: agy 7 % weekly (matches /quota), Codex and Claude marked as old | OK |
| Settings: the 8 sections draw; it detects the broken statusline | OK |

### Bugs found in the final test and fixed
- **Footer in a loop**: `load()` read a signal inside its effect → 60 layouts per second, nodes
  growing and the renderer at 180 MB (total RAM 373 MB). With `untrack` the renderer drops to ~45 MB.
- The API read the last rows of the screen (empty) instead of up to the cursor.
- Integration was only marked with the first command: `run` couldn't wait in a new tab.
- The tab menu closed before applying the action (Solid doesn't let you read its value once closed).
- A light line on the right of the terminal: the border of xterm's "overview ruler".

### Measurements (release, 18/11/2026)
| Measurement | Result | Plan goal |
|---|---|---|
| Startup to the first prompt | 1.2–1.4 s (PowerShell 5.1 alone takes ~0.18 s) | < 500 ms — **no** |
| Private RAM with 1 tab (AlphaTerm + WebView2) | ~225 MB (renderer 45, GPU 108) | < 120 MB — **no** |
| Throughput | on par with Windows Terminal (F1: the limit is ConPTY) | comparable — yes |
| Key latency | not measured | < 10 ms — no data |

RAM and startup are dominated by WebView2 (the GPU process grows with the transparent window and WebGL).
Going lower than that would need another interface engine: it wasn't done.

### Pending / not verified
- **Docker with a real container**: there are no images on the machine and pulling one is a download
  (it asks first).
- **Claude Code with a real task** going through the hook: the script was tested with the same JSON
  Claude sends and that Claude accepts the two flags; the "trust the folder" prompt was not accepted (it changes its
  configuration) nor was it given a task (it spends quota).
- Codex and agy launched from the panel; Codex's approval mode with `-s read-only -a on-request`.
- A summary with a real model (Ollama has no models; pulling one is a download).
- The native folder pickers (they can't be driven with computer use).
- The session doesn't save the windows' size or position.
- Packaging (a loose exe or an NSIS installer): Bruno's decision.
- ~~The project folder is still `Desktop\NovaTerm`~~: renamed to `Desktop\AlphaTerm` on
  18/11/2026 (with the Claude Code session outside the folder and the app closed).

### Stats
- Commits: F3 `8b4a54b`, F4 `9ce06bc`, F5 `3b94920`, F6 `b617faf`, F7 `38c09ad`, F8 `de356a4`,
  rename `85f31a8`, extras and F9 up to `cef9654`.
- Tests: Rust 55 (+3 ignored), Vitest 96. All green.
- Release binary: alphaterm.exe 14.9 MB (+ conpty.dll and OpenConsole.exe).

---

## After the delivery (18/11/2026)

- **Claude Code without colors inside AlphaTerm** (Bruno saw it): AlphaTerm had been opened from
  this Claude Code session and the shells inherited its environment: `NO_COLOR=1` (turns colors off) and
  ~30 `CLAUDE_CODE_*` variables, including tokens and the child-session marker (hence the warning
  "Transcript saving is off"). Now the shells are created without those variables, unless they are in the
  persistent Windows environment. Verified: opening AlphaTerm from the same session, the shell
  ends up without NO_COLOR or CLAUDE_*, and Claude Code shows with colors.
- `build.rs` stopped copying ConPTY after renaming the folder (the path was fixed in the compiled build
  script): it now reads it at run time.
- Tests: Rust 56 (+3 ignored), Vitest 96.

---

## Live usage, file changes and adjustments (20/11/2026)

Bruno's requests, in order:

1. **A cmd window that appeared and went away every few minutes.** Cause: `agy -p /quota` (the footer's
   quota query, every 10 min) launched agy's updater ("Spawned background update
   process", in its log) outside the hidden console. The System dashboard already avoided it with
   `AGY_CLI_DISABLE_AUTO_UPDATE=true` (agy only accepts "true"); AlphaTerm does the same. Verified
   with a process and window watcher on the new AlphaTerm: 0 console windows in 3 minutes
   with a full round of queries (Claude, Codex and agy).
2. **Usage like the System dashboard, without having to use the agent.** `usage_live.rs`: when opening
   AlphaTerm and every N minutes (Settings, 15 by default) `claude` and `codex` are opened in a windowless
   ConPTY, `/usage` or `/status` is typed and the screen is read with `vt100`; agy continues with its
   `/quota` in JSON. The newest figure wins between the query and the files (statusline, Codex
   sessions). Claude runs with `--strict-mcp-config` and `disableAllHooks` (it doesn't bring up MCP servers or hooks).
   Stumble: answering `ESC[6n` (where the cursor is) made Codex receive the answer as
   typed text; without answering it works, as in the dashboard. Measured times: Claude 9 s, Codex 16 s,
   agy 5 s. No hung processes remain.
3. **Changes panel** (Ctrl+Shift+M, `changes.rs` + `ChangesPanel.tsx`): what the agents change in
   text files, code and PDFs (by their text), with or without git ("in git" label),
   side by side or unified, open one or all, collapse all. Sources: Claude Code's Pre/PostToolUse
   hook launched from AlphaTerm (exact) and, for any agent, its tab's folder
   (a copy at startup + watcher). What didn't make it into the copy is compared against the last commit or
   shown whole. It is kept for 7 days in `changes.json`.
4. **Edit and save from that panel**: it respects encoding (UTF-8 with or without BOM, UTF-16, ANSI) and
   line ending, and doesn't save if the file changed since it was opened.
5. **RAM as a percentage** (button, detail, and per tab and process).
6. **Detailed usage in the Agents panel**: under each agent, plan, model, each window
   with its reset (countdown and time), per model (Claude: week per model and "what else
   consumes"; agy: groups with their models), extra usage and a weekly forecast at the current pace.
7. **Collapsible vertical tab bar** (the state and each tab's initial remain).
8. **CPU and RAM in the vertical bar**: the graph goes below each number; with the bar collapsed
   only the numbers remain (before, the widget hid when collapsing).
9. **Version in the footer** (`v0.2.0`; tooltip with commit, build date and exe path) and in
   Settings → About. The version becomes 0.2.0.
10. **Install per version and update the shortcut**: `npm run release` builds and runs
    `scripts/instalar.mjs`, which copies to `%LOCALAPPDATA%\AlphaTerm\versiones\<version>` and points the
    desktop shortcut and the taskbar pin there. Before, they pointed to
    `target\release\alphaterm.exe`, which can't be overwritten while AlphaTerm is open.
11. **`compilar-version.bat`** in the project folder (double-click): builds (into `target\prueba`
    if `target\release\alphaterm.exe` is open) and installs, leaving the "AlphaTerm <version>" shortcut
    on the desktop (it renames the previous one). With CRLF.
12. **Pasting images**: Ctrl+V (or right click) with an image on the clipboard and no text saves it
    as a PNG in `%TEMP%\AlphaTerm\pegadas` and pastes its path; Claude Code and Codex attach it.

Others: the Rust test binaries wouldn't start (STATUS_ENTRYPOINT_NOT_FOUND: TaskDialogIndirect
needs common controls v6); the manifest is now embedded by the linker for all binaries.
`ALPHATERM_DATA_DIR` makes it possible to open a new version next to the one in use.

### Test in the app (separate release, CDP)
- Footer with live data on opening (Claude 5 h and week, Codex week, agy). Agents panel with
  the detail of the three. No console windows.
- Hook: the real script (`guardian-hook.mjs`) with Claude Code's input: Edit of a `.md` (+2 −1),
  Write of a new file ("new") and of a PDF (−"Total: 100", +"Total: 250"). Open all, diff.
- Editing: Ctrl+S saves to disk ("edited by hand"); if the file changes while being edited, it doesn't
  save and explains why.
- Bug found in the test: folders inside AppData weren't watched (it excluded all of AppData, and the
  test project was in Temp). Now only the roots are excluded (user, AppData, Temp).
- Folder watcher, now fixed: with Codex open in the project, a new `plan.txt` (+3) and
  `compras.txt` (+2 −1) are attributed to Codex; `node_modules` and a temp file are ignored; deleting
  `plan.txt` is recorded.
- CPU/RAM: in the vertical bar, the graph below the number; collapsed, only the numbers.
- `compilar-version.bat` end to end: it built into `target\prueba` (the old one was open),
  installed 0.2.0, renamed the shortcut to "AlphaTerm 0.2.0" and updated the pin. The installed
  version shows "v0.2.0+" in the footer.

### Pending / not verified
- Pasting an image with a real screenshot (Bruno's clipboard wasn't touched; the PNG saving
  has a test).
- The hook with a real Claude Code session editing (tested with the real script and the same input).

### Stats
- Tests: Rust 72 (+6 ignored: real queries to Claude, Codex and agy), Vitest 104. All green.
- Release binary: alphaterm.exe 17.4 MB (+ conpty.dll and OpenConsole.exe). Version 0.2.0.


## Adjustable vertical bar and agent launch options (20/11/2026, afternoon)

1. **Collapse button for the vertical bar**: the `«`/`»` becomes a drawn sidebar icon
   (rounded frame with a small line on the left, the same in both states).
2. **Vertical bar width**: its right edge is dragged (160 to 480 px, and it leaves at least 360 px
   for the terminals). It is saved on release in `tabBar.width`; double click goes back to 220 px. Collapsed
   it stays at 48 px and when expanded it recovers the chosen width.
3. **Agent launch options** (instead of the Agents panel's edit button): a
   button with sliders opens, attached to the agent's row, model (a list that filters as you type),
   effort (slider; the first position is "default"), permissions and modes, session checkboxes
   (continue, resume, worktree, first message) and "More options" (extra folders, system prompt,
   tools, Chrome, debug, etc.), with the command line that is going to run. What was there before (name,
   command, variables, hide, delete) went into "Advanced".
   - Catalog in `src/panels/agentLaunch.ts`, surveyed from the `--help` of the installed versions
     (Claude Code 2.1.329, Codex 0.170.0, agy 1.5.13, OpenCode 1.19.1) and from the official documentation.
     OpenCode 2.x changed the flags of its interface (no --model or --agent): the catalog is the 1.x one.
   - Live models: `agent_models` command (Rust). Codex from `~/.codex/models_cache.json` (with
     each model's reasoning levels: the slider changes according to the model), agy with
     `agy models` and OpenCode with `opencode models`, windowless and once per session (↻ to re-read).
     Claude has no list: it is fixed (aliases and full names).
   - Options that clash (e.g. Codex `--approve-for-me` with `--sandbox`, Claude
     `--dangerously-skip-permissions` with `--permission-mode`): the one left out shows gray, with
     "Not used together with …", and isn't sent. The dangerous ones, in red.
   - Quotes according to the profile's shell (PowerShell 5.1, pwsh, cmd, bash). In PowerShell 5.1 the inner
     double quotes go as `\"` (otherwise they get lost when passing the argument to the .exe).
   - The first message goes first (before flags like `--add-dir`, which eat whatever follows). In
     Codex, resuming is the `resume` subcommand, which goes before everything.
   - They are saved per agent in `agents[].launch` and apply to every "Launch" (panel, Projects and when
     reopening the session; on reopening the session ones aren't repeated, because it is already resumed).
   - Codex: if the options already say how to approve, AlphaTerm doesn't add `-s read-only -a on-request`.
4. **Bug found and fixed**: the Agents panel iterated objects and every settings change
   rebuilt the row (focus and whatever was open got lost). Now it iterates ids.

### Test in the app (separate release with its own data, CDP + the test instance's control API)
- Icon as requested; drag to 331 px saved, limits 160 and 480, double click to 220, collapse and
  expand.
- Claude: opus + high + plan → the line, the summary under the name and what was saved match; launched,
  it shows "Opus 5.5 with high effort" and "plan mode on". Skipping permissions grays out what clashes.
- Codex: 10 models from the cache; with gpt-6-luna the slider loses "ultra". Launched with
  `-c model_reasoning_effort=xhigh --approve-for-me --search`: it starts with no error and without the Guardian's
  `-s`.
- agy: 23 models (2 s). Launched with `--model gemini-4-neon --effort xhigh --mode auto --sandbox
  --settings '{\"toolPermission\":\"proceed-in-sandbox\"}'` in PowerShell 5.1: it shows "Gemini 4 Neon
  (XHigh)" and "Auto mode".
- OpenCode: 121 models (2 s). It wasn't launched.

### Pending / not verified
- OpenCode launched with options; the first message (it wasn't sent so as not to spend quota); quotes in cmd and
  Git Bash (they have tests, no test in the app).

### Stats
- Tests: Rust 74 (+6 ignored), Vitest 111. All green.

## Built-in browser with element marking (20/11/2026)

Request: a browser view inside AlphaTerm where the agent sees the app it brought up,
interacts, takes screenshots, and where the user marks elements (like the first version of Claude
Design) to ask for changes in real time. Bruno's decisions: the request goes to the agent already
working on the project, in its tab, as if typed (option 1); the browser is a child WebView2
inside the window (option A, as opposed to a docked window or Chrome streamed as video); it is
a new kind of pane; Claude Code with an exact "done" notice, the rest by silence.

### What was done
- `src-tauri/src/browser.rs`: child WebView2 (`Window::add_child`, `unstable` feature) over the
  pane's rectangle; CDP through `CallDevToolsProtocolMethod` (screenshots of the view, the whole page and
  crops; click, text, keys, scroll, eval); `Runtime.bindingCalled` events (marks),
  `consoleAPICalled` and `exceptionThrown` (the page's console); new windows open in the same
  pane; the request builds `pedido.md`, `marcas.json` and the screenshots in `%TEMP%\AlphaTerm\navegador`.
- `scripts/browser-overlay.js`: edit mode (highlight on mouse hover with label and component,
  click marks with a number without firing the page, Alt+click the parent, Esc exits), data of each mark
  (unique selector, HTML, computed styles, position, component and React source file —
  `_debugSource` or React 19's stack —, Vue 2/3, Svelte and Angular), hot reload detection,
  and the page's structure as text for the agent.
- Frontend: `browser` leaf in the model (saved in the session), `src/browser/BrowserView.tsx`
  (bar with URL, Edit, Whole site, console errors; marks as chips; the request with which
  terminal it goes to; "Preparing… / Working… / Needs you / Done ✓"), it hides if a menu or modal
  overlaps it or when switching tabs. It opens with Ctrl+Shift+U, from Servers ("Open in browser",
  next to the tab where it was born) or through the API.
- API/MCP: `browser_open/list/navigate/reload/screenshot/snapshot/click/type/key/scroll/eval/
  console/marks`; the screenshot comes back as an image over MCP. Claude Code's Stop hook (`agent_stop`), in
  `claude-guardian.json` and in `claude-stop.json` (if the Guardian isn't there).
- A fix along the way: with a child WebView, Tauri no longer counts the window in `webview_windows()`; the control
  API, the Guardian and window closing moved to `app.windows()`.

### Test in the app (separate release with its own data, CDP on 9339)
A test site with auto-reload and a fake "agent" (it reads the paste, shows a spinner for 4 s and
changes the button's color in the HTML):
- Opened through the API as an agent would: pane next to its terminal, injected layer, live
  `__alphaterm` function, hot reload detected.
- Edit mode: the click marks and doesn't fire the page's `onclick`; two marks with component
  `SubmitButton` and file `src/components/SubmitButton.tsx:12` (simulated fiber); chips in the UI.
- Request: the agent received the text with the paths; "Working…" at 0.5 s, "Done ✓" at 7.8 s,
  the button turned blue (the page reloaded by itself) and the marks were cleared. Correct screenshots
  (view with numbers and a crop of the button).
- Agent tools: snapshot with selectors, a real click ("click 1"), text with ñ and accent,
  Ctrl+A, scroll, eval, whole-page and single-element screenshots, console error, nonexistent selector with
  a clear error; over MCP the screenshot arrives as an image.
- Simulated Stop hook (same JSON Claude Code sends): it goes to "Done" while the agent keeps going.
- Global request: it includes the whole-page screenshot.
- It hides with What's new open and on another tab; it comes back on closing or returning.
- Close and reopen: the pane comes back with its URL and its owner.

### Pending / not verified
- A real Claude Code receiving a request (a real task wasn't spent): the hook was tested with its
  JSON and the paste with a program that asks for bracketed paste.
- Real React/Vue (detection was tested with a simulated fiber); pages with iframes (the layer
  only marks the main document).
- Dragging a divider over the browser: while dragging, the browser hides.

### Stats
- Tests: Rust 77 (+6 ignored), Vitest 122. All green.

## Command suggestions (21/11/2026, branch `predicciones`)

Bruno's request: "a predictive command system in the shell, keeping the history if I press
up and a menu of possible folders from where I'm standing to show up if I type cd"
(and with `ping`, the most common IPs; "so with all the commands"). Design and plan in
`Documentacion/en/specs/2026-11-21-command-suggestions*.md`. Chosen approach: our own menu with our own sources
(folders, history, catalog) + completions from the PowerShell session itself.

### What was done
- `src/suggest/`: read the prompt line from the screen (from the 133;B to the cursor), split
  words with quotes (in cmd only `"`), our own catalog in Spanish (~60 commands: files, network,
  system, git, npm, docker, winget, agents…; the cmd built-ins that are cmdlet aliases in PowerShell
  are for cmd only), an engine that joins history, catalog, folders, PATH and PowerShell with
  order and no repeats, insertion with backspaces and quotes, menu keys, controller and menu.
- PowerShell: `alphaterm.ps1` registers the `F12,e` shortcut with PSReadLine; it runs `TabExpansion2` and
  answers in an invisible OSC 7717 with a per-session nonce (`ALPHATERM_NONCE`, deleted from the
  environment). It is requested after 150 ms without keys, never for catalog commands or network paths or
  after Tab/Ctrl+R; if a response takes more than 300 ms, that tab only asks with Ctrl+Space.
- Rust (`suggest.rs`): list folders (3 s cache, no hidden ones, max 500), gateway
  (`GetBestRoute` to 8.8.8.8), PATH executables, npm scripts and processes.
- cmd now saves history: the line is read on Enter and `running` becomes true until the next
  prompt (the tab's state, the agents' and Servers' also see it).
- Keys: ↑ is always the history except while navigating the menu; ↓ navigates; Tab inserts; Enter runs
  (it inserts only if navigated); Esc closes; Ctrl+Space opens by hand (in PowerShell it replaces
  `MenuComplete` while suggestions are on).
- Settings → Terminal: on / while typing or only with Ctrl+Space / PowerShell completions.

### Test in the app
- Risk 1 (the hidden shortcut through ConPTY) verified first with a real integration test
  (`powershell_completa_con_f12`): it arrives, answers `Get-ChildItem` and the folders for `cd `, and the
  nonce doesn't stay in the environment.
- Development and separate release version (`target\prueba`, its own data and WebView2, CDP on 9333,
  without touching the open AlphaTerm):
  - PowerShell: `cd ` with folders, `..` and `~`; Tab goes down to subfolders; ↓ + Enter inserts without
    running; Enter runs; ↑ brings up history and doesn't open the menu; Esc closes without deleting the line;
    `Get-Ch` and `Get-ChildItem -Fi` with results from the session itself; Ctrl+Space; no menu
    inside `node`.
  - cmd: `ping ` with 8.8.8.8, 1.1.1.1, the router (192.168.1.1, read live), localhost and options;
    no menu while `ping` runs; `cd 3d` → `cd "3D Objects\\"` and it keeps going down; cmd history
    saved exactly as typed.
  - Clean screen: the hidden shortcut leaves nothing visible.
- Fixes that came out of the real test (each with its own test that failed first): the menu stayed
  one key behind (an exit notice before the echo consumed the mark; now the line is compared);
  `cd` history from other folders covered the folders; cmd's title put an extra space
  into the history; PowerShell's results beat the catalog on the first word and repeated `.exe`;
  `dir /` in cmd listed the disk root instead of the options.
- A review of the whole branch by a separate reviewer ("with fixes", nothing critical). Fixed, each one with
  its test: a pending insertion could be written after Enter (now it is canceled and never
  written outside the prompt); the echo wait now compares the expected line (someone else's output no
  longer counts as echo); nothing with control characters is offered (an npm script "x\rcalc\r" would
  have run); inside quotes the trailing slash goes doubled (`"AI PROJECTS\\"`: with a single one, git
  or node receive the argument broken, verified on this PC; cd and Set-Location accept the double); values
  that already carry quotes aren't quoted again; a 4 s cache on the generators (git,
  docker, processes) instead of a process per key; history from other folders returns for the
  commands the catalog doesn't know. The minor ones were noted (see below).

### Pending / not verified
- PowerShell 7 (not installed at home) and PSReadLine with its own predictions (2.2+), which may
  draw gray text after the cursor: the menu doesn't appear if there is something typed after the cursor.
- Trying it in Bruno's daily use (branch `predicciones`, shortcut "AlphaTerm prueba
  (predicciones).bat" on the desktop, with separate data).
- Long wrapped lines and multi-line commands: covered by tests, not tried by hand.
- Review minor ones not done: folders with more than 500 entries (they are cut before filtering),
  accepting a command from the menu doesn't open the next menu, the first ↓ only marks row 1, the
  nonce goes to all profiles, no visible notice when a tab stops asking
  PowerShell, catalog details (cd /d in PowerShell, chdir/mklink/title/ver/for), and noting in
  CLAUDE.md the 7717/F12,e protocol and that every write to the shell goes through `toShell`.

### Stats
- Tests: Rust 84 (+6 ignored), Vitest 206. All green.

## Panes: bar, moving and dividers (23/11/2026, branch `paneles`)

Bruno's request: "put split view of multiple windows", and then "add the split and close
buttons, also being able to move them as if it were snap, that is, change the order or the size". Design and
plan in `Documentacion/en/specs/2026-11-23-pane-bar-and-snap-*.md`. Approach chosen by Bruno: a
fixed bar on top of each pane (instead of floating buttons).

### What was done
- A 22 px bar on each terminal pane: name (agent or shell · folder), ⇥ split
  right, ⤓ split down, × close. Highlighted on the focused pane. Right click: Split
  right, Split down, Equalize sizes, Close pane. The browser adds the ⋮⋮ grip and ⇥ ⤓.
- × and "Close pane" ask if something is running (agent or command), with a question of their own
  inside the app (`askConfirm`): `window.confirm` doesn't ask in AlphaTerm (see Pending).
- Moving: the bar is dragged (5 px threshold); over half of another pane it ends up on that side,
  in the center they swap; where it will end up is painted. Esc, losing focus or pointercancel
  cancel. The browser hides while dragging.
- Dividers: a 9 px zone, they stop at ⅓, ½ and ⅔ (at 12 px or less), double click leaves half and half.
- Model with tests: `movePane`, `swapPanes`, `equalize`, `paneAt`, `dropZone`, `zoneRect`,
  `snapRatio`; `paneBusy`; the drag controller (`paneDrag.ts`) with its own tests.

### Test in the app (debug exe + Vite, own data and WebView2, CDP on 9333)
- ⇥ and ⤓ split the pane of that bar; the new one is highlighted; × with nothing running closes.
- With `ping -t localhost` running, × and "Close pane" ask ("Close this pane? Whatever is running
  in it will be stopped (PING · Br1)."), with focus on Cancel; Esc and Cancel don't close.
- Dragging the ping's pane to the left half of another: it ends up on the left, it is the same terminal
  node (DOM mark intact) and the PING process is still alive. Center swaps. Esc,
  blur and a click without moving change nothing and leave the body clean.
- Esc mid-drag doesn't reach the shell (a line typed in PowerShell is still there; a direct Esc
  does delete it).
- With a browser: during the drag it hides and the zone is painted; on canceling it comes back. The
  browser moves by its grip.
- Divider: near ⅓ it ends at 0.3333; at 9 px from ⅔ it ends at 0.6667; far away it stays where it is dropped
  (0.42); double click 0.5; "Equalize sizes" 0.5.
- Closing the test window and reopening it recovers the moved layout.
- Finding: `window.confirm` is replaced by Tauri's dialog plugin (async function →
  promise, always "yes") and the app doesn't have the permission: none of the app's `confirm()` calls
  asks. So as not to show questions after acting, the permission wasn't added.

### Pending / not verified
- Fixed at Bruno's request: the 13 old `confirm()` calls (stopping a server, even if AlphaTerm didn't
  launch it; deleting a Docker container; resetting settings to factory; changing Claude Code's
  statusline; deleting themes, recipes, Docker presets and catalog agents;
  switching branches with changes; creating a repo; clearing changes; discarding an edit; closing a tab
  folder) moved to `askConfirm`, with a button that says what it does ("Stop", "Delete",
  "Reset to factory"…). `scripts/sin-confirm.test.mjs` fails if a stray one shows up again.
- Trying it in Bruno's daily use (shortcut "AlphaTerm prueba (paneles).bat").
- With a real agent working (Claude Code) while its pane is moved: tested with `ping`, not with
  an agent.

### Stats
- Tests: Vitest 229 (+23: model 11, session 1, state 1, drag 7, confirmation 3, `confirm()`
  guard 1). No Rust changes.

## Languages: Spanish, English and Portuguese (24/11/2026, branch `i18n`, version 0.7.0)

Bruno's request: AlphaTerm should be fully usable in Spanish, English or Portuguese, with the
documentation, What's new and the API descriptions also in all three, so the repo can be published as
open source.

### What was done
- Foundation (`src/i18n/index.ts`): `t("Spanish text")` translates into the current language (a Solid
  signal: in JSX it updates as soon as the language changes), `k()` marks texts in constants,
  `locale()` for dates and numbers. Dictionaries per area in `src/i18n/en|pt/*.json` with the Spanish
  text as the key. `scripts/i18n-check.mjs` (with a test) checks missing and left-over entries,
  {variables} and conflicts.
- Settings: new "Language" section (first in the list, with 🌐) with Español / English / Português;
  the change applies live in every window. New install: the Windows language; older settings: Spanish.
- Whole interface: 1179 texts translated into English and Portuguese (settings and shortcuts, agents,
  side panels, window and tabs, browser, terminal, usage, Guardian, command suggestions with their
  whole catalog, What's new).
- Rust backend (`src-tauri/src/i18n.rs`): ~195 messages with their three versions (errors, Guardian,
  usage, control API, browser request). `set_locale` from the frontend; read from settings.json at
  startup. New tabs get `ALPHATERM_LANG`.
- Agent scripts: the MCP server (27 tools, ~62 texts), the Guardian hook and the browser overlay, in
  all three languages.
- What's new: the 60 earlier commits translated (`src/i18n/changelog/en|pt.json`, key = subject);
  `changelog.mjs --faltan`, and `release.mjs` stops if a translation is missing.
- Documentation in English and Portuguese (`Documentacion/en|pt`, `CLAUDE.en.md`, `CLAUDE.pt.md`,
  ConPTY notices) and their PDFs (`generar_pdfs.py` now generates per language:
  `python Documentacion/generar_pdfs.py en pt`), README in three languages (with screenshots of
  the English interface), MIT license and third-party notices.
- Work was done in parallel by area (ten agents, each with its own files and dictionaries); the
  integration unified repeated translations and fixed what crossed areas: each panel's shortcut is
  looked up by id (it used to compare labels), and the usage labels, the Guardian decisions and
  "Símbolo del sistema" stay in Spanish as ids and are translated when shown.

### Pending / not verified
- Review of the translations by an English or Portuguese speaker.

### Stats
- Tests: Vitest 241 (+12), cargo 86 ok + 6 ignored (+2). tsc without errors.
