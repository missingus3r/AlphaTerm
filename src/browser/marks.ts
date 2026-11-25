import { t } from "../i18n";

/** Data of an element marked in the browser (built by the `browser-overlay.js` layer). */
export interface Mark {
  n: number;
  tag: string;
  id?: string;
  classes?: string[];
  text?: string;
  selector: string;
  attrs?: Record<string, string>;
  html?: string;
  rect?: { x: number; y: number; w: number; h: number };
  styles?: Record<string, string>;
  component?: { framework: string; name: string; chain?: string[]; source?: { file?: string; line?: number } | null } | null;
}

/** Short name for the chip: `button.primary «Enviar»` or the component if there is one. */
export function markLabel(m: Mark): string {
  let s = m.component?.name ? `${m.component.name} ‹${m.tag}›` : m.tag + (m.id ? `#${m.id}` : m.classes?.length ? `.${m.classes.slice(0, 2).join(".")}` : "");
  const text = (m.text ?? "").trim();
  if (text) s += ` ${t("«{text}»", { text: text.length > 24 ? text.slice(0, 24) + "…" : text })}`;
  return s;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const intersects = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * What floats over AlphaTerm's interface (menus, modals, previews). The browser is another
 * WebView2 on top of the window: nothing in the interface can cover it, so while any of this
 * overlaps it, the browser is hidden.
 */
export const FLOATING = ".settings-overlay, .modal-backdrop, .guardian-backdrop, .ctx-menu, .menu, .sys-pop, .usage-pop, .path-preview, .suggest-menu, .floating";

export function coveredBy(area: Box, doc: Pick<Document, "querySelectorAll">): boolean {
  for (const el of doc.querySelectorAll<HTMLElement>(FLOATING)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (getComputedStyle(el).display === "none" || getComputedStyle(el).visibility === "hidden") continue;
    if (intersects(area, r)) return true;
  }
  return false;
}
