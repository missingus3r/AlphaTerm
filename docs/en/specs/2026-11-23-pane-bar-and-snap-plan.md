# Panes: bar with buttons and moving as snap — implementation plan

> Translated from the Spanish original (`docs/es/specs/2026-11-23-pane-bar-and-snap-plan.md`). The Spanish version is the source of truth.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bar with split/close on each pane, a right-click menu, moving panes by dragging (halves or swap) and dividers that stop at ⅓, ½, ⅔.

**Architecture:** All in the frontend (no Rust changes). The operations on the pane tree and the zone geometry are pure functions in `src/layout/model.ts` with tests; the bar and the menu are a new component (`PaneBar.tsx`); dragging is a pointer-event controller (`paneDrag.ts`) that Workspace connects to the model. Moving = changing the tree; panes are still iterated by id, so no terminal gets re-created.

**Tech Stack:** SolidJS 1.9 + TypeScript, Vitest, Tauri 2 (untouched), xterm 6.

**Spec:** `docs/en/specs/2026-11-23-pane-bar-and-snap-design.md`

## Global Constraints

- No changes in `src-tauri` (Rust). Working branch: `paneles`, from `main`.
- Terminal panes: they are iterated by id and positioned by rectangles. Never wrap `TerminalView` in something that can be re-mounted when the tree changes (it kills the shell and the agent).
- Nothing in the interface can cover the browser's WebView2: floating things go in `FLOATING` (`src/browser/marks.ts`); during a drag the body's `resizing` class is used, which already hides it.
- Right-click inside the terminal is still copy/paste; the new menu goes on the small bar.
- Don't change or remove existing shortcuts. Nothing with Ctrl+Alt.
- Interface texts in Rioplatense Spanish, with this plan's exact texts.
- Solid: in menus, apply the action before closing it (the `act` pattern from `TabBar.tsx`); in effects that read and write, `untrack`/`on`.
- Don't close Bruno's AlphaTerm. Interface tests go in a separate instance (see Task 6). Rust is outside the PATH: prepend `~/.cargo/bin`.
- The `.bat` files, with CRLF.

## Review Focus

1. Dragging over a browser pane: the WebView2 hides during the drag and shows again when dropped or canceled (Task 4, CDP test).
2. The drag gets cut without `pointerup` (leaves the window, `pointercancel`, the window loses focus): the body can't be left with `resizing` and the panes not receiving clicks (Task 4, CDP test with `blur`).
3. A click on ⇥, ⤓ or ✕ doesn't start a drag nor does the threshold trigger it (Task 3/4, CDP test).
4. "Close pane" from the menu with a command running also asks, just like ✕ (Task 3, CDP test).
5. A moved layout survives closing and reopening (session) (Task 1, session test).

---

### Task 1: move, swap and equalize in the model

**Files:**
- Modify: `src/layout/model.ts`
- Test: `src/layout/model.test.ts`, `src/layout/session.test.ts`

**Interfaces:**
- Produces:
  - `export type DropZone = "left" | "right" | "top" | "bottom" | "center"`
  - `movePane(l: Layout, tabId: string, paneId: string, targetId: string, zone: DropZone): Layout`
  - `swapPanes(l: Layout, tabId: string, aId: string, bId: string): Layout`
  - `equalize(l: Layout, tabId: string): Layout`

- [ ] **Step 1: create the branch** — `git switch -c paneles` in `Desktop\AlphaTerm`.
- [ ] **Step 2: failing tests** in `model.test.ts`, `describe("mover paneles")`:
  - "to the left of another": A|B (`splitPane` row), `movePane(l, t, B, A, "left")` → `leaves` = `[B, A]`, `root.dir === "row"`, `root.ratio === 0.5`, `activePane === B`.
  - "bottom with three panes": A | (B over C); move A to `"bottom"` of C → `leaves` = `[B, C, A]`; `paneRects(root).get(A)` ≈ `{ x: 0, y: 0.75, w: 1, h: 0.25 }` (`toBeCloseTo`).
  - "the center swaps and doesn't touch proportions": A|B|C with `setRatio` 0.3 on the root; `movePane(..., A, C, "center")` → `leaves` = `[C, B, A]` and the root still has `ratio === 0.3`.
  - "onto itself, with a single pane or with ids that don't exist changes nothing": the result is the same reference (`toBe(l)`).
  - "moving doesn't create panes": after moving, `findLeaf(root, B.id)` is `toEqual` to the original leaf (same id, profile, folder, startup).
  - "equalize": A | (B | C) with factory proportions → `equalize` → the three widths in `paneRects` ≈ 1/3; A | (B over C) → widths of A and B ≈ 0.5, and B and C with height ≈ 0.5.
- [ ] **Step 3: failing session test** in `session.test.ts`: "saves the moved layout": A|B, `movePane(B → "left" of A)`, `restore(JSON.parse(JSON.stringify(serialize(l, () => undefined))), opts)` → `leaves` = `[B, A]`.
- [ ] **Step 4: run** `npx vitest run src/layout` → FAIL (undefined functions).
- [ ] **Step 5: implement** in `model.ts`. `movePane`: with `"center"` it calls `swapPanes`; otherwise, `removeLeaf` of the pane and `replaceNode` of the target by a new split (`newId("s")`, ratio 0.5): `left` → row, a = moved; `right` → row, b = moved; `top` → column, a = moved; `bottom` → column, b = moved. The moved one stays active. `swapPanes`: swaps the two leaves' places in the tree (the splits stay the same). `equalize`: each split takes `ratio = n(a) / (n(a) + n(b))`, where n counts panes along its axis: leaf = 1; split on the same axis = sum; on the other axis = maximum. Clamp to [0.1, 0.9] like `setRatio`.
- [ ] **Step 6: run** `npx vitest run src/layout` → PASS.
- [ ] **Step 7: commit** "Panes: move, swap and equalize in the model".

### Task 2: zone geometry, divider snapping and busy pane

**Files:**
- Modify: `src/layout/model.ts`, `src/panels/agentState.ts`
- Test: `src/layout/model.test.ts`, `src/panels/agentState.test.ts`

**Interfaces:**
- Consumes: `DropZone`, `Rect` (Task 1 / existing).
- Produces:
  - `paneAt(rects: Map<string, Rect>, fx: number, fy: number): string | undefined` — the pane whose rectangle contains the point (same units).
  - `dropZone(r: Rect, fx: number, fy: number): DropZone` — center if `|u-0.5| <= 0.2 && |v-0.5| <= 0.2` (u, v = relative position inside `r`); otherwise, the nearest edge.
  - `zoneRect(r: Rect, zone: DropZone): Rect` — the half of the side; `center` = the whole `r`.
  - `export const SNAP_POINTS = [1 / 3, 1 / 2, 2 / 3]` and `snapRatio(ratio: number, extentPx: number, thresholdPx = 12): number` — the nearest point if it is within `<= thresholdPx` pixels; otherwise, `ratio`.
  - `paneBusy(p: AgentPaneInfo): boolean` in `agentState.ts` = `!p.exited && agentRunning(p)`.

- [ ] **Step 1: failing tests**:
  - `dropZone` with `{x:0,y:0,w:1,h:1}`: (0.05, 0.5) → left; (0.95, 0.5) → right; (0.5, 0.05) → top; (0.5, 0.95) → bottom; (0.5, 0.5) and (0.6, 0.62) → center. With `{x:0.5,y:0,w:0.5,h:1}`: (0.55, 0.5) → left.
  - `zoneRect({x:0,y:0,w:1,h:1}, "right")` → `{x:0.5,y:0,w:0.5,h:1}`; `"top"` → `{x:0,y:0,w:1,h:0.5}`; `"center"` → the same one.
  - `paneAt`: two rectangles side by side; (0.75, 0.5) → the second; (1.5, 0.5) → `undefined`.
  - `snapRatio(0.49, 800)` → 0.5; `snapRatio(0.47, 800)` → 0.47; `snapRatio(0.34, 600)` → 1/3; `snapRatio(0.9, 1000)` → 0.9.
  - `paneBusy`: integrated and running → true; integrated and idle → false; no integration with `fgProcess: "ping"` → true; `exited: true` with `running: true` → false.
- [ ] **Step 2: run** `npx vitest run src/layout src/panels/agentState.test.ts` → FAIL.
- [ ] **Step 3: implement** the five functions with those signatures.
- [ ] **Step 4: run** the same → PASS.
- [ ] **Step 5: commit** "Panes: drop zones, divider snapping and busy pane".

### Task 3: bar with split and close, and the right-click menu

**Files:**
- Create: `src/layout/PaneBar.tsx`
- Modify: `src/layout/Workspace.tsx`, `src/browser/BrowserView.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `paneBusy` (Task 2), `equalize` (Task 1), `SplitDir`.
- Produces:
  - `PaneBar(props: { title: string; highlight: boolean; onSplit: (dir: SplitDir) => void; onClose: () => void; onGrab: (e: PointerEvent) => void; onMenu: (e: MouseEvent) => void })`
  - `PaneMenu(props: { x: number; y: number; onSplit: (dir: SplitDir) => void; onEqualize: () => void; onClose: () => void; onDismiss: () => void })` — uses the `.ctx-menu` class (already in `FLOATING`), closes on an outside click or Esc, applies the action before closing.
  - In Workspace: `splitAt(tabId: string, paneId: string, dir: SplitDir | "auto")` (the current body of `doSplit`, which now calls it with the active pane), `askClose(tabId: string, paneId: string)`, `paneLabel(paneId: string): string` (comes from `targetsOf`, which now uses it).
  - BrowserView: new optional props `onSplit?: (dir: SplitDir) => void`, `onGrab?: (e: PointerEvent) => void`, `onMenu?: (e: MouseEvent) => void`.

- [ ] **Step 1: `PaneBar.tsx`** with the bar: title (with ellipsis) on the left and three `icon-btn`: `⇥` title "Split right", `⤓` "Split down", `✕` "Close pane". The buttons cut `pointerdown` (`stopPropagation`) so as not to start a drag. `pointerdown` on the bar → `onGrab`; `contextmenu` → `onMenu` (with `preventDefault`). `highlight` class when the pane is focused and there are 2 or more.
- [ ] **Step 2: `PaneMenu`** in the same file with the items, in this order: "Split right", "Split down", "Equalize sizes", "Close pane" (class `danger`).
- [ ] **Step 3: Workspace.** The terminal `.pane` becomes `<PaneBar/>` + `<div class="pane-body"><TerminalView …/></div>` (same `For` by id, with no other level that gets re-mounted). `onGrab` for now only focuses the pane. `askClose`: if `paneBusy(panes[paneId])`, `confirm("Close this pane? Whatever is running in it will be stopped (" + paneLabel(paneId) + ").")`; otherwise, it closes directly. ✕ and "Close pane" use `askClose`; Ctrl+Shift+W still uses `closePane` directly. "Equalize sizes" → `M.equalize`. Signal `paneMenu: { x; y; tabId; paneId } | null` with the position clamped to the window as in `TabBar`.
- [ ] **Step 4: BrowserView.** At the start of `.bp-bar`: `<span class="bp-grip" title="Drag to move the pane">⋮⋮</span>` with `onPointerDown={props.onGrab}` and `onContextMenu={props.onMenu}`; before the ×, the ⇥ and ⤓ buttons (`props.onSplit`). Workspace passes them in (closing the browser doesn't ask).
- [ ] **Step 5: CSS.** `.pane-bar`: on top, 22 px high, `var(--bar)`, bottom border `var(--line)`, text 11.5 px `var(--muted)`, `cursor: grab`; `.pane-bar.highlight`: text `var(--text)` and a 2 px line on top with `var(--accent)`. `.pane-body`: `position: absolute; top: 22px; left: 0; right: 0; bottom: 0`. `.bp-grip`: `cursor: grab`, `var(--muted)`.
- [ ] **Step 6: verify** `npx tsc --noEmit` and `npx vitest run` → no errors, all PASS.
- [ ] **Step 7: commit** "Panes: bar with split and close, and the right-click menu".

### Task 4: move panes by dragging the bar

**Files:**
- Create: `src/layout/paneDrag.ts`
- Modify: `src/layout/Workspace.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `paneAt`, `dropZone`, `zoneRect` (Task 2), `movePane` (Task 1), `onGrab` of PaneBar/BrowserView (Task 3).
- Produces: `export const DRAG_THRESHOLD_PX = 5` and `startPaneDrag(o: { e: PointerEvent; container: HTMLElement; paneId: string; rects: () => Map<string, Rect>; onHover: (h: { target: string; zone: DropZone } | null) => void; onDrop: (target: string, zone: DropZone) => void; onClick: () => void }): void`

- [ ] **Step 1: `paneDrag.ts`.** Left button only. It listens on `window` for `pointermove`, `pointerup`, `pointercancel`, `keydown` (Esc) and `blur`. Until 5 px are passed (`Math.hypot`) it does nothing, and if released before it calls `onClick`. On passing the threshold: `body.classList.add("resizing", "pane-dragging")`. On each move: point relative to the `container` (0..1), `paneAt`; if it is another pane → `onHover({ target, zone: dropZone(...) })`, otherwise `onHover(null)`. `pointerup` with a target → `onDrop`. Esc, `pointercancel` and `blur` cancel without moving. It always cleans up the body's classes, the listeners and calls `onHover(null)`.
- [ ] **Step 2: Workspace.** Each pane's `onGrab` (terminal and browser) → `startPaneDrag` with that tab's `.tab-view` and `M.paneRects(tab.root)`; `onClick` focuses the pane; `onDrop` → `update((x) => M.movePane(x, tabId, paneId, target, zone))`. Signal `dropHint: { tabId: string; rect: Rect; center: boolean } | null`, which paints `<div class="pane-drop" classList={{ center }}>` in that tab's `.tab-view`, with `zoneRect` in percentages (`pct`).
- [ ] **Step 3: CSS.** `body.pane-dragging, body.pane-dragging * { cursor: grabbing !important; }`. `.pane-drop`: absolute, `z-index: 6`, `pointer-events: none`, 2 px border `var(--accent)`, background `color-mix(in srgb, var(--accent) 18%, transparent)`, `border-radius: 4px`, short `transition`. `.pane-drop.center::after`: "⇄" centered.
- [ ] **Step 4: verify** `npx tsc --noEmit` and `npx vitest run` → OK.
- [ ] **Step 5: commit** "Panes: move by dragging the bar (halves or swap)".

### Task 5: dividers easier to grab, with snapping and double click

**Files:**
- Modify: `src/layout/Workspace.tsx` (`startDrag` and the dividers' `For`), `src/styles.css`

**Interfaces:**
- Consumes: `snapRatio` (Task 2), `setRatio` (existing).

- [ ] **Step 1:** in `startDrag`, the proportion goes through `M.snapRatio(ratio, extentPx)` with `extentPx = box.width * area.rect.w` (row) or `box.height * area.rect.h` (column).
- [ ] **Step 2:** the divider gets `onDblClick` → `M.setRatio(x, tabId, area.id, 0.5)` and `title` "Drag to resize · double-click: half and half".
- [ ] **Step 3: CSS.** A 9 px grab zone (`.divider.row { width: 9px; margin-left: -4px }`, `::before` at 4 px; the same for column); on mouse hover the line shows at 3 px with `var(--accent)`.
- [ ] **Step 4: verify** `npx tsc --noEmit` and `npx vitest run` → OK.
- [ ] **Step 5: commit** "Panes: wider divider, snaps at ⅓ ½ ⅔ and double-click equalizes".

### Task 6: real test, documentation and build for Bruno

**Files:**
- Modify: `docs/es/Process_Report.md`, `CLAUDE.md`, `docs/es/Code_Guide.txt`
- Create: `C:\Users\Br1\Desktop\AlphaTerm prueba (paneles).bat` (CRLF)

- [ ] **Step 1: test build.** `npx tauri build --no-bundle` with `CARGO_TARGET_DIR=target\prueba` (and `~/.cargo/bin` at the front of the PATH). Open it with its own `ALPHATERM_DATA_DIR` and `WEBVIEW2_USER_DATA_FOLDER` in `%LOCALAPPDATA%\AlphaTerm\prueba-paneles` and `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`.
- [ ] **Step 2: CDP tests** (Runtime.evaluate + Input.dispatchMouseEvent; dialogs with Page.handleJavaScriptDialog), each one with its result noted:
  - ⇥ and ⤓ split the pane of that bar; ✕ with nothing running closes without asking.
  - With `ping -t localhost` running, ✕ and the menu's "Close pane" ask; Cancel doesn't close.
  - Mark a pane's `.xterm` with `dataset`, run `ping -t localhost`, drag it to half of another pane: the mark stays on the same node (it wasn't re-mounted) and the ping keeps writing.
  - Dropping in the center swaps; Esc mid-drag moves nothing; `blur` mid-drag leaves the body without `resizing` or `pane-dragging`.
  - With a browser in the tab: during the drag it is hidden and when dropped it shows again.
  - A click on ⇥ doesn't leave `pane-dragging` on the body.
  - A divider dropped near ⅓ ends up at exactly ⅓; double click leaves it at ½.
  - Close and reopen the test: the moved layout is recovered.
- [ ] **Step 3: document.** Report: an entry "23/11/2026 — Panes: bar, moving and dividers", with what was done and what was verified (what is unverified, marked). `CLAUDE.md`: in Gotchas, the 22 px bar and `.pane-body`, and that dragging uses `resizing` to hide the browser. Code guide: `PaneBar.tsx` and `paneDrag.ts`.
- [ ] **Step 4: final verification** `npx vitest run` and `npx tsc --noEmit` → all PASS.
- [ ] **Step 5: commit** "Report: panes with bar, moving and dividers".
- [ ] **Step 6: the .bat** "AlphaTerm prueba (paneles).bat" on the desktop, with CRLF, that opens `src-tauri\target\prueba\release\alphaterm.exe` with the test data (like the suggestions one). Tell Bruno so he can try it.
- [ ] **Step 7: if Bruno approves it**, merge into `main` and `build-release.bat --minor` (0.6.0). If not, adjust on the branch. Clean up the test stuff only with his permission.
