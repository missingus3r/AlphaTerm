import { onCleanup, onMount } from "solid-js";
import type { SplitDir } from "./model";

/**
 * Barrita arriba de cada panel de terminal: nombre, dividir y cerrar. Se agarra para mover el
 * panel; con clic derecho abre el menú. Los botones no empiezan un arrastre.
 */
export function PaneBar(props: {
  title: string;
  tooltip?: string;
  highlight: boolean;
  onSplit: (dir: SplitDir) => void;
  onClose: () => void;
  onGrab: (e: PointerEvent) => void;
  onMenu: (e: MouseEvent) => void;
}) {
  const stop = (e: Event) => e.stopPropagation();
  return (
    <div
      class="pane-bar"
      classList={{ highlight: props.highlight }}
      title={props.tooltip}
      // Sin esto, el clic le saca el foco a la terminal.
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => props.onGrab(e)}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onMenu(e);
      }}
    >
      <span class="pane-title">{props.title}</span>
      <button class="icon-btn" title="Dividir a la derecha" onPointerDown={stop} onClick={() => props.onSplit("row")}>
        ⇥
      </button>
      <button class="icon-btn" title="Dividir abajo" onPointerDown={stop} onClick={() => props.onSplit("column")}>
        ⤓
      </button>
      <button class="icon-btn" title="Cerrar el panel" onPointerDown={stop} onClick={() => props.onClose()}>
        ✕
      </button>
    </div>
  );
}

/** Menú del clic derecho en la barrita de un panel. Aplica la acción y después se cierra. */
export function PaneMenu(props: { x: number; y: number; onSplit: (dir: SplitDir) => void; onEqualize: () => void; onClose: () => void; onDismiss: () => void }) {
  onMount(() => {
    const out = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest?.(".ctx-menu")) props.onDismiss();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && props.onDismiss();
    window.addEventListener("mousedown", out);
    window.addEventListener("keydown", esc);
    onCleanup(() => {
      window.removeEventListener("mousedown", out);
      window.removeEventListener("keydown", esc);
    });
  });
  const act = (f: () => void) => {
    try {
      f();
    } finally {
      props.onDismiss();
    }
  };
  return (
    <div class="ctx-menu" style={{ left: `${props.x}px`, top: `${props.y}px` }} role="menu">
      <button onClick={() => act(() => props.onSplit("row"))}>Dividir a la derecha</button>
      <button onClick={() => act(() => props.onSplit("column"))}>Dividir abajo</button>
      <button onClick={() => act(props.onEqualize)}>Igualar tamaños</button>
      <button class="danger" onClick={() => act(props.onClose)}>
        Cerrar panel
      </button>
    </div>
  );
}
