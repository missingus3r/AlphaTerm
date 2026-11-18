//! Agentes: dónde está instalado cada uno.
//!
//! Se busca el primer token del comando en el PATH del proceso, en el PATH del registro (por si
//! se instaló algo después de abrir NovaTerm) y en las carpetas donde se suelen instalar.
//! No se ejecuta nada: solo se mira si el archivo existe.

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
/// así encuentran programas instalados después de abrir NovaTerm.
#[tauri::command]
pub fn agents_path_env() -> String {
    std::env::join_paths(search_dirs()).map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let d = std::env::temp_dir().join(format!("novaterm-agents-{}", std::process::id()));
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
