//! Projects: folders where work was done with agents (Claude Code, Codex) and each one's tree.
//!
//! - Claude: each folder in `~/.claude/projects` has transcripts with the real `cwd` (the folder
//!   name encodes the path, but with ambiguous hyphens: the `cwd` is read from inside).
//! - Codex: the first line of each session (`session_meta`) carries the `cwd`.
//! - The tree respects `.gitignore` (`ignore` crate) and loads one folder at a time. A watcher
//!   (`notify`) reports when an open folder changes.

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter, Webview};

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub path: String,
    /// "claude", "codex".
    pub sources: Vec<String>,
    /// Last time used (unix ms).
    pub last_used: u64,
    pub exists: bool,
    pub git: bool,
}

fn mtime_ms(p: &Path) -> u64 {
    std::fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// First `cwd` that appears in the first lines of a Claude transcript.
pub fn cwd_in_lines(lines: impl Iterator<Item = String>) -> Option<String> {
    for line in lines.take(80) {
        if !line.contains("\"cwd\"") {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(&line) {
            if let Some(c) = v.get("cwd").and_then(Value::as_str).or_else(|| v.pointer("/payload/cwd").and_then(Value::as_str)) {
                return Some(c.to_string());
            }
        }
    }
    None
}

fn home() -> PathBuf {
    crate::os::home()
}

fn claude_projects() -> Vec<(String, u64)> {
    let root = home().join(".claude").join("projects");
    let Ok(rd) = std::fs::read_dir(&root) else { return vec![] };
    let mut out = Vec::new();
    for dir in rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()) {
        let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|e| e == "jsonl"))
            .collect();
        files.sort_by_key(|p| std::cmp::Reverse(mtime_ms(p)));
        for f in files.iter().take(3) {
            let Ok(file) = std::fs::File::open(f) else { continue };
            if let Some(cwd) = cwd_in_lines(BufReader::new(file).lines().map_while(Result::ok)) {
                out.push((cwd, mtime_ms(f)));
                break;
            }
        }
    }
    out
}

fn codex_projects() -> Vec<(String, u64)> {
    let root = home().join(".codex").join("sessions");
    let mut files = Vec::new();
    walk(&root, &mut files, 0);
    files.sort_by_key(|p| std::cmp::Reverse(mtime_ms(p)));
    files
        .iter()
        .take(80)
        .filter_map(|f| {
            let text = crate::usage::read_maybe_zst(f)?;
            cwd_in_lines(text.lines().map(str::to_string)).map(|c| (c, mtime_ms(f)))
        })
        .collect()
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > 5 {
        return;
    }
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(&p, out, depth + 1);
        } else if p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("rollout-")) {
            out.push(p);
        }
    }
}

/// Merges the sources: same folder (ignoring case and trailing slash) = one project.
pub fn merge(found: Vec<(String, u64, &'static str)>) -> Vec<Found> {
    let mut by: HashMap<String, Found> = HashMap::new();
    for (path, used, src) in found {
        let key = path.trim_end_matches(['\\', '/']).to_lowercase();
        if key.is_empty() {
            continue;
        }
        let e = by.entry(key).or_insert_with(|| Found { path: path.trim_end_matches(['\\', '/']).to_string(), sources: vec![], last_used: 0, exists: false, git: false });
        if !e.sources.iter().any(|s| s == src) {
            e.sources.push(src.to_string());
        }
        e.last_used = e.last_used.max(used);
    }
    let mut out: Vec<Found> = by.into_values().collect();
    for f in &mut out {
        let p = Path::new(&f.path);
        f.exists = p.is_dir();
        f.git = crate::procinfo::git_dir(p).is_some();
    }
    out.sort_by(|a, b| b.last_used.cmp(&a.last_used));
    out
}

#[tauri::command]
pub async fn projects_discover() -> Result<Vec<Found>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut all: Vec<(String, u64, &'static str)> = Vec::new();
        all.extend(claude_projects().into_iter().map(|(p, t)| (p, t, "claude")));
        all.extend(codex_projects().into_iter().map(|(p, t)| (p, t, "codex")));
        merge(all)
    })
    .await
    .map_err(|e| e.to_string())
}

// --- Tree ---

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub dir: bool,
    pub size: u64,
}

/// Contents of a folder: folders first, then files, respecting .gitignore
/// (including those of parent folders inside the repo) and hiding `.git`.
pub fn list_dir(dir: &Path) -> Result<Vec<Entry>, String> {
    if !dir.is_dir() {
        return Err(tr!("No existe la carpeta {}", "The folder {} doesn't exist", "A pasta {} não existe"; dir.display()));
    }
    let walker = ignore::WalkBuilder::new(dir)
        .max_depth(Some(1))
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .parents(true)
        .require_git(false)
        .filter_entry(|e| e.file_name() != ".git")
        .build();
    let mut out: Vec<Entry> = walker
        .flatten()
        .filter(|e| e.depth() == 1)
        .map(|e| {
            let md = e.metadata().ok();
            Entry {
                name: e.file_name().to_string_lossy().into_owned(),
                path: e.path().display().to_string(),
                dir: md.as_ref().is_some_and(|m| m.is_dir()),
                size: md.as_ref().filter(|m| m.is_file()).map(|m| m.len()).unwrap_or(0),
            }
        })
        .collect();
    out.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    if out.len() > 2000 {
        out.truncate(2000);
    }
    Ok(out)
}

#[tauri::command]
pub async fn fs_list(dir: String) -> Result<Vec<Entry>, String> {
    tauri::async_runtime::spawn_blocking(move || list_dir(Path::new(&dir))).await.map_err(|e| e.to_string())?
}

// --- Watcher ---

/// One watcher per window, over the folders that window has open.
#[derive(Default)]
pub struct WatchState {
    watchers: Mutex<HashMap<String, (notify::RecommendedWatcher, Vec<PathBuf>)>>,
}

#[derive(Serialize, Clone)]
struct FsChanged {
    dirs: Vec<String>,
}

/// Replaces the set of watched folders for this window (non-recursive: only the open ones).
#[tauri::command]
pub fn fs_watch(app: AppHandle, webview: Webview, state: tauri::State<WatchState>, dirs: Vec<String>) -> Result<(), String> {
    use notify::{RecursiveMode, Watcher};
    let label = webview.label().to_string();
    let mut map = state.watchers.lock().unwrap();
    if dirs.is_empty() {
        map.remove(&label);
        return Ok(());
    }
    if !map.contains_key(&label) {
        let target = label.clone();
        let app2 = app.clone();
        let w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let Ok(ev) = res else { return };
            // Only the folder that changed matters (the frontend lists it again).
            let mut dirs: Vec<String> = ev.paths.iter().filter_map(|p| p.parent().map(|d| d.display().to_string())).collect();
            dirs.sort();
            dirs.dedup();
            if !dirs.is_empty() {
                let _ = app2.emit_to(&target, "fs-changed", FsChanged { dirs });
            }
        })
        .map_err(|e| e.to_string())?;
        map.insert(label.clone(), (w, vec![]));
    }
    let (w, current) = map.get_mut(&label).unwrap();
    let want: Vec<PathBuf> = dirs.iter().map(PathBuf::from).filter(|p| p.is_dir()).collect();
    for old in current.iter().filter(|p| !want.contains(p)) {
        let _ = w.unwatch(old);
    }
    for new in want.iter().filter(|p| !current.contains(p)) {
        let _ = w.watch(new, RecursiveMode::NonRecursive);
    }
    *current = want;
    Ok(())
}

pub fn unwatch_window(state: &WatchState, label: &str) {
    state.watchers.lock().unwrap().remove(label);
}

// --- Terminal links: existence and preview ---

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Stat {
    pub dir: bool,
    pub size: u64,
}

/// Which paths exist (so text that merely looks like a path doesn't get underlined).
#[tauri::command]
pub fn fs_stat(paths: Vec<String>) -> Vec<Option<Stat>> {
    paths
        .iter()
        .take(200)
        .map(|p| std::fs::metadata(p).ok().map(|m| Stat { dir: m.is_dir(), size: if m.is_file() { m.len() } else { 0 } }))
        .collect()
}

const PREVIEW_IMAGE_MAX: u64 = 15 * 1024 * 1024;

/// First bytes of a file (text: up to `max`; whole image if it weighs less than 15 MB).
#[tauri::command]
pub fn fs_head(path: String, max: u64, whole_if_under: Option<bool>) -> Result<tauri::ipc::Response, String> {
    use std::io::Read;
    let md = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if !md.is_file() {
        return Err(crate::i18n::tr("No es un archivo", "Not a file", "Não é um arquivo").into());
    }
    let limit = if whole_if_under.unwrap_or(false) {
        if md.len() > PREVIEW_IMAGE_MAX {
            return Err(crate::i18n::tr("La imagen es muy grande para la vista previa", "The image is too large to preview", "A imagem é grande demais para a visualização").into());
        }
        md.len()
    } else {
        max.min(256 * 1024)
    };
    let mut buf = Vec::with_capacity(limit as usize);
    std::fs::File::open(&path).map_err(|e| e.to_string())?.take(limit).read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(buf))
}

// --- Open externally ---

/// Opens a folder or file in Explorer, in VS Code or with the associated program.
#[tauri::command]
pub fn fs_open(path: String, with: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(tr!("No existe {path}", "{path} doesn't exist", "{path} não existe"));
    }
    #[cfg(not(windows))]
    return match with.as_str() {
        // "explorer" is the file manager (the name stays because the frontend sends it).
        "explorer" => crate::os::reveal(&p),
        "default" => crate::os::open(&p),
        "vscode" => {
            let code = crate::agents::resolve_in("code", &crate::agents::search_dirs()).ok_or(crate::i18n::tr("No se encontró VS Code (code) en el PATH", "VS Code (code) wasn't found in the PATH", "O VS Code (code) não foi encontrado no PATH"))?;
            let mut c = std::process::Command::new(code);
            c.arg(&p).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
            let mut child = c.spawn().map_err(|e| e.to_string())?;
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            Ok(())
        }
        other => Err(tr!("No sé abrir con {other}", "Don't know how to open with {other}", "Não sei abrir com {other}")),
    };
    #[cfg(windows)]
    let mut cmd = match with.as_str() {
        "explorer" => {
            let mut c = std::process::Command::new("explorer.exe");
            if p.is_dir() {
                c.arg(&p);
            } else {
                c.arg(format!("/select,{}", p.display()));
            }
            c
        }
        "vscode" => {
            let code = crate::agents::resolve_in("code", &crate::agents::search_dirs()).ok_or(crate::i18n::tr("No se encontró VS Code (code) en el PATH", "VS Code (code) wasn't found in the PATH", "O VS Code (code) não foi encontrado no PATH"))?;
            // code.cmd is a script: it runs with cmd /c so it works without a visible console.
            let mut c = std::process::Command::new("cmd.exe");
            c.arg("/c").arg(code).arg(&p);
            c
        }
        "default" => {
            let mut c = std::process::Command::new("explorer.exe");
            c.arg(&p);
            c
        }
        other => return Err(tr!("No sé abrir con {other}", "Don't know how to open with {other}", "Não sei abrir com {other}")),
    };
    #[cfg(windows)]
    {
        crate::os::no_window(&mut cmd);
        cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lee_el_cwd_de_claude_y_de_codex() {
        let claude = ["{\"type\":\"summary\"}", "{\"cwd\":\"C:\\\\Users\\\\yo\\\\web\",\"type\":\"user\"}"];
        assert_eq!(cwd_in_lines(claude.iter().map(|s| s.to_string())).as_deref(), Some("C:\\Users\\yo\\web"));
        let codex = ["{\"type\":\"session_meta\",\"payload\":{\"cwd\":\"C:\\\\x\"}}"];
        assert_eq!(cwd_in_lines(codex.iter().map(|s| s.to_string())).as_deref(), Some("C:\\x"));
        assert_eq!(cwd_in_lines(["nada"].iter().map(|s| s.to_string())), None);
    }

    #[test]
    fn junta_fuentes_y_ordena() {
        let m = merge(vec![
            ("C:\\a\\".into(), 10, "claude"),
            ("c:\\A".into(), 30, "codex"),
            ("C:\\b".into(), 20, "claude"),
            ("".into(), 99, "claude"),
        ]);
        assert_eq!(m.len(), 2);
        assert_eq!(m[0].path, "C:\\a");
        assert_eq!(m[0].sources, vec!["claude", "codex"]);
        assert_eq!(m[0].last_used, 30);
    }

    #[test]
    fn el_arbol_respeta_gitignore() {
        let d = std::env::temp_dir().join(format!("alphaterm-tree-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("src")).unwrap();
        std::fs::create_dir_all(d.join("node_modules").join("x")).unwrap();
        std::fs::create_dir_all(d.join(".git")).unwrap();
        std::fs::write(d.join(".gitignore"), "node_modules/\n*.log\n").unwrap();
        std::fs::write(d.join("b.txt"), "hola").unwrap();
        std::fs::write(d.join("A.md"), "").unwrap();
        std::fs::write(d.join("debug.log"), "").unwrap();
        let names: Vec<String> = list_dir(&d).unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, vec!["src", ".gitignore", "A.md", "b.txt"]);
        assert!(list_dir(&d.join("no-existe")).is_err());
    }
}
