import { dropZone, paneAt, type DropZone, type Rect } from "./model";

/** Cuánto hay que mover el puntero para que un clic en la barrita pase a ser un arrastre. */
export const DRAG_THRESHOLD_PX = 5;

/** Dónde escucha y marca el arrastre (la ventana y el body reales; en los tests, de mentira). */
export interface DragEnv {
  win: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  body: { classList: { add(...c: string[]): void; remove(...c: string[]): void } };
}

export interface PaneDragOpts {
  /** El pointerdown en la barrita (o el agarre del navegador). */
  e: Pick<PointerEvent, "button" | "clientX" | "clientY"> & Partial<Pick<PointerEvent, "pointerId" | "target">>;
  /** La `.tab-view` de la pestaña: los rectángulos de los paneles son relativos a ella. */
  container: { getBoundingClientRect(): { left: number; top: number; width: number; height: number } };
  paneId: string;
  rects: () => Map<string, Rect>;
  onHover: (h: { target: string; zone: DropZone } | null) => void;
  onDrop: (target: string, zone: DropZone) => void;
  /** Se soltó sin llegar a arrastrar. */
  onClick: () => void;
}

/**
 * Arrastre de un panel por su barrita. Mientras dura, el body lleva `resizing` (los paneles no
 * reciben el puntero y el navegador integrado se esconde) y `pane-dragging` (cursor). Esc,
 * `pointercancel` o perder el foco de la ventana lo cancelan sin mover nada.
 */
export function startPaneDrag(o: PaneDragOpts, env: DragEnv = { win: window, body: document.body }): void {
  if (o.e.button !== 0) return;
  const x0 = o.e.clientX;
  const y0 = o.e.clientY;
  // Que el soltar llegue aunque el puntero salga de la ventana.
  try {
    if (o.e.pointerId !== undefined) (o.e.target as Element | null)?.setPointerCapture?.(o.e.pointerId);
  } catch {
    /* sin captura igual anda dentro de la ventana */
  }
  let dragging = false;
  let hover: { target: string; zone: DropZone } | null = null;

  const at = (ev: { clientX: number; clientY: number }) => {
    const b = o.container.getBoundingClientRect();
    const fx = (ev.clientX - b.left) / b.width;
    const fy = (ev.clientY - b.top) / b.height;
    const rects = o.rects();
    const target = paneAt(rects, fx, fy);
    return target && target !== o.paneId ? { target, zone: dropZone(rects.get(target)!, fx, fy) } : null;
  };
  const move = (ev: Event) => {
    const p = ev as PointerEvent;
    if (!dragging) {
      if (Math.hypot(p.clientX - x0, p.clientY - y0) <= DRAG_THRESHOLD_PX) return;
      dragging = true;
      env.body.classList.add("resizing", "pane-dragging");
    }
    hover = at(p);
    o.onHover(hover);
  };
  const up = (ev: Event) => {
    if (dragging) hover = at(ev as PointerEvent);
    end(true);
  };
  const cancel = () => end(false);
  const key = (ev: Event) => {
    if ((ev as KeyboardEvent).key !== "Escape") return;
    // La terminal sigue con el foco: el Esc no le tiene que llegar (a un agente lo interrumpe).
    ev.preventDefault();
    ev.stopPropagation();
    end(false);
  };
  const end = (drop: boolean) => {
    env.win.removeEventListener("pointermove", move);
    env.win.removeEventListener("pointerup", up);
    env.win.removeEventListener("pointercancel", cancel);
    env.win.removeEventListener("blur", cancel);
    env.win.removeEventListener("keydown", key, { capture: true });
    if (!dragging) {
      if (drop) o.onClick();
      return;
    }
    env.body.classList.remove("resizing", "pane-dragging");
    o.onHover(null);
    if (drop && hover) o.onDrop(hover.target, hover.zone);
  };
  env.win.addEventListener("pointermove", move);
  env.win.addEventListener("pointerup", up);
  env.win.addEventListener("pointercancel", cancel);
  env.win.addEventListener("blur", cancel);
  env.win.addEventListener("keydown", key, { capture: true });
}
