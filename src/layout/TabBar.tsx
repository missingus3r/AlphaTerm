import { profileLabel } from "../terminal/pty";
import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { Marquee } from "./Marquee";
import type { Profile } from "../terminal/pty";
import type { Group } from "./model";
import { DEFAULTS, LIMITS } from "../settings/schema";
import { k, t } from "../i18n";

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
  /** Ancho en px de la barra vertical desplegada; `onWidth` se llama al soltar el borde arrastrado. */
  width?: number;
  onWidth?: (width: number) => void;
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
  idle: k("En espera"),
  running: k("Ejecutando"),
  waiting: k("Un agente espera input"),
  attention: k("Un agente te necesita"),
  error: k("El último comando falló"),
  exited: k("La shell terminó"),
};

/** Inicial para la barra plegada (la primera letra o número del título). */
export const tabInitial = (title: string) => (title.match(/[\p{L}\p{N}]/u)?.[0] ?? "·").toUpperCase();

export function TabBar(props: Props) {
  const [dragId, setDragId] = createSignal<string | null>(null);
  const compact = () => props.vertical && !!props.collapsed;
  // Ancho de la barra vertical: mientras se arrastra el borde vive acá; al soltar se guarda.
  const [dragW, setDragW] = createSignal<number | null>(null);
  const barWidth = () => dragW() ?? props.width ?? DEFAULTS.tabBar.width;
  const startResize = (e: PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = barWidth();
    const [lo, hi] = LIMITS.tabBarWidth;
    // Deja al menos 360 px para las terminales.
    const clamp = (w: number) => Math.round(Math.max(lo, Math.min(hi, window.innerWidth - 360, w)));
    document.body.classList.add("resizing", "resizing-row");
    const move = (ev: PointerEvent) => setDragW(clamp(startW + ev.clientX - startX));
    const up = () => {
      document.body.classList.remove("resizing", "resizing-row");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const w = dragW();
      if (w !== null && w !== props.width) props.onWidth?.(w);
      setDragW(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const help = () => props.help.map(([keys, label]) => `${t(keys)}: ${t(label)}`).join("\n");
  const [menu, setMenu] = createSignal<Menu>(null);
  const groupOf = (id?: string) => (id ? props.groups.find((g) => g.id === id) : undefined);
  const firstOfGroup = (i: number) => {
    const tab = props.tabs[i];
    return !!tab.groupId && props.tabs[i - 1]?.groupId !== tab.groupId;
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
    <nav
      class="tabbar"
      classList={{ vertical: props.vertical, collapsed: compact() }}
      style={{ width: props.vertical && !compact() ? `${barWidth()}px` : undefined }}
      aria-label={t("Pestañas")}
    >
      <Show when={props.vertical && !compact() && props.onWidth}>
        <div
          class="tabbar-resize"
          title={t("Arrastrar para cambiar el ancho (doble clic: ancho normal)")}
          onPointerDown={startResize}
          onDblClick={() => props.onWidth?.(DEFAULTS.tabBar.width)}
        />
      </Show>
      <Show when={props.vertical && props.onCollapse}>
        <button
          class="btn collapse-bar"
          title={compact() ? t("Desplegar la barra de pestañas") : t("Plegar la barra de pestañas")}
          aria-expanded={!compact()}
          onClick={() => props.onCollapse?.()}
        >
          {/* Ícono de barra lateral: marco redondeado con una rayita a la izquierda (igual en los dos estados). */}
          <svg width="17" height="14" viewBox="0 0 17 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
            <rect x="0.8" y="0.8" width="15.4" height="12.4" rx="3" />
            <path d="M4.4 4.4v5.2" />
          </svg>
        </button>
      </Show>
      <div class="tabs" role="tablist" aria-orientation={props.vertical ? "vertical" : "horizontal"}>
        <For each={props.tabs}>
          {(tab, i) => (
            <>
            <Show when={firstOfGroup(i())}>
              {(() => {
                const g = () => groupOf(tab.groupId);
                const count = () => props.tabs.filter((x) => x.groupId === tab.groupId).length;
                const hasActive = () => props.tabs.some((x) => x.groupId === tab.groupId && x.id === props.activeId);
                return (
                  <div
                    class="tab-group"
                    classList={{ collapsed: g()?.collapsed, "has-active": hasActive() }}
                    style={{ "--gcolor": g()?.color ?? "var(--muted)" }}
                    title={t("{name} · {n} pestañas (clic: plegar/desplegar; clic derecho: opciones)", { name: g()?.name ?? t("Carpeta"), n: count() })}
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
                    <span class="group-name">{compact() ? tabInitial(g()?.name ?? t("Carpeta")) : (g()?.name ?? t("Carpeta"))}</span>
                    <span class="panes">{count()}</span>
                  </div>
                );
              })()}
            </Show>
            <Show when={!groupOf(tab.groupId)?.collapsed}>
            <div
              class="tab"
              style={{ "--tcolor": tab.color ?? groupOf(tab.groupId)?.color ?? "transparent" }}
              onContextMenu={(e) => openMenu(e, "tab", tab.id)}
              role="tab"
              aria-selected={tab.id === props.activeId}
              classList={{ active: tab.id === props.activeId, dragging: dragId() === tab.id, grouped: !!tab.groupId }}
              title={`${tab.tooltip}\n${t(STATUS_LABEL[tab.status])}`}
              draggable={props.editingId !== tab.id}
              onDragStart={(e) => {
                setDragId(tab.id);
                e.dataTransfer?.setData("text/plain", tab.id);
              }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = dragId();
                if (id && id !== tab.id) props.onMove(id, i());
                setDragId(null);
              }}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  props.onClose(tab.id); // clic del medio cierra, como en los navegadores
                } else if (e.button === 0) props.onSelect(tab.id);
              }}
              onDblClick={() => props.onStartRename(tab.id)}
            >
              <span class={`dot st-${tab.status}`} aria-label={t(STATUS_LABEL[tab.status])} />
              <Show
                when={props.editingId === tab.id && !compact()}
                fallback={
                  compact() ? (
                    <span class="tab-initial" style={tab.color ? { color: tab.color } : undefined}>
                      {tabInitial(tab.title)}
                    </span>
                  ) : (
                    <Marquee class="tab-title" text={tab.title} style={tab.color ? { color: tab.color } : undefined} />
                  )
                }
              >
                <input
                  class="tab-edit"
                  value={tab.title}
                  ref={(el) => queueMicrotask(() => (el.focus(), el.select()))}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key !== "Enter" && e.key !== "Escape") return;
                    // Sin esto, el mismo Enter llega a la terminal cuando recupera el foco.
                    e.preventDefault();
                    props.onRename(tab.id, e.key === "Enter" ? e.currentTarget.value : null);
                  }}
                  onBlur={(e) => props.onRename(tab.id, e.currentTarget.value)}
                  placeholder={t("Vacío = nombre automático")}
                />
              </Show>
              <Show when={tab.changes}>
                <span class="changes" title={t("{n} archivos cambiados en git", { n: tab.changes ?? 0 })}>
                  ±{tab.changes}
                </span>
              </Show>
              <Show when={tab.panes > 1}>
                <span class="panes" title={t("{n} paneles", { n: tab.panes })}>
                  {tab.panes}
                </span>
              </Show>
              <button
                class="close"
                title={t("Cerrar pestaña (Ctrl+Shift+W cierra el panel)")}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => props.onClose(tab.id)}
              >
                ×
              </button>
            </div>
            </Show>
            </>
          )}
        </For>
        <div class="new-tab">
          <button class="btn add" title={t("Pestaña nueva (Ctrl+Shift+T)")} onClick={() => props.onNew()}>
            {/* Dibujado: el carácter "+" no queda centrado en todas las fuentes. */}
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
          </button>
          <select
            class="profile"
            title={t("Perfil de las pestañas nuevas")}
            value={props.newTabProfile}
            onChange={(e) => props.onNewTabProfile(e.currentTarget.value)}
          >
            <For each={props.profiles}>
              {(p) => (
                <option value={p.id} disabled={!p.available}>
                  {profileLabel(p.name)}
                  {p.available ? "" : ` ${t("(no detectado)")}`}
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
                        const name = prompt(t("Nombre de la carpeta:"), g?.name ?? "");
                        if (name?.trim()) props.onGroupUpdate(m().id, { name: name.trim() });
                      })
                    }
                  >
                    {t("Renombrar carpeta…")}
                  </button>
                  <div class="ctx-colors">
                    <For each={TAB_COLORS}>{(c) => <button class="swatch-btn" style={{ background: c }} title={c} onClick={() => act(() => props.onGroupUpdate(m().id, { color: c }))} />}</For>
                    <button class="swatch-btn none" title={t("Sin color")} onClick={() => act(() => props.onGroupUpdate(m().id, { color: undefined }))}>
                      ∅
                    </button>
                  </div>
                  <button onClick={() => act(() => props.onGroupUngroup(m().id))}>{t("Desarmar la carpeta")}</button>
                  <button class="danger" onClick={() => act(() => props.onGroupClose(m().id))}>
                    {t("Cerrar todas sus pestañas…")}
                  </button>
                </>
              }
            >
              <button onClick={() => act(() => props.onStartRename(m().id))}>{t("Renombrar pestaña")}</button>
              <div class="ctx-label">{t("Color del título")}</div>
              <div class="ctx-colors">
                <For each={TAB_COLORS}>{(c) => <button class="swatch-btn" style={{ background: c }} title={c} onClick={() => act(() => props.onColor(m().id, c))} />}</For>
                <button class="swatch-btn none" title={t("Sin color")} onClick={() => act(() => props.onColor(m().id, undefined))}>
                  ∅
                </button>
              </div>
              <div class="ctx-label">{t("Carpeta")}</div>
              <button onClick={() => act(() => props.onGroupNew(m().id))}>{t("Nueva carpeta con esta pestaña…")}</button>
              <For each={props.groups.filter((g) => g.id !== props.tabs.find((x) => x.id === m().id)?.groupId)}>
                {(g) => <button onClick={() => act(() => props.onGroupMove(m().id, g.id))}>{t("Mover a «{name}»", { name: g.name })}</button>}
              </For>
              <Show when={props.tabs.find((x) => x.id === m().id)?.groupId}>
                <button onClick={() => act(() => props.onGroupMove(m().id, null))}>{t("Sacar de la carpeta")}</button>
              </Show>
              <div class="ctx-sep" />
              <button onClick={() => act(props.onRenameWindow)}>{t("Título de la ventana…")}</button>
              <button class="danger" onClick={() => act(() => props.onClose(m().id))}>
                {t("Cerrar pestaña")}
              </button>
            </Show>
          </div>
        )}
      </Show>
      <div class="bar-actions">
        {props.widgets}
        <button class="btn" title={t("Ventana nueva (Ctrl+Shift+N)")} onClick={props.onNewWindow}>
          ⧉
        </button>
        <button
          class="btn"
          title={props.vertical ? t("Pestañas arriba (Ctrl+Shift+B)") : t("Pestañas a la izquierda (Ctrl+Shift+B)")}
          onClick={props.onToggleBar}
        >
          {props.vertical ? "⬒" : "◧"}
        </button>
        <button class="btn" title={t("Configuración (Ctrl+,)")} onClick={props.onSettings}>
          ⚙
        </button>
        <span class="btn help" title={help()}>
          ?
        </span>
      </div>
    </nav>
  );
}
