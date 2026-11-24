/**
 * Opciones de arranque de cada agente (las de su `--help` y su documentación), para elegirlas con
 * casillas, listas y deslizadores antes de lanzarlo. Lo elegido se guarda en `AgentDef.launch` y
 * `launchParts` lo convierte en argumentos, con las comillas de la shell donde se escribe.
 *
 * Relevado el 20/11/2026 con Claude Code 2.1.329, Codex 0.170.0, agy 1.5.13 y OpenCode 1.19.1 (sus
 * `--help` y la documentación oficial). OpenCode 2.x cambió los flags de la interfaz (no tiene
 * --model ni --agent): este catálogo es el de la 1.x, la instalada.
 */
import type { AgentDef } from "../settings/schema";
import { k, t } from "../i18n";

export type LaunchValue = string | boolean;
export type LaunchValues = Record<string, LaunchValue>;

export interface Choice {
  value: string;
  label: string;
  hint?: string;
}

/** Dónde va el argumento: subcomando (`codex resume`), primer posicional o flag común. */
type Slot = "sub" | "lead" | "flag";

interface Base {
  key: string;
  label: string;
  hint?: string;
  /** Saltea protecciones: se pinta en rojo. */
  danger?: boolean;
  section: "main" | "session" | "more";
  /** No se repite al reabrir AlphaTerm (el agente ya se retoma con su forma de continuar). */
  session?: boolean;
  slot?: Slot;
  /** Opciones que no se mandan si esta está prendida (el agente no las acepta juntas). */
  conflicts?: string[];
  /** Clave de un `--settings` JSON que junta varias opciones en un solo argumento (agy). */
  json?: string;
}

export type LaunchOpt =
  | (Base & { kind: "bool"; args: string[] })
  | (Base & { kind: "choice"; choices: Choice[]; args: (v: string) => string[] })
  /** Texto con sugerencias (lista desplegable que se puede filtrar escribiendo). `models`: se suman los que informa el agente. */
  | (Base & { kind: "combo"; suggestions: Choice[]; models?: boolean; args: (v: string) => string[] })
  /** Deslizador: la primera posición es "por defecto" (sin flag). */
  | (Base & { kind: "level"; levels: string[]; args: (v: string) => string[] })
  | (Base & { kind: "text"; placeholder?: string; multiline?: boolean; args: (v: string) => string[] });

/** Varios valores en un campo de texto: separados por ";" o saltos de línea. */
const many = (v: string) =>
  v
    .split(/[;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
const each = (flag: string) => (v: string) => many(v).flatMap((x) => [flag, x]);
const one = (flag: string) => (v: string) => [flag, v];

const EFFORT = ["low", "medium", "high", "xhigh", "max"];

const CLAUDE: LaunchOpt[] = [
  {
    key: "model",
    kind: "combo",
    section: "main",
    label: k("Modelo"),
    args: one("--model"),
    suggestions: [
      { value: "default", label: k("El de la cuenta") },
      { value: "best", label: k("El mejor disponible (hoy Opus)") },
      { value: "fable", label: k("Fable (el último Fable)") },
      { value: "opus", label: k("Opus (el último Opus)") },
      { value: "sonnet", label: k("Sonnet (el último Sonnet)") },
      { value: "haiku", label: k("Haiku (el último Haiku)") },
      { value: "opusplan", label: k("Opus para planear, Sonnet para ejecutar") },
      { value: "claude-fable-5-2", label: "Fable 5.2" },
      { value: "claude-opus-5-5", label: "Opus 5.5" },
      { value: "claude-sonnet-5-5", label: "Sonnet 5.5" },
      { value: "claude-haiku-5-5", label: "Haiku 5.5" },
    ],
  },
  {
    key: "effort",
    kind: "level",
    section: "main",
    label: k("Esfuerzo"),
    hint: k("Si la variable CLAUDE_CODE_EFFORT_LEVEL está definida, gana ella"),
    levels: EFFORT,
    args: one("--effort"),
  },
  {
    key: "permissionMode",
    kind: "choice",
    section: "main",
    label: k("Permisos"),
    args: one("--permission-mode"),
    choices: [
      { value: "manual", label: k("Preguntar todo"), hint: k("Pide permiso antes de editar o correr comandos") },
      { value: "acceptEdits", label: k("Aceptar ediciones"), hint: k("Edita archivos sin preguntar; los comandos los sigue preguntando") },
      { value: "plan", label: k("Plan"), hint: k("Solo lee y propone un plan; no cambia nada") },
      { value: "auto", label: "Auto", hint: k("Un clasificador aprueba lo seguro y frena lo riesgoso") },
      { value: "dontAsk", label: k("No preguntar"), hint: k("Rechaza todo lo que no esté permitido en la configuración") },
      { value: "bypassPermissions", label: k("Sin permisos (bypass)"), hint: k("No pregunta nada. Solo para entornos aislados") },
    ],
  },
  {
    key: "skipPermissions",
    kind: "bool",
    section: "main",
    danger: true,
    conflicts: ["permissionMode", "allowSkip"],
    label: k("Saltar todos los permisos"),
    hint: k("--dangerously-skip-permissions: no pregunta nada (las reglas que prohíben siguen valiendo). Recomendado solo en entornos aislados sin internet"),
    args: ["--dangerously-skip-permissions"],
  },
  {
    key: "allowSkip",
    kind: "bool",
    section: "main",
    label: k("Permitir pasar a «sin permisos» con Shift+Tab"),
    hint: k("--allow-dangerously-skip-permissions: no arranca así, pero deja elegirlo en la sesión"),
    args: ["--allow-dangerously-skip-permissions"],
  },
  { key: "continue", kind: "bool", section: "session", session: true, conflicts: ["resume"], label: k("Continuar la última conversación de la carpeta"), args: ["--continue"] },
  { key: "resume", kind: "bool", section: "session", session: true, label: k("Elegir una conversación para retomar"), args: ["--resume"] },
  { key: "fork", kind: "bool", section: "session", session: true, label: k("Al retomar, seguir en una copia nueva (fork)"), args: ["--fork-session"] },
  { key: "worktree", kind: "bool", section: "session", session: true, label: k("Trabajar en un worktree de git nuevo"), args: ["--worktree"] },
  { key: "name", kind: "text", section: "session", label: k("Nombre de la sesión"), placeholder: k("se ve en el prompt y en /resume"), args: one("--name") },
  { key: "prompt", kind: "text", section: "session", session: true, slot: "lead", multiline: true, label: k("Primer mensaje"), placeholder: k("lo manda apenas arranca"), args: (v) => [v] },
  { key: "addDir", kind: "text", section: "more", label: k("Carpetas adicionales"), placeholder: k("C:\\otra\\carpeta; separadas por ;"), args: each("--add-dir") },
  { key: "appendSystemPrompt", kind: "text", section: "more", multiline: true, label: k("Agregar al system prompt"), args: one("--append-system-prompt") },
  {
    key: "systemPrompt",
    kind: "text",
    section: "more",
    multiline: true,
    label: k("Reemplazar el system prompt"),
    hint: k("Reemplaza todo el de Claude Code: casi siempre conviene «Agregar»"),
    args: one("--system-prompt"),
  },
  { key: "allowedTools", kind: "text", section: "more", label: k("Herramientas permitidas sin preguntar"), placeholder: "Bash(git *),Edit", args: one("--allowed-tools") },
  { key: "disallowedTools", kind: "text", section: "more", label: k("Herramientas prohibidas"), placeholder: "WebFetch,Bash(rm *)", args: one("--disallowed-tools") },
  { key: "agent", kind: "text", section: "more", label: k("Subagente principal"), placeholder: k("nombre de un agente propio"), args: one("--agent") },
  { key: "fallbackModel", kind: "text", section: "more", label: k("Modelos de respaldo"), placeholder: "sonnet,haiku", args: one("--fallback-model") },
  {
    key: "chrome",
    kind: "choice",
    section: "more",
    label: "Claude in Chrome",
    args: (v) => [v === "on" ? "--chrome" : "--no-chrome"],
    choices: [
      { value: "on", label: k("Prendido") },
      { value: "off", label: k("Apagado") },
    ],
  },
  { key: "ide", kind: "bool", section: "more", label: k("Conectarse al IDE abierto"), args: ["--ide"] },
  { key: "remoteControl", kind: "bool", section: "more", label: k("Control remoto (seguirla desde el celular o la web)"), args: ["--remote-control"] },
  { key: "brief", kind: "bool", section: "more", label: k("Mensajes al usuario (SendUserMessage)"), args: ["--brief"] },
  { key: "verbose", kind: "bool", section: "more", label: k("Detallado (verbose)"), args: ["--verbose"] },
  { key: "debug", kind: "bool", section: "more", label: k("Modo debug"), args: ["--debug"] },
  { key: "safeMode", kind: "bool", section: "more", label: k("Modo seguro (sin CLAUDE.md, skills, plugins, hooks ni MCP)"), args: ["--safe-mode"] },
  {
    key: "bare",
    kind: "bool",
    section: "more",
    label: k("Mínimo (--bare)"),
    hint: k("Sin hooks, plugins ni CLAUDE.md, y solo con API key: el guardián y el panel de modificaciones no lo ven"),
    args: ["--bare"],
  },
  { key: "restricted", kind: "bool", section: "more", label: k("Restringido (sin herramientas que corren código)"), args: ["--restricted"] },
  { key: "disableSlash", kind: "bool", section: "more", label: k("Sin skills ni comandos /"), args: ["--disable-slash-commands"] },
  { key: "screenReader", kind: "bool", section: "more", label: k("Salida para lector de pantalla"), args: ["--ax-screen-reader"] },
  { key: "autocompact", kind: "text", section: "more", label: k("Compactar al llegar a (tokens)"), placeholder: k("auto o 200000"), args: one("--autocompact") },
  { key: "pluginDir", kind: "text", section: "more", label: k("Plugins solo para esta sesión"), placeholder: k("carpeta o .zip; separadas por ;"), args: each("--plugin-dir") },
];

const CODEX: LaunchOpt[] = [
  { key: "model", kind: "combo", section: "main", label: k("Modelo"), models: true, suggestions: [], args: one("--model") },
  {
    key: "effort",
    kind: "level",
    section: "main",
    label: k("Razonamiento"),
    levels: ["low", "medium", "high", "xhigh", "max", "ultra"],
    args: (v) => ["-c", `model_reasoning_effort=${v}`],
  },
  {
    key: "sandbox",
    kind: "choice",
    section: "main",
    label: "Sandbox",
    args: one("--sandbox"),
    choices: [
      { value: "read-only", label: k("Solo lectura") },
      { value: "workspace-write", label: k("Escribir en la carpeta") },
      { value: "danger-full-access", label: k("Acceso total (sin sandbox)") },
    ],
  },
  {
    key: "approval",
    kind: "choice",
    section: "main",
    label: k("Aprobaciones"),
    args: one("--ask-for-approval"),
    choices: [
      { value: "on-request", label: k("Cuando el modelo lo pida") },
      { value: "never", label: k("Nunca (los errores vuelven al modelo)") },
    ],
  },
  {
    key: "approveForMe",
    kind: "bool",
    section: "main",
    conflicts: ["sandbox"],
    label: k("Auto: revisión automática de aprobaciones"),
    hint: k("--approve-for-me: un revisor automático aprueba, con sandbox de escritura en la carpeta"),
    args: ["--approve-for-me"],
  },
  {
    key: "yolo",
    kind: "bool",
    section: "main",
    danger: true,
    conflicts: ["sandbox", "approval", "approveForMe"],
    label: k("Sin aprobaciones ni sandbox (yolo)"),
    hint: k("--dangerously-bypass-approvals-and-sandbox: solo para entornos aislados"),
    args: ["--dangerously-bypass-approvals-and-sandbox"],
  },
  {
    key: "resumeLast",
    kind: "bool",
    section: "session",
    session: true,
    slot: "sub",
    conflicts: ["resume", "forkLast"],
    label: k("Continuar la última conversación"),
    args: ["resume", "--last"],
  },
  { key: "resume", kind: "bool", section: "session", session: true, slot: "sub", conflicts: ["forkLast"], label: k("Elegir una conversación para retomar"), args: ["resume"] },
  { key: "forkLast", kind: "bool", section: "session", session: true, slot: "sub", label: k("Seguir la última en una copia nueva (fork)"), args: ["fork", "--last"] },
  { key: "worktree", kind: "bool", section: "session", session: true, label: k("Trabajar en un worktree de git nuevo"), args: ["--worktree"] },
  { key: "prompt", kind: "text", section: "session", session: true, slot: "lead", multiline: true, label: k("Primer mensaje"), args: (v) => [v] },
  { key: "fast", kind: "bool", section: "main", label: k("Modo rápido (más velocidad, más consumo)"), args: ["-c", "service_tier=fast"] },
  { key: "search", kind: "bool", section: "more", label: k("Búsqueda web en vivo"), args: ["--search"] },
  { key: "network", kind: "bool", section: "more", label: k("Red dentro del sandbox de escritura"), args: ["-c", "sandbox_workspace_write.network_access=true"] },
  {
    key: "developerInstructions",
    kind: "text",
    section: "more",
    multiline: true,
    label: k("Agregar instrucciones (system prompt)"),
    args: (v) => ["-c", `developer_instructions=${v}`],
  },
  {
    key: "verbosity",
    kind: "choice",
    section: "more",
    label: k("Largo de las respuestas"),
    args: (v) => ["-c", `model_verbosity=${v}`],
    choices: [
      { value: "low", label: k("Cortas") },
      { value: "medium", label: k("Medianas") },
      { value: "high", label: k("Largas") },
    ],
  },
  {
    key: "reasoningSummary",
    kind: "choice",
    section: "more",
    label: k("Resumen del razonamiento"),
    args: (v) => ["-c", `model_reasoning_summary=${v}`],
    choices: ["auto", "concise", "detailed", "none"].map((v) => ({ value: v, label: v })),
  },
  { key: "addDir", kind: "text", section: "more", label: k("Carpetas adicionales con escritura"), placeholder: k("separadas por ;"), args: each("--add-dir") },
  { key: "profile", kind: "text", section: "more", label: k("Perfil de configuración"), placeholder: k("nombre en $CODEX_HOME"), args: one("--profile") },
  { key: "oss", kind: "bool", section: "more", label: k("Modelo local (--oss)"), args: ["--oss"] },
  {
    key: "localProvider",
    kind: "choice",
    section: "more",
    label: k("Proveedor local"),
    args: one("--local-provider"),
    choices: [
      { value: "ollama", label: "Ollama" },
      { value: "lmstudio", label: "LM Studio" },
    ],
  },
  { key: "noAltScreen", kind: "bool", section: "more", label: k("Sin pantalla alternativa (deja el historial en la terminal)"), args: ["--no-alt-screen"] },
  { key: "noDaemon", kind: "bool", section: "more", label: k("Sin el servidor compartido de fondo"), args: ["--no-daemon"] },
  { key: "enable", kind: "text", section: "more", label: k("Activar funciones"), placeholder: k("nombres de `codex features`; separados por ;"), args: each("--enable") },
  { key: "disable", kind: "text", section: "more", label: k("Desactivar funciones"), placeholder: k("separados por ;"), args: each("--disable") },
  { key: "config", kind: "text", section: "more", label: k("Otros ajustes (-c)"), placeholder: k("clave=valor; separados por ;"), args: each("-c") },
];

const AGY: LaunchOpt[] = [
  { key: "model", kind: "combo", section: "main", label: k("Modelo"), models: true, suggestions: [], args: one("--model") },
  { key: "effort", kind: "level", section: "main", label: k("Esfuerzo"), levels: EFFORT, args: one("--effort") },
  {
    key: "mode",
    kind: "choice",
    section: "main",
    label: k("Modo"),
    args: one("--mode"),
    choices: [
      { value: "accept-edits", label: k("Aceptar ediciones") },
      { value: "auto", label: "Auto" },
      { value: "plan", label: k("Plan") },
    ],
  },
  {
    key: "skipPermissions",
    kind: "bool",
    section: "main",
    danger: true,
    label: k("Saltar todos los permisos"),
    hint: k("--dangerously-skip-permissions: aprueba todo sin preguntar"),
    args: ["--dangerously-skip-permissions"],
  },
  { key: "sandbox", kind: "bool", section: "main", label: k("Sandbox (terminal con restricciones)"), args: ["--sandbox"] },
  {
    key: "toolPermission",
    kind: "choice",
    section: "main",
    json: "toolPermission",
    label: k("Permiso de herramientas"),
    args: () => [],
    choices: [
      { value: "request-review", label: k("Pedir revisión"), hint: k("Pregunta antes de usar herramientas") },
      { value: "proceed-in-sandbox", label: k("Seguir dentro del sandbox"), hint: k("Corre sin preguntar lo que queda contenido en el sandbox") },
      { value: "always-proceed", label: k("Seguir siempre"), hint: k("No pregunta") },
      { value: "strict", label: k("Estricto"), hint: k("Pregunta todo") },
    ],
  },
  { key: "continue", kind: "bool", section: "session", session: true, conflicts: ["conversation"], label: k("Continuar la última conversación"), args: ["--continue"] },
  { key: "conversation", kind: "text", section: "session", session: true, label: k("Retomar una conversación por id"), args: one("--conversation") },
  { key: "newProject", kind: "bool", section: "session", session: true, label: k("Proyecto nuevo para esta sesión"), args: ["--new-project"] },
  { key: "prompt", kind: "text", section: "session", session: true, multiline: true, label: k("Primer mensaje"), args: one("--prompt-interactive") },
  { key: "addDir", kind: "text", section: "more", label: k("Carpetas adicionales"), placeholder: k("separadas por ;"), args: each("--add-dir") },
  { key: "agent", kind: "text", section: "more", label: k("Agente"), placeholder: k("ver `agy agents`"), args: one("--agent") },
  { key: "project", kind: "text", section: "more", label: k("Proyecto (id o nombre)"), args: one("--project") },
  { key: "remoteControl", kind: "bool", section: "more", label: k("Control remoto"), args: ["--remote-control"] },
  { key: "remoteAgent", kind: "bool", section: "more", label: k("Agentes remotos"), args: ["--remote-agent"] },
  {
    key: "verbosity",
    kind: "choice",
    section: "more",
    json: "verbosity",
    label: k("Detalle de la salida"),
    args: () => [],
    choices: [
      { value: "low", label: k("Poco") },
      { value: "medium", label: k("Normal") },
      { value: "high", label: k("Mucho") },
    ],
  },
  { key: "logFile", kind: "text", section: "more", label: k("Archivo de log"), args: one("--log-file") },
];

const OPENCODE: LaunchOpt[] = [
  { key: "model", kind: "combo", section: "main", label: k("Modelo"), models: true, suggestions: [], args: one("--model") },
  {
    key: "agent",
    kind: "combo",
    section: "main",
    label: k("Agente"),
    args: one("--agent"),
    suggestions: [
      { value: "build", label: k("build (el de siempre: edita y corre comandos)") },
      { value: "plan", label: k("plan (solo analiza; pide permiso para editar)") },
    ],
  },
  {
    key: "auto",
    kind: "bool",
    section: "main",
    danger: true,
    label: k("Aprobar todo lo que no esté prohibido"),
    hint: k("--auto: aprueba los permisos que la configuración no niega explícitamente"),
    args: ["--auto"],
  },
  { key: "continue", kind: "bool", section: "session", session: true, label: k("Continuar la última sesión"), args: ["--continue"] },
  { key: "session", kind: "text", section: "session", session: true, label: k("Retomar una sesión por id"), args: one("--session") },
  { key: "fork", kind: "bool", section: "session", session: true, label: k("Al retomar, seguir en una copia nueva (fork)"), args: ["--fork"] },
  { key: "prompt", kind: "text", section: "session", session: true, multiline: true, label: k("Primer mensaje"), args: one("--prompt") },
  { key: "mini", kind: "bool", section: "more", label: k("Interfaz mínima"), args: ["--mini"] },
  { key: "pure", kind: "bool", section: "more", label: k("Sin plugins externos"), args: ["--pure"] },
  {
    key: "logLevel",
    kind: "choice",
    section: "more",
    label: k("Nivel de log"),
    args: one("--log-level"),
    choices: ["DEBUG", "INFO", "WARN", "ERROR"].map((v) => ({ value: v, label: v })),
  },
  { key: "printLogs", kind: "bool", section: "more", label: k("Mostrar los logs"), args: ["--print-logs"] },
  { key: "port", kind: "text", section: "more", label: k("Puerto del servidor"), placeholder: k("0 = uno libre"), args: one("--port") },
];

const CATALOG: Record<string, LaunchOpt[]> = { claude: CLAUDE, codex: CODEX, agy: AGY, opencode: OPENCODE };

/** Programa del agente: el primer token del comando, sin carpeta ni extensión ("claude", "codex"…). */
export const agentKind = (command: string) =>
  (command.trim().match(/^"([^"]*)"|^\S+/)?.[1] ?? command.trim().split(/\s+/)[0] ?? "")
    .split(/[\\/]/)
    .pop()!
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1)$/, "");

export const optionsFor = (command: string): LaunchOpt[] => CATALOG[agentKind(command)] ?? [];

// --- Comillas según la shell -----------------------------------------------------------------

export type ShellKind = "ps5" | "pwsh" | "cmd" | "posix";

export const shellKindOf = (profileId: string): ShellKind =>
  profileId === "powershell" ? "ps5" : profileId === "pwsh" ? "pwsh" : profileId === "gitbash" || profileId === "wsl" ? "posix" : "cmd";

/** Un argumento listo para escribir en la shell. Lo simple va tal cual. */
export function quoteArg(arg: string, shell: ShellKind): string {
  if (/^[A-Za-z0-9_\-./\\:=]+$/.test(arg)) return arg;
  switch (shell) {
    case "posix":
      return `'${arg.replace(/'/g, `'\\''`)}'`;
    case "ps5":
      // PowerShell 5.1 pierde las comillas dobles internas al pasarle el argumento a un .exe: van como \".
      return `'${arg.replace(/'/g, "''").replace(/"/g, '\\"')}'`;
    case "pwsh":
      return `'${arg.replace(/'/g, "''")}'`;
    default:
      return `"${arg.replace(/"/g, '\\"')}"`;
  }
}

const isSet = (v: LaunchValue | undefined) => (typeof v === "boolean" ? v : typeof v === "string" && v.trim() !== "");

/** La opción prendida que deja afuera a `key` (no se aceptan juntas), si hay una. */
export function blockedBy(agent: Pick<AgentDef, "command" | "launch">, key: string): LaunchOpt | undefined {
  const values = agent.launch ?? {};
  return optionsFor(agent.command).find((o) => o.key !== key && o.conflicts?.includes(key) && isSet(values[o.key]));
}

/** Argumentos elegidos, separados por lugar. `resuming`: sin los de sesión (al reabrir AlphaTerm). */
export function launchParts(agent: Pick<AgentDef, "command" | "launch">, opts: { resuming?: boolean } = {}) {
  const parts: Record<Slot, string[]> = { sub: [], lead: [], flag: [] };
  const values = agent.launch ?? {};
  const json: Record<string, string> = {};
  for (const o of optionsFor(agent.command)) {
    const v = values[o.key];
    if (!isSet(v) || (opts.resuming && o.session) || blockedBy(agent, o.key)) continue;
    if (o.json) {
      json[o.json] = String(v).trim();
      continue;
    }
    const args = o.kind === "bool" ? o.args : o.args(String(v).trim());
    parts[o.slot ?? "flag"].push(...args);
  }
  if (Object.keys(json).length) parts.flag.push("--settings", JSON.stringify(json));
  return parts;
}

/** Línea de comando del agente con las opciones elegidas (más `extra`, que va al final). */
export function buildCommand(agent: Pick<AgentDef, "command" | "launch">, shell: ShellKind, extra: string[] = [], opts: { resuming?: boolean; resumeArgs?: string } = {}): string {
  const p = launchParts(agent, opts);
  const q = (xs: string[]) => xs.map((x) => quoteArg(x, shell));
  return [agent.command.trim(), opts.resumeArgs ?? "", ...q(p.sub), ...q(p.lead), ...q(p.flag), ...extra].filter(Boolean).join(" ");
}

/** Resumen corto de lo elegido (para debajo del nombre del agente), en el idioma actual. */
export function launchSummary(agent: Pick<AgentDef, "command" | "launch">): string {
  const values = agent.launch ?? {};
  const out: string[] = [];
  for (const o of optionsFor(agent.command)) {
    const v = values[o.key];
    if (!isSet(v) || o.section !== "main" || blockedBy(agent, o.key)) continue;
    if (o.kind === "bool") out.push(o.danger ? `⚠ ${t(o.label).toLowerCase()}` : t(o.label).split(" (")[0].split(":")[0].toLowerCase());
    else if (o.kind === "choice") {
      const c = o.choices.find((c) => c.value === v);
      out.push(c ? t(c.label).toLowerCase() : String(v));
    }
    else out.push(String(v));
  }
  const more = Object.keys(values).filter((k) => isSet(values[k]) && optionsFor(agent.command).some((o) => o.key === k && o.section !== "main")).length;
  if (more) out.push(`+${more}`);
  return out.join(" · ");
}
