//! Agentes: dónde está instalado cada uno.
//!
//! Se busca el primer token del comando en el PATH del proceso, en el PATH del registro (por si
//! se instaló algo después de abrir AlphaTerm) y en las carpetas donde se suelen instalar.
//! No se ejecuta nada: solo se mira si el archivo existe.
//!
//! Aparte, `agent_models` lista los modelos que ofrece cada agente leyéndolos de él mismo
//! (Codex los deja en su caché; agy y OpenCode los listan con `models`).

use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

const EXTS: &[&str] = &["exe", "cmd", "bat", "com", "ps1"];

/// Primer token de una línea de comando (respeta comillas dobles).
pub fn first_token(cmd: &str) -> String {
    let t = cmd.trim_start();
    if let Some(rest) = t.strip_prefix('"') {
        return rest.split('"').next().unwrap_or("").to_string();
    }
    t.split_whitespace().next().unwrap_or("").to_string()
}

/// Expande %VARIABLES% como hace Windows (las que no existen quedan tal cual).
pub fn expand_vars(s: &str, get: impl Fn(&str) -> Option<String>) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find('%') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        match after.find('%') {
            Some(j) if j > 0 => {
                let name = &after[..j];
                match get(name) {
                    Some(v) => out.push_str(&v),
                    None => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[j + 1..];
            }
            _ => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

fn registry_path() -> Vec<String> {
    let mut out = Vec::new();
    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        use winreg::RegKey;
        let keys = [
            (HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
            (HKEY_CURRENT_USER, "Environment"),
        ];
        for (root, key) in keys {
            if let Ok(k) = RegKey::predef(root).open_subkey(key) {
                if let Ok(v) = k.get_value::<String, _>("Path") {
                    out.push(expand_vars(&v, |n| std::env::var(n).ok()));
                }
            }
        }
    }
    out
}

fn extra_dirs() -> Vec<PathBuf> {
    let env = |k: &str| std::env::var_os(k).map(PathBuf::from);
    let mut v = Vec::new();
    if let Some(h) = env("USERPROFILE") {
        v.push(h.join(".local").join("bin"));
        v.push(h.join(".bun").join("bin"));
        v.push(h.join(".opencode").join("bin"));
    }
    if let Some(l) = env("LOCALAPPDATA") {
        v.push(l.join("agy").join("bin"));
        v.push(l.join("Programs").join("claude"));
    }
    if let Some(a) = env("APPDATA") {
        v.push(a.join("npm"));
    }
    v
}

/// Carpetas donde buscar, sin repetir y en orden: PATH del proceso, del registro y extras.
pub fn search_dirs() -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let mut push = |p: PathBuf| {
        let key = p.to_string_lossy().trim_end_matches('\\').to_lowercase();
        if !key.is_empty() && seen.insert(key) {
            out.push(p);
        }
    };
    if let Some(p) = std::env::var_os("PATH") {
        std::env::split_paths(&p).for_each(&mut push);
    }
    for p in registry_path() {
        std::env::split_paths(&p).for_each(&mut push);
    }
    extra_dirs().into_iter().for_each(&mut push);
    out
}

/// Busca un programa en las carpetas dadas.
pub fn resolve_in(name: &str, dirs: &[PathBuf]) -> Option<PathBuf> {
    if name.is_empty() {
        return None;
    }
    let p = Path::new(name);
    if p.is_absolute() {
        return p.is_file().then(|| p.to_path_buf());
    }
    let has_ext = p.extension().map(|e| EXTS.contains(&e.to_string_lossy().to_lowercase().as_str())).unwrap_or(false);
    for d in dirs {
        if has_ext {
            let c = d.join(name);
            if c.is_file() {
                return Some(c);
            }
            continue;
        }
        for ext in EXTS {
            let c = d.join(format!("{name}.{ext}"));
            if c.is_file() {
                return Some(c);
            }
        }
    }
    None
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detected {
    /// Ruta encontrada, o `None` si no está instalado.
    path: Option<String>,
}

/// Dónde está cada comando (mismo orden que la lista recibida).
#[tauri::command]
pub fn agents_detect(commands: Vec<String>) -> Vec<Detected> {
    let dirs = search_dirs();
    commands
        .iter()
        .map(|c| Detected { path: resolve_in(&first_token(c), &dirs).map(|p| p.display().to_string()) })
        .collect()
}

/// PATH completo (proceso + registro + carpetas de agentes), para las pestañas de agentes:
/// así encuentran programas instalados después de abrir AlphaTerm.
#[tauri::command]
pub fn agents_path_env() -> String {
    std::env::join_paths(search_dirs()).map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

// --- Modelos de cada agente ------------------------------------------------------------------

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    /// Nombre para mostrar ("" si el agente no da uno).
    pub label: String,
    /// Niveles de esfuerzo que acepta (vacío = no se sabe).
    pub efforts: Vec<String>,
    pub default_effort: Option<String>,
}

/// `models_cache.json` de Codex: solo los modelos visibles en su selector, en su orden.
pub fn parse_codex_cache(json: &str) -> Vec<ModelInfo> {
    let v: serde_json::Value = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let mut list: Vec<(i64, ModelInfo)> = v["models"]
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or(&[])
        .iter()
        .filter(|m| m["visibility"].as_str().unwrap_or("list") == "list")
        .filter_map(|m| {
            let id = m["slug"].as_str()?.to_string();
            let efforts = m["supported_reasoning_levels"]
                .as_array()
                .map(|l| l.iter().filter_map(|x| x["effort"].as_str().map(String::from)).collect())
                .unwrap_or_default();
            let info = ModelInfo {
                label: m["display_name"].as_str().unwrap_or("").to_string(),
                efforts,
                default_effort: m["default_reasoning_level"].as_str().map(String::from),
                id,
            };
            Some((m["priority"].as_i64().unwrap_or(i64::MAX), info))
        })
        .collect();
    list.sort_by_key(|(p, _)| *p);
    list.into_iter().map(|(_, m)| m).collect()
}

/// Salida de `agy models`: "id<TAB>Nombre" por línea (la primera es "Fetching…").
pub fn parse_agy_models(out: &str) -> Vec<ModelInfo> {
    out.lines()
        .filter_map(|l| {
            let (id, label) = l.split_once('\t')?;
            let id = id.trim();
            (!id.is_empty() && !id.contains(' ')).then(|| ModelInfo { id: id.into(), label: label.trim().into(), efforts: vec![], default_effort: None })
        })
        .collect()
}

/// Salida de `opencode models`: "proveedor/modelo" por línea.
pub fn parse_opencode_models(out: &str) -> Vec<ModelInfo> {
    out.lines()
        .map(str::trim)
        .filter(|l| l.contains('/') && !l.contains(' '))
        .map(|l| ModelInfo { id: l.into(), label: String::new(), efforts: vec![], default_effort: None })
        .collect()
}

/// Corre un programa sin ventana y devuelve su salida estándar (con tiempo límite).
fn run_hidden(exe: &Path, args: &[&str], limit: std::time::Duration) -> Result<String, String> {
    use std::process::{Command, Stdio};
    let mut c = Command::new(exe);
    c.args(args)
        .env("AGY_CLI_DISABLE_AUTO_UPDATE", "true")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = c.spawn().map_err(|e| e.to_string())?;
    let mut so = child.stdout.take().unwrap();
    let reader = std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = std::io::Read::read_to_end(&mut so, &mut b);
        b
    });
    let start = std::time::Instant::now();
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            break;
        }
        if start.elapsed() > limit {
            let _ = child.kill();
            return Err("tardó demasiado".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    Ok(String::from_utf8_lossy(&reader.join().unwrap_or_default()).into_owned())
}

fn models_for(kind: &str, command: &str) -> Result<Vec<ModelInfo>, String> {
    let limit = std::time::Duration::from_secs(25);
    let exe = || resolve_in(&first_token(command), &search_dirs()).ok_or_else(|| format!("no se encontró {}", first_token(command)));
    match kind {
        "codex" => {
            let home = std::env::var_os("CODEX_HOME")
                .map(PathBuf::from)
                .or_else(|| std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join(".codex")))
                .ok_or("no se encontró la carpeta de Codex")?;
            let json = std::fs::read_to_string(home.join("models_cache.json"))
                .map_err(|_| "Codex todavía no guardó su lista de modelos (la baja al abrirlo)".to_string())?;
            Ok(parse_codex_cache(&json))
        }
        "agy" => run_hidden(&exe()?, &["models"], limit).map(|o| parse_agy_models(&o)),
        "opencode" => run_hidden(&exe()?, &["models"], limit).map(|o| parse_opencode_models(&o)),
        _ => Ok(Vec::new()),
    }
}

/// Modelos que ofrece un agente (`kind`: codex, agy u opencode; los demás, lista vacía).
#[tauri::command]
pub async fn agent_models(kind: String, command: String) -> Result<Vec<ModelInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || models_for(&kind, &command)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modelos_de_codex() {
        let j = r#"{"models":[
            {"slug":"b","display_name":"B","priority":2,"visibility":"list","default_reasoning_level":"medium","supported_reasoning_levels":[{"effort":"low"},{"effort":"high"}]},
            {"slug":"oculto","priority":0,"visibility":"hide"},
            {"slug":"a","display_name":"A","priority":1,"visibility":"list"}]}"#;
        let m = parse_codex_cache(j);
        assert_eq!(m.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), ["a", "b"]);
        assert_eq!(m[1].efforts, ["low", "high"]);
        assert_eq!(m[1].default_effort.as_deref(), Some("medium"));
        assert!(parse_codex_cache("no es json").is_empty());
    }

    #[test]
    fn modelos_de_agy_y_opencode() {
        let a = parse_agy_models("Fetching available models...\ngemini-4-neon-high\tGemini 4 Neon (High)\n\n");
        assert_eq!(a, [ModelInfo { id: "gemini-4-neon-high".into(), label: "Gemini 4 Neon (High)".into(), efforts: vec![], default_effort: None }]);
        let o = parse_opencode_models("opencode/big-pickle\r\ngoogle/gemini-2.5-pro\nError: algo\n");
        assert_eq!(o.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), ["opencode/big-pickle", "google/gemini-2.5-pro"]);
    }

    #[test]
    fn primer_token() {
        assert_eq!(first_token("claude --model opus"), "claude");
        assert_eq!(first_token("  codex"), "codex");
        assert_eq!(first_token("\"C:\\Program Files\\x\\a.exe\" -v"), "C:\\Program Files\\x\\a.exe");
        assert_eq!(first_token(""), "");
    }

    #[test]
    fn expande_variables() {
        let get = |n: &str| (n == "USERPROFILE").then(|| "C:\\Users\\yo".to_string());
        assert_eq!(expand_vars("%USERPROFILE%\\bin;%NOEXISTE%\\x;100%", get), "C:\\Users\\yo\\bin;%NOEXISTE%\\x;100%");
    }

    #[test]
    fn resuelve_con_extensiones() {
        let d = std::env::temp_dir().join(format!("alphaterm-agents-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("miagente.cmd"), "@echo hola").unwrap();
        let dirs = vec![PathBuf::from("C:\\no\\existe"), d.clone()];
        assert_eq!(resolve_in("miagente", &dirs), Some(d.join("miagente.cmd")));
        assert_eq!(resolve_in("miagente.cmd", &dirs), Some(d.join("miagente.cmd")));
        assert_eq!(resolve_in("otro", &dirs), None);
        assert!(resolve_in("cmd", &search_dirs()).is_some(), "cmd.exe está en el PATH");
    }
}
