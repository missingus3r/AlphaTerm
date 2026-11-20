//! Consumo "en vivo", como el System dashboard: se abre cada CLI escondida en una pseudoconsola
//! (ConPTY, sin ventana), se le escribe su comando de consumo y se lee la pantalla.
//! - Claude: `claude` → /usage (sesión de 5 h, semana, semana por modelo, uso extra, plan).
//! - Codex: `codex` → /status (límites de 5 h y semanal, plan y modelo).
//! - agy: `agy -p /quota --output-format json` (oficial, en JSON y sin gastar cuota).
//!
//! agy va siempre con AGY_CLI_DISABLE_AUTO_UPDATE=true (exactamente "true": agy ignora "1"). Sin
//! esa variable, cada consulta puede lanzar su actualizador fuera de la consola escondida y en
//! Windows aparece una ventana de cmd un instante (el destello que se veía cada 10 minutos).

use crate::usage::{Group, Table, Usage, UsageWindow};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde_json::Value;
use std::io::{Read, Write};
use std::num::NonZeroU16;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

pub const AGY_NO_UPDATE: (&str, &str) = ("AGY_CLI_DISABLE_AUTO_UPDATE", "true");

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn home() -> PathBuf {
    std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_default()
}

/// Carpeta donde se abren Claude y Codex para preguntar (la misma que usa el dashboard: así no
/// piden confirmar que se confía en la carpeta).
fn probe_dir() -> PathBuf {
    let d = home().join("Desktop");
    if d.is_dir() {
        d
    } else {
        home()
    }
}

// --- Programa de pantalla completa escondido ----------------------------------------------------

/// Lo que ve el guion en cada vuelta.
pub struct Ctx<'a> {
    pub elapsed: Duration,
    /// Tiempo sin salida nueva.
    pub quiet: Duration,
    pub screen: &'a str,
}

pub enum Step {
    Wait,
    Type(String),
    Done,
}

/// Saca lo que se heredó del programa que abrió AlphaTerm (marcas y tokens de Claude Code…).
fn clean_env(cmd: &mut CommandBuilder) {
    static PERSISTENT: OnceLock<std::collections::HashSet<String>> = OnceLock::new();
    let persistent = PERSISTENT.get_or_init(crate::pty::env::persistent_names);
    for name in crate::pty::env::to_remove(std::env::vars_os().filter_map(|(k, _)| k.into_string().ok()), persistent) {
        cmd.env_remove(name);
    }
}

/// Corre un programa con interfaz de texto en una pseudoconsola sin ventana. `step` recibe la
/// pantalla cada ~200 ms y decide qué tipear o si ya está. Al final se le manda `quit` (para que
/// cierre lo suyo) y se lo mata si sigue vivo. Devuelve la última pantalla.
pub fn run_tui(
    exe: &Path,
    args: &[String],
    cwd: &Path,
    env: &[(&str, &str)],
    (cols, rows): (u16, u16),
    limit: Duration,
    quit: &[&str],
    mut step: impl FnMut(&Ctx) -> Step,
) -> Result<String, String> {
    let pair = native_pty_system().openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())?;
    let script = exe.extension().map(|e| matches!(e.to_string_lossy().to_lowercase().as_str(), "cmd" | "bat")).unwrap_or(false);
    let mut cmd = if script {
        let mut c = CommandBuilder::new("cmd.exe");
        c.args(["/d", "/c"]);
        c.arg(exe);
        c
    } else {
        CommandBuilder::new(exe)
    };
    cmd.args(args);
    cmd.cwd(cwd);
    clean_env(&mut cmd);
    cmd.env("PATH", crate::agents::agents_path_env());
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    for (k, v) in env {
        cmd.env(k, v);
    }
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    // El lector sigue hasta el final aunque ya nadie escuche: si la salida no se vacía, cerrar la
    // pseudoconsola se puede colgar.
    std::thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = tx.send(buf[..n].to_vec());
                }
            }
        }
    });
    let mut parser = vt100::Parser::new(NonZeroU16::new(rows.max(10)).unwrap(), NonZeroU16::new(cols.max(40)).unwrap(), 0);
    // No se contesta cuando preguntan dónde está el cursor (ESC[6n): con el modo de entrada de
    // ConPTY la respuesta le llega al programa como texto tipeado (Codex la tomaba como mensaje).
    // Sin respuesta andan igual, como en el dashboard.
    let feed = |parser: &mut vt100::Parser, _writer: &mut Box<dyn Write + Send>, chunk: &[u8]| parser.process(chunk);

    let start = Instant::now();
    let mut last_data = Instant::now();
    let mut last_step = Instant::now() - Duration::from_secs(1);
    let mut exited = false;
    let screen = loop {
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(chunk) => {
                feed(&mut parser, &mut writer, &chunk);
                while let Ok(more) = rx.try_recv() {
                    feed(&mut parser, &mut writer, &more);
                }
                last_data = Instant::now();
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => exited = true,
        }
        if matches!(child.try_wait(), Ok(Some(_))) {
            exited = true;
        }
        if last_step.elapsed() >= Duration::from_millis(200) || exited {
            last_step = Instant::now();
            let screen = parser.screen().contents();
            let ctx = Ctx { elapsed: start.elapsed(), quiet: last_data.elapsed(), screen: &screen };
            match step(&ctx) {
                Step::Wait => {}
                Step::Type(s) => {
                    let _ = writer.write_all(s.as_bytes());
                    let _ = writer.flush();
                }
                Step::Done => break screen,
            }
            if exited {
                break screen;
            }
        }
        if start.elapsed() > limit {
            break parser.screen().contents();
        }
    };
    if !exited {
        for q in quit {
            let _ = writer.write_all(q.as_bytes());
            let _ = writer.flush();
            std::thread::sleep(Duration::from_millis(400));
        }
        let until = Instant::now() + Duration::from_secs(3);
        while Instant::now() < until {
            while let Ok(more) = rx.try_recv() {
                feed(&mut parser, &mut writer, &more);
            }
            if matches!(child.try_wait(), Ok(Some(_))) {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let _ = child.kill();
    }
    let _ = child.wait();
    drop(writer);
    drop(pair.master);
    Ok(screen)
}

/// Con ALPHATERM_PROBE_DUMP=<carpeta> se guarda la última pantalla de cada consulta (para ver qué
/// cambió cuando una CLI cambia su formato).
fn dump(name: &str, screen: &str) {
    if let Some(dir) = std::env::var_os("ALPHATERM_PROBE_DUMP") {
        let _ = std::fs::write(PathBuf::from(dir).join(format!("{name}.txt")), screen);
    }
}

// --- Ayudas para leer pantallas ------------------------------------------------------------------

/// Número justo antes de `s[..end]` ("… 42.5" → 42.5).
fn num_before(s: &str) -> Option<f64> {
    let t = s.trim_end();
    let start = t.char_indices().rev().take_while(|(_, c)| c.is_ascii_digit() || *c == '.').last().map(|(i, _)| i)?;
    t[start..].trim_matches('.').parse().ok()
}

/// "N% <palabra>" en la línea (sin distinguir mayúsculas): N.
fn pct_with(line: &str, word: &str) -> Option<f64> {
    let low = line.to_ascii_lowercase();
    for (i, _) in low.match_indices('%') {
        let after = low[i + 1..].trim_start();
        if after.starts_with(word) {
            return num_before(&line[..i]);
        }
    }
    None
}

/// Saca los bordes de cajas y espacios de los costados.
fn tidy(s: &str) -> String {
    s.trim_matches(|c: char| c.is_whitespace() || "│┃|╭╮╰╯─━".contains(c)).trim().to_string()
}

/// Texto de reinicio en las líneas siguientes ("Resets 3pm (America/Montevideo)" → "3pm (…)").
fn resets_in(lines: &[&str], from: usize, span: usize) -> Option<String> {
    for l in lines.iter().skip(from).take(span) {
        let low = l.to_ascii_lowercase();
        for key in ["resets ", "reset "] {
            if let Some(i) = low.find(key) {
                let t = tidy(&l[i + key.len()..]);
                if !t.is_empty() {
                    return Some(t);
                }
            }
        }
    }
    None
}

fn first_pct(lines: &[&str], from: usize, span: usize, word: &str) -> Option<f64> {
    lines.iter().skip(from).take(span).find_map(|l| pct_with(l, word))
}

fn win(label: &str, used: f64, resets_text: Option<String>, detail: bool) -> UsageWindow {
    UsageWindow { label: label.into(), used_pct: used.clamp(0.0, 100.0), resets_at: None, resets_text, stale: false, detail }
}

// --- Claude ---------------------------------------------------------------------------------------

/// Lo que se lee de la pantalla de /usage de Claude Code.
pub fn parse_claude_screen(screen: &str) -> Option<(Vec<UsageWindow>, Vec<String>)> {
    let lines: Vec<&str> = screen.lines().collect();
    let mut out: Vec<UsageWindow> = Vec::new();
    let mut extras = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (i, l) in lines.iter().enumerate() {
        let low = l.to_ascii_lowercase();
        let kind = if low.contains("current session") {
            Some(("5 h", false))
        } else if low.contains("current week (all") {
            Some(("semana", false))
        } else if low.contains("current week (sonnet") {
            Some(("semana · Sonnet", true))
        } else if low.contains("current week (fable") {
            Some(("semana · Fable", true))
        } else if low.contains("current week (opus") {
            Some(("semana · Opus", true))
        } else if low.contains("current week (haiku") {
            Some(("semana · Haiku", true))
        } else if low.contains("extra usage") {
            Some(("uso extra", true))
        } else {
            None
        };
        if let Some((label, detail)) = kind {
            if seen.contains(label) {
                continue;
            }
            if let Some(p) = first_pct(&lines, i, 3, "used") {
                seen.insert(label);
                out.push(win(label, p, resets_in(&lines, i, 4), detail));
                if label == "uso extra" {
                    if let Some(sp) = lines.iter().skip(i).take(3).find_map(|x| spent(x)) {
                        extras.push(format!("Uso extra: {sp}"));
                    }
                }
            }
        }
        if low.contains("of your usage was while") {
            extras.push(tidy(l));
        }
    }
    // Como el dashboard: vale si trae la sesión, la semana o el uso extra.
    out.iter().any(|w| !w.detail || w.label == "uso extra").then_some((out, extras))
}

/// "nombre      98%" → ("nombre", 98).
fn name_pct(line: &str) -> Option<(String, f64)> {
    let t = tidy(line);
    let p = t.strip_suffix('%')?;
    let n = num_before(p)?;
    let name = p.trim_end().trim_end_matches(|c: char| c.is_ascii_digit() || c == '.').trim().to_string();
    (!name.is_empty()).then_some((name, n))
}

/// "98%  Revisá el plugin…" → ("Revisá el plugin…", 98).
fn pct_name(line: &str) -> Option<(String, f64)> {
    let t = tidy(line);
    let (num, rest) = t.split_once('%')?;
    let n: f64 = num.trim().parse().ok()?;
    let name = rest.trim().to_string();
    (!name.is_empty()).then_some((name, n))
}

/// Tablas de /usage: "Skills  % of usage", "Plugins  % of usage" (y la de modelos, cuando Claude
/// la muestra) y lo que más consume ("What's contributing to your usage?").
pub fn parse_claude_tables(screen: &str) -> (Vec<Table>, Vec<String>) {
    let lines: Vec<&str> = screen.lines().collect();
    let mut tables = Vec::new();
    let mut notes = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let t = tidy(lines[i]);
        let low = t.to_ascii_lowercase();
        let (title, row): (Option<String>, fn(&str) -> Option<(String, f64)>) = if low.ends_with("% of usage") {
            (Some(t[..t.len() - "% of usage".len()].trim().to_string()), name_pct)
        } else if low.starts_with("what's contributing to your usage") {
            (Some("Qué más consume".into()), pct_name)
        } else {
            if low.starts_with("per-model breakdown unavailable") {
                notes.push(format!("Desglose por modelo no disponible ahora{}", t.find('(').map(|k| format!(" {}", &t[k..])).unwrap_or_default()));
            }
            (None, name_pct)
        };
        let Some(title) = title else {
            i += 1;
            continue;
        };
        let mut rows = Vec::new();
        let mut j = i + 1;
        while j < lines.len() {
            let l = tidy(lines[j]);
            if l.is_empty() {
                j += 1;
                continue;
            }
            match row(&l) {
                Some(r) => rows.push(r),
                // Subtítulos de "What's contributing" ("Approximate · …", "Last 24h · …").
                None if rows.is_empty() && !l.contains('%') && l.len() < 70 => {}
                None => break,
            }
            j += 1;
        }
        if !rows.is_empty() {
            let title = match title.as_str() {
                "Skills" => "Skills".to_string(),
                "Plugins" => "Plugins".to_string(),
                "Models" => "Modelos".to_string(),
                other => other.to_string(),
            };
            tables.push(Table { title, rows });
        }
        i = j.max(i + 1);
    }
    (tables, notes)
}

/// "$3.20 / $50.00 spent" → "$3.20 de $50.00".
fn spent(line: &str) -> Option<String> {
    let low = line.to_ascii_lowercase();
    let i = low.find("spent")?;
    let head = &line[..i];
    let slash = head.rfind('/')?;
    let a = head[..slash].rsplit(|c: char| c.is_whitespace()).find(|s| !s.is_empty())?.trim();
    let b = head[slash + 1..].trim();
    (!a.is_empty() && !b.is_empty()).then(|| format!("{a} de {b}"))
}

/// Banner de Claude Code: "Opus 5.5 · Claude Max" → ("Opus 5.5", "Max").
pub fn parse_claude_banner(screen: &str) -> Option<(String, String)> {
    for l in screen.lines() {
        if let Some(i) = l.find("· Claude ") {
            let plan = tidy(&l[i + "· Claude ".len()..]);
            let plan = plan.split_whitespace().next().unwrap_or("").to_string();
            // En el banner de dos columnas hay texto a la izquierda: se toma el último tramo.
            let left = l[..i].rsplit('│').next().unwrap_or(&l[..i]);
            let left = tidy(left);
            let model = left.rsplit("  ").next().unwrap_or(&left).trim().to_string();
            if !plan.is_empty() && ["Max", "Pro", "Team", "Enterprise", "Free"].contains(&plan.as_str()) {
                return Some((model, plan));
            }
        }
    }
    None
}

/// Esfuerzo configurado en ~/.claude/settings.json (effortLevel).
fn claude_effort() -> Option<String> {
    let t = std::fs::read_to_string(home().join(".claude").join("settings.json")).ok()?;
    let v: Value = serde_json::from_str(&t).ok()?;
    v.get("effortLevel").and_then(Value::as_str).map(str::to_string)
}

/// Pantallas que frenan la consulta (y por qué).
fn blocked(screen: &str) -> Option<&'static str> {
    let low = screen.to_ascii_lowercase();
    if low.contains("do you trust the files in this folder") || low.contains("trust this folder") || low.contains("one you trust") {
        return Some("pide confirmar que confiás en la carpeta del Escritorio: abrilo ahí una vez a mano.");
    }
    if low.contains("select login method") || low.contains("sign in with chatgpt") || low.contains("please run /login") {
        return Some("no tiene una sesión iniciada.");
    }
    None
}

pub fn claude_live() -> Result<Usage, String> {
    let exe = crate::agents::resolve_in("claude", &crate::agents::search_dirs()).ok_or("Claude Code no está instalado.")?;
    // Sin servidores MCP ni hooks: es solo para mirar el consumo.
    let args: Vec<String> = vec!["--strict-mcp-config".into(), "--settings".into(), r#"{"disableAllHooks":true}"#.into()];
    let mut stage = 0;
    let mut typed_at = Instant::now();
    let mut problem = None;
    let mut banner = None;
    let screen = run_tui(&exe, &args, &probe_dir(), &[], (120, 60), Duration::from_secs(45), &["\x1b", "/exit\r"], |c| {
        if banner.is_none() {
            banner = parse_claude_banner(c.screen);
        }
        if let Some(p) = blocked(c.screen) {
            problem = Some(p);
            return Step::Done;
        }
        match stage {
            0 if (c.elapsed > Duration::from_millis(2500) && c.quiet > Duration::from_millis(1200)) || c.elapsed > Duration::from_secs(10) => {
                stage = 1;
                typed_at = Instant::now();
                Step::Type("/usage".into())
            }
            1 if typed_at.elapsed() > Duration::from_millis(700) => {
                stage = 2;
                typed_at = Instant::now();
                Step::Type("\r".into())
            }
            2 if parse_claude_screen(c.screen).is_some() && c.quiet > Duration::from_millis(900) => Step::Done,
            _ => Step::Wait,
        }
    })?;
    dump("claude", &screen);
    if let Some(p) = problem {
        return Err(format!("Claude Code {p}"));
    }
    let (windows, mut extras) = parse_claude_screen(&screen).ok_or("No se pudo leer la pantalla de /usage de Claude Code.")?;
    let (tables, notes) = parse_claude_tables(&screen);
    extras.extend(notes);
    let (model, plan) = banner.map(|(m, p)| (Some(m), Some(p))).unwrap_or((None, None));
    // El banner ya puede traer el esfuerzo ("Opus 5.5 with xhigh effort").
    let (model, effort) = match model.as_deref().and_then(|m| m.split_once(" with ")) {
        Some((name, rest)) => (Some(name.trim().to_string()), Some(rest.trim_end_matches("effort").trim().to_string()).filter(|e| !e.is_empty())),
        None => (model, claude_effort()),
    };
    Ok(Usage {
        provider: "claude".into(),
        exact: true,
        source: "Claude Code /usage (consulta en vivo)".into(),
        updated_at: Some(now_ms()),
        windows,
        note: None,
        refreshing: false,
        plan,
        model: match (model, effort) {
            (Some(m), Some(e)) => Some(format!("{m} · {e}")),
            (m, e) => m.or(e),
        },
        extras,
        groups: vec![],
        tables,
    })
}

// --- Codex ----------------------------------------------------------------------------------------

/// Lo que se lee de /status de Codex (la pantalla aplanada en una línea).
pub fn parse_codex_status(screen: &str) -> Option<(Vec<UsageWindow>, Option<String>, Option<String>)> {
    let flat = screen.split_whitespace().collect::<Vec<_>>().join(" ");
    let low = flat.to_ascii_lowercase();
    let mut out = Vec::new();
    for (key, label) in [("5h limit", "5 h"), ("weekly limit", "semana")] {
        let Some(i) = low.find(key) else { continue };
        let rest = &low[i..];
        let Some(j) = rest.find("% left") else { continue };
        let Some(left) = num_before(&flat[i..i + j]) else { continue };
        let after = &flat[i + j..];
        let resets = after
            .to_ascii_lowercase()
            .find("(resets ")
            .and_then(|k| after[k + 8..].split(')').next().map(|s| s.trim().to_string()))
            .filter(|s| !s.is_empty() && s.len() < 60);
        out.push(win(label, 100.0 - left, resets, false));
    }
    if out.is_empty() {
        return None;
    }
    // "Account: x@y (Plus)" → plan; "Model: gpt-5-codex (reasoning medium, …)" → modelo.
    let plan = low.find("account").and_then(|i| {
        let a = &flat[i..];
        let o = a.find('(').filter(|o| *o < 80)?;
        let c = a[o..].find(')')?;
        let p = a[o + 1..o + c].trim();
        (p.len() < 30 && !p.is_empty()).then(|| p.to_string())
    });
    let model = low.find("model:").and_then(|i| {
        let a = flat[i + 6..].trim_start();
        let name = a.split_whitespace().next()?.trim_matches(|c: char| c == '│' || c == ',').to_string();
        let effort = a.find("reasoning ").filter(|k| *k < 60).and_then(|k| a[k + 10..].split(|c: char| c == ',' || c == ')' || c.is_whitespace()).next()).map(str::to_string);
        (!name.is_empty()).then(|| match effort {
            Some(e) if !e.is_empty() => format!("{name} · {e}"),
            _ => name,
        })
    });
    Some((out, plan, model))
}

/// Modelo por defecto de ~/.codex/config.toml (solo las claves de arriba, antes de la primera tabla).
fn codex_config_model() -> Option<String> {
    let t = std::fs::read_to_string(home().join(".codex").join("config.toml")).ok()?;
    let head = t.split("\n[").next().unwrap_or("");
    let key = |k: &str| {
        head.lines().find_map(|l| {
            let l = l.trim();
            let rest = l.strip_prefix(k)?.trim_start().strip_prefix('=')?;
            Some(rest.trim().trim_matches(|c| c == '"' || c == '\'').to_string())
        })
    };
    let name = key("model")?;
    Some(match key("model_reasoning_effort") {
        Some(e) => format!("{name} · {e}"),
        None => name,
    })
}

pub fn codex_live() -> Result<Usage, String> {
    let exe = crate::agents::resolve_in("codex", &crate::agents::search_dirs()).ok_or("Codex no está instalado.")?;
    let mut stage = 0;
    let mut at = Instant::now();
    let mut problem = None;
    let screen = run_tui(&exe, &[], &probe_dir(), &[], (140, 60), Duration::from_secs(45), &["\x1b", "/quit\r"], |c| {
        if let Some(p) = blocked(c.screen) {
            problem = Some(p);
            return Step::Done;
        }
        let ready = parse_codex_status(c.screen).is_some();
        match stage {
            0 if (c.elapsed > Duration::from_secs(3) && c.quiet > Duration::from_millis(1500)) || c.elapsed > Duration::from_secs(12) => {
                stage = 1;
                at = Instant::now();
                Step::Type("/status".into())
            }
            1 if at.elapsed() > Duration::from_millis(700) => {
                stage = 2;
                at = Instant::now();
                Step::Type("\r".into())
            }
            // A veces el primer Enter solo elige el comando del menú.
            2 if !ready && at.elapsed() > Duration::from_secs(3) => {
                stage = 3;
                Step::Type("\r".into())
            }
            2 | 3 if ready && c.quiet > Duration::from_millis(900) => Step::Done,
            _ => Step::Wait,
        }
    })?;
    dump("codex", &screen);
    if let Some(p) = problem {
        return Err(format!("Codex {p}"));
    }
    let (windows, plan, model) = parse_codex_status(&screen).ok_or("No se pudo leer la pantalla de /status de Codex.")?;
    Ok(Usage {
        provider: "codex".into(),
        exact: true,
        source: "Codex /status (consulta en vivo)".into(),
        updated_at: Some(now_ms()),
        windows,
        note: None,
        refreshing: false,
        plan,
        model: model.or_else(codex_config_model),
        extras: vec![],
        groups: vec![],
        tables: vec![],
    })
}

// --- Antigravity (agy) ---------------------------------------------------------------------------

pub fn parse_agy_groups(v: &Value) -> Vec<Group> {
    let Some(groups) = v.pointer("/command/data/groups").and_then(Value::as_array) else { return vec![] };
    groups
        .iter()
        .filter_map(|g| {
            let name = g.get("name").and_then(Value::as_str)?.to_string();
            let desc = g.get("description").and_then(Value::as_str).unwrap_or("");
            let models = desc.split_once("Models within this group:").map(|(_, m)| m.trim().trim_end_matches('.').to_string());
            Some(Group { name, models })
        })
        .collect()
}

/// Modelo configurado en agy (si lo guarda en su settings.json).
fn agy_model() -> Option<String> {
    let t = std::fs::read_to_string(home().join(".gemini").join("antigravity-cli").join("settings.json")).ok()?;
    let v: Value = serde_json::from_str(&t).ok()?;
    ["model", "/model/name", "/defaultModel"]
        .iter()
        .find_map(|k| if k.starts_with('/') { v.pointer(k) } else { v.get(*k) }.and_then(Value::as_str).map(str::to_string))
}

pub fn agy_live() -> Result<Usage, String> {
    let exe = crate::agents::resolve_in("agy", &crate::agents::search_dirs()).ok_or("agy no está instalado.")?;
    let mut cmd = std::process::Command::new(&exe);
    // Directo, sin shell: desde Git Bash, MSYS convierte "/quota" en una ruta y agy lo toma como prompt.
    cmd.args(["-p", "/quota", "--output-format", "json"]).stdin(std::process::Stdio::null()).env(AGY_NO_UPDATE.0, AGY_NO_UPDATE.1);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = crate::usage::run_with_timeout(cmd, Duration::from_secs(45)).map_err(|e| format!("No se pudo consultar agy: {e}"))?;
    let v = serde_json::from_slice::<Value>(&out).map_err(|_| "agy respondió algo que no es JSON.".to_string())?;
    let now = now_ms() / 1000;
    let windows = crate::usage::parse_agy(&v, now).filter(|w| !w.is_empty()).ok_or("La respuesta de agy no trae grupos de cuota.")?;
    // Defensa: si por algún motivo agy corrió un turno (gastó), se avisa.
    let tokens = v.pointer("/usage/total_tokens").and_then(Value::as_u64).unwrap_or(0);
    Ok(Usage {
        provider: "agy".into(),
        exact: true,
        source: "agy /quota (oficial, consulta en vivo)".into(),
        updated_at: Some(now_ms()),
        windows,
        note: (tokens > 0).then(|| format!("Atención: la consulta usó {tokens} tokens.")),
        refreshing: false,
        plan: None,
        model: agy_model(),
        extras: vec![],
        groups: parse_agy_groups(&v),
        tables: vec![],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLAUDE: &str = "\
 ✻ Welcome to Claude Code
   Opus 5.5 · Claude Max
   C:\\Users\\x\\Desktop

 > /usage
 ──────────────────────────────────────────
  Settings:  Status   Config   Usage

  Current session
  ███████▌                                           15% used
  Resets 3pm (America/Montevideo)

  Current week (all models)
  █████████████████                                  34% used
  Resets Nov 25, 1am (America/Montevideo)

  Current week (Sonnet only)
  ██                                                 4% used

  Current week (Fable)
  █                                                  2% used

  Extra usage
  ▏                                                  0% used
  $0.00 / $50.00 spent · Resets Dec 1 (America/Montevideo)

  48% of your usage was while 3+ sessions ran in parallel
";

    #[test]
    fn lee_usage_de_claude() {
        let (w, extras) = parse_claude_screen(CLAUDE).unwrap();
        assert_eq!(w[0].label, "5 h");
        assert_eq!(w[0].used_pct, 15.0);
        assert_eq!(w[0].resets_text.as_deref(), Some("3pm (America/Montevideo)"));
        assert!(!w[0].detail);
        assert_eq!(w[1].label, "semana");
        assert_eq!(w[1].used_pct, 34.0);
        assert_eq!(w[1].resets_text.as_deref(), Some("Nov 25, 1am (America/Montevideo)"));
        assert_eq!(w[2].label, "semana · Sonnet");
        assert!(w[2].detail);
        assert_eq!(w[3].label, "semana · Fable");
        assert_eq!(w[4].label, "uso extra");
        assert!(extras.contains(&"Uso extra: $0.00 de $50.00".to_string()), "{extras:?}");
        assert!(extras.iter().any(|e| e.starts_with("48% of your usage")));
        assert!(parse_claude_screen("Welcome to Claude Code\n> ").is_none());
    }

    #[test]
    fn lee_las_tablas_de_claude() {
        let s = "\
  What's contributing to your usage?
  Approximate · sessions on this computer only
  Last 24h · shares overlap

  98%  Run /superpowers:systematic-debugging on a cheaper model
  29%  Turn off MCP servers you don't use · 23k tokens per request

  Skills                  % of usage
  /superpowers:systematic-deb…   98%

  Plugins                 % of usage
  superpowers                    98%

  Per-model breakdown unavailable (rate limited until 10:02am)
  Session
  Estimated cost:         $0.0000";
        let (t, notes) = parse_claude_tables(s);
        assert_eq!(t.len(), 3, "{t:?}");
        assert_eq!(t[0].title, "Qué más consume");
        assert_eq!(t[0].rows[0], ("Run /superpowers:systematic-debugging on a cheaper model".to_string(), 98.0));
        assert_eq!(t[0].rows.len(), 2);
        assert_eq!(t[1].title, "Skills");
        assert_eq!(t[1].rows, vec![("/superpowers:systematic-deb…".to_string(), 98.0)]);
        assert_eq!(t[2].title, "Plugins");
        assert_eq!(notes, vec!["Desglose por modelo no disponible ahora (rate limited until 10:02am)".to_string()]);
    }

    #[test]
    fn lee_el_banner_de_claude() {
        assert_eq!(parse_claude_banner(CLAUDE), Some(("Opus 5.5".into(), "Max".into())));
        assert_eq!(parse_claude_banner("│ Sonnet 5.5 · Claude Pro   │"), Some(("Sonnet 5.5".into(), "Pro".into())));
        assert_eq!(parse_claude_banner("nada"), None);
    }

    #[test]
    fn lee_status_de_codex() {
        let s = "\
│  Model:        gpt-6-sol (reasoning medium, summaries auto)   │
│  Account:      x@y.com (Plus)                                  │
│  5h limit:     [████████████████░░░░] 82% left (resets 14:30)   │
│  Weekly limit: [██████████░░░░░░░░░░] 51% left (resets 09:12 on 25 Nov) │";
        let (w, plan, model) = parse_codex_status(s).unwrap();
        assert_eq!(w[0].label, "5 h");
        assert!((w[0].used_pct - 18.0).abs() < 1e-9);
        assert_eq!(w[0].resets_text.as_deref(), Some("14:30"));
        assert_eq!(w[1].label, "semana");
        assert!((w[1].used_pct - 49.0).abs() < 1e-9);
        assert_eq!(w[1].resets_text.as_deref(), Some("09:12 on 25 Nov"));
        assert_eq!(plan.as_deref(), Some("Plus"));
        assert_eq!(model.as_deref(), Some("gpt-6-sol · medium"));
        assert!(parse_codex_status("Codex listo").is_none());
    }

    #[test]
    fn grupos_de_agy() {
        let v = serde_json::json!({"command": {"data": {"groups": [
            {"name": "Gemini Models", "description": "Models within this group: Gemini 4 Neon, Gemini 3.8 Flash", "buckets": []},
            {"name": "Gemini 4 Argon", "description": "For paid Pro plans, Argon quota is separate.", "buckets": []}]}}});
        let g = parse_agy_groups(&v);
        assert_eq!(g[0].models.as_deref(), Some("Gemini 4 Neon, Gemini 3.8 Flash"));
        assert_eq!(g[1].models, None);
    }

    #[test]
    fn numeros_y_porcentajes() {
        assert_eq!(num_before("algo 42.5"), Some(42.5));
        assert_eq!(pct_with("  ███ 7% used", "used"), Some(7.0));
        assert_eq!(pct_with("82% left (x)", "used"), None);
        assert_eq!(spent("$3.20 / $50 spent · Resets"), Some("$3.20 de $50".into()));
    }

    #[test]
    #[ignore = "abre Claude Code de verdad; correr a mano"]
    fn claude_real() {
        println!("{:#?}", claude_live());
    }

    #[test]
    #[ignore = "abre Codex de verdad; correr a mano"]
    fn codex_real() {
        println!("{:#?}", codex_live());
    }

    #[test]
    #[ignore = "consulta agy de verdad; correr a mano"]
    fn agy_real() {
        println!("{:#?}", agy_live());
    }
}
