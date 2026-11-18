//! Consumo por suscripción. Cada proveedor dice de dónde sale el dato y si es exacto.
//!
//! - Claude: los límites (5 h y semana) que Claude Code le pasa a su statusline, guardados en un
//!   JSON. No se lee `.credentials.json` ni se llama a ningún endpoint. Si no hay statusline,
//!   se estima con los tokens de los transcripts (sin porcentaje).
//! - Codex: el último evento `rate_limits` de sus sesiones (`.jsonl` o `.jsonl.zst`).
//! - Antigravity (agy): `agy -p /quota --output-format json`, que es oficial y no gasta cuota.
//!   Se ejecuta directo (sin shell: desde Git Bash, MSYS convierte "/quota" en una ruta y agy
//!   lo toma como prompt pagado).

use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub label: String,
    /// Usado, 0–100.
    pub used_pct: f64,
    /// Unix (segundos).
    pub resets_at: Option<i64>,
    /// La ventana ya se reinició después del dato: el porcentaje real es desconocido.
    pub stale: bool,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub provider: String,
    pub exact: bool,
    pub source: String,
    /// Cuándo se tomó el dato (unix ms).
    pub updated_at: Option<i64>,
    pub windows: Vec<UsageWindow>,
    pub note: Option<String>,
}

fn now_s() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn home() -> PathBuf {
    std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_default()
}

pub fn window_label(minutes: i64) -> String {
    match minutes {
        300 => "5 h".into(),
        10080 => "semana".into(),
        1440 => "día".into(),
        m if m % 1440 == 0 => format!("{} días", m / 1440),
        m if m % 60 == 0 => format!("{} h", m / 60),
        m => format!("{m} min"),
    }
}

fn win(label: impl Into<String>, used: f64, resets: Option<i64>, now: i64) -> UsageWindow {
    UsageWindow { label: label.into(), used_pct: used.clamp(0.0, 100.0), resets_at: resets, stale: resets.is_some_and(|r| r <= now) }
}

// --- Claude --------------------------------------------------------------------------------------

/// Archivos donde una statusline deja el JSON de Claude Code (el de NovaTerm y el del Control Panel).
pub fn claude_statusline_files() -> Vec<PathBuf> {
    vec![crate::settings::data_dir().join("claude-statusline.json"), home().join(".claude").join("control-panel").join("statusline.json")]
}

pub fn parse_claude_statusline(v: &Value, now: i64) -> Option<(i64, Vec<UsageWindow>)> {
    let rl = v.get("rate_limits")?;
    let captured = v.get("_capturedAt").and_then(Value::as_i64)?;
    let mut out = Vec::new();
    for (key, label) in [("five_hour", "5 h"), ("seven_day", "semana"), ("seven_day_opus", "semana (Opus)")] {
        if let Some(w) = rl.get(key) {
            if let Some(p) = w.get("used_percentage").and_then(Value::as_f64) {
                out.push(win(label, p, w.get("resets_at").and_then(Value::as_i64), now));
            }
        }
    }
    (!out.is_empty()).then_some((captured, out))
}

fn claude() -> Usage {
    let now = now_s();
    let best = claude_statusline_files()
        .iter()
        .filter_map(|p| std::fs::read_to_string(p).ok())
        .filter_map(|t| serde_json::from_str::<Value>(&t).ok())
        .filter_map(|v| parse_claude_statusline(&v, now))
        .max_by_key(|(c, _)| *c);
    if let Some((captured, windows)) = best {
        let age_h = (now * 1000 - captured) as f64 / 3_600_000.0;
        return Usage {
            provider: "claude".into(),
            exact: true,
            source: "statusline de Claude Code".into(),
            updated_at: Some(captured),
            note: (age_h > 1.0).then(|| "Se actualiza cada vez que Claude Code dibuja su statusline.".into()),
            windows,
        };
    }
    let (t5, t7) = claude_tokens(now);
    Usage {
        provider: "claude".into(),
        exact: false,
        source: "transcripts de ~/.claude (estimado)".into(),
        updated_at: Some(now * 1000),
        windows: vec![],
        note: Some(format!(
            "Sin statusline no hay porcentaje: {} tokens en 5 h, {} en 7 días. Conectá la statusline en Configuración para ver el dato exacto.",
            fmt_tokens(t5),
            fmt_tokens(t7)
        )),
    }
}

pub fn fmt_tokens(n: u64) -> String {
    match n {
        n if n >= 1_000_000 => format!("{:.1} M", n as f64 / 1e6),
        n if n >= 1_000 => format!("{:.0} k", n as f64 / 1e3),
        n => n.to_string(),
    }
}

/// Tokens de Claude en las últimas 5 h y 7 días, sumando los `usage` de los transcripts
/// (sin repetir mensajes, que aparecen varias veces mientras se escriben).
fn claude_tokens(now: i64) -> (u64, u64) {
    let root = home().join(".claude").join("projects");
    let since7 = now - 7 * 86400;
    let since5 = now - 5 * 3600;
    let mut files = Vec::new();
    collect_files(&root, &mut files, &|p| p.extension().is_some_and(|e| e == "jsonl"), since7, 0);
    let (mut t5, mut t7) = (0u64, 0u64);
    let mut seen = HashSet::new();
    for f in files {
        let Ok(file) = std::fs::File::open(&f) else { continue };
        for line in BufReader::new(file).lines().map_while(Result::ok) {
            if !line.contains("\"usage\"") {
                continue;
            }
            let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
            let Some(ts) = v.get("timestamp").and_then(Value::as_str).and_then(parse_rfc3339) else { continue };
            if ts < since7 {
                continue;
            }
            let msg = &v["message"];
            if let Some(id) = msg.get("id").and_then(Value::as_str) {
                if !seen.insert(id.to_string()) {
                    continue;
                }
            }
            let u = &msg["usage"];
            let n: u64 = ["input_tokens", "output_tokens", "cache_creation_input_tokens"]
                .iter()
                .filter_map(|k| u.get(*k).and_then(Value::as_u64))
                .sum();
            t7 += n;
            if ts >= since5 {
                t5 += n;
            }
        }
    }
    (t5, t7)
}

fn collect_files(dir: &Path, out: &mut Vec<PathBuf>, keep: &dyn Fn(&Path) -> bool, newer_than: i64, depth: usize) {
    if depth > 6 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let Ok(md) = e.metadata() else { continue };
        if md.is_dir() {
            collect_files(&p, out, keep, newer_than, depth + 1);
        } else if keep(&p) {
            let m = md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0);
            if m >= newer_than {
                out.push(p);
            }
        }
    }
}

/// "2026-10-26T21:16:12.185Z" → unix segundos (solo UTC, que es lo que escriben estas herramientas).
pub fn parse_rfc3339(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 19 {
        return None;
    }
    let n = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, se) = (n(0..4)?, n(5..7)?, n(8..10)?, n(11..13)?, n(14..16)?, n(17..19)?);
    // Días desde 1970 (algoritmo de Howard Hinnant).
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * (mo + if mo > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    let mut t = days * 86400 + h * 3600 + mi * 60 + se;
    // Desfase explícito (+hh:mm / -hh:mm).
    let tail = &s[19..];
    let tz = tail.trim_start_matches(|c: char| c == '.' || c.is_ascii_digit());
    if let (Some(sign), Some(hh), Some(mm)) = (tz.chars().next(), tz.get(1..3).and_then(|x| x.parse::<i64>().ok()), tz.get(4..6).and_then(|x| x.parse::<i64>().ok())) {
        let off = hh * 3600 + mm * 60;
        if sign == '+' {
            t -= off;
        } else if sign == '-' {
            t += off;
        }
    }
    Some(t)
}

// --- Codex ---------------------------------------------------------------------------------------

pub fn parse_codex_line(v: &Value, now: i64) -> Option<(i64, Vec<UsageWindow>, Option<String>)> {
    let rl = v.get("payload")?.get("rate_limits")?;
    if rl.is_null() {
        return None;
    }
    let ts = v.get("timestamp").and_then(Value::as_str).and_then(parse_rfc3339)?;
    let mut out = Vec::new();
    for key in ["primary", "secondary"] {
        let Some(w) = rl.get(key).filter(|w| !w.is_null()) else { continue };
        let Some(p) = w.get("used_percent").and_then(Value::as_f64) else { continue };
        let minutes = w.get("window_minutes").and_then(Value::as_i64).unwrap_or(0);
        let resets = w.get("resets_at").and_then(Value::as_i64).or_else(|| w.get("resets_in_seconds").and_then(Value::as_i64).map(|r| ts + r));
        out.push(win(window_label(minutes), p, resets, now));
    }
    let plan = rl.get("plan_type").and_then(Value::as_str).map(str::to_string);
    (!out.is_empty()).then_some((ts * 1000, out, plan))
}

pub(crate) fn read_maybe_zst(p: &Path) -> Option<String> {
    let f = std::fs::File::open(p).ok()?;
    let mut s = String::new();
    if p.extension().is_some_and(|e| e == "zst") {
        let mut dec = ruzstd::decoding::StreamingDecoder::new(BufReader::new(f)).ok()?;
        let mut buf = Vec::new();
        dec.read_to_end(&mut buf).ok()?;
        s = String::from_utf8_lossy(&buf).into_owned();
    } else {
        BufReader::new(f).read_to_string(&mut s).ok()?;
    }
    Some(s)
}

fn codex() -> Usage {
    let now = now_s();
    let root = home().join(".codex").join("sessions");
    let mut files = Vec::new();
    let is_rollout = |p: &Path| p.file_name().map(|n| n.to_string_lossy().starts_with("rollout-")).unwrap_or(false);
    collect_files(&root, &mut files, &is_rollout, 0, 0);
    files.sort_by_key(|p| std::cmp::Reverse(std::fs::metadata(p).and_then(|m| m.modified()).ok()));
    for f in files.iter().take(40) {
        let Some(text) = read_maybe_zst(f) else { continue };
        let found = text
            .lines()
            .rev()
            .filter(|l| l.contains("\"rate_limits\""))
            .filter_map(|l| serde_json::from_str::<Value>(l).ok())
            .find_map(|v| parse_codex_line(&v, now));
        if let Some((ts, windows, plan)) = found {
            return Usage {
                provider: "codex".into(),
                exact: true,
                source: "sesiones de Codex (~/.codex/sessions)".into(),
                updated_at: Some(ts),
                windows,
                note: Some(format!(
                    "Dato de la última sesión de Codex{}: se actualiza cuando usás Codex.",
                    plan.map(|p| format!(" (plan {p})")).unwrap_or_default()
                )),
            };
        }
    }
    Usage {
        provider: "codex".into(),
        exact: false,
        source: "sesiones de Codex".into(),
        updated_at: None,
        windows: vec![],
        note: Some("No hay sesiones de Codex con datos de límites.".into()),
    }
}

// --- Antigravity (agy) ---------------------------------------------------------------------------

pub fn parse_agy(v: &Value, now: i64) -> Option<Vec<UsageWindow>> {
    let groups = v.get("command")?.get("data")?.get("groups")?.as_array()?;
    let mut out = Vec::new();
    for g in groups {
        let gname = g.get("name").and_then(Value::as_str).unwrap_or("?");
        for b in g.get("buckets").and_then(Value::as_array).into_iter().flatten() {
            let Some(rem) = b.get("remaining_fraction").and_then(Value::as_f64) else { continue };
            let w = match b.get("window").and_then(Value::as_str) {
                Some("5h") => "5 h",
                Some("weekly") => "semana",
                Some(other) => other,
                None => "?",
            };
            let resets = b.get("reset_time").and_then(Value::as_str).and_then(parse_rfc3339);
            out.push(win(format!("{gname} · {w}"), (1.0 - rem) * 100.0, resets, now));
        }
    }
    Some(out)
}

fn agy() -> Usage {
    let fail = |note: String| Usage { provider: "agy".into(), exact: false, source: "agy /quota".into(), updated_at: None, windows: vec![], note: Some(note) };
    let dirs = crate::agents::search_dirs();
    let Some(exe) = crate::agents::resolve_in("agy", &dirs) else { return fail("agy no está instalado.".into()) };
    let mut cmd = std::process::Command::new(&exe);
    cmd.args(["-p", "/quota", "--output-format", "json"]).stdin(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = match run_with_timeout(cmd, Duration::from_secs(45)) {
        Ok(o) => o,
        Err(e) => return fail(format!("No se pudo consultar agy: {e}")),
    };
    let Ok(v) = serde_json::from_slice::<Value>(&out) else { return fail("agy respondió algo que no es JSON.".into()) };
    // Defensa: si por algún motivo agy corrió un turno (gastó), se avisa.
    let tokens = v.pointer("/usage/total_tokens").and_then(Value::as_u64).unwrap_or(0);
    match parse_agy(&v, now_s()) {
        Some(windows) if !windows.is_empty() => Usage {
            provider: "agy".into(),
            exact: true,
            source: "agy /quota (oficial)".into(),
            updated_at: Some(now_s() * 1000),
            windows,
            note: (tokens > 0).then(|| format!("Atención: la consulta usó {tokens} tokens.")),
        },
        _ => fail("La respuesta de agy no trae grupos de cuota.".into()),
    }
}

fn run_with_timeout(mut cmd: std::process::Command, limit: Duration) -> Result<Vec<u8>, String> {
    let mut child = cmd.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).spawn().map_err(|e| e.to_string())?;
    let mut stdout = child.stdout.take().ok_or("sin salida")?;
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() > limit => {
                let _ = child.kill();
                return Err("tardó demasiado".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(e) => return Err(e.to_string()),
        }
    }
    reader.join().map_err(|_| "error leyendo la salida".to_string())
}

/// Lo último que se consultó de cada proveedor: varias ventanas comparten el dato.
static CACHE: std::sync::Mutex<Vec<(String, std::time::Instant, Usage)>> = std::sync::Mutex::new(Vec::new());
const CACHE_FOR: Duration = Duration::from_secs(30);

/// `force` (clic en el footer) saltea la caché.
#[tauri::command]
pub async fn usage_get(provider: String, force: Option<bool>) -> Result<Usage, String> {
    if !force.unwrap_or(false) {
        let cache = CACHE.lock().unwrap();
        if let Some((_, at, u)) = cache.iter().find(|(p, at, _)| *p == provider && at.elapsed() < CACHE_FOR) {
            let _ = at;
            return Ok(u.clone());
        }
    }
    let p = provider.clone();
    let u = tauri::async_runtime::spawn_blocking(move || match p.as_str() {
        "claude" => Ok(claude()),
        "codex" => Ok(codex()),
        "agy" => Ok(agy()),
        other => Err(format!("proveedor desconocido: {other}")),
    })
    .await
    .map_err(|e| e.to_string())??;
    let mut cache = CACHE.lock().unwrap();
    cache.retain(|(x, _, _)| *x != provider);
    cache.push((provider, std::time::Instant::now(), u.clone()));
    Ok(u)
}

// --- Statusline de NovaTerm para Claude Code ---------------------------------------------------------

const STATUSLINE_JS: &str = r#"// Statusline de NovaTerm para Claude Code: guarda los límites que Claude Code le pasa
// (para el footer de consumo de NovaTerm) y muestra una línea corta. Sin dependencias.
const fs = require("fs");
const path = require("path");
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let data = {};
  try { data = JSON.parse(raw); } catch {}
  try {
    const dir = path.join(process.env.APPDATA || "", "NovaTerm");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "claude-statusline.json");
    fs.writeFileSync(file + ".tmp", JSON.stringify({ ...data, _capturedAt: Date.now() }));
    fs.renameSync(file + ".tmp", file);
  } catch {}
  const rl = data.rate_limits || {};
  const pct = (w) => (w && typeof w.used_percentage === "number" ? `${Math.round(w.used_percentage)}%` : "–");
  const model = (data.model && data.model.display_name) || "Claude";
  const ctx = data.context_window && typeof data.context_window.used_percentage === "number" ? ` · ctx ${Math.round(data.context_window.used_percentage)}%` : "";
  process.stdout.write(`${model}${ctx} · 5h ${pct(rl.five_hour)} · sem ${pct(rl.seven_day)}`);
});
"#;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatuslineStatus {
    /// Comando configurado hoy en ~/.claude/settings.json (si hay).
    current: Option<String>,
    /// El configurado es el de NovaTerm.
    ours: bool,
    /// El script del comando configurado existe (si se pudo saber).
    current_exists: Option<bool>,
}

fn claude_settings() -> PathBuf {
    home().join(".claude").join("settings.json")
}

fn statusline_script() -> PathBuf {
    crate::settings::data_dir().join("statusline.js")
}

/// Primera ruta entre comillas de un comando (para saber si el script existe).
fn quoted_path(cmd: &str) -> Option<PathBuf> {
    let start = cmd.find('"')? + 1;
    let end = start + cmd[start..].find('"')?;
    Some(PathBuf::from(&cmd[start..end]))
}

#[tauri::command]
pub fn usage_statusline_status() -> StatuslineStatus {
    let current = std::fs::read_to_string(claude_settings())
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.pointer("/statusLine/command").and_then(Value::as_str).map(str::to_string));
    let ours = current.as_deref().is_some_and(|c| c.contains("NovaTerm") && c.contains("statusline.js"));
    let current_exists = current.as_deref().and_then(quoted_path).map(|p| p.exists());
    StatuslineStatus { current, ours, current_exists }
}

/// Instala la statusline de NovaTerm en Claude Code. Solo se llama cuando el usuario toca el botón.
/// Guarda una copia de ~/.claude/settings.json antes de cambiarlo y conserva el resto del archivo.
#[tauri::command]
pub fn usage_statusline_install() -> Result<String, String> {
    let script = statusline_script();
    std::fs::create_dir_all(script.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&script, STATUSLINE_JS).map_err(|e| e.to_string())?;
    let path = claude_settings();
    let text = std::fs::read_to_string(&path).unwrap_or_else(|_| "{}".into());
    let mut v: Value = serde_json::from_str(&text).map_err(|e| format!("~/.claude/settings.json no es JSON válido: {e}"))?;
    let backup = path.with_extension("json.antes-de-novaterm");
    std::fs::write(&backup, &text).map_err(|e| e.to_string())?;
    let cmd = format!("node \"{}\"", script.display().to_string().replace('\\', "/"));
    v.as_object_mut().ok_or("settings.json no es un objeto")?.insert("statusLine".into(), serde_json::json!({ "type": "command", "command": cmd }));
    let out = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
    std::fs::write(&path, out + "\n").map_err(|e| e.to_string())?;
    Ok(backup.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn fechas_rfc3339() {
        assert_eq!(parse_rfc3339("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_rfc3339("2026-10-26T21:16:12.185Z"), Some(1793049372));
        assert_eq!(parse_rfc3339("2026-10-26T18:16:12-03:00"), Some(1793049372));
        assert_eq!(parse_rfc3339("basura"), None);
    }

    #[test]
    fn etiquetas_de_ventana() {
        assert_eq!(window_label(300), "5 h");
        assert_eq!(window_label(10080), "semana");
        assert_eq!(window_label(2880), "2 días");
        assert_eq!(window_label(45), "45 min");
    }

    #[test]
    fn statusline_de_claude() {
        let v = json!({"_capturedAt": 1_000_000_000, "rate_limits": {"five_hour": {"used_percentage": 28, "resets_at": 2000}, "seven_day": {"used_percentage": 18.5, "resets_at": 500}}});
        let (c, w) = parse_claude_statusline(&v, 1000).unwrap();
        assert_eq!(c, 1_000_000_000);
        assert_eq!(w[0], UsageWindow { label: "5 h".into(), used_pct: 28.0, resets_at: Some(2000), stale: false });
        assert!(w[1].stale, "la semana ya se reinició");
        assert!(parse_claude_statusline(&json!({"rate_limits": {}}), 0).is_none());
    }

    #[test]
    fn linea_de_codex() {
        let v = json!({"timestamp": "2026-10-26T21:16:12.185Z", "payload": {"type": "token_count", "rate_limits": {
            "primary": {"used_percent": 12.5, "window_minutes": 10080, "resets_at": 1793650834},
            "secondary": null, "plan_type": "plus"}}});
        let (ts, w, plan) = parse_codex_line(&v, 1793049372).unwrap();
        assert_eq!(ts, 1793049372000);
        assert_eq!(w, vec![UsageWindow { label: "semana".into(), used_pct: 12.5, resets_at: Some(1793650834), stale: false }]);
        assert_eq!(plan.as_deref(), Some("plus"));
        assert!(parse_codex_line(&json!({"timestamp": "2026-10-26T21:16:12Z", "payload": {"rate_limits": null}}), 0).is_none());
    }

    #[test]
    fn cuota_de_agy() {
        let v = json!({"usage": {"total_tokens": 0}, "command": {"data": {"groups": [
            {"name": "Claude and GPT models", "buckets": [
                {"window": "weekly", "remaining_fraction": 0.93, "reset_time": "2026-11-25T01:14:26Z"},
                {"window": "5h", "remaining_fraction": 1.0, "reset_time": "2026-11-18T17:12:58Z"}]}]}}});
        let w = parse_agy(&v, 0).unwrap();
        assert_eq!(w[0].label, "Claude and GPT models · semana");
        assert!((w[0].used_pct - 7.0).abs() < 1e-9);
        assert_eq!(w[1].used_pct, 0.0);
    }

    #[test]
    fn ruta_entre_comillas() {
        assert_eq!(quoted_path("node \"C:/x/statusline.js\""), Some(PathBuf::from("C:/x/statusline.js")));
        assert_eq!(quoted_path("node x.js"), None);
        assert_eq!(fmt_tokens(1_234_567), "1.2 M");
    }

    #[test]
    #[ignore = "lee datos reales de la máquina (Codex); correr a mano"]
    fn codex_real() {
        let u = codex();
        println!("{u:?}");
    }
}
