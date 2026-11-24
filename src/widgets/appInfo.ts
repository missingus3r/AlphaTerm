/** Versión de la compilación que corre (una sola consulta por ventana). */
import { invoke } from "@tauri-apps/api/core";
import { locale, t } from "../i18n";

export interface AppInfo {
  version: string;
  /** Commit corto; con "+" si había cambios sin commitear al compilar. */
  commit: string;
  /** Unix (segundos). */
  built: number;
  exe: string;
}

let cached: Promise<AppInfo | null> | null = null;
export const appInfo = () => (cached ??= invoke<AppInfo>("app_info").catch(() => null));

/** "AlphaTerm 0.2.0 · commit 60d56fe (con cambios sin commitear) · compilado 20/11/2026 10:35". */
export function versionTooltip(i: AppInfo): string {
  const built = i.built ? new Date(i.built * 1000).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" }) : "?";
  const dirty = i.commit.endsWith("+");
  const hash = i.commit.replace(/\+$/, "");
  const commit = i.commit ? (dirty ? t("commit {hash} (con cambios sin commitear)", { hash }) : t("commit {hash}", { hash })) : t("sin datos de git");
  return `AlphaTerm ${i.version}\n${commit}\n${t("compilado {date}", { date: built })}\n${i.exe}`;
}
