//! API de control para agentes: un servidor HTTP local (solo 127.0.0.1, con token) que deja a un
//! agente ver y manejar AlphaTerm: listar pestañas, abrir pestañas, paneles y ventanas, correr
//! comandos y leer su salida, y manejar Docker. Lo destructivo pasa por el guardián.
//!
//! - La URL y el token quedan en `%APPDATA%\AlphaTerm\control.json` y en las variables
//!   ALPHATERM_CONTROL_URL / ALPHATERM_CONTROL_TOKEN de cada pestaña (el token cambia en cada inicio).
//! - `alphaterm-mcp.mjs` (en la misma carpeta) es un servidor MCP y también un CLI para usarla.
//! - Lo que depende de las ventanas (pestañas, buffers) se le pregunta al frontend por eventos.

use crate::guardian::{self, Ask, Decision, Kind};
use crate::i18n::tr;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct ControlState {
    pub enabled: AtomicBool,
    token: Mutex<String>,
    url: Mutex<String>,
    pending: Mutex<HashMap<u64, Sender<Value>>>,
    next: AtomicU64,
    presets: Mutex<Vec<crate::docker::Preset>>,
}

impl ControlState {
    /// Variables para las shells nuevas (vacío si la API está apagada).
    pub fn env(&self) -> Vec<(String, String)> {
        if !self.enabled.load(Ordering::SeqCst) {
            return vec![];
        }
        let dir = crate::settings::data_dir();
        vec![
            ("ALPHATERM_CONTROL_URL".into(), self.url.lock().unwrap().clone()),
            ("ALPHATERM_CONTROL_TOKEN".into(), self.token.lock().unwrap().clone()),
            ("ALPHATERM_CTL".into(), dir.join("alphaterm-mcp.mjs").display().to_string()),
        ]
    }
}

fn random_token() -> String {
    let mut b = [0u8; 24];
    let _ = getrandom::fill(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Arranca el servidor y escribe los scripts auxiliares.
pub fn start(app: AppHandle) {
    let server = match tiny_http::Server::http("127.0.0.1:0") {
        Ok(s) => s,
        Err(e) => {
            eprintln!("API de control: no se pudo abrir el puerto: {e}");
            return;
        }
    };
    let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(0);
    let token = random_token();
    let url = format!("http://127.0.0.1:{port}");
    {
        let st = app.state::<ControlState>();
        *st.token.lock().unwrap() = token.clone();
        *st.url.lock().unwrap() = url.clone();
        st.enabled.store(true, Ordering::SeqCst);
    }
    write_files(&url, &token);
    std::thread::Builder::new()
        .name("control-http".into())
        .spawn(move || {
            for req in server.incoming_requests() {
                let app = app.clone();
                std::thread::spawn(move || handle(app, req));
            }
        })
        .ok();
}

fn write_files(url: &str, token: &str) {
    let dir = crate::settings::data_dir();
    let _ = std::fs::create_dir_all(&dir);
    let _ = crate::settings::save_to(&dir.join("control.json"), &json!({ "url": url, "token": token, "pid": std::process::id() }));
    let _ = std::fs::write(dir.join("alphaterm-mcp.mjs"), MCP_JS);
    let _ = std::fs::write(dir.join("guardian-hook.mjs"), HOOK_JS);
    let fwd = |p: std::path::PathBuf| p.display().to_string().replace('\\', "/");
    let hook_cmd = format!("node \"{}\"", fwd(dir.join("guardian-hook.mjs")));
    // Stop: avisa cuándo Claude Code terminó de contestar (el navegador pasa de "trabajando" a "listo").
    let stop = json!([ { "hooks": [ { "type": "command", "command": hook_cmd, "timeout": 15 } ] } ]);
    let _ = crate::settings::save_to(&dir.join("claude-stop.json"), &json!({ "hooks": { "Stop": stop.clone() } }));
    let _ = crate::settings::save_to(
        &dir.join("claude-guardian.json"),
        &json!({ "hooks": {
            "PreToolUse": [ { "matcher": "Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell", "hooks": [ { "type": "command", "command": hook_cmd, "timeout": 600 } ] } ],
            "PostToolUse": [ { "matcher": "Write|Edit|MultiEdit|NotebookEdit", "hooks": [ { "type": "command", "command": hook_cmd, "timeout": 30 } ] } ],
            "Stop": stop
        } }),
    );
    let _ = crate::settings::save_to(
        &dir.join("claude-mcp.json"),
        &json!({ "mcpServers": { "alphaterm": { "type": "stdio", "command": "node", "args": [fwd(dir.join("alphaterm-mcp.mjs"))] } } }),
    );
}

fn respond(req: tiny_http::Request, code: u16, body: Value) {
    let hdr = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json; charset=utf-8"[..]).unwrap();
    let _ = req.respond(tiny_http::Response::from_string(body.to_string()).with_status_code(code).with_header(hdr));
}

fn handle(app: AppHandle, mut req: tiny_http::Request) {
    let st = app.state::<ControlState>();
    let token = st.token.lock().unwrap().clone();
    let auth = req.headers().iter().find(|h| h.field.equiv("Authorization")).map(|h| h.value.as_str().to_string()).unwrap_or_default();
    if auth != format!("Bearer {token}") {
        return respond(req, 401, json!({ "error": tr("token inválido", "invalid token", "token inválido") }));
    }
    if !st.enabled.load(Ordering::SeqCst) {
        return respond(
            req,
            403,
            json!({ "error": tr(
                "La API de control está apagada en la configuración de AlphaTerm",
                "The control API is turned off in AlphaTerm's settings",
                "A API de controle está desligada nas configurações do AlphaTerm"
            ) }),
        );
    }
    let method = req.url().trim_start_matches("/v1/").trim_matches('/').to_string();
    let mut body = String::new();
    let _ = req.as_reader().take(4 * 1024 * 1024).read_to_string(&mut body);
    let params: Value = if body.trim().is_empty() { json!({}) } else { serde_json::from_str(&body).unwrap_or(json!({})) };
    let caller = req.headers().iter().find(|h| h.field.equiv("X-AlphaTerm-Pane")).map(|h| h.value.as_str().to_string());
    match dispatch(&app, &method, params, caller) {
        Ok(v) => respond(req, 200, v),
        Err(e) => respond(req, 400, json!({ "error": e })),
    }
}

fn s(p: &Value, k: &str) -> Option<String> {
    p.get(k).and_then(Value::as_str).map(str::to_string)
}

/// Pregunta al guardián por un comando que va a una shell.
fn guard_command(app: &AppHandle, cmd: &str, caller: &Option<String>, pane: &Option<String>) -> Result<(), String> {
    let Some(r) = guardian::classify_command(cmd) else { return Ok(()) };
    let ask = Ask {
        id: 0,
        kind: r.kind,
        agent: match caller {
            Some(c) => tr!("Agente vía API (desde el panel {c})", "Agent via API (from pane {c})", "Agente via API (do painel {c})"),
            None => api_agent().into(),
        },
        tool: "run".into(),
        summary: guardian::command_summary(&r.reason),
        paths: vec![],
        detail: Some(cmd.to_string()),
        cwd: None,
        session: caller.clone().or_else(|| pane.clone()),
    };
    match guardian::ask(app, ask, Duration::from_secs(600)) {
        Decision::Deny => Err(tr(
            "El guardián de AlphaTerm bloqueó el comando (el usuario no lo permitió).",
            "AlphaTerm's Guardian blocked the command (the user didn't allow it).",
            "O Guardião do AlphaTerm bloqueou o comando (o usuário não permitiu).",
        )
        .into()),
        _ => Ok(()),
    }
}

/// Quién pide algo por la API (para el guardián).
fn api_agent() -> &'static str {
    tr("Agente vía API", "Agent via API", "Agente via API")
}

/// "falta <parámetro>" (el nombre del parámetro no se traduce).
fn missing(name: &str) -> String {
    tr!("falta {name}", "missing {name}", "falta {name}")
}

pub fn dispatch(app: &AppHandle, method: &str, p: Value, caller: Option<String>) -> Result<Value, String> {
    let st = app.state::<ControlState>();
    match method {
        "ping" => Ok(json!({ "ok": true, "app": "AlphaTerm", "version": env!("CARGO_PKG_VERSION") })),
        "help" => Ok(json!({ "methods": [
            "list", "read {pane, lines}", "last_output {pane}", "run {pane, command, wait, timeout_ms}", "send {pane, text, enter}",
            "open_tab {cwd, command, window, background}", "split {pane, direction: right|down, cwd, command}",
            "open_window {cwd, command}", "close {pane}", "focus {pane}",
            "docker_list", "docker_action {target, action: start|stop|restart|rm}", "docker_logs {target, tail}", "docker_start {name}",
            "browser_open {url, pane, direction: right|down, new}", "browser_list", "browser_navigate {browser, url}", "browser_reload {browser, hard}",
            "browser_screenshot {browser, selector, full}", "browser_click {browser, selector | x, y}", "browser_type {browser, text, selector}",
            "browser_key {browser, key}", "browser_scroll {browser, dy, dx, selector}", "browser_eval {browser, js}", "browser_snapshot {browser, max_lines}",
            "browser_console {browser, since, errors_only}", "browser_marks {browser}"
        ] })),
        // --- Navegador integrado (el backend lo maneja por DevTools; abrir uno lo hace el frontend) ---
        "browser_open" => {
            let mut p = p;
            if let Some(c) = &caller {
                p["caller"] = json!(c);
            }
            ask_windows(app, "browser_open", p, Duration::from_secs(30), false)
        }
        m if m.starts_with("browser_") => crate::browser::control(app, m, &p, &caller),
        // Hook Stop de Claude Code: el agente de ese panel terminó de contestar.
        "agent_stop" => {
            if let Some(c) = &caller {
                let _ = app.emit("agent-stop", json!({ "pane": c }));
            }
            Ok(json!({ "ok": true }))
        }
        // --- Docker (directo en el backend) ---
        "docker_list" => Ok(json!({ "containers": crate::docker::containers()?, "presets": *st.presets.lock().unwrap() })),
        "docker_logs" => Ok(json!({ "logs": crate::docker::logs(&s(&p, "target").ok_or_else(|| missing("target"))?, p.get("tail").and_then(Value::as_u64).unwrap_or(200) as u32)? })),
        "docker_action" => {
            let target = s(&p, "target").ok_or_else(|| missing("target"))?;
            let act = s(&p, "action").ok_or_else(|| missing("action"))?;
            if act == "rm" {
                let ask = Ask {
                    id: 0,
                    kind: Kind::Delete,
                    agent: api_agent().into(),
                    tool: "docker rm".into(),
                    summary: tr!("Quiere borrar el contenedor {target}", "Wants to delete the container {target}", "Quer apagar o contêiner {target}"),
                    paths: vec![],
                    detail: None,
                    cwd: None,
                    session: caller.clone(),
                };
                if guardian::ask(app, ask, Duration::from_secs(600)) == Decision::Deny {
                    return Err(tr("El guardián bloqueó el borrado del contenedor.", "The Guardian blocked deleting the container.", "O Guardião bloqueou a exclusão do contêiner.").into());
                }
            }
            Ok(json!({ "result": crate::docker::action(&target, &act)? }))
        }
        "docker_start" => {
            let name = s(&p, "name").ok_or_else(|| missing("name"))?;
            let preset = st.presets.lock().unwrap().iter().find(|x| x.name.eq_ignore_ascii_case(&name)).cloned().ok_or_else(|| {
                tr!("No hay una receta de Docker llamada {name}", "There's no Docker recipe named {name}", "Não há uma receita do Docker chamada {name}")
            })?;
            Ok(json!({ "result": crate::docker::start_preset(&preset)? }))
        }
        // --- Guardián (lo llama el hook de Claude Code) ---
        "guardian" => {
            // Copia de cómo estaba el archivo, para el panel de modificaciones.
            crate::changes::hook_pre(&app.state::<crate::changes::ChangesState>().0, &p);
            if !app.state::<guardian::GuardianState>().claude.load(Ordering::SeqCst) {
                return Ok(json!({ "decision": "allow", "reason": tr("el guardián no vigila a Claude Code", "the Guardian isn't watching Claude Code", "o Guardião não está vigiando o Claude Code") }));
            }
            let Some(mut ask) = guardian::from_claude_hook(&p) else {
                return Ok(json!({ "decision": "allow", "reason": tr("no hace falta preguntar", "no need to ask", "não é preciso perguntar") }));
            };
            if let Some(c) = &caller {
                ask.agent = tr!("{} (panel {c})", "{} (pane {c})", "{} (painel {c})"; ask.agent);
            }
            let d = guardian::ask(app, ask, Duration::from_secs(590));
            Ok(json!({ "decision": if d == Decision::Deny { "deny" } else { "allow" } }))
        }
        // PostToolUse del hook: cómo quedó el archivo.
        "changes_post" => {
            crate::changes::hook_post(&app.state::<crate::changes::ChangesState>().0, &p);
            Ok(json!({ "ok": true }))
        }
        // --- Lo que maneja el frontend ---
        "run" | "send" => {
            let text = s(&p, if method == "run" { "command" } else { "text" }).ok_or_else(|| tr("falta el comando", "missing command", "falta o comando"))?;
            if method == "run" || p.get("enter").and_then(Value::as_bool).unwrap_or(false) {
                guard_command(app, &text, &caller, &s(&p, "pane"))?;
            }
            let timeout = p.get("timeout_ms").and_then(Value::as_u64).unwrap_or(120_000).min(30 * 60_000);
            ask_windows(app, method, p, Duration::from_millis(timeout + 5000), false)
        }
        "open_window" => {
            // Se crea la ventana desde acá con un layout de una pestaña; el panel ya tiene su id.
            let pane = format!("p{}", random_token()[..10].to_string());
            let tab = format!("t{}", random_token()[..10].to_string());
            let cmd = s(&p, "command").unwrap_or_default();
            if !cmd.is_empty() {
                guard_command(app, &cmd, &caller, &None)?;
            }
            let leaf = json!({ "kind": "leaf", "id": pane, "profileId": s(&p, "profile").unwrap_or_else(|| "powershell".into()), "cwd": s(&p, "cwd"),
                "startup": if cmd.is_empty() { Value::Null } else { json!({ "command": cmd }) } });
            let layout = json!({ "version": 1, "layout": { "tabs": [ { "id": tab, "root": leaf, "activePane": pane } ], "activeTab": tab } });
            let label = tauri::async_runtime::block_on(crate::windows::window_new(app.clone(), Some(layout)))?;
            Ok(json!({ "window": label, "tab": tab, "pane": pane }))
        }
        "list" => ask_windows(app, "list", p, Duration::from_secs(5), true),
        "read" | "last_output" | "open_tab" | "split" | "close" | "focus" => {
            if let Some(c) = s(&p, "command") {
                guard_command(app, &c, &caller, &None)?;
            }
            ask_windows(app, method, p, Duration::from_secs(15), false)
        }
        other => Err(tr!("Método desconocido: {other}. Probá 'help'.", "Unknown method: {other}. Try 'help'.", "Método desconhecido: {other}. Tente 'help'.")),
    }
}

/// Le pregunta a las ventanas de terminal. `all`: junta las respuestas de todas (list); si no, vale
/// la primera que no diga "no es mío".
fn ask_windows(app: &AppHandle, method: &str, params: Value, limit: Duration, all: bool) -> Result<Value, String> {
    let st = app.state::<ControlState>();
    let labels: Vec<String> = app.windows().into_keys().filter(|l| l != "settings").collect();
    if labels.is_empty() {
        return Err(tr("No hay ventanas de terminal abiertas", "No terminal windows are open", "Não há janelas de terminal abertas").into());
    }
    let (tx, rx) = channel::<Value>();
    let mut ids = Vec::new();
    for l in &labels {
        let id = st.next.fetch_add(1, Ordering::SeqCst) + 1;
        st.pending.lock().unwrap().insert(id, tx.clone());
        ids.push(id);
        // Para métodos sin panel (open_tab), contesta la ventana pedida o la principal.
        let _ = app.emit_to(l, "control-request", json!({ "id": id, "method": method, "params": params, "window": l, "windows": labels }));
    }
    drop(tx);
    let deadline = std::time::Instant::now() + limit;
    let mut parts = Vec::new();
    let mut answered = 0;
    let result = loop {
        let left = deadline.saturating_duration_since(std::time::Instant::now());
        match rx.recv_timeout(left) {
            Ok(v) => {
                answered += 1;
                if all {
                    if let Some(r) = v.get("result") {
                        parts.push(r.clone());
                    }
                    if answered == labels.len() {
                        break Ok(json!({ "windows": parts }));
                    }
                } else if v.get("notMine").and_then(Value::as_bool) != Some(true) {
                    break match v.get("error").and_then(Value::as_str) {
                        Some(e) => Err(e.to_string()),
                        None => Ok(v.get("result").cloned().unwrap_or(Value::Null)),
                    };
                } else if answered == labels.len() {
                    break Err(tr("Ese panel no existe (usá list para ver los ids)", "That pane doesn't exist (use list to see the ids)", "Esse painel não existe (use list para ver os ids)").into());
                }
            }
            Err(_) => {
                break if all {
                    Ok(json!({ "windows": parts }))
                } else {
                    Err(tr("Las ventanas no contestaron a tiempo", "The windows didn't answer in time", "As janelas não responderam a tempo").into())
                };
            }
        }
    };
    let mut pend = st.pending.lock().unwrap();
    for id in ids {
        pend.remove(&id);
    }
    result
}

/// Respuesta del frontend a un `control-request`.
#[tauri::command]
pub fn control_respond(state: tauri::State<ControlState>, id: u64, reply: Value) {
    if let Some(tx) = state.pending.lock().unwrap().get(&id) {
        let _ = tx.send(reply);
    }
}

/// La configuración (API prendida, guardián, recetas de Docker) llega desde el frontend.
#[tauri::command]
pub fn control_config(
    state: tauri::State<ControlState>,
    guard: tauri::State<guardian::GuardianState>,
    enabled: bool,
    guardian_on: bool,
    guardian_modify: bool,
    guardian_claude: Option<bool>,
    presets: Vec<crate::docker::Preset>,
) {
    state.enabled.store(enabled, Ordering::SeqCst);
    guard.enabled.store(guardian_on, Ordering::SeqCst);
    guard.watch_modify.store(guardian_modify, Ordering::SeqCst);
    guard.claude.store(guardian_claude.unwrap_or(true), Ordering::SeqCst);
    *state.presets.lock().unwrap() = presets;
}

/// Rutas de los archivos para lanzar agentes con el guardián y el MCP de AlphaTerm.
#[tauri::command]
pub fn control_files() -> Value {
    let d = crate::settings::data_dir();
    json!({
        "claudeSettings": d.join("claude-guardian.json").display().to_string(),
        "claudeStop": d.join("claude-stop.json").display().to_string(),
        "claudeMcp": d.join("claude-mcp.json").display().to_string(),
        "mcpScript": d.join("alphaterm-mcp.mjs").display().to_string(),
    })
}

const MCP_JS: &str = include_str!("../scripts/alphaterm-mcp.mjs");
const HOOK_JS: &str = include_str!("../scripts/guardian-hook.mjs");
