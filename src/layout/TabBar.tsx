import { profileLabel } from "../terminal/pty";
import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { Marquee } from "./Marquee";
import type { Profile } from "../terminal/pty";
import { dropChanges, type Group, type TabDrop } from "./model";
import { startPointerDrag, type DragPoint } from "./paneDrag";
import { autoScrollStep, tabDropAt, type TabSlot } from "./tabDrag";
import { DEFAULTS, LIMITS } from "../settings/schema";
import { k, t } from "../i18n";

/** Colors for tabs and folders (they look good on light and dark themes). */
export const TAB_COLORS = ["#ef6b73", "#f2a65a", "#e5c07b", "#8bd49c", "#5fd7d7", "#60a5fa", "#a78bfa", "#f472b6"];

export type TabStatus = "idle" | "running" | "waiting" | "attention" | "error" | "exited";

export interface TabItem {
  id: string;
  title: string;
  status: TabStatus;
  tooltip: string;
  panes: number;
  /** Files changed in the tab's git repo (if it is a repo). */
  changes?: number;
  color?: string;
  groupId?: string;
}

interface Props {
  tabs: TabItem[];
  activeId: string;
  vertical: boolean;
  /** Collapsed vertical bar: narrow, with the status and the initial of each tab. */
  collapsed?: boolean;
  onCollapse?: () => void;
  /** Width in px of the expanded vertical bar; `onWidth` is called when the dragged edge is released. */
  width?: number;
  onWidth?: (width: number) => void;
  /** Shortcuts for the "?" button's tooltip. */
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
  /** A dragged tab was dropped somewhere that changes the order or its folder. */
  onDrop: (id: string, drop: TabDrop) => void;
  onToggleBar: () => void;
  onNewWindow: () => void;
  onSettings: () => void;
  /** Widgets that go in the bar (CPU/RAM). */
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

/** Initial for the collapsed bar (the first letter or digit of the title). */
export const tabInitial = (title: string) => (title.match(/[\p{L}\p{N}]/u)?.[0] ?? "·").toUpperCase();

export function TabBar(props: Props) {
  // Dragging a tab to reorder it: by pointer, like the panes (HTML5 drag and drop doesn't reach the page).
  const [dragId, setDragId] = createSignal<string | null>(null);
  const [hover, setHover] = createSignal<TabDrop | null>(null);
  let tabsEl!: HTMLDivElement;
  const slots = (): TabSlot[] =>
    [...tabsEl.querySelectorAll<HTMLElement>(":scope > [data-slot]")].map((el) => {
      const r = el.getBoundingClientRect();
      return { kind: el.dataset.slot as TabSlot["kind"], id: el.dataset.id!, start: props.vertical ? r.top : r.left, end: props.vertical ? r.bottom : r.right };
    });
  /** Which half of this tab or header the drop would go to (to draw the mark). */
  const hoverOn = (kind: "tab" | "group", id: string) => {
    const h = hover();
    return h && h.kind !== "end" && h.kind === kind && h.id === id ? h.side : null;
  };
  const startTabDrag = (e: PointerEvent, id: string) => {
    let last: DragPoint | null = null;
    let raf = 0;
    const dropAt = (p: DragPoint) => {
      const d = tabDropAt(slots(), props.vertical ? p.clientY : p.clientX);
      return d && dropChanges(props.tabs, id, d) ? d : null;
    };
    // With the pointer near an edge of the list, it scrolls (many tabs don't fit in the bar).
    const scroll = () => {
      raf = 0;
      if (!last) return;
      const r = tabsEl.getBoundingClientRect();
      const step = props.vertical ? autoScrollStep(last.clientY, r.top, r.bottom) : autoScrollStep(last.clientX, r.left, r.right);
      const before = props.vertical ? tabsEl.scrollTop : tabsEl.scrollLeft;
      if (props.vertical) tabsEl.scrollTop += step;
      else tabsEl.scrollLeft += step;
      if ((props.vertical ? tabsEl.scrollTop : tabsEl.scrollLeft) === before) return;
      setHover(dropAt(last));
      raf = requestAnimationFrame(scroll);
    };
    startPointerDrag({
      e: { button: e.button, clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, target: e.currentTarget },
      bodyClass: "tab-dragging",
      onMove: (p) => {
        setDragId(id);
        last = p;
        setHover(dropAt(p));
        if (!raf) raf = requestAnimationFrame(scroll);
      },
      onEnd: (p) => {
        cancelAnimationFrame(raf);
        last = null;
        const d = p && dropAt(p);
        setHover(null);
        setDragId(null);
        if (d) props.onDrop(id, d);
      },
      onClick: () => {},
    });
  };
  const compact = () => props.vertical && !!props.collapsed;
  // Width of the vertical bar: while the edge is dragged it lives here; on release it's saved.
  const [dragW, setDragW] = createSignal<number | null>(null);
  const barWidth = () => dragW() ?? props.width ?? DEFAULTS.tabBar.width;
  const startResize = (e: PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = barWidth();
    const [lo, hi] = LIMITS.tabBarWidth;
    // Leaves at least 360 px for the terminals.
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
  // Action first, then close: with the menu closed, Solid no longer lets you read its value (m()).
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
          {/* Sidebar icon: rounded frame with a small bar on the left (same in both states). */}
          <svg width="17" height="14" viewBox="0 0 17 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
            <rect x="0.8" y="0.8" width="15.4" height="12.4" rx="3" />
            <path d="M4.4 4.4v5.2" />
          </svg>
        </button>
      </Show>
      <div class="tabs" ref={tabsEl} role="tablist" aria-orientation={props.vertical ? "vertical" : "horizontal"}>
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
                    data-slot="group"
                    data-id={tab.groupId}
                    classList={{
                      collapsed: g()?.collapsed,
                      "has-active": hasActive(),
                      "drop-before": hoverOn("group", tab.groupId!) === "before",
                      "drop-into": hoverOn("group", tab.groupId!) === "into",
                    }}
                    style={{ "--gcolor": g()?.color ?? "var(--muted)" }}
                    title={t("{name} · {n} pestañas (clic: plegar/desplegar; clic derecho: opciones)", { name: g()?.name ?? t("Carpeta"), n: count() })}
                    onClick={() => g() && props.onGroupUpdate(g()!.id, { collapsed: !g()!.collapsed })}
                    onContextMenu={(e) => g() && openMenu(e, "group", g()!.id)}
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
              data-slot="tab"
              data-id={tab.id}
              style={{ "--tcolor": tab.color ?? groupOf(tab.groupId)?.color ?? "transparent" }}
              onContextMenu={(e) => openMenu(e, "tab", tab.id)}
              role="tab"
              aria-selected={tab.id === props.activeId}
              classList={{
                active: tab.id === props.activeId,
                dragging: dragId() === tab.id,
                grouped: !!tab.groupId,
                "drop-before": hoverOn("tab", tab.id) === "before",
                "drop-after": hoverOn("tab", tab.id) === "after",
              }}
              title={`${tab.tooltip}\n${t(STATUS_LABEL[tab.status])}`}
              onPointerDown={(e) => {
                // Not from the close button or while renaming (there the pointer selects text).
                if (props.editingId === tab.id || (e.target as HTMLElement).closest?.(".close, input")) return;
                startTabDrag(e, tab.id);
              }}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  props.onClose(tab.id); // middle-click closes, like in browsers
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
                    // Without this, the same Enter reaches the terminal when it regains focus.
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
        <div class="new-tab" classList={{ "drop-end": hover()?.kind === "end" }}>
          <button class="btn add" title={t("Pestaña nueva (Ctrl+Shift+T)")} onClick={() => props.onNew()}>
            {/* Drawn: the "+" character isn't centered in every font. */}
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
