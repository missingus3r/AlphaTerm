/** Datos de un elemento marcado en el navegador (los arma la capa `browser-overlay.js`). */
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

/** Nombre corto para el chip: `button.primary «Enviar»` o el componente si lo hay. */
export function markLabel(m: Mark): string {
  let s = m.component?.name ? `${m.component.name} ‹${m.tag}›` : m.tag + (m.id ? `#${m.id}` : m.classes?.length ? `.${m.classes.slice(0, 2).join(".")}` : "");
  const t = (m.text ?? "").trim();
  if (t) s += ` «${t.length > 24 ? t.slice(0, 24) + "…" : t}»`;
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
 * Lo que flota en la interfaz de AlphaTerm (menús, modales, vistas previas). El navegador es otro
 * WebView2 encima de la ventana: nada de la interfaz lo puede tapar, así que mientras algo de esto
 * se superpone, el navegador se esconde.
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
