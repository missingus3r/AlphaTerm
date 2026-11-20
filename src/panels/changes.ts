/** Lógica pura del panel de modificaciones (sin Tauri, para testearla). */

export interface ChangeSummary {
  id: number;
  path: string;
  firstAt: number;
  lastAt: number;
  agents: string[];
  tools: string[];
  events: number;
  /** De dónde salió la versión de antes: "hook", "carpeta", "git" o "ninguna". */
  baseFrom: string;
  inGit: boolean;
  pdf: boolean;
  adds: number;
  dels: number;
  version: number;
  manual: boolean;
  created: boolean;
  deleted: boolean;
  kind: "text" | "binary" | "tooBig" | "unreadable";
  size: number | null;
  editable: boolean;
}

export type ChangeFilter = "all" | "git" | "nogit";

export function matchesFilter(c: ChangeSummary, f: ChangeFilter, query: string): boolean {
  if (f === "git" && !c.inGit) return false;
  if (f === "nogit" && c.inGit) return false;
  const q = query.trim().toLowerCase();
  return !q || c.path.toLowerCase().includes(q);
}

export function totals(list: ChangeSummary[]) {
  return { files: list.length, adds: list.reduce((a, c) => a + c.adds, 0), dels: list.reduce((a, c) => a + c.dels, 0) };
}

/** Etiquetas de un archivo, en orden de importancia. */
export function changeTags(c: ChangeSummary): { label: string; cls: string; title: string }[] {
  const t: { label: string; cls: string; title: string }[] = [];
  if (c.created) t.push({ label: "nuevo", cls: "ok", title: "El archivo no existía antes del agente" });
  if (c.deleted) t.push({ label: "borrado", cls: "bad", title: "El archivo ya no existe" });
  if (c.inGit) t.push({ label: "en git", cls: "git", title: "Está en un repositorio git (también aparece en el panel de git)" });
  if (c.pdf) t.push({ label: "PDF (texto)", cls: "", title: "Se compara el texto del PDF" });
  if (c.baseFrom === "git") t.push({ label: "vs último commit", cls: "", title: "No entró en la copia de la carpeta: se compara con el último commit" });
  if (c.baseFrom === "ninguna" && !c.created) t.push({ label: "sin copia previa", cls: "old", title: "No se sabe cómo era antes: se muestra el contenido actual entero" });
  if (c.manual) t.push({ label: "editado a mano", cls: "nt", title: "El último cambio lo hiciste vos desde este panel" });
  return t;
}
