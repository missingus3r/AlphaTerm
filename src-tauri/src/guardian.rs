//! Guardián: antes de que un agente borre o modifique archivos, pregunta al usuario.
//!
//! Dónde puede frenar de verdad (y dónde no):
//! - Claude Code lanzado desde AlphaTerm: con un hook PreToolUse (Write, Edit, MultiEdit,
//!   NotebookEdit y comandos de Bash/PowerShell que borran o pisan) que le pregunta a la app.
//! - Comandos que un agente manda por la API de control (`run`, `send`, docker rm…).
//! - Codex: se lanza con su propio modo de aprobación (pregunta en su pantalla).
//! - Otros agentes: Windows no deja frenar escrituras de otro programa sin un driver; ahí solo se
//!   registran los cambios que se ven en la carpeta (aviso posterior).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Delete,
    Modify,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Risk {
    pub kind: Kind,
    pub reason: String,
}

/// Tramos de una línea de comandos (separados por ; & | y paréntesis), cada uno con sus palabras.
fn segments(cmd: &str) -> Vec<Vec<String>> {
    cmd.split(|c: char| c == ';' || c == '&' || c == '|' || c == '(' || c == ')' || c == '\n')
        .map(|seg| seg.split_whitespace().map(|w| w.to_lowercase()).collect::<Vec<_>>())
        .filter(|v| !v.is_empty())
        .collect()
}

/// El programa de un tramo: sin ruta ni .exe, salteando "sudo", "call" y asignaciones VAR=x.
fn program(seg: &[String]) -> (String, &[String]) {
    let mut i = 0;
    while i < seg.len() && (seg[i] == "sudo" || seg[i] == "call" || seg[i] == "." || (seg[i].contains('=') && !seg[i].starts_with('-'))) {
        i += 1;
    }
    let Some(first) = seg.get(i) else { return (String::new(), &[]) };
    let name = first.trim_matches(|c| c == '"' || c == '\'' || c == '`');
    let name = name.rsplit(['\\', '/']).next().unwrap_or(name);
    let name = name.strip_suffix(".exe").unwrap_or(name).to_string();
    (name, &seg[i + 1..])
}

/// ¿Este comando de shell borra o pisa archivos? (PowerShell, cmd y bash.)
pub fn classify_command(cmd: &str) -> Option<Risk> {
    let low = cmd.to_lowercase();
    let del = |r: &str| Some(Risk { kind: Kind::Delete, reason: r.into() });
    let modi = |r: &str| Some(Risk { kind: Kind::Modify, reason: r.into() });

    for seg in segments(cmd) {
        let (prog, rest) = program(&seg);
        let rest: Vec<&str> = rest.iter().map(String::as_str).collect();
        match prog.as_str() {
            "rm" | "rmdir" | "rd" | "del" | "erase" | "remove-item" | "ri" | "unlink" | "shred" => return del("borra archivos o carpetas"),
            "git" => {
                let sub = rest.iter().find(|s| !s.starts_with('-')).copied();
                match sub {
                    Some("clean") => return del("git clean borra archivos sin seguimiento"),
                    Some("reset") if rest.contains(&"--hard") => return del("git reset --hard descarta cambios"),
                    Some("checkout") if rest.contains(&"--") || rest.contains(&".") => return modi("git checkout pisa archivos con la versión del repo"),
                    Some("restore") if !rest.contains(&"--staged") => return modi("git restore descarta cambios"),
                    Some("stash") if rest.contains(&"drop") || rest.contains(&"clear") => return del("borra cambios guardados con stash"),
                    Some("push") if rest.iter().any(|s| *s == "-f" || s.starts_with("--force")) => return modi("push forzado reescribe el remoto"),
                    _ => {}
                }
            }
            "docker" => {
                if rest.first().is_some_and(|s| *s == "rm" || *s == "rmi")
                    || rest.windows(2).any(|p| (p[0] == "volume" || p[0] == "container" || p[0] == "image") && (p[1] == "rm" || p[1] == "prune"))
                    || rest.windows(2).any(|p| p[0] == "system" && p[1] == "prune")
                {
                    return del("borra contenedores, imágenes o volúmenes de Docker");
                }
            }
            "move-item" | "mi" | "mv" | "move" | "ren" | "rename" | "rename-item" => return modi("mueve o renombra archivos"),
            "set-content" | "sc" | "out-file" | "clear-content" | "clc" | "add-content" | "ac" | "truncate" | "tee" | "tee-object" => {
                return modi("escribe sobre archivos")
            }
            "copy-item" | "cp" | "copy" | "xcopy" | "robocopy" => return modi("copia sobre archivos (puede pisar)"),
            "format" | "diskpart" | "format-volume" | "mkfs" => return del("formatea un disco"),
            "sed" if rest.iter().any(|x| x.starts_with("-i")) => return modi("sed -i edita archivos en el lugar"),
            _ => {}
        }
    }
    // Redirecciones que pisan un archivo: "algo > archivo" (no ">>" ni "2>&1" ni "> $null"/"nul").
    let bytes = low.as_bytes();
    for (i, &b) in bytes.iter().enumerate() {
        if b == b'>' {
            let prev = if i > 0 { bytes[i - 1] } else { b' ' };
            let next = bytes.get(i + 1).copied().unwrap_or(b' ');
            if prev == b'>' || next == b'>' || next == b'&' || prev.is_ascii_digit() && prev != b'1' {
                continue;
            }
            let target = low[i + 1..].trim_start();
            if target.starts_with("$null") || target.starts_with("nul") || target.starts_with("/dev/null") {
                continue;
            }
            return modi("redirige la salida a un archivo (lo pisa)");
        }
    }
    None
}

// --- Pedidos al usuario --------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Ask {
    pub id: u64,
    pub kind: Kind,
    /// Quién lo pide ("Claude Code", "API de control"…).
    pub agent: String,
    /// Herramienta o acción ("Edit", "Bash", "run"…).
    pub tool: String,
    pub summary: String,
    pub paths: Vec<String>,
    /// Texto extra (comando, diff de una edición…).
    pub detail: Option<String>,
    pub cwd: Option<String>,
    pub session: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Decision {
    Allow,
    /// Permitir todo lo de este tipo, de esta sesión de agente, por 30 minutos.
    AllowSession,
    Deny,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub at: u64,
    pub ask: Ask,
    pub decision: String,
}

#[derive(Default)]
pub struct GuardianState {
    pub enabled: std::sync::atomic::AtomicBool,
    pub watch_modify: std::sync::atomic::AtomicBool,
    /// Preguntar por lo que hace Claude Code (el hook también está para registrar cambios).
    pub claude: std::sync::atomic::AtomicBool,
    pending: Mutex<HashMap<u64, Sender<Decision>>>,
    open: Mutex<Vec<Ask>>,
    /// (sesión, tipo) → permitido hasta.
    allow_until: Mutex<HashMap<(String, Kind), Instant>>,
    log: Mutex<Vec<LogEntry>>,
    next: std::sync::atomic::AtomicU64,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

impl GuardianState {
    fn push_log(&self, ask: &Ask, decision: &str) {
        let mut l = self.log.lock().unwrap();
        l.push(LogEntry { at: now_ms(), ask: ask.clone(), decision: decision.into() });
        if l.len() > 300 {
            l.remove(0);
        }
    }
}

/// Pregunta al usuario (bloquea hasta que conteste, como mucho `limit`). Sin respuesta: no se permite.
pub fn ask(app: &AppHandle, mut a: Ask, limit: Duration) -> Decision {
    use std::sync::atomic::Ordering::SeqCst;
    let g = app.state::<GuardianState>();
    if !g.enabled.load(SeqCst) || (a.kind == Kind::Modify && !g.watch_modify.load(SeqCst)) {
        g.push_log(&a, "permitido (guardián apagado)");
        return Decision::Allow;
    }
    if let Some(s) = &a.session {
        if g.allow_until.lock().unwrap().get(&(s.clone(), a.kind)).is_some_and(|t| *t > Instant::now()) {
            g.push_log(&a, "permitido (regla de la sesión)");
            return Decision::Allow;
        }
    }
    a.id = g.next.fetch_add(1, SeqCst) + 1;
    let (tx, rx) = channel();
    g.pending.lock().unwrap().insert(a.id, tx);
    g.open.lock().unwrap().push(a.clone());
    let _ = app.emit("guardian-ask", &a);
    // Que la ventana pida atención (titila en la barra de tareas).
    for (label, w) in app.windows() {
        if label != "settings" {
            let _ = w.request_user_attention(Some(tauri::UserAttentionType::Critical));
        }
    }
    let d = rx.recv_timeout(limit).unwrap_or(Decision::Deny);
    g.pending.lock().unwrap().remove(&a.id);
    g.open.lock().unwrap().retain(|x| x.id != a.id);
    let _ = app.emit("guardian-done", a.id);
    if d == Decision::AllowSession {
        if let Some(s) = &a.session {
            g.allow_until.lock().unwrap().insert((s.clone(), a.kind), Instant::now() + Duration::from_secs(30 * 60));
        }
    }
    g.push_log(&a, match d {
        Decision::Allow => "permitido",
        Decision::AllowSession => "permitido (30 min para esta sesión)",
        Decision::Deny => "bloqueado",
    });
    d
}

#[tauri::command]
pub fn guardian_answer(state: tauri::State<GuardianState>, id: u64, decision: Decision) -> bool {
    state.pending.lock().unwrap().get(&id).map(|tx| tx.send(decision).is_ok()).unwrap_or(false)
}

/// Pedidos esperando respuesta (para una ventana que se abre con uno en curso).
#[tauri::command]
pub fn guardian_open(state: tauri::State<GuardianState>) -> Vec<Ask> {
    state.open.lock().unwrap().clone()
}

#[tauri::command]
pub fn guardian_log(state: tauri::State<GuardianState>) -> Vec<LogEntry> {
    state.log.lock().unwrap().iter().rev().cloned().collect()
}

/// Lo que manda el hook de Claude Code: decide si hay que preguntar y arma el pedido.
pub fn from_claude_hook(v: &Value) -> Option<Ask> {
    let tool = v.get("tool_name")?.as_str()?.to_string();
    let input = v.get("tool_input").cloned().unwrap_or(Value::Null);
    let cwd = v.get("cwd").and_then(Value::as_str).map(str::to_string);
    let session = v.get("session_id").and_then(Value::as_str).map(str::to_string);
    let path = input.get("file_path").or_else(|| input.get("notebook_path")).and_then(Value::as_str).map(str::to_string);
    let base = |kind, summary: String, detail: Option<String>| Ask {
        id: 0,
        kind,
        agent: "Claude Code".into(),
        tool: tool.clone(),
        summary,
        paths: path.clone().into_iter().collect(),
        detail,
        cwd: cwd.clone(),
        session: session.clone(),
    };
    match tool.as_str() {
        "Write" => {
            let exists = path.as_deref().is_some_and(|p| std::path::Path::new(p).exists());
            let content = input.get("content").and_then(Value::as_str).unwrap_or("");
            let preview: String = content.lines().take(40).collect::<Vec<_>>().join("\n");
            Some(base(Kind::Modify, if exists { "Quiere reescribir un archivo entero".into() } else { "Quiere crear un archivo".into() }, Some(preview)))
        }
        "Edit" | "MultiEdit" => {
            let detail = if tool == "Edit" {
                let old = input.get("old_string").and_then(Value::as_str).unwrap_or("");
                let new = input.get("new_string").and_then(Value::as_str).unwrap_or("");
                Some(format!("{}\n{}", old.lines().map(|l| format!("- {l}")).collect::<Vec<_>>().join("\n"), new.lines().map(|l| format!("+ {l}")).collect::<Vec<_>>().join("\n")))
            } else {
                let n = input.get("edits").and_then(Value::as_array).map(|a| a.len()).unwrap_or(0);
                Some(format!("{n} cambios en el archivo"))
            };
            Some(base(Kind::Modify, "Quiere editar un archivo".into(), detail))
        }
        "NotebookEdit" => Some(base(Kind::Modify, "Quiere editar un notebook".into(), None)),
        "Bash" | "PowerShell" => {
            let cmd = input.get("command").and_then(Value::as_str).unwrap_or("");
            let r = classify_command(cmd)?;
            Some(Ask { paths: vec![], ..base(r.kind, format!("Quiere correr un comando que {}", r.reason), Some(cmd.to_string())) })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn k(c: &str) -> Option<Kind> {
        classify_command(c).map(|r| r.kind)
    }

    #[test]
    fn detecta_borrados() {
        assert_eq!(k("rm -rf node_modules"), Some(Kind::Delete));
        assert_eq!(k("Remove-Item .\\dist -Recurse -Force"), Some(Kind::Delete));
        assert_eq!(k("del /q build\\*.obj"), Some(Kind::Delete));
        assert_eq!(k("cd x && rmdir /s /q y"), Some(Kind::Delete));
        assert_eq!(k("git clean -fdx"), Some(Kind::Delete));
        assert_eq!(k("git reset --hard HEAD~1"), Some(Kind::Delete));
        assert_eq!(k("docker rm -f web"), Some(Kind::Delete));
        assert_eq!(k("docker system prune -a"), Some(Kind::Delete));
    }

    #[test]
    fn detecta_modificaciones() {
        assert_eq!(k("echo hola > a.txt"), Some(Kind::Modify));
        assert_eq!(k("Set-Content x.txt 'a'"), Some(Kind::Modify));
        assert_eq!(k("git checkout -- src/a.ts"), Some(Kind::Modify));
        assert_eq!(k("git push --force origin main"), Some(Kind::Modify));
        assert_eq!(k("sed -i 's/a/b/' f"), Some(Kind::Modify));
        assert_eq!(k("mv a b"), Some(Kind::Modify));
    }

    #[test]
    fn deja_pasar_lo_inofensivo() {
        assert_eq!(k("git status"), None);
        assert_eq!(k("npm run build 2>&1"), None);
        assert_eq!(k("echo hola >> log.txt"), None);
        assert_eq!(k("dir > $null"), None);
        assert_eq!(k("ls -la"), None);
        assert_eq!(k("git restore --staged a.ts"), None);
        assert_eq!(k("cargo test"), None);
        assert_eq!(k("grep -r 'rm' src"), None, "rm entre comillas como argumento de grep");
    }

    #[test]
    fn arma_el_pedido_desde_el_hook_de_claude() {
        let a = from_claude_hook(&json!({"tool_name": "Edit", "session_id": "s1", "cwd": "C:\\w",
            "tool_input": {"file_path": "C:\\w\\a.ts", "old_string": "uno", "new_string": "dos"}})).unwrap();
        assert_eq!(a.kind, Kind::Modify);
        assert_eq!(a.paths, vec!["C:\\w\\a.ts"]);
        assert_eq!(a.detail.as_deref(), Some("- uno\n+ dos"));
        let b = from_claude_hook(&json!({"tool_name": "Bash", "tool_input": {"command": "rm -rf dist"}})).unwrap();
        assert_eq!(b.kind, Kind::Delete);
        assert!(from_claude_hook(&json!({"tool_name": "Bash", "tool_input": {"command": "ls"}})).is_none());
        assert!(from_claude_hook(&json!({"tool_name": "Read", "tool_input": {"file_path": "x"}})).is_none());
    }
}
