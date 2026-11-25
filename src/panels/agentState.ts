import { k } from "../i18n";

/**
 * State of an agent launched in a tab, based on what the pane knows:
 * - shell integration (a command running or not) or, without integration, the foreground process;
 * - output activity: agents with a text interface repaint while they work
 *   (spinners, streaming), so a few seconds of silence with the agent alive = waiting for input;
 * - the bell (BEL), which several agents use to ask for attention.
 */
export type AgentState = "starting" | "working" | "waiting" | "attention" | "done" | "exited";

export interface AgentPaneInfo {
  exited?: boolean;
  integrated: boolean;
  running: boolean;
  fgProcess?: string;
  /** Output in the last few seconds. */
  active?: boolean;
  bell?: boolean;
  /** The agent's command has already started at some point in this pane. */
  agentStarted?: boolean;
  exitCode?: number | null;
}

export function agentRunning(p: AgentPaneInfo): boolean {
  return p.integrated ? p.running : !!p.fgProcess;
}

/** Something is running in the pane (an agent or a command): closing it cuts it off. */
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

/** Label of each state (in Spanish: shown with `t`). */
export const AGENT_STATE_LABEL: Record<AgentState, string> = {
  starting: k("Arrancando"),
  working: k("Trabajando"),
  waiting: k("Esperando input"),
  attention: k("Te necesita"),
  done: k("Terminó"),
  exited: k("Pestaña cerrada"),
};

/** Command line an agent starts with (what is typed in the shell). */
export function agentCommandLine(command: string): string {
  return command.trim().replace(/[\r\n]+/g, " ");
}

/** "KEY=value" text per line → object (invalid lines are ignored). */
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

/** Adds a folder at the start of the recent ones (no repeats, at most 12). */
export function pushRecent(list: string[], dir: string): string[] {
  const norm = (d: string) => d.replace(/[\\/]+$/, "").toLowerCase();
  return [dir, ...list.filter((d) => norm(d) !== norm(dir))].slice(0, 12);
}
