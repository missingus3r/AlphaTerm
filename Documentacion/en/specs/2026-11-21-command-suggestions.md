# Command suggestions in the terminal — design

> Translated from the Spanish original (`Documentacion/specs/2026-11-21-predicciones-de-comandos.md`). The Spanish version is the source of truth.

Date: 21/11/2026. Status: draft for approval.

## Why

Bruno wants AlphaTerm to suggest what to type while he types in cmd or PowerShell: with `cd`,
the folders of where he is standing; with `ping`, the typical IPs and hosts; and the same for the other
commands. What he explicitly asked for: "a predictive command system in the shell, keeping
the history if I press up, and a menu of possible folders from where I'm standing
to show up if I type cd".

Our own reading (he didn't say it): the value is in typing less of the everyday commands
(history, folders) and in not having to remember the syntax of the ones he rarely uses (a catalog with
explained options).

## Goals

- A menu that appears below the cursor while typing at the **cmd** and
  **PowerShell (5.1 and 7)** prompt, with suggestions for the command and for its arguments.
- `cd ` immediately shows the folders of the current folder (and `..`), filtered by what is
  being typed; when you pick one you can keep going down (`cd src\` → subfolders of `src`).
- Prediction from history: if what is typed is the beginning of an already used command
  (`git p` → `git push origin main`), it shows up as a suggestion, with priority if it was in this folder.
- Typical values per command from our own catalog (e.g. `ping` → 8.8.8.8, 1.1.1.1, the router,
  localhost, google.com and the hosts that were already used).
- In PowerShell, also what the shell itself knows (all cmdlets, their parameters, installed
  modules, variables, paths) by asking the open session for the completions.
- The up arrow is still the shell's history, as it is today.

## Non-goals (v1)

- Git Bash, WSL and custom profiles: no menu (the foundation is left ready to add them later).
- Gray prediction next to the cursor (fish/Warp style). It was discarded as an approach; it can
  be added later.
- Suggestions inside programs running in the terminal (Claude Code, Codex, python, ssh…).
- Using PSReadLine's predictions or updating PSReadLine.
- Importing third-party catalogs (e.g. Fig's specs): the catalog is our own and in Spanish.
- Cursor in the middle of the line: the menu only appears with the cursor at the end of what was typed.

## Anti-goals (if this happens, it failed even if it "works")

- The up arrow no longer bringing up the history when one isn't navigating the menu.
- The menu appearing or AlphaTerm sending keys while a program or an agent is running.
- Typing feeling slower or keys getting reversed (known gotcha: everything goes through
  `WriteQueue`).
- Esc, Tab or Enter doing something different from usual when the menu isn't open.
- The menu covering the built-in browser (nothing in the interface can cover the child WebView2).

## What already exists and constrains the design

- Shell integration (`src-tauri/shell/alphaterm.ps1`, `src-tauri/src/pty/integration.rs`):
  PowerShell emits OSC 133 A/B/C/D, 633;E (command text) and OSC 7 (folder). cmd only has the
  PROMPT variable: 133;D with no code, 9;9 with the folder, 133;A/B around the prompt. **cmd doesn't
  say which command was run or when it starts.**
- `TerminalView.tsx` parses those marks (`parse133`, `parse633`, `parseOsc7/9`), knows the current
  folder (`cwdNow`), whether a command is running (`running`) and whether the shell has integration.
  Keys go from `term.onData` straight to `session.write` (with `WriteQueue`); shortcuts are
  intercepted in `attachCustomKeyEventHandler`.
- History: `history.rs` (`history_add`, `history_search`), in `%APPDATA%\AlphaTerm\history.jsonl`.
  It is fed by `Workspace.tsx` when a tab goes from `running` to not `running` with a
  `lastCommand`. Today it only has PowerShell commands.
- The home PowerShell 5.1 ships PSReadLine 2.0.0 (no predictions of its own).
- Built-in browser: new menus go in `FLOATING` (`src/browser/marks.ts`) so that the
  WebView2 hides if they overlap it.
- Settings: schema in `src/settings/schema.ts`, view in `SettingsView.tsx`.
- Git and Docker through the CLI, with no shell in the middle (`git.rs`, `docker.rs`).

## Approaches considered

1. **Our own menu with our own sources**: AlphaTerm reads the line from the screen and builds the options
   from folders/files, history and a hand-written catalog. The same in cmd and PowerShell; the
   catalog covers the common commands, not "all" of them.
2. **Ask PowerShell**: like VS Code, a hidden keyboard shortcut makes the open session
   run `TabExpansion2` and return the completions through an invisible sequence. It knows everything
   about PowerShell; it only works in PowerShell and requires care to keep in sync with what was typed.
3. **A gray prediction** next to the cursor: quick for repeating, but it doesn't give the list of
   folders. Discarded as the main approach.
- Also discarded: enabling the predictions of a newer PSReadLine (PowerShell only, history only,
  no folders).
- Variant evaluated for 2: a separate hidden PowerShell to ask. It doesn't need to
  send keys, but it doesn't know the session's contents (variables, functions, loaded modules) and adds a
  process (~60–80 MB, with the RAM goal already unmet). It stays only as plan B if the
  hidden shortcut doesn't work through ConPTY.

**Chosen by Bruno: 1 + 2.** Number 1 is the base in both shells; in PowerShell, the session's own
completions are added.

## How it works

### When it can be shown ("at the prompt" state)

A tab is *at the prompt* if all of this holds:
- the profile is `cmd`, `powershell` or `pwsh`, and at least one 133;B arrived (integration alive);
- after the last 133;B no Enter was sent to the shell. Any Enter counts: a key,
  an Agents panel command, the History `send`, pasted text with a line break. The check
  goes in a single place that all of the tab's writes pass through, not just in `onData`;
- the alternate buffer is not active (`term.buffer.active.type !== "alternate"`);
- `running` is false.

The state is set back to true with the next 133;B. If it isn't at the prompt, the menu
closes and AlphaTerm sends nothing to the shell.

### Reading what is being typed

- When 133;B arrives, the exact position where the prompt ends is saved: an xterm line
  marker plus `cursorX` at that moment (the OSC handler runs synchronously with parsing, so the
  cursor is there).
- After every write from the shell (`onWriteParsed`), the current line is built: the text from
  that position **up to the cursor**, joining wrapped lines (`isWrapped`). Whatever is
  after the cursor is ignored.
- If the cursor isn't at the end of what was typed, or the input has more than one logical line
  (PowerShell's `>>` continuation), there is no menu.
- The line is split into words respecting quotes. The current word is the one the cursor touches.
  It is used to know whether the command (first word) or an argument is being completed, and for which command.

### Suggestion sources

Each suggestion has: text to insert, visible label, a short description in Spanish, type
(folder, file, history, command, option, value, PowerShell) and score.

1. **Folders and files** (Rust, new command): lists the folder that what was typed points to,
   relative to the current folder or absolute (`C:\`, `..\`, `~`). Folders only for `cd`, `pushd`,
   `mkdir` and `rd`; folders and files for the rest. Up to 500 entries, with a short cache per
   folder (a few seconds). Hidden or system ones are skipped, unless what was typed starts with `.`.
2. **History**: the commands that start with the typed line, with more weight if they were used in this
   folder and if they are recent or frequent. Also the arguments already used with the same command
   (e.g. earlier `ping`/`ssh`/`tracert`/`curl` hosts).
   - **cmd history (new)**: when Enter is sent while at the cmd prompt, the line is
     read and `patch({ lastCommand, running: true })` is done. The next prompt's 133;D already sets
     `running: false`, so `Workspace.tsx` saves it as it does today (empty exit code,
     because cmd doesn't provide one).
3. **Our own catalog** (`src/suggest/catalog/`, TypeScript): per command, description, subcommands,
   options (with their explanation) and arguments with value *generators*. Each entry is marked
   for cmd, PowerShell or both (e.g. `dir /s` cmd only). Initial list:
   - files: cd, dir/ls, mkdir/md, rmdir/rd, del/rm, copy/cp, move/mv, ren, type/cat, tree,
     start, explorer, code, notepad;
   - network: ping, tracert, nslookup, ipconfig, netstat, arp, curl, ssh, scp;
   - system: tasklist, taskkill, where, set, echo, cls, exit, shutdown, systeminfo, whoami, sfc,
     chkdsk, winget, wsl;
   - development: git, npm, npx, node, python/py, pip, docker, cargo, claude, codex, agy, opencode.

   Generators with live data, all with no shell in the middle:
   - hosts: 8.8.8.8 (Google DNS), 1.1.1.1 (Cloudflare), the network's gateway (the router,
     from Rust), 127.0.0.1/localhost, google.com, plus the hosts from history;
   - git branches and remotes (git CLI, like `git.rs`);
   - the folder's `package.json` scripts (`npm run …`);
   - Docker containers and images (CLI, like `docker.rs`), only if Docker responds quickly;
   - processes for `taskkill /IM` (names of the open processes).
4. **Command names**: for the first word, the catalog, the history and the executables on the
   PATH (`.exe`, `.cmd`, `.bat`, `.ps1` in PowerShell; cached list, `agents_path_env` can be
   reused). In cmd also its built-in commands.
5. **PowerShell (approach 2)**: see below.

### Completions from the PowerShell session itself

- `alphaterm.ps1` registers, if PSReadLine exists, a two-key shortcut that nobody uses (proposal:
  `F12,e`; the builder can change it) with `Set-PSReadLineKeyHandler`. When it arrives:
  1. it reads the buffer and the cursor with `[Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState`;
  2. it runs `TabExpansion2 -inputScript $buffer -cursorColumn $cursor`;
  3. it writes with `[Console]::Write` an invisible OSC of its own with a base64 JSON: the buffer and
     cursor used, `ReplacementIndex`, `ReplacementLength` and up to 100 results (text, label,
     type, tooltip);
  4. it doesn't touch the buffer or the screen.
- On load, the script announces with another OSC that the shortcut is available. Without that announcement, AlphaTerm
  never sends it.
- AlphaTerm sends the shortcut sequence through the tab's `WriteQueue` only if it is *at the
  prompt*, the session announced that it has it, and ~150 ms went by without keys.
- The response is discarded if its buffer doesn't match the line read at that moment (a
  stale response). Local sources are shown right away; PowerShell's get mixed in when they arrive.
- **Careful, it slows typing while it runs**: PSReadLine's handler runs on the same thread that draws
  what is typed, so while `TabExpansion2` works the keys pile up (they aren't lost,
  they show up together at the end). Measured on the home PowerShell 5.1 (`-NoProfile`, 21/11/2026):
  the first call takes 100–150 ms; after that, `Get-` 55–70 ms, `cd ` 35–50 ms, `git `/`ping `
  ~30 ms, `cd A` 3 ms, parameters (`Get-ChildItem -`) ~1 ms. It is on the order of a keystroke, but so as
  not to ask for more than needed:
  - it isn't requested if the command is in the catalog (its results would be ignored anyway);
  - it isn't requested for network paths (`\\server\…`) or for a first word with fewer than 3 letters;
  - AlphaTerm measures how long each response takes in that tab; if one goes over 300 ms, that tab
    stops asking on its own and only asks with Ctrl+Space (flagged with a tooltip in the menu);
  - no "warm-up" when the shell starts (it would worsen the first prompt, whose goal is already unmet).
- For commands that aren't PowerShell's (e.g. `ping`), `TabExpansion2` returns files from the
  folder: if the command is in the catalog, the catalog rules and PowerShell isn't asked.

### Merging and order

- It filters by the current word case-insensitively: first what starts the same, then
  what contains it. The matching letters are highlighted.
- First word: full-line history > catalog > PowerShell (cmdlets, aliases,
  functions) > PATH.
- Arguments: if the command is in the catalog, its values and options plus that command's
  history; if not, PowerShell's; folders and files whenever the argument is a path.
- No duplicates (the same text to insert appears only once, with the heaviest-weighted source).

### The menu

```
PS C:\Users\Br1\desktop> cd al█
                           ┌────────────────────────────────────────┐
                           │ ▸ 📁 AlphaTerm\                 folder │
                           │   📁 aa-disney\                 folder │
                           │   📁 aa-netflix\                folder │
                           │   🕘 cd AlphaTerm\src  yesterday, here │
                           └────────────────────────────────────────┘

C:\Users\Br1> ping █
              ┌──────────────────────────────────────────┐
              │ ▸ 8.8.8.8           Google DNS           │
              │   1.1.1.1           Cloudflare DNS       │
              │   192.168.1.1       your router          │
              │   localhost         this PC              │
              │   -t                until Ctrl+C         │
              └──────────────────────────────────────────┘
```

- An absolute `div` inside the terminal pane, aligned to the column where the word starts,
  below the cursor line (above if it doesn't fit). The cell size is computed from the pane and
  `cols/rows`. Up to 8 visible rows with scroll. It respects the terminal's theme.
- Its class is added to `FLOATING` in `src/browser/marks.ts`.
- It closes when the terminal loses focus, when switching tabs, with Esc or if it stops being at the prompt.

### Keys (proposal, design decision)

With the menu open there is always a highlighted row (the first one, in a soft tone):

| Key | Menu open, not navigated | Menu open, navigating (after ↓) | Menu closed |
|---|---|---|---|
| ↑ | closes the menu and passes to the shell (history) | goes up; from the first row it stops navigating | shell |
| ↓ | starts navigating (down one row) | goes down | shell |
| Tab | inserts the highlighted one | inserts the highlighted one | shell (the usual Tab) |
| Enter | passes to the shell (runs what was typed) | inserts the highlighted one (doesn't run) | shell |
| Esc | closes the menu (doesn't reach the shell) | closes the menu | shell |
| Ctrl+Space | — | — | opens the menu by hand |

- The menu appears on its own: right after the space in commands with known arguments
  (`cd `, `ping `, `git `), with 1 letter in path arguments, and with 2 letters for the first
  word, as long as there are matches. The thresholds stay in adjustable constants.
- Intercepting the keys goes in `attachCustomKeyEventHandler`. It is added before the shortcut check
  only when the menu is open, and never with Ctrl+Alt (AltGr).
- **Ctrl+Space in PowerShell** is today PSReadLine's `MenuComplete` (Windows edit mode, Bruno's).
  Our own decision: with suggestions on, AlphaTerm takes it, because its menu
  shows the same PowerShell completions and the others besides. With suggestions
  off, Ctrl+Space reaches PSReadLine again as always. In cmd it does nothing today.
- The menu opens only after typed characters, not after bringing up a line with ↑/↓ or after the
  shell's own Tab (so ↓ and PSReadLine's Tab cycle keep working).
- The hidden shortcut is never sent right after Tab, Ctrl+R or other PSReadLine keys
  that wait for a second key.

### Inserting a suggestion

- The current word is replaced: as many backspaces are sent as characters of that word
  were typed and then the new text, all through the `WriteQueue`. In PowerShell, with a result from
  `TabExpansion2`, the part to replace is `ReplacementIndex/Length` (it has to end at the cursor).
- Paths with spaces go in quotes (`"…"` in cmd, whatever `TabExpansion2` returns or `'…'` in
  PowerShell). If the word already opened quotes, they are respected.
- If a folder was inserted, it ends in `\` and the menu opens again with its subfolders. If
  it was something else, it ends in a space and the menu closes.
- A chosen history line replaces the whole line (and doesn't run).

### Settings

In `schema.ts` + `SettingsView.tsx`, terminal section:
- "Command suggestions": on (default) / off.
- "Show": while typing (default) / only with Ctrl+Space.
- "Ask PowerShell for completions": yes (default) / no.

## Risks: verify first

1. **The hidden shortcut through ConPTY**: that the F12 sequence AlphaTerm writes reaches
   PSReadLine 2.0 as `F12,e`, that the handler runs and that the response OSC reaches
   xterm without dirtying the screen. If it doesn't work, plan B (a separate hidden PowerShell) is used or
   2 is left out, and Bruno is told before going on.
2. **Reading the line**: that the 133;B position plus the cursor give the right line in both shells,
   with PSReadLine's redraws and with wrapped lines.
3. **Inserting with backspaces**: that it works in cmd and in PSReadLine without leaving junk on the screen.

These three go first in the plan, before building the rest.

## Review decisions (made, not Bruno's)

- The new cmd `running: true` also feeds the tab's state, the agents' and the
  Servers panel: that is the intent (today cmd never says that something is running).
- History suggestions are filtered by shell (cmd and PowerShell syntax differ).
- Before inserting, the sent keys that the shell hasn't shown yet are counted, so that the
  backspaces don't delete what they shouldn't.
- The "shortcut available" announcement is only accepted from a PowerShell profile and with a per-
  session code that AlphaTerm passes to the script, so that no other program's output can imitate it.

## What is left for whoever builds it

- The exact scoring algorithm (recency, frequency, folder) and the appearance thresholds.
- File structure inside `src/suggest/` and names of the new Rust commands.
- The number of the custom OSC and the exact JSON format.
- How to get the gateway in Rust (Windows API or routing table).
- Icons and style of the menu, within the current theme.
- The content of each catalog entry (options and descriptions in Spanish).

## How it is considered done

- Tests: `npx vitest run` (splitting words, reading the line, merging and order, key state
  machine, catalog generators), `cargo test` (listing folders, gateway, cache) and
  `npx tsc --noEmit`.
- Real test in a test AlphaTerm (`CARGO_TARGET_DIR=target\prueba`, its own `ALPHATERM_DATA_DIR` and
  `WEBVIEW2_USER_DATA_FOLDER`, CDP), **without closing Bruno's AlphaTerm**: `cd` with
  folders in cmd and PowerShell, `ping`, history with ↑ intact, PowerShell cmdlets, no
  menu inside Claude Code, and cmd now saving history.
- Record in `Documentacion/en/Process_Report.md`, marking what is unverified.
- New version with `compilar-version.bat --minor` (0.5.0).
