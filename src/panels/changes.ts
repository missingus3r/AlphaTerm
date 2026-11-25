/** Pure logic of the Changes panel (no Tauri, so it can be tested). */
import { k } from "../i18n";

export interface ChangeSummary {
  id: number;
  path: string;
  firstAt: number;
  lastAt: number;
  agents: string[];
  tools: string[];
  events: number;
  /** Where the previous version came from: "hook", "carpeta", "git" or "ninguna". */
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

/** Labels of a file, in order of importance (`label` and `title` are translated with `t` when shown). */
export function changeTags(c: ChangeSummary): { label: string; cls: string; title: string }[] {
  const tags: { label: string; cls: string; title: string }[] = [];
  if (c.created) tags.push({ label: k("nuevo"), cls: "ok", title: k("El archivo no existía antes del agente") });
  if (c.deleted) tags.push({ label: k("borrado"), cls: "bad", title: k("El archivo ya no existe") });
  if (c.inGit) tags.push({ label: k("en git"), cls: "git", title: k("Está en un repositorio git (también aparece en el panel de git)") });
  if (c.pdf) tags.push({ label: k("PDF (texto)"), cls: "", title: k("Se compara el texto del PDF") });
  if (c.baseFrom === "git") tags.push({ label: k("vs último commit"), cls: "", title: k("No entró en la copia de la carpeta: se compara con el último commit") });
  if (c.baseFrom === "ninguna" && !c.created) tags.push({ label: k("sin copia previa"), cls: "old", title: k("No se sabe cómo era antes: se muestra el contenido actual entero") });
  if (c.manual) tags.push({ label: k("editado a mano"), cls: "nt", title: k("El último cambio lo hiciste vos desde este panel") });
  return tags;
}
