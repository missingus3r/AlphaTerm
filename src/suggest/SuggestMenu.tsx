/**
 * Suggestion menu below the cursor (or above if it doesn't fit). It positions it using the terminal's cell size;
 * the letters that match what was typed are highlighted.
 *
 * Descriptions arrive in Spanish (marked with `k()` in the catalog, the engine and the
 * generators) and are translated here. Those that are not our texts (PowerShell help, an npm script's
 * command, Docker data) have no translation and `t` leaves them as they come.
 */
import { createEffect, For, Show, type JSX } from "solid-js";
import { t } from "../i18n";
import type { Kind } from "./engine";
import type { MenuView } from "./controller";

/** Position of the xterm screen within the pane and cell size, in px. */
export interface Geom {
  x: number;
  y: number;
  cw: number;
  ch: number;
  w: number;
  h: number;
}

const ICON: Record<Kind, string> = { folder: "📁", file: "📄", history: "🕘", command: "›", option: "-", value: "•", pwsh: "PS" };
const ROW_H = 24;
const MAX_ROWS = 8;
const WIDTH_GUESS = 360;
const px = (n: number) => `${Math.round(n)}px`;

function highlight(label: string, hits: number[] | undefined): JSX.Element {
  if (!hits?.length) return label;
  const set = new Set(hits);
  const parts: JSX.Element[] = [];
  let run = "";
  let bold = false;
  const flush = () => {
    if (run) parts.push(bold ? <b>{run}</b> : run);
    run = "";
  };
  for (let i = 0; i < label.length; i++) {
    const b = set.has(i);
    if (b !== bold) {
      flush();
      bold = b;
    }
    run += label[i];
  }
  flush();
  return parts;
}

export function SuggestMenu(props: { view: MenuView; geom: Geom; font: string; onPick: (i: number) => void }) {
  let list: HTMLDivElement | undefined;
  const style = (): JSX.CSSProperties => {
    const g = props.geom;
    const v = props.view;
    const h = Math.min(MAX_ROWS, v.items.length) * ROW_H + 10;
    const left = Math.max(4, Math.min(g.x + v.col * g.cw - 10, g.w - WIDTH_GUESS));
    const below = g.y + (v.row + 1) * g.ch + 2;
    const above = g.y + v.row * g.ch - 2;
    const up = below + h > g.h - 4 && above - h > 0;
    return up
      ? { left: px(left), bottom: px(g.h - above), "font-family": props.font }
      : { left: px(left), top: px(below), "font-family": props.font };
  };
  createEffect(() => {
    const el = list?.children[props.view.selected] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  });
  return (
    <div class="suggest-menu" style={style()} onMouseDown={(e) => e.preventDefault()}>
      <div class="sg-list" ref={list}>
        <For each={props.view.items}>
          {(it, i) => (
            <div
              class="sg-row"
              classList={{ sel: i() === props.view.selected, firm: props.view.navigating }}
              title={it.desc ? t(it.desc) : ""}
              onClick={() => props.onPick(i())}
            >
              <span class={`sg-ico sg-${it.kind}`}>{ICON[it.kind]}</span>
              <span class="sg-label">{highlight(it.label, it.hits)}</span>
              <Show when={it.desc}>
                {(desc) => <span class="sg-desc">{t(desc())}</span>}
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
