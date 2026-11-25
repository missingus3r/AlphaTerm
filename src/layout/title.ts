/**
 * Tab summary name. Priority:
 *   1. title pinned by hand;
 *   2. OSC title set by the foreground program (for example Claude Code summarizes the task);
 *   3. heuristic: running command + folder + git branch ("npm run dev · frontend (main)");
 *   4. (F9) optional LLM summary.
 */
import { t } from "../i18n";

export interface PaneInfo {
  shellName: string;
  /** The shell sends OSC 133: we know for certain whether a command is running. */
  integrated: boolean;
  running: boolean;
  cwd?: string;
  lastCommand?: string;
  exitCode?: number | null;
  /** Valid OSC title as a summary (set by the program, not by the shell prompt). */
  agentTitle?: string;
  /** Foreground process according to the backend (newest descendant of the shell). */
  fgProcess?: string;
  branch?: string;
  /** Summary made by a model (optional, F9). */
  llmTitle?: string;
}

/** Titles set by the shells themselves or ConPTY: they say nothing about the task. */
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

/** cmd sets the title to "C:\WINDOWS\system32\cmd.exe - <command>" while something runs: the command is extracted. */
export function cmdRunningCommand(t: string): string | null {
  const m = /^(?:.*[\\/])?cmd(?:\.exe)?\s+-\s+(.+)$/i.exec(t.trim());
  return m?.[1]?.trim() || null;
}

/** The command in cmd's title has an extra space after the name: if it's the same one that was typed, the typed one counts. */
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

/** "C:\x\node.exe server.js --port 3000" → "node server.js --port" (up to 3 words, 32 characters). */
export function commandLabel(cmd?: string): string {
  if (!cmd) return "";
  // In "cd x; npm run dev" what runs is the last part; in "git log | less", the first of the stretch.
  const chain = cmd.split(/;|&&|\|\|/).map((s) => s.trim()).filter(Boolean);
  const segment = (chain[chain.length - 1] ?? "").split("|")[0] ?? "";
  const tokens = segment.trim().match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  // PowerShell call operators (`& "ruta.exe"`, `. script`): they aren't the command.
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
    // Without integration, the last known command (for example, from cmd's title) only counts
    // if it matches the running process; otherwise it may be an old one.
    const label = commandLabel(p.lastCommand);
    const same = label.split(" ")[0]?.toLowerCase() === p.fgProcess.toLowerCase();
    what = same ? label : p.fgProcess;
  }
  if (what && place) return `${what} · ${place}`;
  return what || place || p.shellName;
}

/** Order: title set by the program > model summary (if enabled) > heuristic. */
export function paneTitle(p: PaneInfo): string {
  return p.agentTitle?.trim() || p.llmTitle?.trim() || heuristicTitle(p);
}

export function tabTitle(manual: string | undefined, focused: PaneInfo | undefined, fallback = t("Terminal")): string {
  if (manual?.trim()) return manual.trim();
  return focused ? paneTitle(focused) : fallback;
}
