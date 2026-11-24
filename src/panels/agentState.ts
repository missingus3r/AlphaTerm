import { k } from "../i18n";

/**
 * Estado de un agente lanzado en una pestaña, a partir de lo que sabe el panel:
 * - integración de la shell (comando en curso o no) o, sin integración, el proceso en primer plano;
 * - actividad de la salida: los agentes con interfaz de texto se repintan mientras trabajan
 *   (spinners, streaming), así que unos segundos de silencio con el agente vivo = esperando input;
 * - la campana (BEL), que varios agentes usan para pedir atención.
 */
export type AgentState = "starting" | "working" | "waiting" | "attention" | "done" | "exited";

export interface AgentPaneInfo {
  exited?: boolean;
  integrated: boolean;
  running: boolean;
  fgProcess?: string;
  /** Salida en los últimos segundos. */
  active?: boolean;
  bell?: boolean;
  /** El comando del agente ya arrancó alguna vez en este panel. */
  agentStarted?: boolean;
  exitCode?: number | null;
}

export function agentRunning(p: AgentPaneInfo): boolean {
  return p.integrated ? p.running : !!p.fgProcess;
}

/** Hay algo corriendo en el panel (un agente o un comando): cerrarlo lo corta. */
export function paneBusy(p: AgentPaneInfo): boolean {
  return !p.exited && agentRunning(p);
}

export function agentState(p: AgentPaneInfo): AgentState {
  if (p.exited) return "exited";
  if (!p.agentStarted) return "starting";
  if (!agentRunning(p)) return "done";
  if (p.bell) return "attention";
  return p.active ? "working" : "waiting";
}

/** Etiqueta de cada estado (en español: se muestra con `t`). */
export const AGENT_STATE_LABEL: Record<AgentState, string> = {
  starting: k("Arrancando"),
  working: k("Trabajando"),
  waiting: k("Esperando input"),
  attention: k("Te necesita"),
  done: k("Terminó"),
  exited: k("Pestaña cerrada"),
};

/** Línea de comando con la que arranca un agente (lo que se escribe en la shell). */
export function agentCommandLine(command: string): string {
  return command.trim().replace(/[\r\n]+/g, " ");
}

/** Texto "CLAVE=valor" por línea → objeto (las líneas inválidas se ignoran). */
export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) out[k] = line.slice(i + 1);
  }
  return out;
}

export const envToText = (env: Record<string, string>) =>
  Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

/** Agrega una carpeta al principio de las recientes (sin repetir, máximo 12). */
export function pushRecent(list: string[], dir: string): string[] {
  const norm = (d: string) => d.replace(/[\\/]+$/, "").toLowerCase();
  return [dir, ...list.filter((d) => norm(d) !== norm(dir))].slice(0, 12);
}
