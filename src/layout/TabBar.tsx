import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { Marquee } from "./Marquee";
import type { Profile } from "../terminal/pty";
import type { Group } from "./model";

/** Colores para pestañas y carpetas (se ven bien en temas claros y oscuros). */
export const TAB_COLORS = ["#ef6b73", "#f2a65a", "#e5c07b", "#8bd49c", "#5fd7d7", "#60a5fa", "#a78bfa", "#f472b6"];

export type TabStatus = "idle" | "running" | "waiting" | "attention" | "error" | "exited";

export interface TabItem {
  id: string;
  title: string;
  status: TabStatus;
  tooltip: string;
  panes: number;
  /** Archivos cambiados en el repo git de la pestaña (si es un repo). */
  changes?: number;
  color?: string;
  groupId?: string;
}

interface Props {
  tabs: TabItem[];
  activeId: string;
  vertical: boolean;
  /** Barra vertical plegada: angosta, con el estado y la inicial de cada pestaña. */
  collapsed?: boolean;
  onCollapse?: () => void;
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
  /** Widgets que van en la barra (CPU/RAM). */
  widgets?: JSX.Element;
  groups: Group[];
  onColor: (id: string, color: string | undefined) => void;
  onGroupNew: (tabId: string) => void;
  onGroupMove: (tabId: string, groupId: string | null) => void;
  onGroupUpdate: (groupId: string, patch: Partial<Omit<Group, "id">>) => void;
  onGroupUngroup: (groupId: string) => void;
  onGroupClose: (groupId: string) => void;
  onRenameWindow: () => void;
}

type Menu = { x: number; y: number; kind: "tab" | "group"; id: string } | null;

const STATUS_LABEL: Record<TabStatus, string> = {
  idle: "En espera",
  running: "Ejecutando",
  waiting: "Un agente espera input",
  attention: "Un agente te necesita",
  error: "El último comando falló",
  exited: "La shell terminó",
};

/** Inicial para la barra plegada (la primera letra o número del título). */
export const tabInitial = (title: string) => (title.match(/[\p{L}\p{N}]/u)?.[0] ?? "·").toUpperCase();

export function TabBar(props: Props) {
  const [dragId, setDragId] = createSignal<string | null>(null);
  const compact = () => props.vertical && !!props.collapsed;
  const help = () => props.help.map(([k, v]) => `${k}: ${v}`).join("\n");
  const [menu, setMenu] = createSignal<Menu>(null);
  const groupOf = (id?: string) => (id ? props.groups.find((g) => g.id === id) : undefined);
  const firstOfGroup = (i: number) => {
    const t = props.tabs[i];
    return !!t.groupId && props.tabs[i - 1]?.groupId !== t.groupId;
  };
  const openMenu = (e: MouseEvent, kind: "tab" | "group", id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: Math.min(e.clientX, window.innerWidth - 230), y: Math.min(e.clientY, window.innerHeight - 320), kind, id });
  };
  onMount(() => {
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest?.(".ctx-menu")) setMenu(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    onCleanup(() => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    });
  });
  // Primero la acción y después cerrar: con el menú cerrado, Solid ya no deja leer su valor (m()).
  const act = (f: () => void) => {
    try {
      f();
    } finally {
      setMenu(null);
    }
  };

  return (
    <nav class="tabbar" classList={{ vertical: props.vertical, collapsed: compact() }} aria-label="Pestañas">
      <Show when={props.vertical && props.onCollapse}>
        <button
          class="btn collapse-bar"
          title={compact() ? "Desplegar la barra de pestañas" : "Plegar la barra de pestañas"}
          aria-expanded={!compact()}
          onClick={() => props.onCollapse?.()}
        >
          {compact() ? "»" : "«"}
        </button>
      </Show>
      <div class="tabs" role="tablist" aria-orientation={props.vertical ? "vertical" : "horizontal"}>
        <For each={props.tabs}>
          {(t, i) => (
            <>
            <Show when={firstOfGroup(i())}>
              {(() => {
                const g = () => groupOf(t.groupId);
                const count = () => props.tabs.filter((x) => x.groupId === t.groupId).length;
                const hasActive = () => props.tabs.some((x) => x.groupId === t.groupId && x.id === props.activeId);
                return (
                  <div
                    class="tab-group"
                    classList={{ collapsed: g()?.collapsed, "has-active": hasActive() }}
                    style={{ "--gcolor": g()?.color ?? "var(--muted)" }}
                    title={`${g()?.name ?? "Carpeta"} · ${count()} pestañas (clic: plegar/desplegar; clic derecho: opciones)`}
                    onClick={() => g() && props.onGroupUpdate(g()!.id, { collapsed: !g()!.collapsed })}
                    onContextMenu={(e) => g() && openMenu(e, "group", g()!.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = dragId();
                      if (id && g()) props.onGroupMove(id, g()!.id);
                      setDragId(null);
                    }}
                  >
                    <span class="caret">{g()?.collapsed ? "▸" : "▾"}</span>
                    <span class="group-name">{compact() ? tabInitial(g()?.name ?? "C") : (g()?.name ?? "Carpeta")}</span>
                    <span class="panes">{count()}</span>
                  </div>
                );
              })()}
            </Show>
            <Show when={!groupOf(t.groupId)?.collapsed}>
            <div
              class="tab"
              style={{ "--tcolor": t.color ?? groupOf(t.groupId)?.color ?? "transparent" }}
              onContextMenu={(e) => openMenu(e, "tab", t.id)}
              role="tab"
              aria-selected={t.id === props.activeId}
              classList={{ active: t.id === props.activeId, dragging: dragId() === t.id, grouped: !!t.groupId }}
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
                when={props.editingId === t.id && !compact()}
                fallback={
                  compact() ? (
                    <span class="tab-initial" style={t.color ? { color: t.color } : undefined}>
                      {tabInitial(t.title)}
                    </span>
                  ) : (
                    <Marquee class="tab-title" text={t.title} style={t.color ? { color: t.color } : undefined} />
                  )
                }
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
              <Show when={t.changes}>
                <span class="changes" title={`${t.changes} archivos cambiados en git`}>
                  ±{t.changes}
                </span>
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
            </Show>
            </>
          )}
        </For>
        <div class="new-tab">
          <button class="btn add" title="Pestaña nueva (Ctrl+Shift+T)" onClick={() => props.onNew()}>
            {/* Dibujado: el carácter "+" no queda centrado en todas las fuentes. */}
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
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
      <Show when={menu()}>
        {(m) => (
          <div class="ctx-menu" style={{ left: `${m().x}px`, top: `${m().y}px` }} role="menu">
            <Show
              when={m().kind === "tab"}
              fallback={
                <>
                  <button
                    onClick={() =>
                      act(() => {
                        const g = groupOf(m().id);
                        const name = prompt("Nombre de la carpeta:", g?.name ?? "");
                        if (name?.trim()) props.onGroupUpdate(m().id, { name: name.trim() });
                      })
                    }
                  >
                    Renombrar carpeta…
                  </button>
                  <div class="ctx-colors">
                    <For each={TAB_COLORS}>{(c) => <button class="swatch-btn" style={{ background: c }} title={c} onClick={() => act(() => props.onGroupUpdate(m().id, { color: c }))} />}</For>
                    <button class="swatch-btn none" title="Sin color" onClick={() => act(() => props.onGroupUpdate(m().id, { color: undefined }))}>
                      ∅
                    </button>
                  </div>
                  <button onClick={() => act(() => props.onGroupUngroup(m().id))}>Desarmar la carpeta</button>
                  <button class="danger" onClick={() => act(() => props.onGroupClose(m().id))}>
                    Cerrar todas sus pestañas…
                  </button>
                </>
              }
            >
              <button onClick={() => act(() => props.onStartRename(m().id))}>Renombrar pestaña</button>
              <div class="ctx-label">Color del título</div>
              <div class="ctx-colors">
                <For each={TAB_COLORS}>{(c) => <button class="swatch-btn" style={{ background: c }} title={c} onClick={() => act(() => props.onColor(m().id, c))} />}</For>
                <button class="swatch-btn none" title="Sin color" onClick={() => act(() => props.onColor(m().id, undefined))}>
                  ∅
                </button>
              </div>
              <div class="ctx-label">Carpeta</div>
              <button onClick={() => act(() => props.onGroupNew(m().id))}>Nueva carpeta con esta pestaña…</button>
              <For each={props.groups.filter((g) => g.id !== props.tabs.find((t) => t.id === m().id)?.groupId)}>
                {(g) => <button onClick={() => act(() => props.onGroupMove(m().id, g.id))}>Mover a «{g.name}»</button>}
              </For>
              <Show when={props.tabs.find((t) => t.id === m().id)?.groupId}>
                <button onClick={() => act(() => props.onGroupMove(m().id, null))}>Sacar de la carpeta</button>
              </Show>
              <div class="ctx-sep" />
              <button onClick={() => act(props.onRenameWindow)}>Título de la ventana…</button>
              <button class="danger" onClick={() => act(() => props.onClose(m().id))}>
                Cerrar pestaña
              </button>
            </Show>
          </div>
        )}
      </Show>
      <div class="bar-actions">
        {props.widgets}
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
