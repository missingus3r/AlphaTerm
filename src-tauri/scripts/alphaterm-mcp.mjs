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
//
// Idioma de las descripciones y los mensajes (es, en, pt): ALPHATERM_LANG (también lo tienen las
// pestañas) o, si no está, la clave `language` de settings.json, en la misma carpeta que
// control.json; si no, español. Los errores que manda AlphaTerm ya vienen en su idioma.
import fs from "node:fs";
import path from "node:path";

/** Carpeta de AlphaTerm: la de control.json y settings.json. */
const DIR = path.join(process.env.APPDATA || "", "AlphaTerm");

function detectLang() {
  const ok = (l) => (typeof l === "string" && ["es", "en", "pt"].includes(l.trim().toLowerCase()) ? l.trim().toLowerCase() : null);
  const env = ok(process.env.ALPHATERM_LANG);
  if (env) return env;
  try {
    return ok(JSON.parse(fs.readFileSync(path.join(DIR, "settings.json"), "utf8").replace(/^\uFEFF/, "")).language) ?? "es";
  } catch {
    return "es";
  }
}
const LANG = detectLang();
/** El texto en el idioma elegido: tr(español, inglés, portugués). */
const tr = (es, en, pt) => (LANG === "en" ? en : LANG === "pt" ? pt : es);

function conn() {
  let url = process.env.ALPHATERM_CONTROL_URL;
  let token = process.env.ALPHATERM_CONTROL_TOKEN;
  if (!url || !token) {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(DIR, "control.json"), "utf8"));
      url = c.url;
      token = c.token;
    } catch {
      throw new Error(tr("AlphaTerm no está abierto (no hay control.json)", "AlphaTerm isn't open (there's no control.json)", "O AlphaTerm não está aberto (não há control.json)"));
    }
  }
  return { url, token };
}

async function call(method, params = {}) {
  const { url, token } = conn();
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  if (process.env.ALPHATERM_PANE) headers["X-AlphaTerm-Pane"] = process.env.ALPHATERM_PANE;
  const r = await fetch(`${url}/v1/${method}`, { method: "POST", headers, body: JSON.stringify(params) });
  const data = await r.json().catch(() => ({ error: tr(`respuesta inválida (${r.status})`, `invalid response (${r.status})`, `resposta inválida (${r.status})`) }));
  if (!r.ok || data.error) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

// Parámetros: tipo y descripción (el mismo nombre significa lo mismo en todas las herramientas).
const P = {
  pane: ["string", tr("Id del panel (lo da alphaterm_list).", "Pane id (from alphaterm_list).", "Id do painel (vem de alphaterm_list).")],
  cwd: ["string", tr("Carpeta de trabajo.", "Working folder.", "Pasta de trabalho.")],
  command: ["string", tr("Comando para la shell.", "Shell command.", "Comando para o shell.")],
  background: ["boolean", tr("true: abre la pestaña sin cambiar a ella.", "true: open the tab without switching to it.", "true: abre a aba sem mudar para ela.")],
  direction: ["string", tr("right (a la derecha) o down (abajo).", "right or down.", "right (à direita) ou down (abaixo).")],
  wait: ["boolean", tr("Esperar a que termine (true por defecto).", "Wait for it to finish (default true).", "Esperar terminar (true por padrão).")],
  timeout_ms: ["number", tr("Tiempo máximo de espera, en ms.", "Maximum wait, in ms.", "Tempo máximo de espera, em ms.")],
  text: ["string", tr("Texto a escribir.", "Text to type.", "Texto a digitar.")],
  enter: ["boolean", tr("true: agrega Enter al final.", "true: press Enter at the end.", "true: adiciona Enter no final.")],
  lines: ["number", tr("Cuántas líneas (200 por defecto).", "How many lines (default 200).", "Quantas linhas (200 por padrão).")],
  target: ["string", tr("Nombre o id del contenedor.", "Container name or id.", "Nome ou id do contêiner.")],
  action: ["string", tr("start, stop, restart o rm.", "start, stop, restart or rm.", "start, stop, restart ou rm.")],
  tail: ["number", tr("Cuántas líneas del final (200 por defecto).", "How many lines from the end (default 200).", "Quantas linhas do final (200 por padrão).")],
  url: ["string", tr("Dirección (también valen localhost:5173 o un puerto solo).", "Address (localhost:5173 or just a port also work).", "Endereço (localhost:5173 ou só uma porta também servem).")],
  new: ["boolean", tr("true: abre otro navegador aunque ya haya uno.", "true: open another browser even if there's one already.", "true: abre outro navegador mesmo se já houver um.")],
  browser: ["string", tr("Id del navegador (sin él: el de tu panel o el último abierto).", "Browser id (without it: your pane's, or the last one opened).", "Id do navegador (sem ele: o do seu painel ou o último aberto).")],
  hard: ["boolean", tr("true: recarga sin caché.", "true: reload bypassing the cache.", "true: recarrega sem cache.")],
  selector: ["string", tr("Selector CSS de un elemento.", "CSS selector of an element.", "Seletor CSS de um elemento.")],
  full: ["boolean", tr("true: la página entera.", "true: the whole page.", "true: a página inteira.")],
  max_lines: ["number", tr("Máximo de líneas (400 por defecto).", "Maximum lines (default 400).", "Máximo de linhas (400 por padrão).")],
  x: ["number", tr("Coordenada x (px de la vista).", "X coordinate (viewport px).", "Coordenada x (px da área visível).")],
  y: ["number", tr("Coordenada y (px de la vista).", "Y coordinate (viewport px).", "Coordenada y (px da área visível).")],
  key: ["string", tr("Tecla o combinación (Enter, Ctrl+A…).", "Key or combination (Enter, Ctrl+A…).", "Tecla ou combinação (Enter, Ctrl+A…).")],
  dy: ["number", tr("Píxeles hacia abajo (negativo = arriba).", "Pixels down (negative = up).", "Pixels para baixo (negativo = para cima).")],
  dx: ["number", tr("Píxeles hacia la derecha.", "Pixels to the right.", "Pixels para a direita.")],
  js: ["string", tr("Código JavaScript.", "JavaScript code.", "Código JavaScript.")],
  since: ["number", tr("Último seq visto (trae solo lo nuevo).", "Last seq seen (returns only newer entries).", "Último seq visto (traz só o novo).")],
  errors_only: ["boolean", tr("true: solo errores y avisos.", "true: errors and warnings only.", "true: só erros e avisos.")],
  name: ["string", tr("Nombre de la receta.", "Recipe name.", "Nome da receita.")],
};

const TOOLS = [
  {
    name: "alphaterm_list",
    method: "list",
    description: tr(
      "Lista ventanas, pestañas y paneles de AlphaTerm (id de panel, carpeta, comando en curso, agente). Tu propio panel es la variable ALPHATERM_PANE.",
      "Lists AlphaTerm's windows, tabs and panes (pane id, folder, running command, agent). Your own pane is the ALPHATERM_PANE variable.",
      "Lista janelas, abas e painéis do AlphaTerm (id do painel, pasta, comando em execução, agente). Seu próprio painel está na variável ALPHATERM_PANE.",
    ),
    props: [],
  },
  {
    name: "alphaterm_open_tab",
    method: "open_tab",
    description: tr(
      "Abre una pestaña nueva (opcionalmente en una carpeta y corriendo un comando). Devuelve el id del panel.",
      "Opens a new tab (optionally in a folder and running a command). Returns the pane id.",
      "Abre uma aba nova (opcionalmente em uma pasta e executando um comando). Retorna o id do painel.",
    ),
    props: ["cwd", "command", "background"],
  },
  {
    name: "alphaterm_split",
    method: "split",
    description: tr(
      "Divide un panel (right = a la derecha, down = abajo) y opcionalmente corre un comando en el nuevo. Devuelve el id del panel nuevo.",
      "Splits a pane (right or down) and optionally runs a command in the new one. Returns the new pane's id.",
      "Divide um painel (right = à direita, down = abaixo) e opcionalmente executa um comando no novo. Retorna o id do painel novo.",
    ),
    props: ["pane", "direction", "cwd", "command"],
    required: ["pane"],
  },
  {
    name: "alphaterm_open_window",
    method: "open_window",
    description: tr(
      "Abre una ventana nueva de AlphaTerm (sub ventana) con una pestaña, opcionalmente corriendo un comando.",
      "Opens a new AlphaTerm window (sub-window) with one tab, optionally running a command.",
      "Abre uma janela nova do AlphaTerm (subjanela) com uma aba, opcionalmente executando um comando.",
    ),
    props: ["cwd", "command"],
  },
  {
    name: "alphaterm_run",
    method: "run",
    description: tr(
      "Corre un comando en un panel y (si wait, por defecto) espera a que termine y devuelve la salida y el código. Necesita shell con integración (PowerShell, Git Bash, cmd). Lo que borra o pisa archivos pasa por el guardián (el usuario aprueba).",
      "Runs a command in a pane and (if wait, the default) waits for it to finish and returns the output and exit code. Needs a shell with integration (PowerShell, Git Bash, cmd). Anything that deletes or overwrites files goes through the Guardian (the user approves).",
      "Executa um comando em um painel e (se wait, o padrão) espera terminar e retorna a saída e o código. Precisa de um shell com integração (PowerShell, Git Bash, cmd). O que apaga ou sobrescreve arquivos passa pelo Guardião (o usuário aprova).",
    ),
    props: ["pane", "command", "wait", "timeout_ms"],
    required: ["pane", "command"],
  },
  {
    name: "alphaterm_send",
    method: "send",
    description: tr(
      "Escribe texto en un panel como si se tipeara (por ejemplo respuestas a un programa interactivo). enter=true agrega Enter.",
      "Types text into a pane as if typed (for example answers to an interactive program). enter=true adds Enter.",
      "Digita texto em um painel como se fosse digitado (por exemplo respostas a um programa interativo). enter=true adiciona Enter.",
    ),
    props: ["pane", "text", "enter"],
    required: ["pane", "text"],
  },
  {
    name: "alphaterm_read",
    method: "read",
    description: tr(
      "Lee las últimas líneas que se ven en un panel (salida de un servidor, un build, otro agente…).",
      "Reads the last visible lines of a pane (output of a server, a build, another agent…).",
      "Lê as últimas linhas visíveis de um painel (saída de um servidor, um build, outro agente…).",
    ),
    props: ["pane", "lines"],
    required: ["pane"],
  },
  {
    name: "alphaterm_last_output",
    method: "last_output",
    description: tr(
      "Salida y código del último comando terminado en un panel.",
      "Output and exit code of the last finished command in a pane.",
      "Saída e código do último comando terminado em um painel.",
    ),
    props: ["pane"],
    required: ["pane"],
  },
  {
    name: "alphaterm_close",
    method: "close",
    description: tr("Cierra un panel (y su shell).", "Closes a pane (and its shell).", "Fecha um painel (e seu shell)."),
    props: ["pane"],
    required: ["pane"],
  },
  {
    name: "alphaterm_focus",
    method: "focus",
    description: tr("Muestra un panel al usuario (cambia a su pestaña).", "Shows a pane to the user (switches to its tab).", "Mostra um painel ao usuário (muda para a aba dele)."),
    props: ["pane"],
    required: ["pane"],
  },
  {
    name: "docker_list",
    method: "docker_list",
    description: tr(
      "Contenedores de Docker (todos) y recetas configuradas en AlphaTerm.",
      "Docker containers (all) and the recipes configured in AlphaTerm.",
      "Contêineres do Docker (todos) e receitas configuradas no AlphaTerm.",
    ),
    props: [],
  },
  {
    name: "docker_action",
    method: "docker_action",
    description: tr(
      "start, stop, restart o rm (rm pasa por el guardián) de un contenedor.",
      "start, stop, restart or rm a container (rm goes through the Guardian).",
      "start, stop, restart ou rm de um contêiner (rm passa pelo Guardião).",
    ),
    props: ["target", "action"],
    required: ["target", "action"],
  },
  {
    name: "docker_logs",
    method: "docker_logs",
    description: tr("Últimas líneas de log de un contenedor.", "Last log lines of a container.", "Últimas linhas de log de um contêiner."),
    props: ["target", "tail"],
    required: ["target"],
  },
  {
    name: "browser_open",
    method: "browser_open",
    description: tr(
      "Abre el navegador integrado de AlphaTerm al lado de tu panel (o reusa el que ya tenga tu pestaña) con una URL, por ejemplo el servidor de desarrollo que levantaste. El usuario lo ve y puede marcar elementos para pedirte cambios. new=true abre otro aunque ya haya uno. Devuelve el id del navegador.",
      "Opens AlphaTerm's built-in browser next to your pane (or reuses the one your tab already has) at a URL, for example the dev server you started. The user sees it and can mark elements to ask you for changes. new=true opens another one even if there's one already. Returns the browser id.",
      "Abre o navegador integrado do AlphaTerm ao lado do seu painel (ou reutiliza o que sua aba já tem) com uma URL, por exemplo o servidor de desenvolvimento que você subiu. O usuário o vê e pode marcar elementos para pedir alterações. new=true abre outro mesmo se já houver um. Retorna o id do navegador.",
    ),
    props: ["url", "pane", "direction", "new"],
    required: ["url"],
  },
  {
    name: "browser_list",
    method: "browser_list",
    description: tr(
      "Navegadores integrados abiertos (id, URL, título, panel dueño).",
      "Open built-in browsers (id, URL, title, owner pane).",
      "Navegadores integrados abertos (id, URL, título, painel dono).",
    ),
    props: [],
  },
  {
    name: "browser_navigate",
    method: "browser_navigate",
    description: tr(
      "Lleva el navegador a una URL y espera a que cargue. Sin 'browser' usa el de tu panel (o el último abierto).",
      "Takes the browser to a URL and waits for it to load. Without 'browser' it uses your pane's (or the last one opened).",
      "Leva o navegador a uma URL e espera carregar. Sem 'browser' usa o do seu painel (ou o último aberto).",
    ),
    props: ["browser", "url", "timeout_ms"],
    required: ["url"],
  },
  {
    name: "browser_reload",
    method: "browser_reload",
    description: tr("Recarga la página (hard=true sin caché).", "Reloads the page (hard=true bypasses the cache).", "Recarrega a página (hard=true sem cache)."),
    props: ["browser", "hard"],
  },
  {
    name: "browser_screenshot",
    method: "browser_screenshot",
    description: tr(
      "Captura de lo que se ve en el navegador (full=true: la página entera; selector: solo ese elemento). Devuelve la imagen.",
      "Screenshot of what the browser shows (full=true: the whole page; selector: only that element). Returns the image.",
      "Captura do que aparece no navegador (full=true: a página inteira; selector: só esse elemento). Retorna a imagem.",
    ),
    props: ["browser", "selector", "full"],
  },
  {
    name: "browser_snapshot",
    method: "browser_snapshot",
    description: tr(
      "Estructura de la página como texto: encabezados, textos, links, botones y campos, cada interactivo con su selector {…} para usar en browser_click/browser_type.",
      "Page structure as text: headings, texts, links, buttons and fields, each interactive one with its {…} selector to use in browser_click/browser_type.",
      "Estrutura da página como texto: títulos, textos, links, botões e campos, cada interativo com seu seletor {…} para usar em browser_click/browser_type.",
    ),
    props: ["browser", "max_lines"],
  },
  {
    name: "browser_click",
    method: "browser_click",
    description: tr(
      "Hace clic en un elemento (selector CSS) o en un punto (x, y en px de la vista).",
      "Clicks an element (CSS selector) or a point (x, y in viewport px).",
      "Clica em um elemento (seletor CSS) ou em um ponto (x, y em px da área visível).",
    ),
    props: ["browser", "selector", "x", "y"],
  },
  {
    name: "browser_type",
    method: "browser_type",
    description: tr(
      "Escribe texto (si hay selector, primero hace clic en ese campo).",
      "Types text (if there's a selector, clicks that field first).",
      "Digita texto (se houver selector, clica primeiro nesse campo).",
    ),
    props: ["browser", "text", "selector"],
    required: ["text"],
  },
  {
    name: "browser_key",
    method: "browser_key",
    description: tr(
      "Aprieta una tecla: Enter, Tab, Escape, Backspace, ArrowDown, ... o combinaciones como Ctrl+A.",
      "Presses a key: Enter, Tab, Escape, Backspace, ArrowDown, ... or combinations like Ctrl+A.",
      "Pressiona uma tecla: Enter, Tab, Escape, Backspace, ArrowDown, ... ou combinações como Ctrl+A.",
    ),
    props: ["browser", "key"],
    required: ["key"],
  },
  {
    name: "browser_scroll",
    method: "browser_scroll",
    description: tr(
      "Desplaza la página dy px (negativo = arriba) o hasta un elemento (selector).",
      "Scrolls the page dy px (negative = up) or to an element (selector).",
      "Rola a página dy px (negativo = para cima) ou até um elemento (selector).",
    ),
    props: ["browser", "dy", "dx", "selector"],
  },
  {
    name: "browser_eval",
    method: "browser_eval",
    description: tr(
      "Evalúa JavaScript en la página y devuelve el resultado (espera promesas). Para leer o probar cosas; los cambios de verdad van en el código fuente.",
      "Evaluates JavaScript in the page and returns the result (awaits promises). For reading or testing things; real changes go in the source code.",
      "Avalia JavaScript na página e retorna o resultado (espera promises). Para ler ou testar coisas; as alterações de verdade vão no código-fonte.",
    ),
    props: ["browser", "js"],
    required: ["js"],
  },
  {
    name: "browser_console",
    method: "browser_console",
    description: tr(
      "Mensajes de la consola y errores de la página (since = último seq visto, para traer solo lo nuevo).",
      "Console messages and page errors (since = last seq seen, to get only new ones).",
      "Mensagens do console e erros da página (since = último seq visto, para trazer só o novo).",
    ),
    props: ["browser", "since", "errors_only"],
  },
  {
    name: "browser_marks",
    method: "browser_marks",
    description: tr(
      "Elementos que el usuario marcó en el navegador (etiqueta, texto, selector, HTML, estilos, componente y archivo fuente si se sabe).",
      "Elements the user marked in the browser (tag, text, selector, HTML, styles, component and source file if known).",
      "Elementos que o usuário marcou no navegador (tag, texto, seletor, HTML, estilos, componente e arquivo-fonte, se souber).",
    ),
    props: ["browser"],
  },
  {
    name: "docker_start",
    method: "docker_start",
    description: tr(
      "Inicia una receta de Docker configurada en AlphaTerm (por nombre): la crea si no existe.",
      "Starts a Docker recipe configured in AlphaTerm (by name): creates it if it doesn't exist.",
      "Inicia uma receita do Docker configurada no AlphaTerm (pelo nome): cria se não existir.",
    ),
    props: ["name"],
    required: ["name"],
  },
];

function schema(t) {
  const properties = {};
  for (const k of t.props) {
    const [type, description] = P[k];
    properties[k] = { type, description };
  }
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
          if (!t) throw new Error(tr(`Herramienta desconocida: ${params?.name}`, `Unknown tool: ${params?.name}`, `Ferramenta desconhecida: ${params?.name}`));
          try {
            const r = await call(t.method, params.arguments ?? {});
            const content = [{ type: "text", text: JSON.stringify(r, null, 2) }];
            // Las capturas van también como imagen, para que el agente las vea sin abrir el archivo.
            if (t.method === "browser_screenshot" && r?.path) {
              try {
                content.push({ type: "image", data: fs.readFileSync(r.path).toString("base64"), mimeType: "image/png" });
              } catch {
                /* queda la ruta */
              }
            }
            send({ jsonrpc: "2.0", id, result: { content } });
          } catch (e) {
            send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(e.message || e) }], isError: true } });
          }
        } else if (method === "ping") {
          send({ jsonrpc: "2.0", id, result: {} });
        } else {
          send({ jsonrpc: "2.0", id, error: { code: -32601, message: tr(`Método no soportado: ${method}`, `Unsupported method: ${method}`, `Método não suportado: ${method}`) } });
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
    else
      out(
        tr(
          "Uso: list | run <pane> <comando> | read <pane> [líneas] | open <carpeta> [comando] | call <método> [json]",
          "Usage: list | run <pane> <command> | read <pane> [lines] | open <folder> [command] | call <method> [json]",
          "Uso: list | run <pane> <comando> | read <pane> [linhas] | open <pasta> [comando] | call <método> [json]",
        ),
      );
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(1);
  }
}

if (process.argv.length > 2) cli(process.argv.slice(2));
else mcp();
