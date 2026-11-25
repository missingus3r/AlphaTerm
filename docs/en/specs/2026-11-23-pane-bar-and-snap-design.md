# Panes: bar with buttons and moving as "snap" — short design

> Translated from the Spanish original (`docs/es/specs/2026-11-23-pane-bar-and-snap-design.md`). The Spanish version is the source of truth.

Date: 23/11/2026. Status: for approval.

## Why
Bruno works with several terminals and agents at once in the same tab. Today, splitting and closing
panes can only be done with shortcuts (Alt+Shift+=, Alt+Shift+-, Alt+Shift+D, Ctrl+Shift+W), there is no way
to change the order of the panes and the line for resizing is barely visible. He wants to do it
with the mouse: split and close buttons, and moving the panes "like snap" (changing the order or the
size).

## Goals
- A small bar on top of each pane with the name and the buttons split right (⇥), split
  down (⤓) and close (✕).
- Right-click on the bar: a menu with Split right, Split down, Equalize sizes and Close
  pane.
- Drag a pane by its bar and drop it on another: the left, right, top or bottom
  half of the other pane puts it on that side; the center swaps them. While dragging, the
  place where it will end up is painted.
- Size: the divider line easier to grab, which stops on its own at ⅓, ½ and ⅔, and a double click to
  leave both sides equal.

## Out of scope (for now)
- Ready-made layouts in the Windows 11 style (2 columns, 2×2, etc.): left as a possible extra. Bruno didn't
  ask for it in his answer; it gets added later if he wants it.
- Moving panes to another tab or window, or dropping a tab inside another one.
- Changes to the control API or the MCP (they keep `split` as today).

## What can't happen
- Moving a pane must not re-create its terminal (it kills the shell and the agent). Panes are still
  iterated by id and positioned by rectangles; moving is only changing the tree.
- The built-in browser (a native WebView2, nothing can cover it) must not end up on top of the zone where
  you drop.
- Losing the terminal's right click (copy if there is a selection, otherwise paste): the new menu goes on
  the bar, not on the terminal.
- Breaking the keyboard shortcuts that already exist.

## Approaches considered
- **A) A fixed bar on top of each pane** (chosen by Bruno). You always see what each pane is and
  where to grab it; it takes one line of height from each terminal.
- B) Floating buttons in the corner on mouse hover. They take no room, but they cover terminal
  text and are harder to discover.

## How (my decisions, marked for review)
- **Always-visible bar**, also with a single pane (it is where the button for the first
  split is). About 22 px. The focused pane (with 2 or more) has it highlighted in the accent color.
  Name: the same one the browser already uses to pick a terminal (agent or shell · folder).
- **Browser panes**: they already have their own bar; the grip (⋮⋮) is added on the left and
  the ⇥ ⤓ buttons (splitting from a browser opens a terminal in its owner's folder, as today).
- **✕ with something running asks for confirmation** (agent or command in progress), because the button is small
  and sits next to the split ones. With nothing running it closes directly. Ctrl+Shift+W still doesn't
  ask.
- **Dragging with pointer events** (like the dividers), not with the browser's native drag:
  it only starts after moving 5 px (a simple click on the bar just focuses). Esc cancels. Dropping on
  itself or outside the panes does nothing. During the drag the browsers are hidden (the
  same `resizing` class the dividers already use) and the new menu goes in `FLOATING`.
- **Model** (`src/layout/model.ts`, pure functions with tests): insert a pane next to another one
  from any of the four sides, move a pane (take it out and insert it, half and half) and
  swap two panes. Equalize: each split takes the proportion of panes it has on each
  side, so they all end up the same size on that axis.
- **Divider snapping**: if dropped within ~12 px of ⅓, ½ or ⅔ of its split, it stays exactly
  there. The function that decides is pure and has a test.
- The session already saves the tree: what was moved is recovered on its own when reopening.

## For whoever builds it
- Visual details (icons, colors, the drawing of the drop zone) following the current style of
  `styles.css`.
- Test in a separate AlphaTerm (`CARGO_TARGET_DIR=target\prueba` + its own `ALPHATERM_DATA_DIR` and
  `WEBVIEW2_USER_DATA_FOLDER`) over CDP, without closing Bruno's. Tests: vitest, tsc, and that
  moving a pane with a command running doesn't cut it off.
