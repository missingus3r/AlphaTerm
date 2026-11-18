import { createSignal, For, Show } from "solid-js";
import { Marquee } from "./Marquee";
import type { Profile } from "../terminal/pty";

export type TabStatus = "idle" | "running" | "error" | "exited";

export interface TabItem {
  id: string;
  title: string;
  status: TabStatus;
  tooltip: string;
  panes: number;
}

interface Props {
  tabs: TabItem[];
  activeId: string;
  vertical: boolean;
  /** Atajos para el tooltip del botón "?". */
  help: [string, string][];
  editingId: string | null;
  profiles: Profile[];
  newTabProfile: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: (profileId?: string) => void;
  onNewTabProfile: (profileId: string) => void;
  onStartRename: (id: string) => void;
  onRename: (id: string, title: string | null) => void;
  onMove: (id: string, toIndex: number) => void;
  onToggleBar: () => void;
  onNewWindow: () => void;
  onSettings: () => void;
}

const STATUS_LABEL: Record<TabStatus, string> = {
  idle: "En espera",
  running: "Ejecutando",
  error: "El último comando falló",
  exited: "La shell terminó",
};

export function TabBar(props: Props) {
  const [dragId, setDragId] = createSignal<string | null>(null);
  const help = () => props.help.map(([k, v]) => `${k}: ${v}`).join("\n");

  return (
    <nav class="tabbar" classList={{ vertical: props.vertical }} aria-label="Pestañas">
      <div class="tabs" role="tablist" aria-orientation={props.vertical ? "vertical" : "horizontal"}>
        <For each={props.tabs}>
          {(t, i) => (
            <div
              class="tab"
              role="tab"
              aria-selected={t.id === props.activeId}
              classList={{ active: t.id === props.activeId, dragging: dragId() === t.id }}
              title={`${t.tooltip}\n${STATUS_LABEL[t.status]}`}
              draggable={props.editingId !== t.id}
              onDragStart={(e) => {
                setDragId(t.id);
                e.dataTransfer?.setData("text/plain", t.id);
              }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = dragId();
                if (id && id !== t.id) props.onMove(id, i());
                setDragId(null);
              }}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  props.onClose(t.id); // clic del medio cierra, como en los navegadores
                } else if (e.button === 0) props.onSelect(t.id);
              }}
              onDblClick={() => props.onStartRename(t.id)}
            >
              <span class={`dot st-${t.status}`} aria-label={STATUS_LABEL[t.status]} />
              <Show
                when={props.editingId === t.id}
                fallback={<Marquee class="tab-title" text={t.title} />}
              >
                <input
                  class="tab-edit"
                  value={t.title}
                  ref={(el) => queueMicrotask(() => (el.focus(), el.select()))}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key !== "Enter" && e.key !== "Escape") return;
                    // Sin esto, el mismo Enter llega a la terminal cuando recupera el foco.
                    e.preventDefault();
                    props.onRename(t.id, e.key === "Enter" ? e.currentTarget.value : null);
                  }}
                  onBlur={(e) => props.onRename(t.id, e.currentTarget.value)}
                  placeholder="Vacío = nombre automático"
                />
              </Show>
              <Show when={t.panes > 1}>
                <span class="panes" title={`${t.panes} paneles`}>
                  {t.panes}
                </span>
              </Show>
              <button
                class="close"
                title="Cerrar pestaña (Ctrl+Shift+W cierra el panel)"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => props.onClose(t.id)}
              >
                ×
              </button>
            </div>
          )}
        </For>
        <div class="new-tab">
          <button class="btn add" title="Pestaña nueva (Ctrl+Shift+T)" onClick={() => props.onNew()}>
            +
          </button>
          <select
            class="profile"
            title="Perfil de las pestañas nuevas"
            value={props.newTabProfile}
            onChange={(e) => props.onNewTabProfile(e.currentTarget.value)}
          >
            <For each={props.profiles}>
              {(p) => (
                <option value={p.id} disabled={!p.available}>
                  {p.name}
                  {p.available ? "" : " (no detectado)"}
                </option>
              )}
            </For>
          </select>
        </div>
      </div>
      <div class="bar-actions">
        <button class="btn" title="Ventana nueva (Ctrl+Shift+N)" onClick={props.onNewWindow}>
          ⧉
        </button>
        <button
          class="btn"
          title={props.vertical ? "Pestañas arriba (Ctrl+Shift+B)" : "Pestañas a la izquierda (Ctrl+Shift+B)"}
          onClick={props.onToggleBar}
        >
          {props.vertical ? "⬒" : "◧"}
        </button>
        <button class="btn" title="Configuración (Ctrl+,)" onClick={props.onSettings}>
          ⚙
        </button>
        <span class="btn help" title={help()}>
          ?
        </span>
      </div>
    </nav>
  );
}
