import { describe, expect, it, vi } from "vitest";
import { startPaneDrag, startPointerDrag, type DragEnv } from "./paneDrag";
import type { Rect } from "./model";

/** Fake window and body: the controller only listens to events and sets classes. */
function fakeEnv() {
  const win = new EventTarget();
  const classes = new Set<string>();
  const env: DragEnv = {
    win,
    body: { classList: { add: (...c: string[]) => c.forEach((x) => classes.add(x)), remove: (...c: string[]) => c.forEach((x) => classes.delete(x)) } },
  };
  const fire = (type: string, props: Record<string, unknown> = {}) => win.dispatchEvent(Object.assign(new Event(type), props));
  return { env, classes, fire };
}

const rects = new Map<string, Rect>([
  ["A", { x: 0, y: 0, w: 0.5, h: 1 }],
  ["B", { x: 0.5, y: 0, w: 0.5, h: 1 }],
]);
const container = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 500 }) };

function begin(button = 0) {
  const f = fakeEnv();
  const cb = { onHover: vi.fn(), onDrop: vi.fn(), onClick: vi.fn() };
  startPaneDrag({ e: { button, clientX: 100, clientY: 100 }, container, paneId: "A", rects: () => rects, ...cb }, f.env);
  return { ...f, ...cb };
}

describe("arrastrar paneles", () => {
  it("un clic sin pasar el umbral es un clic: no marca el body ni mueve", () => {
    const d = begin();
    d.fire("pointermove", { clientX: 102, clientY: 101 });
    d.fire("pointerup", { clientX: 102, clientY: 101 });
    expect(d.onClick).toHaveBeenCalledTimes(1);
    expect(d.onDrop).not.toHaveBeenCalled();
    expect(d.classes.size).toBe(0);
  });

  it("pasado el umbral marca el body, avisa la zona y al soltar mueve", () => {
    const d = begin();
    d.fire("pointermove", { clientX: 900, clientY: 250 });
    expect(d.classes.has("resizing")).toBe(true);
    expect(d.classes.has("pane-dragging")).toBe(true);
    expect(d.onHover).toHaveBeenLastCalledWith({ target: "B", zone: "right" });
    d.fire("pointerup", { clientX: 900, clientY: 250 });
    expect(d.onDrop).toHaveBeenCalledWith("B", "right");
    expect(d.onHover).toHaveBeenLastCalledWith(null);
    expect(d.classes.size).toBe(0);
    expect(d.onClick).not.toHaveBeenCalled();
  });

  it("sobre el mismo panel no hay destino", () => {
    const d = begin();
    d.fire("pointermove", { clientX: 300, clientY: 250 });
    expect(d.onHover).toHaveBeenLastCalledWith(null);
    d.fire("pointerup", { clientX: 300, clientY: 250 });
    expect(d.onDrop).not.toHaveBeenCalled();
    expect(d.onClick).not.toHaveBeenCalled();
  });

  for (const [name, type, props] of [
    ["Esc", "keydown", { key: "Escape" }],
    ["pointercancel", "pointercancel", {}],
    ["perder el foco de la ventana", "blur", {}],
  ] as const) {
    it(`${name} cancela sin mover y limpia todo`, () => {
      const d = begin();
      d.fire("pointermove", { clientX: 900, clientY: 250 });
      d.fire(type, props);
      expect(d.classes.size).toBe(0);
      expect(d.onHover).toHaveBeenLastCalledWith(null);
      d.fire("pointerup", { clientX: 900, clientY: 250 });
      expect(d.onDrop).not.toHaveBeenCalled();
    });
  }

  it("el arrastre genérico (el de las pestañas) usa su clase y avisa el punto o la cancelación", () => {
    const f = fakeEnv();
    const cb = { onMove: vi.fn(), onEnd: vi.fn(), onClick: vi.fn() };
    startPointerDrag({ e: { button: 0, clientX: 10, clientY: 10 }, bodyClass: "tab-dragging", ...cb }, f.env);
    f.fire("pointermove", { clientX: 40, clientY: 12 });
    expect([...f.classes].sort()).toEqual(["resizing", "tab-dragging"]);
    expect(cb.onMove).toHaveBeenLastCalledWith(expect.objectContaining({ clientX: 40 }));
    f.fire("pointerup", { clientX: 60, clientY: 12 });
    expect(cb.onEnd).toHaveBeenLastCalledWith(expect.objectContaining({ clientX: 60 }));
    expect(f.classes.size).toBe(0);

    startPointerDrag({ e: { button: 0, clientX: 10, clientY: 10 }, bodyClass: "tab-dragging", ...cb }, f.env);
    f.fire("pointermove", { clientX: 40, clientY: 12 });
    f.fire("keydown", { key: "Escape" });
    expect(cb.onEnd).toHaveBeenLastCalledWith(null);
    expect(cb.onClick).not.toHaveBeenCalled();
  });

  it("solo con el botón izquierdo", () => {
    const d = begin(2);
    d.fire("pointermove", { clientX: 900, clientY: 250 });
    d.fire("pointerup", { clientX: 900, clientY: 250 });
    expect(d.onClick).not.toHaveBeenCalled();
    expect(d.onHover).not.toHaveBeenCalled();
    expect(d.classes.size).toBe(0);
  });
});
