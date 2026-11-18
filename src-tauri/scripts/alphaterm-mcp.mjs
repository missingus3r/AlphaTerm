#!/usr/bin/env node
// AlphaTerm: servidor MCP (stdio) y CLI para la API de control. Sin dependencias.
//
//   Como MCP:  node alphaterm-mcp.mjs            (Claude Code, Codex, etc. lo lanzan solos)
//   Como CLI:  node alphaterm-mcp.mjs list
//              node alphaterm-mcp.mjs run <pane> "npm test"
//              node alphaterm-mcp.mjs call <método> '{"json": "params"}'
//
// Usa ALPHATERM_CONTROL_URL / ALPHATERM_CONTROL_TOKEN (las tienen las pestañas de AlphaTerm) o,
// si no están, %APPDATA%\AlphaTerm\control.json.
import fs from "node:fs";
import path from "node:path";

function conn() {
  let url = process.env.ALPHATERM_CONTROL_URL;
  let token = process.env.ALPHATERM_CONTROL_TOKEN;
  if (!url || !token) {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA || "", "AlphaTerm", "control.json"), "utf8"));
      url = c.url;
      token = c.token;
    } catch {
      throw new Error("AlphaTerm no está abierto (no hay control.json)");
    }
  }
  return { url, token };
}

async function call(method, params = {}) {
  const { url, token } = conn();
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  if (process.env.ALPHATERM_PANE) headers["X-AlphaTerm-Pane"] = process.env.ALPHATERM_PANE;
  const r = await fetch(`${url}/v1/${method}`, { method: "POST", headers, body: JSON.stringify(params) });
  const data = await r.json().catch(() => ({ error: `respuesta inválida (${r.status})` }));
  if (!r.ok || data.error) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

const TOOLS = [
  { name: "alphaterm_list", method: "list", description: "Lista ventanas, pestañas y paneles de AlphaTerm (id de panel, carpeta, comando en curso, agente). Tu propio panel es la variable ALPHATERM_PANE.", props: {} },
  { name: "alphaterm_open_tab", method: "open_tab", description: "Abre una pestaña nueva (opcionalmente en una carpeta y corriendo un comando). Devuelve el id del panel.", props: { cwd: "string", command: "string", background: "boolean" } },
  { name: "alphaterm_split", method: "split", description: "Divide un panel (right = a la derecha, down = abajo) y opcionalmente corre un comando en el nuevo. Devuelve el id del panel nuevo.", props: { pane: "string", direction: "string", cwd: "string", command: "string" }, required: ["pane"] },
  { name: "alphaterm_open_window", method: "open_window", description: "Abre una ventana nueva de AlphaTerm (sub ventana) con una pestaña, opcionalmente corriendo un comando.", props: { cwd: "string", command: "string" } },
  { name: "alphaterm_run", method: "run", description: "Corre un comando en un panel y (si wait, por defecto) espera a que termine y devuelve la salida y el código. Necesita shell con integración (PowerShell, Git Bash, cmd). Lo que borra o pisa archivos pasa por el guardián (el usuario aprueba).", props: { pane: "string", command: "string", wait: "boolean", timeout_ms: "number" }, required: ["pane", "command"] },
  { name: "alphaterm_send", method: "send", description: "Escribe texto en un panel como si se tipeara (por ejemplo respuestas a un programa interactivo). enter=true agrega Enter.", props: { pane: "string", text: "string", enter: "boolean" }, required: ["pane", "text"] },
  { name: "alphaterm_read", method: "read", description: "Lee las últimas líneas que se ven en un panel (salida de un servidor, un build, otro agente…).", props: { pane: "string", lines: "number" }, required: ["pane"] },
  { name: "alphaterm_last_output", method: "last_output", description: "Salida y código del último comando terminado en un panel.", props: { pane: "string" }, required: ["pane"] },
  { name: "alphaterm_close", method: "close", description: "Cierra un panel (y su shell).", props: { pane: "string" }, required: ["pane"] },
  { name: "alphaterm_focus", method: "focus", description: "Muestra un panel al usuario (cambia a su pestaña).", props: { pane: "string" }, required: ["pane"] },
  { name: "docker_list", method: "docker_list", description: "Contenedores de Docker (todos) y recetas configuradas en AlphaTerm.", props: {} },
  { name: "docker_action", method: "docker_action", description: "start, stop, restart o rm (rm pasa por el guardián) de un contenedor.", props: { target: "string", action: "string" }, required: ["target", "action"] },
  { name: "docker_logs", method: "docker_logs", description: "Últimas líneas de log de un contenedor.", props: { target: "string", tail: "number" }, required: ["target"] },
  { name: "docker_start", method: "docker_start", description: "Inicia una receta de Docker configurada en AlphaTerm (por nombre): la crea si no existe.", props: { name: "string" }, required: ["name"] },
];

function schema(t) {
  const properties = {};
  for (const [k, type] of Object.entries(t.props)) properties[k] = { type };
  return { type: "object", properties, required: t.required ?? [] };
}

async function mcp() {
  let buf = "";
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", async (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const { id, method, params } = msg;
      if (id === undefined) continue; // notificaciones
      try {
        if (method === "initialize") {
          send({ jsonrpc: "2.0", id, result: { protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "alphaterm", version: "1.0.0" } } });
        } else if (method === "tools/list") {
          send({ jsonrpc: "2.0", id, result: { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: schema(t) })) } });
        } else if (method === "tools/call") {
          const t = TOOLS.find((x) => x.name === params?.name);
          if (!t) throw new Error(`Herramienta desconocida: ${params?.name}`);
          try {
            const r = await call(t.method, params.arguments ?? {});
            send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] } });
          } catch (e) {
            send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(e.message || e) }], isError: true } });
          }
        } else if (method === "ping") {
          send({ jsonrpc: "2.0", id, result: {} });
        } else {
          send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Método no soportado: ${method}` } });
        }
      } catch (e) {
        send({ jsonrpc: "2.0", id, error: { code: -32000, message: String(e.message || e) } });
      }
    }
  });
}

async function cli(args) {
  const [cmd, ...rest] = args;
  const out = (v) => console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
  try {
    if (cmd === "list") out(await call("list"));
    else if (cmd === "run") out(await call("run", { pane: rest[0], command: rest.slice(1).join(" ") }));
    else if (cmd === "read") out((await call("read", { pane: rest[0], lines: Number(rest[1] || 200) })).text);
    else if (cmd === "open") out(await call("open_tab", { cwd: rest[0], command: rest.slice(1).join(" ") || undefined }));
    else if (cmd === "call") out(await call(rest[0], rest[1] ? JSON.parse(rest[1]) : {}));
    else out("Uso: list | run <pane> <comando> | read <pane> [líneas] | open <carpeta> [comando] | call <método> [json]");
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(1);
  }
}

if (process.argv.length > 2) cli(process.argv.slice(2));
else mcp();
