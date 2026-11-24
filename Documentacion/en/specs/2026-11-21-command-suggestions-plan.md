# Command suggestions — implementation plan

> Translated from the Spanish original (`Documentacion/specs/2026-11-21-predicciones-plan.md`). The Spanish version is the source of truth.

> For whoever executes it: tasks in order, with `- [ ]` checkboxes. Branch `predicciones`.

**Goal:** a suggestions menu below the cursor in cmd and PowerShell (folders, history,
our own catalog and completions from the PowerShell session), without touching ↑ or Tab/Enter/Esc outside the menu.

**Architecture:** pure logic in `src/suggest/` (read the line, catalog, engine, keys, insertion,
PowerShell messages), a controller that hooks it to `TerminalView`'s xterm, a menu component,
new commands in `src-tauri/src/suggest.rs` and a PSReadLine handler in `alphaterm.ps1`.

**Technology:** SolidJS 1.9 + xterm 6, Tauri 2 / Rust, PowerShell 5.1 + PSReadLine 2.0, vitest.

**Design:** `Documentacion/en/specs/2026-11-21-command-suggestions.md` (read it together with this plan).

## Global constraints

- All writes to the shell through `PtySession.write` (WriteQueue). Never Ctrl+Alt shortcuts.
- Enter = `String.fromCharCode(13)`; backspace = `"\x7f"` (what xterm sends).
- Only `cmd`, `powershell`, `pwsh` profiles. Cursor at the end of what was typed; a single logical line.
- No shell in the middle for what the app builds (git/docker through the CLI, as today).
- Descriptions and visible texts in Spanish.
- Hidden shortcut: `F12,e` (xterm sends F12 as `\x1b[24~`). Custom OSC `7717`:
  `ESC]7717;ready;<nonce>BEL` and `ESC]7717;c;<nonce>;<base64 of UTF-8 JSON>BEL`.
  JSON: `{"b":buffer,"c":cursor,"i":ReplacementIndex,"l":ReplacementLength,"r":[{"t":CompletionText,"s":ListItemText,"k":ResultType,"d":ToolTip≤200}]}`, up to 100 results.
- Nonce: `ALPHATERM_NONCE` variable that the view sends when launching the shell; the script reads and deletes it.
- Thresholds: ask PowerShell after 150 ms without keys; downgrade the tab to "Ctrl+Space only" if a
  response takes > 300 ms; first word with ≥ 2 letters (≥ 3 to ask PowerShell);
  path arguments with ≥ 1 letter; 8 visible rows; 500 entries per folder; folder cache 3 s.
- Don't close Bruno's AlphaTerm. Interface tests with `CARGO_TARGET_DIR=target\prueba` and its own
  `ALPHATERM_DATA_DIR`/`WEBVIEW2_USER_DATA_FOLDER`.

## Review focus (what can bite the most)

1. Enter with the menu open and not navigated: it must execute, and Enter's `keypress` can't
   slip through when the menu took it (xterm processes `keypress` separately) → test in Task 5.
2. Typed keys that the shell hasn't shown yet when accepting a suggestion → the insertion waits for the
   echo (Task 7).
3. A program or agent running in cmd (launched from the Agents panel, which writes with Enter) →
   the "at the prompt" state turns off with any written Enter (Task 7).
4. Folders with spaces and already-open quotes → Task 6.
5. Stale or fake PowerShell responses (other text with 7717) → nonce and buffer (Task 2).

---

### Task 1: PowerShell handler and a real test through ConPTY (risk 1, goes first)

**Files:** `src-tauri/shell/alphaterm.ps1`, test in `src-tauri/src/pty/mod.rs` (`integration_tests`).

- [ ] Test `powershell_completa_con_f12`: `spawn_env` of `powershell` with `ALPHATERM_NONCE=abc123`
  and a cwd with a known folder; wait for `\x1b]7717;ready;abc123`; write `Get-ChildIt` and
  then `\x1b[24~e`; wait for `\x1b]7717;c;abc123;`, decode the base64 and check
  `b == "Get-ChildIt"`, `c == 11`, and that `r` has `Get-ChildItem`. Second case: `cd ` + shortcut →
  there is at least one `ProviderContainer`. `$env:ALPHATERM_NONCE` must be empty in the session.
- [ ] Run it: it fails (there is no handler).
- [ ] Handler with `Set-PSReadLineKeyHandler -Chord 'F12,e'` (only if PSReadLine exists and there is a nonce),
  `GetBufferState` + `TabExpansion2`, `ConvertTo-Json -Compress -Depth 4`, `[Console]::Write` of the OSC.
  `ready` is emitted at every prompt (inside `prompt`) if the handler was registered.
- [ ] Run it: it passes. **If it doesn't pass through ConPTY, stop and tell Bruno (plan B or no approach 2).**
- [ ] Commit.

### Task 2: PowerShell messages in the frontend

**Files:** `src/suggest/pwsh.ts`, `src/suggest/pwsh.test.ts`.
**Produces:** `parse7717(data: string, nonce: string): PsMsg | null` with
`PsMsg = { type: "ready" } | { type: "completions"; buffer: string; cursor: number; index: number; length: number; results: PsResult[] }`,
`PsResult = { text: string; label: string; kind: string; tip: string }`. `PS_CHORD = "\x1b[24~e"`.

- [ ] Tests: valid ready; different nonce → null; broken base64 → null; JSON with 2 results → mapped fields.
- [ ] Implement and make it pass. Commit.

### Task 3: read the line and split words

**Files:** `src/suggest/line.ts`, `src/suggest/line.test.ts`.
**Produces:**
- `readInput(buf: BufLike, start: { line: number; x: number }, cur: { line: number; x: number }, cols: number): string | null`
  (`BufLike = { getLine(i): { isWrapped: boolean; translateToString(trim: boolean, s?: number, e?: number): string } | undefined }`);
  null if the cursor is before the start or there is a non-wrapped line in the middle.
- `parseLine(line: string): Parsed` with `Parsed = { words: Word[]; current: Word; index: number }`,
  `Word = { raw: string; value: string; start: number; quote: '"' | "'" | null; closed: boolean }`
  (the current one is empty with `start = line.length` if the line ends in a space outside quotes).

- [ ] Tests: `"cd "` → empty current at index 1; `cd "Mis Doc` → value `Mis Doc`, quote `"`, closed false;
  `cd 'a b\'` → value `a b\`, closed true; line wrapped over 2 rows; non-wrapped row in the middle → null.
- [ ] Implement and make it pass. Commit.

### Task 4: suggestions backend (Rust)

**Files:** `src-tauri/src/suggest.rs` (new), `src-tauri/src/lib.rs` (register).
**Produces (commands):**
- `suggest_list_dir(cwd: String, dir: String, dirs_only: bool, hidden: bool) -> Vec<DirEntry { name, dir }>`:
  `dir` relative to `cwd`, absolute or with `~`; `\\…` → empty; max 500, case-insensitive alphabetical order, 3 s cache.
- `suggest_gateway() -> Option<String>`: `GetBestRoute` toward 8.8.8.8, next IPv4 hop (60 s cache).
- `suggest_path_commands() -> Vec<String>`: executables of the full PATH (`agents::agents_path_env()`),
  `PATHEXT` extensions + `.ps1`, without extension and without repeats, 60 s cache.
- `suggest_npm_scripts(cwd: String) -> Vec<(String, String)>`: `scripts` from `package.json`.
- `suggest_processes() -> Vec<String>`: process names (sysinfo), without repeats.

- [ ] Tests (`cargo test suggest`): temp folder with `a/`, `B/`, `c.txt`, `.oculta/` → order and filters;
  `~` and `..`; empty network path; `package.json` with 2 scripts; gateway returns a valid IPv4 or None.
- [ ] Implement and make it pass. Commit.

### Task 5: menu keys

**Files:** `src/suggest/keys.ts`, `src/suggest/keys.test.ts`.
**Produces:** `menuKey(e: KeyLike, st: { open: boolean; navigating: boolean; enabled: boolean }): MenuKey`
with `MenuKey = "pass" | "up" | "down" | "accept" | "close" | "open" | "toShell"` (`toShell` = close and let it through).
`KeyLike` from `src/terminal/keys.ts`.

- [ ] Tests: the full key table from the design; Ctrl+Space with `enabled: false` → pass;
  Ctrl+Alt+anything → pass; `keypress`/`keyup` → pass (the controller swallows it, Task 7).
- [ ] Implement and make it pass. Commit.

### Task 6: catalog, engine and insertion

**Files:** `src/suggest/catalog.ts`, `src/suggest/engine.ts`, `src/suggest/insert.ts` and their `.test.ts`.
**Produces:**
- `CmdSpec = { names: string[]; desc: string; shells?: Shell[]; subs?: CmdSpec[]; opts?: Opt[]; args?: ArgSource }`,
  `Opt = { name: string; desc: string; arg?: ArgSource }`, `ArgSource = GenName | Value[]`,
  `GenName = "folders" | "paths" | "hosts" | "gitBranches" | "gitRemotes" | "npmScripts" | "dockerContainers" | "dockerImages" | "processes"`,
  `Value = { v: string; desc?: string }`, `Shell = "cmd" | "ps"`. `findSpec(name, shell): CmdSpec | null`
  (case-insensitive, without `.exe`). Command list from the design.
- `Suggestion = { insert: string; label: string; desc?: string; kind: Kind; score: number; replace: "word" | "line"; dir?: boolean; hits?: number[] }`,
  `Kind = "folder" | "file" | "history" | "command" | "option" | "value" | "pwsh"`.
- `Sources = { listDir(dir: string, dirsOnly: boolean, hidden: boolean): Promise<{ name: string; dir: boolean }[]>; history(): Promise<HistEntry[]>; pathCommands(): Promise<string[]>; gen(name: GenName, cwd: string): Promise<Value[]> }`.
- `analyze(p: Parsed, shell: Shell): Analysis` (first word or argument, command, spec, argument
  source, whether it is worth asking PowerShell, whether it shows up on its own) and
  `collect(a: Analysis, ctx: { line: string; cwd: string; shell: Shell }, src: Sources, ps?: PsMsg): Promise<Suggestion[]>`
  with the design's filtering, order and no repeats. History filtered by shell (`shell` containing
  "PowerShell" → ps; "Símbolo" or "cmd" → cmd; null → both).
- `insertion(line: string, s: Suggestion, cur: Word, shell: Shell): string`: backspaces + text; quotes
  if needed (`"` in cmd, `'` in PowerShell); folder → ends in `\`; anything else → space; `line` →
  deletes the whole line. For PowerShell results, backspaces = `cursor - index`.

- [ ] Tests: `ping ` → 8.8.8.8 and `-t` (with a fake `gen`); `cd al` with fake folders → only folders,
  first the ones that start with "al"; `git checkout ` → branches; `git p` with history → `git push origin main`
  first, with a higher score if from the same folder; cmd history doesn't show in ps; `Get-Ch` in ps →
  analysis asks PowerShell, `cd x` in ps → no; PowerShell results + local folders without repeats;
  insertion of `Mis Documentos` in cmd → `"Mis Documentos\"`, in ps → `'Mis Documentos\'`; replacement of a
  word with closed quotes; history line → deletes everything.
- [ ] Implement and make it pass. Commit.

### Task 7: controller, menu and hooking it to the terminal

**Files:** `src/suggest/controller.ts`, `src/suggest/SuggestMenu.tsx`, `src/suggest/generators.ts`,
`src/terminal/TerminalView.tsx`, `src/layout/Workspace.tsx`, `src/styles.css`, `src/browser/marks.ts`.
**Produces:** `createSuggest(o: { term: Terminal; profileId: string; write(s: string): void; cwd(): string | undefined; settings(): SuggestSettings; patchCmdCommand(line: string): void }): SuggestCtl`
with `SuggestCtl = { onPromptEnd(): void; onCommandStart(): void; onParsed(): void; onWrite(data: string): void; key(e: KeyboardEvent): boolean; onOsc7717(data: string): boolean; nonce: string; menu: Accessor<MenuView | null>; pick(i: number): void; dispose(): void }`.

- [ ] `TerminalView`: a single `write()` for everything that goes to the shell (onData, `send`, `runStartup`)
  that notifies `onWrite`; `ALPHATERM_NONCE` in the env when launching; `registerOscHandler(7717)`; `key()`
  before `props.match`; swallow the `keypress` that follows a taken key; render `<SuggestMenu>`.
- [ ] cmd: Enter at the prompt with a non-empty line → `running = true` + `patch({ lastCommand, running: true })`.
- [ ] The design's "at the prompt" state; pending echo: if something was typed after the last `onWriteParsed`,
  the insertion waits for the next one (max 300 ms).
- [ ] Request to PowerShell: 150 ms debounce, never after Tab/Ctrl+R/F keys, measure and downgrade.
- [ ] `.suggest-menu` in `FLOATING`; styles with the theme variables.
- [ ] `npx tsc --noEmit` and `npx vitest run` pass. Commit.

### Task 8: settings

**Files:** `src/settings/schema.ts`, `src/settings/SettingsView.tsx`, `src/settings/settings.test.ts`.
**Produces:** `SuggestSettings = { enabled: boolean; mode: "auto" | "manual"; pwsh: boolean }` in
`Settings.terminal.suggest` (default `{ enabled: true, mode: "auto", pwsh: true }`).

- [ ] Test: normalize of an old settings without `suggest` → default values; invalid values → default.
- [ ] Implement, rows in "Terminal and interface", make it pass. Commit.

### Task 9: real test, report and build for Bruno

- [ ] `cargo test`, `npx vitest run`, `npx tsc --noEmit`.
- [ ] Build `npx tauri build --no-bundle` with `CARGO_TARGET_DIR=target\prueba`; open it with its own data and
  CDP; test in cmd and PowerShell: `cd ` with folders, `ping `, ↑ intact, `Get-Ch` with cmdlets, no
  menu inside a program, cmd history saved. Screenshots.
- [ ] A shortcut so Bruno can try that build with a copy of his settings and history.
- [ ] Entry in `Documentacion/en/Process_Report.md` (what is unverified, marked). Commit.
- [ ] If Bruno approves: merge into `main` and `compilar-version.bat --minor` (0.5.0). If not: go back to `main`
  and delete the branch (with his permission).
