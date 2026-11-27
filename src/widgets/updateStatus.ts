/**
 * Update notice (app-versions): what to show in the footer for the status the update scripts left in
 * status/alphaterm.json. Pure logic; the component is UpdateNotice.tsx.
 */
import { t, type Lang } from "../i18n";
import { cmpVersion } from "./changelog";

export interface UpdateChange {
  es: string;
  en?: string;
  pt?: string;
}

export interface UpdateStatus {
  id: string;
  state: string;
  /** The published version this status is about. */
  version?: string;
  current?: string;
  reason?: string;
  branch?: string;
  log?: string;
  changes?: UpdateChange[];
}

export interface Notice {
  kind: "updating" | "installed" | "blocked" | "failed";
  text: string;
  step?: string;
}

/** States while an update runs: check.mjs writes "updating", update.mjs each step. */
export const IN_PROGRESS = new Set(["updating", "pulling", "deps", "building"]);

function stepText(state: string): string {
  if (state === "deps") return t("dependencias");
  if (state === "building") return t("compilando");
  return t("bajando");
}

function blockedText(s: UpdateStatus, version: string): string {
  switch (s.reason) {
    case "dirty":
    case "unpushed":
      return t("Hay {version}, pero en esta PC tenés cambios sin subir", { version });
    case "branch":
      return t("Hay {version}, pero esta PC está en la rama {branch}", { version, branch: s.branch ?? "" });
    case "ahead-of-version":
    case "diverged":
      return t("Hay {version}, pero el código de esta PC está más adelante", { version });
    default:
      return t("Hay {version}, pero esta PC no puede actualizarse sola", { version });
  }
}

/** The notice for a status, or null when there's nothing to say (also for a version that is already running). */
export function noticeFor(s: UpdateStatus | null, running: string): Notice | null {
  if (!s?.version || cmpVersion(s.version, running) <= 0) return null;
  const version = s.version;
  if (IN_PROGRESS.has(s.state)) return { kind: "updating", text: t("Actualizando a {version}…", { version }), step: stepText(s.state) };
  if (s.state === "installed") return { kind: "installed", text: t("AlphaTerm {version} instalada: se usa la próxima vez que la abras", { version }) };
  if (s.state === "blocked") return { kind: "blocked", text: blockedText(s, version) };
  if (s.state === "failed") return { kind: "failed", text: t("No se pudo actualizar a {version}", { version }) };
  return null;
}

/** A change in the given language, in Spanish when it isn't translated. */
export function changeText(c: UpdateChange, l: Lang): string {
  return (l === "es" ? undefined : c[l]) ?? c.es;
}
