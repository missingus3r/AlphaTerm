//! Datos para las predicciones de comandos (ver `src/suggest/`): carpetas y archivos, la puerta de
//! enlace (para `ping`), los ejecutables del PATH, los scripts de npm y los procesos abiertos.
//! Todo es lectura local y rápida; lo que se repite mucho al tipear (carpetas, PATH) va con caché.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const MAX_ENTRIES: usize = 500;
const DIR_TTL: Duration = Duration::from_secs(3);
const SLOW_TTL: Duration = Duration::from_secs(60);

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct DirEntry {
    pub name: String,
    pub dir: bool,
}

/// La carpeta a listar para lo escrito (`dir` es la parte hasta la última barra, o vacío).
/// `None` para rutas de red: pueden tardar segundos en contestar.
pub fn resolve_dir(cwd: &Path, dir: &str, home: &Path) -> Option<PathBuf> {
    if dir.starts_with("\\\\") || dir.starts_with("//") {
        return None;
    }
    if dir.is_empty() {
        return Some(cwd.to_path_buf());
    }
    if dir == "~" {
        return Some(home.to_path_buf());
    }
    if let Some(rest) = dir.strip_prefix("~\\").or_else(|| dir.strip_prefix("~/")) {
        return Some(home.join(rest));
    }
    let b = dir.as_bytes();
    if b.len() == 2 && b[1] == b':' && b[0].is_ascii_alphabetic() {
        return Some(PathBuf::from(format!("{dir}\\")));
    }
    // `join` reemplaza todo si `dir` ya es absoluta.
    Some(cwd.join(dir))
}

fn is_hidden(name: &str, meta: Option<&std::fs::Metadata>) -> bool {
    if name.starts_with('.') {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const HIDDEN: u32 = 0x2;
        const SYSTEM: u32 = 0x4;
        if let Some(m) = meta {
            return m.file_attributes() & (HIDDEN | SYSTEM) != 0;
        }
    }
    let _ = meta;
    false
}

/// Contenido de una carpeta, en orden alfabético sin distinguir mayúsculas (hasta 500 entradas).
/// Ocultas y de sistema (o que empiezan con `.`) solo con `hidden`.
pub fn list_dir(path: &Path, dirs_only: bool, hidden: bool) -> Vec<DirEntry> {
    let Ok(rd) = std::fs::read_dir(path) else { return vec![] };
    let mut out: Vec<DirEntry> = rd
        .filter_map(Result::ok)
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if !hidden && is_hidden(&name, e.metadata().ok().as_ref()) {
                return None;
            }
            // `is_dir` de la ruta sigue enlaces y junctions (las carpetas de OneDrive, por ejemplo).
            let dir = e.path().is_dir();
            (dir || !dirs_only).then_some(DirEntry { name, dir })
        })
        .collect();
    out.sort_by_key(|e| e.name.to_lowercase());
    out.truncate(MAX_ENTRIES);
    out
}

/// Scripts del `package.json` de la carpeta, en el orden del archivo.
pub fn npm_scripts(dir: &Path) -> Vec<(String, String)> {
    let Ok(text) = std::fs::read_to_string(dir.join("package.json")) else { return vec![] };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { return vec![] };
    v.get("scripts")
        .and_then(|s| s.as_object())
        .map(|o| o.iter().map(|(k, v)| (k.clone(), v.as_str().unwrap_or_default().to_string())).collect())
        .unwrap_or_default()
}

/// Nombres (sin extensión, sin repetir) de los ejecutables del PATH según PATHEXT, más los `.ps1`.
pub fn path_commands(path_env: &str, pathext: &str) -> Vec<String> {
    let mut exts: HashSet<String> = pathext.split(';').filter(|e| !e.is_empty()).map(|e| e.to_lowercase()).collect();
    exts.insert(".ps1".into());
    let mut seen = HashSet::new();
    let mut out = vec![];
    for dir in std::env::split_paths(path_env) {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.filter_map(Result::ok) {
            let p = e.path();
            let (Some(stem), Some(ext)) = (p.file_stem(), p.extension()) else { continue };
            if !exts.contains(&format!(".{}", ext.to_string_lossy().to_lowercase())) {
                continue;
            }
            let stem = stem.to_string_lossy().into_owned();
            if seen.insert(stem.to_lowercase()) {
                out.push(stem);
            }
        }
    }
    out.sort_by_key(|s| s.to_lowercase());
    out
}

/// Siguiente salto de la ruta hacia Internet (el router de la casa), o `None`.
#[cfg(windows)]
pub fn gateway() -> Option<String> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{GetBestRoute, MIB_IPFORWARDROW};
    let dest = u32::from_ne_bytes([8, 8, 8, 8]);
    let mut row: MIB_IPFORWARDROW = unsafe { std::mem::zeroed() };
    if unsafe { GetBestRoute(dest, 0, &mut row) } != 0 {
        return None;
    }
    let ip = std::net::Ipv4Addr::from(row.dwForwardNextHop.to_ne_bytes());
    (!ip.is_unspecified()).then(|| ip.to_string())
}

#[cfg(not(windows))]
pub fn gateway() -> Option<String> {
    None
}

/// Nombres de los procesos abiertos (para `taskkill /IM`), sin repetir.
pub fn processes() -> Vec<String> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
    let Ok(mut sys) = System::new() else { return vec![] };
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    let mut seen = HashSet::new();
    let mut out: Vec<String> = sys
        .processes()
        .values()
        .map(|p| p.name().to_string_lossy().into_owned())
        .filter(|n| !n.is_empty() && seen.insert(n.to_lowercase()))
        .collect();
    out.sort_by_key(|s| s.to_lowercase());
    out
}

// --- Comandos ---------------------------------------------------------------------------------

type DirKey = (PathBuf, bool, bool);
static DIR_CACHE: Mutex<Option<HashMap<DirKey, (Instant, Vec<DirEntry>)>>> = Mutex::new(None);
static PATH_CACHE: Mutex<Option<(Instant, Vec<String>)>> = Mutex::new(None);
static GW_CACHE: Mutex<Option<(Instant, Option<String>)>> = Mutex::new(None);

fn home() -> PathBuf {
    std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\"))
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static, fallback: T) -> T {
    tauri::async_runtime::spawn_blocking(f).await.unwrap_or(fallback)
}

#[tauri::command]
pub async fn suggest_list_dir(cwd: String, dir: String, dirs_only: bool, hidden: bool) -> Vec<DirEntry> {
    blocking(
        move || {
            let Some(path) = resolve_dir(Path::new(&cwd), &dir, &home()) else { return vec![] };
            let key = (path.clone(), dirs_only, hidden);
            let mut g = DIR_CACHE.lock().unwrap();
            let cache = g.get_or_insert_with(HashMap::new);
            if let Some((at, v)) = cache.get(&key) {
                if at.elapsed() < DIR_TTL {
                    return v.clone();
                }
            }
            drop(g);
            let v = list_dir(&path, dirs_only, hidden);
            let mut g = DIR_CACHE.lock().unwrap();
            let cache = g.get_or_insert_with(HashMap::new);
            cache.retain(|_, (at, _)| at.elapsed() < DIR_TTL);
            cache.insert(key, (Instant::now(), v.clone()));
            v
        },
        vec![],
    )
    .await
}

#[tauri::command]
pub async fn suggest_gateway() -> Option<String> {
    blocking(
        || {
            if let Some((at, v)) = GW_CACHE.lock().unwrap().as_ref() {
                if at.elapsed() < SLOW_TTL {
                    return v.clone();
                }
            }
            let v = gateway();
            *GW_CACHE.lock().unwrap() = Some((Instant::now(), v.clone()));
            v
        },
        None,
    )
    .await
}

#[tauri::command]
pub async fn suggest_path_commands() -> Vec<String> {
    blocking(
        || {
            if let Some((at, v)) = PATH_CACHE.lock().unwrap().as_ref() {
                if at.elapsed() < SLOW_TTL {
                    return v.clone();
                }
            }
            let pathext = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
            let v = path_commands(&crate::agents::agents_path_env(), &pathext);
            *PATH_CACHE.lock().unwrap() = Some((Instant::now(), v.clone()));
            v
        },
        vec![],
    )
    .await
}

#[tauri::command]
pub async fn suggest_npm_scripts(cwd: String) -> Vec<(String, String)> {
    blocking(move || npm_scripts(Path::new(&cwd)), vec![]).await
}

#[tauri::command]
pub async fn suggest_processes() -> Vec<String> {
    blocking(processes, vec![]).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("alphaterm-suggest-{name}"));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn names(v: &[DirEntry]) -> Vec<(&str, bool)> {
        v.iter().map(|e| (e.name.as_str(), e.dir)).collect()
    }

    #[test]
    fn lista_carpetas_y_archivos_en_orden_sin_ocultas() {
        let d = tmp("lista");
        fs::create_dir(d.join("a")).unwrap();
        fs::create_dir(d.join("B")).unwrap();
        fs::create_dir(d.join(".oculta")).unwrap();
        fs::write(d.join("c.txt"), "x").unwrap();
        assert_eq!(names(&list_dir(&d, false, false)), [("a", true), ("B", true), ("c.txt", false)]);
        assert_eq!(names(&list_dir(&d, true, false)), [("a", true), ("B", true)]);
        assert_eq!(names(&list_dir(&d, true, true)), [(".oculta", true), ("a", true), ("B", true)]);
        assert!(list_dir(&d.join("no-existe"), false, false).is_empty());
    }

    #[test]
    fn resuelve_la_carpeta_de_lo_escrito() {
        let cwd = Path::new(r"C:\proy");
        let home = Path::new(r"C:\Users\x");
        assert_eq!(resolve_dir(cwd, "", home), Some(PathBuf::from(r"C:\proy")));
        assert_eq!(resolve_dir(cwd, r"src\", home), Some(PathBuf::from(r"C:\proy\src\")));
        assert_eq!(resolve_dir(cwd, "..", home), Some(PathBuf::from(r"C:\proy\..")));
        assert_eq!(resolve_dir(cwd, "~", home), Some(PathBuf::from(r"C:\Users\x")));
        assert_eq!(resolve_dir(cwd, r"~\Docs\", home), Some(PathBuf::from(r"C:\Users\x\Docs\")));
        assert_eq!(resolve_dir(cwd, r"D:\datos\", home), Some(PathBuf::from(r"D:\datos\")));
        assert_eq!(resolve_dir(cwd, "D:", home), Some(PathBuf::from(r"D:\")));
        assert_eq!(resolve_dir(cwd, "C:/Users/", home), Some(PathBuf::from("C:/Users/")));
        // Rutas de red: nunca (pueden tardar segundos en contestar).
        assert_eq!(resolve_dir(cwd, r"\\servidor\share\", home), None);
        assert_eq!(resolve_dir(cwd, "//servidor/share/", home), None);
    }

    #[test]
    fn scripts_de_npm_en_orden() {
        let d = tmp("npm");
        fs::write(d.join("package.json"), r#"{"name":"x","scripts":{"dev":"vite","build":"tsc && vite build"}}"#).unwrap();
        assert_eq!(npm_scripts(&d), vec![("dev".to_string(), "vite".to_string()), ("build".to_string(), "tsc && vite build".to_string())]);
        assert!(npm_scripts(&d.join("nada")).is_empty());
    }

    #[test]
    fn comandos_del_path_sin_extension_ni_repetidos() {
        let a = tmp("path-a");
        let b = tmp("path-b");
        fs::write(a.join("foo.exe"), "").unwrap();
        fs::write(b.join("Foo.cmd"), "").unwrap();
        fs::write(b.join("bar.txt"), "").unwrap();
        fs::write(b.join("baz.ps1"), "").unwrap();
        let path = std::env::join_paths([&a, &b]).unwrap().into_string().unwrap();
        assert_eq!(path_commands(&path, ".COM;.EXE;.BAT;.CMD"), ["baz", "foo"]);
    }

    #[test]
    fn la_puerta_de_enlace_es_una_ipv4_o_nada() {
        if let Some(gw) = gateway() {
            let ip: std::net::Ipv4Addr = gw.parse().expect("IPv4");
            assert!(!ip.is_unspecified());
        }
    }

    #[test]
    fn procesos_abiertos_sin_repetir() {
        let p = processes();
        assert!(!p.is_empty());
        let mut lower: Vec<String> = p.iter().map(|s| s.to_lowercase()).collect();
        lower.dedup();
        assert_eq!(lower.len(), p.len());
    }
}
