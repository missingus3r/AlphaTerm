import { dropZone, paneAt, type DropZone, type Rect } from "./model";

/** How far the pointer has to move for a click on the bar to become a drag. */
export const DRAG_THRESHOLD_PX = 5;

/** Where it listens and marks the drag (the real window and body; in tests, fake ones). */
export interface DragEnv {
  win: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  body: { classList: { add(...c: string[]): void; remove(...c: string[]): void } };
}

export type DragStart = Pick<PointerEvent, "button" | "clientX" | "clientY"> & Partial<Pick<PointerEvent, "pointerId" | "target">>;
export type DragPoint = { clientX: number; clientY: number };

export interface PointerDragOpts {
  /** The pointerdown that may start the drag. */
  e: DragStart;
  /** Class for the body while dragging (besides `resizing`), for the cursor. */
  bodyClass: string;
  /** The pointer moved during the drag (only once past the threshold). */
  onMove: (p: DragPoint) => void;
  /** End of a real drag: the release point, or `null` if it was cancelled. */
  onEnd: (drop: DragPoint | null) => void;
  /** Released without dragging. */
  onClick: () => void;
}

/**
 * Generic pointer drag (HTML5 drag and drop doesn't reach the page: Tauri's window takes it to
 * drop files). It becomes a drag past `DRAG_THRESHOLD_PX`; while it lasts, the body carries
 * `resizing` (panes don't receive the pointer and the built-in browser is hidden) and
 * `bodyClass`. Esc, `pointercancel` or losing the window's focus cancel it.
 */
export function startPointerDrag(o: PointerDragOpts, env: DragEnv = { win: window, body: document.body }): void {
  if (o.e.button !== 0) return;
  const x0 = o.e.clientX;
  const y0 = o.e.clientY;
  // So the drop arrives even if the pointer leaves the window.
  try {
    if (o.e.pointerId !== undefined) (o.e.target as Element | null)?.setPointerCapture?.(o.e.pointerId);
  } catch {
    /* without capture it still works inside the window */
  }
  let dragging = false;

  const move = (ev: Event) => {
    const p = ev as PointerEvent;
    if (!dragging) {
      if (Math.hypot(p.clientX - x0, p.clientY - y0) <= DRAG_THRESHOLD_PX) return;
      dragging = true;
      env.body.classList.add("resizing", o.bodyClass);
    }
    o.onMove(p);
  };
  const up = (ev: Event) => end(ev as PointerEvent);
  const cancel = () => end(null);
  const key = (ev: Event) => {
    if ((ev as KeyboardEvent).key !== "Escape") return;
    // The terminal keeps focus: the Esc must not reach it (it would interrupt an agent).
    ev.preventDefault();
    ev.stopPropagation();
    end(null);
  };
  const end = (drop: DragPoint | null) => {
    env.win.removeEventListener("pointermove", move);
    env.win.removeEventListener("pointerup", up);
    env.win.removeEventListener("pointercancel", cancel);
    env.win.removeEventListener("blur", cancel);
    env.win.removeEventListener("keydown", key, { capture: true });
    if (!dragging) {
      if (drop) o.onClick();
      return;
    }
    env.body.classList.remove("resizing", o.bodyClass);
    o.onEnd(drop);
  };
  env.win.addEventListener("pointermove", move);
  env.win.addEventListener("pointerup", up);
  env.win.addEventListener("pointercancel", cancel);
  env.win.addEventListener("blur", cancel);
  env.win.addEventListener("keydown", key, { capture: true });
}

export interface PaneDragOpts {
  /** The pointerdown on the bar (or the browser's grip). */
  e: DragStart;
  /** The tab's `.tab-view`: the panes' rectangles are relative to it. */
  container: { getBoundingClientRect(): { left: number; top: number; width: number; height: number } };
  paneId: string;
  rects: () => Map<string, Rect>;
  onHover: (h: { target: string; zone: DropZone } | null) => void;
  onDrop: (target: string, zone: DropZone) => void;
  /** Dropped without dragging. */
  onClick: () => void;
}

/** Drag of a pane by its bar (`pane-dragging` on the body): dropped onto another, it moves there. */
export function startPaneDrag(o: PaneDragOpts, env: DragEnv = { win: window, body: document.body }): void {
  const at = (ev: DragPoint) => {
    const b = o.container.getBoundingClientRect();
    const fx = (ev.clientX - b.left) / b.width;
    const fy = (ev.clientY - b.top) / b.height;
    const rects = o.rects();
    const target = paneAt(rects, fx, fy);
    return target && target !== o.paneId ? { target, zone: dropZone(rects.get(target)!, fx, fy) } : null;
  };
  startPointerDrag(
    {
      e: o.e,
      bodyClass: "pane-dragging",
      onMove: (p) => o.onHover(at(p)),
      onEnd: (p) => {
        const hover = p && at(p);
        o.onHover(null);
        if (hover) o.onDrop(hover.target, hover.zone);
      },
      onClick: o.onClick,
    },
    env,
  );
}
