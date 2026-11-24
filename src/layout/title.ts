/**
 * Nombre-resumen de pestaña. Prioridad:
 *   1. título fijado a mano;
 *   2. título OSC que pone el programa en primer plano (por ejemplo Claude Code resume la tarea);
 *   3. heurística: comando en curso + carpeta + rama git ("npm run dev · frontend (main)");
 *   4. (F9) resumen por LLM opcional.
 */
import { t } from "../i18n";

export interface PaneInfo {
  shellName: string;
  /** El shell manda OSC 133: sabemos con certeza si hay un comando corriendo. */
  integrated: boolean;
  running: boolean;
  cwd?: string;
  lastCommand?: string;
  exitCode?: number | null;
  /** Título OSC válido como resumen (puesto por el programa, no por el prompt del shell). */
  agentTitle?: string;
  /** Proceso en primer plano según el backend (descendiente más nuevo del shell). */
  fgProcess?: string;
  branch?: string;
  /** Resumen hecho por un modelo (opcional, F9). */
  llmTitle?: string;
}

/** Títulos que ponen los propios shells o ConPTY: no dicen nada de la tarea. */
export function isShellTitle(t: string): boolean {
  const s = t.trim();
  return (
    s === "" ||
    /\.exe$/i.test(s) ||
    /^(MINGW|UCRT|MSYS|CLANG)(32|64|ARM64)?:/i.test(s) ||
    /^[\w.-]+@[\w.-]+:/.test(s) ||
    /^(Administrador|Administrator):/i.test(s) ||
    /^(Windows PowerShell|PowerShell|Símbolo del sistema|Command Prompt)$/i.test(s)
  );
}

/** cmd pone de título "C:\WINDOWS\system32\cmd.exe - <comando>" mientras corre algo: se extrae el comando. */
export function cmdRunningCommand(t: string): string | null {
  const m = /^(?:.*[\\/])?cmd(?:\.exe)?\s+-\s+(.+)$/i.exec(t.trim());
  return m?.[1]?.trim() || null;
}

/** El comando del título de cmd lleva un espacio de más tras el nombre: si es el mismo que se tipeó, vale el tipeado. */
export function preferTyped(typed: string | undefined, fromTitle: string): string {
  const flat = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return typed && flat(typed) === flat(fromTitle) ? typed : fromTitle;
}

export function folderName(cwd?: string): string {
  if (!cwd) return "";
  const parts = cwd.replace(/[\\/]+$/, "").split(/[\\/]/);
  const last = parts[parts.length - 1] ?? "";
  return /^[a-zA-Z]:$/.test(last) ? `${last}\\` : last;
}

/** "C:\x\node.exe server.js --port 3000" → "node server.js --port" (hasta 3 palabras, 32 caracteres). */
export function commandLabel(cmd?: string): string {
  if (!cmd) return "";
  // En "cd x; npm run dev" lo que corre es lo último; en "git log | less", lo primero del tramo.
  const chain = cmd.split(/;|&&|\|\|/).map((s) => s.trim()).filter(Boolean);
  const segment = (chain[chain.length - 1] ?? "").split("|")[0] ?? "";
  const tokens = segment.trim().match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  // Operadores de llamada de PowerShell (`& "ruta.exe"`, `. script`): no son el comando.
  while (tokens[0] === "&" || tokens[0] === ".") tokens.shift();
  const first = tokens[0];
  if (first === undefined) return "";
  const exe = first.replace(/^["']|["']$/g, "");
  const base = exe.split(/[\\/]/).pop()!.replace(/\.(exe|cmd|bat|ps1)$/i, "");
  const label = [base, ...tokens.slice(1, 3)].join(" ");
  return label.length > 32 ? `${label.slice(0, 31)}…` : label;
}

export function heuristicTitle(p: PaneInfo): string {
  const folder = folderName(p.cwd);
  const place = folder ? (p.branch ? `${folder} (${p.branch})` : folder) : "";
  let what = "";
  if (p.running) what = commandLabel(p.lastCommand) || p.fgProcess || "";
  else if (!p.integrated && p.fgProcess) {
    // Sin integración, el último comando conocido (por ejemplo, del título de cmd) solo vale
    // si coincide con el proceso que está corriendo; si no, puede ser uno viejo.
    const label = commandLabel(p.lastCommand);
    const same = label.split(" ")[0]?.toLowerCase() === p.fgProcess.toLowerCase();
    what = same ? label : p.fgProcess;
  }
  if (what && place) return `${what} · ${place}`;
  return what || place || p.shellName;
}

/** Orden: título que puso el programa > resumen del modelo (si está activado) > heurística. */
export function paneTitle(p: PaneInfo): string {
  return p.agentTitle?.trim() || p.llmTitle?.trim() || heuristicTitle(p);
}

export function tabTitle(manual: string | undefined, focused: PaneInfo | undefined, fallback = t("Terminal")): string {
  if (manual?.trim()) return manual.trim();
  return focused ? paneTitle(focused) : fallback;
}
