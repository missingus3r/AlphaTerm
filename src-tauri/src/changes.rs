//! Changes to files made by agents, including files not under version control.
//!
//! Two sources:
//! - Claude Code hook launched from AlphaTerm (PreToolUse/PostToolUse on Write, Edit, MultiEdit,
//!   NotebookEdit): exact copy of the file right before the tool runs and right after.
//! - Folder of a pane with a running agent (Codex, agy, Claude with Bash…): when the agent starts,
//!   the folder's text files are copied (minus what git ignores, hidden folders,
//!   node_modules, target… and large files) and watched; each change is compared with that copy.
//!   Anything not in the copy is compared with the last commit (if it's in git) or shown
//!   in full ("no previous copy").
//!
//! Per file, the version before the first change and the latest one are kept: the diff is cumulative.
//! PDFs are compared by their text. From the panel you can edit and save a file (its encoding and
//! line ending are kept, and it isn't overwritten if it changed since it was opened). Everything is saved in
//! `%APPDATA%\AlphaTerm\changes.json` (7 days).

use crate::i18n::tr;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::SeqCst};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const MAX_TEXT: u64 = 4 * 1024 * 1024;
const MAX_PDF: u64 = 40 * 1024 * 1024;
/// Copy of the folder when an agent starts: up to here (the rest is compared with git or has no copy).
const SNAP_FILES: usize = 20_000;
const SNAP_BYTES: usize = 64 * 1024 * 1024;
const SNAP_FILE_MAX: u64 = 2 * 1024 * 1024;
const KEEP_DAYS: u64 = 7;
const KEEP_ENTRIES: usize = 400;
const KEEP_TEXT_BYTES: usize = 80 * 1024 * 1024;

/// Folders that are never copied or watched (heavy or generated).
const SKIP_DIRS: &[&str] = &["node_modules", "target", "__pycache__", "venv", "site-packages", "bower_components"];
const BINARY_EXT: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tif", "tiff", "psd", "heic", "avif", "mp3", "wav", "flac", "ogg", "m4a", "mp4", "mkv", "mov",
    "avi", "webm", "zip", "7z", "rar", "gz", "tgz", "bz2", "xz", "zst", "tar", "exe", "dll", "so", "dylib", "lib", "obj", "o", "a", "pdb", "class",
    "jar", "wasm", "bin", "dat", "db", "sqlite", "sqlite3", "woff", "woff2", "ttf", "otf", "eot", "pyc", "msi", "iso", "img", "glb", "fbx", "blend",
    "stl", "3mf", "gguf", "safetensors", "onnx", "pt", "pth", "ckpt", "npy", "npz", "parquet", "docx", "xlsx", "pptx", "odt", "ods",
];

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Key of a path (Windows is case-insensitive and treats both separators alike).
pub fn norm(p: &Path) -> String {
    p.to_string_lossy().replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

fn is_pdf(p: &Path) -> bool {
    p.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf"))
}

fn binary_ext(p: &Path) -> bool {
    p.extension().map(|e| BINARY_EXT.contains(&e.to_string_lossy().to_lowercase().as_str())).unwrap_or(false)
}

// --- Content ------------------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum Content {
    Text { text: String },
    Binary { size: u64 },
    TooBig { size: u64 },
    /// Doesn't exist (yet, or anymore).
    Missing,
    /// Exists but couldn't be read (locked by another program).
    Unreadable,
}

impl Content {
    fn text(&self) -> Option<&str> {
        match self {
            Content::Text { text } => Some(text),
            _ => None,
        }
    }
    fn bytes(&self) -> usize {
        self.text().map(str::len).unwrap_or(0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Enc {
    Utf8,
    Utf8Bom,
    Utf16Le,
    Utf16Be,
    Latin1,
}

/// Bytes → text, with the encoding they had (None if it looks binary).
pub fn decode_text(b: &[u8]) -> Option<(String, Enc)> {
    if let Some(rest) = b.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8(rest.to_vec()).ok().map(|s| (s, Enc::Utf8Bom));
    }
    let utf16 = |rest: &[u8], le: bool| {
        let units: Vec<u16> = rest.chunks_exact(2).map(|c| if le { u16::from_le_bytes([c[0], c[1]]) } else { u16::from_be_bytes([c[0], c[1]]) }).collect();
        String::from_utf16(&units).ok()
    };
    if let Some(rest) = b.strip_prefix(&[0xFF, 0xFE]) {
        return utf16(rest, true).map(|s| (s, Enc::Utf16Le));
    }
    if let Some(rest) = b.strip_prefix(&[0xFE, 0xFF]) {
        return utf16(rest, false).map(|s| (s, Enc::Utf16Be));
    }
    if b.iter().take(8192).any(|&c| c == 0) {
        return None;
    }
    if let Ok(s) = std::str::from_utf8(b) {
        return Some((s.to_string(), Enc::Utf8));
    }
    // Text in ANSI (Windows-1252/Latin-1): almost everything printable.
    let odd = b.iter().filter(|&&c| c < 0x09 || (0x0E..0x20).contains(&c) || c == 0x7F).count();
    (odd * 50 <= b.len()).then(|| (b.iter().map(|&c| c as char).collect(), Enc::Latin1))
}

pub fn encode_text(text: &str, enc: Enc) -> Result<Vec<u8>, String> {
    Ok(match enc {
        Enc::Utf8 => text.as_bytes().to_vec(),
        Enc::Utf8Bom => [&[0xEF, 0xBB, 0xBF][..], text.as_bytes()].concat(),
        Enc::Utf16Le => [0xFF, 0xFE].into_iter().chain(text.encode_utf16().flat_map(|u| u.to_le_bytes())).collect(),
        Enc::Utf16Be => [0xFE, 0xFF].into_iter().chain(text.encode_utf16().flat_map(|u| u.to_be_bytes())).collect(),
        Enc::Latin1 => text
            .chars()
            .map(|c| {
                u8::try_from(c as u32).map_err(|_| {
                    tr!(
                        "El archivo está en ANSI y «{c}» no entra en esa codificación.",
                        "The file is in ANSI and \"{c}\" doesn't fit that encoding.",
                        "O arquivo está em ANSI e \"{c}\" não cabe nessa codificação."
                    )
                })
            })
            .collect::<Result<Vec<_>, _>>()?,
    })
}

/// Text of a PDF (pdf-extract can panic on odd PDFs: that's caught).
fn pdf_text(b: &[u8]) -> Option<String> {
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| pdf_extract::extract_text_from_mem(b))).ok()?.ok()?;
    let mut out = String::new();
    let mut blank = 0;
    for l in r.lines() {
        let l = l.trim_end();
        if l.trim().is_empty() {
            blank += 1;
            if blank > 1 {
                continue;
            }
        } else {
            blank = 0;
        }
        out.push_str(l);
        out.push('\n');
    }
    Some(out)
}

pub fn decode(path: &Path, b: &[u8]) -> Content {
    if is_pdf(path) {
        return pdf_text(b).map(|text| Content::Text { text }).unwrap_or(Content::Binary { size: b.len() as u64 });
    }
    match decode_text(b) {
        Some((text, _)) => Content::Text { text },
        None => Content::Binary { size: b.len() as u64 },
    }
}

/// Reads with retries (the program writing it may have it open for a moment).
fn read_bytes(path: &Path) -> Result<Vec<u8>, std::io::Error> {
    let mut last = None;
    for i in 0..4 {
        match std::fs::read(path) {
            Ok(b) => return Ok(b),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(e),
            Err(e) => last = Some(e),
        }
        std::thread::sleep(Duration::from_millis(60 * (i + 1)));
    }
    Err(last.unwrap())
}

pub fn read_content(path: &Path) -> Content {
    let md = match std::fs::metadata(path) {
        Ok(m) if m.is_file() => m,
        Ok(_) => return Content::Missing,
        Err(_) => return Content::Missing,
    };
    let size = md.len();
    if size > if is_pdf(path) { MAX_PDF } else { MAX_TEXT } {
        return Content::TooBig { size };
    }
    if binary_ext(path) {
        return Content::Binary { size };
    }
    match read_bytes(path) {
        Ok(b) => decode(path, &b),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Content::Missing,
        Err(_) => Content::Unreadable,
    }
}

// --- Diffs ----------------------------------------------------------------------------------------

fn text_diff<'a>(a: &'a str, b: &'a str) -> similar::TextDiff<'a, 'a, str> {
    similar::TextDiff::configure().timeout(Duration::from_secs(2)).diff_lines(a, b)
}

pub fn counts(a: &str, b: &str) -> (u32, u32) {
    let d = text_diff(a, b);
    let (mut add, mut del) = (0, 0);
    for c in d.iter_all_changes() {
        match c.tag() {
            similar::ChangeTag::Insert => add += 1,
            similar::ChangeTag::Delete => del += 1,
            similar::ChangeTag::Equal => {}
        }
    }
    (add, del)
}

pub fn unified(a: &str, b: &str, name: &str) -> String {
    text_diff(a, b).unified_diff().context_radius(3).header(&format!("a/{name}"), &format!("b/{name}")).to_string()
}

// --- Log -------------------------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: u64,
    pub path: String,
    pub first_at: u64,
    pub last_at: u64,
    /// Who changed it ("Claude Code", "Codex"…, "Vos (a mano)").
    pub agents: Vec<String>,
    /// Tools (Edit, Write…) when known.
    pub tools: Vec<String>,
    pub events: u32,
    /// Where the earlier version came from: "hook", "carpeta", "git" or "ninguna".
    pub base_from: String,
    /// None: it isn't known what it was like before.
    pub before: Option<Content>,
    pub after: Content,
    pub in_git: bool,
    pub adds: u32,
    pub dels: u32,
    pub version: u64,
    /// The last change was made by the user from the panel.
    pub manual: bool,
}

impl Entry {
    fn recount(&mut self) {
        let empty = String::new();
        let a = self.before.as_ref().and_then(|c| c.text()).unwrap_or(&empty);
        let (add, del) = match (self.after.text(), self.before.as_ref()) {
            (Some(b), _) => counts(a, b),
            (None, Some(Content::Text { text })) if self.after == Content::Missing => (0, text.lines().count() as u32),
            _ => (0, 0),
        };
        self.adds = add;
        self.dels = del;
    }
    fn touch(&mut self, agent: &str, tool: Option<&str>) {
        if !self.agents.iter().any(|a| a == agent) {
            self.agents.push(agent.to_string());
        }
        if let Some(t) = tool {
            if !self.tools.iter().any(|x| x == t) {
                self.tools.push(t.to_string());
            }
        }
    }
}

/// What the list shows (without the texts).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: u64,
    pub path: String,
    pub first_at: u64,
    pub last_at: u64,
    pub agents: Vec<String>,
    pub tools: Vec<String>,
    pub events: u32,
    pub base_from: String,
    pub in_git: bool,
    pub pdf: bool,
    pub adds: u32,
    pub dels: u32,
    pub version: u64,
    pub manual: bool,
    pub created: bool,
    pub deleted: bool,
    /// "text", "binary", "tooBig" or "unreadable" (the current version).
    pub kind: String,
    pub size: Option<u64>,
    /// Can be edited from the panel (text, not PDF, exists).
    pub editable: bool,
}

impl From<&Entry> for Summary {
    fn from(e: &Entry) -> Self {
        let (kind, size) = match &e.after {
            Content::Text { text } => ("text", Some(text.len() as u64)),
            Content::Binary { size } => ("binary", Some(*size)),
            Content::TooBig { size } => ("tooBig", Some(*size)),
            Content::Missing => ("text", None),
            Content::Unreadable => ("unreadable", None),
        };
        let pdf = is_pdf(Path::new(&e.path));
        Summary {
            id: e.id,
            path: e.path.clone(),
            first_at: e.first_at,
            last_at: e.last_at,
            agents: e.agents.clone(),
            tools: e.tools.clone(),
            events: e.events,
            base_from: e.base_from.clone(),
            in_git: e.in_git,
            pdf,
            adds: e.adds,
            dels: e.dels,
            version: e.version,
            manual: e.manual,
            created: e.before == Some(Content::Missing),
            deleted: e.after == Content::Missing,
            kind: kind.into(),
            size,
            editable: !pdf && matches!(e.after, Content::Text { .. }),
        }
    }
}

// --- Folder copies -----------------------------------------------------------------------------------

#[derive(Default)]
struct Snap {
    files: HashMap<String, Vec<u8>>,
    /// Files that existed but weren't copied (large or binary): they aren't "new".
    skipped: HashSet<String>,
    /// Everything that was there was copied (the cap wasn't reached).
    complete: bool,
    ready: bool,
    gitignore: Option<ignore::gitignore::Gitignore>,
}

struct DirWatch {
    root: PathBuf,
    /// pane → (window, agent name, generation)
    panes: HashMap<String, (String, String, u64)>,
    snap: Arc<Mutex<Snap>>,
    watcher: Option<notify::RecommendedWatcher>,
}

impl DirWatch {
    fn agent_label(&self) -> String {
        let mut names: Vec<&str> = self.panes.values().map(|(_, a, _)| a.as_str()).collect();
        names.sort();
        names.dedup();
        names.join(" + ")
    }
}

/// Folders too broad to watch: a drive root, the user's folder, and the roots
/// of AppData and Temp (their subfolders are fine: a project may live there), and Windows ones.
pub fn too_broad(root: &Path) -> bool {
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_default();
    let k = norm(root);
    let exact = [
        home.clone(),
        home.join("AppData"),
        home.join("AppData").join("Local"),
        home.join("AppData").join("LocalLow"),
        home.join("AppData").join("Roaming"),
        home.join("AppData").join("Local").join("Temp"),
        std::env::temp_dir(),
    ];
    root.parent().is_none()
        || exact.iter().any(|p| norm(p) == k)
        || k.starts_with("c:\\windows")
        || k.starts_with("c:\\program files")
        || k.starts_with("c:\\programdata")
}

fn skip_dir_name(n: &str) -> bool {
    n.starts_with('.') || SKIP_DIRS.iter().any(|d| d.eq_ignore_ascii_case(n))
}

/// Temporary files from editors and atomic writes.
fn temp_name(n: &str) -> bool {
    let l = n.to_lowercase();
    l.ends_with('~')
        || l.starts_with(".#")
        || l.starts_with("~$")
        || l.contains(".tmp")
        || [".swp", ".swx", ".crdownload", ".part", ".partial", ".bak"].iter().any(|s| l.ends_with(s))
}

/// Is this folder change ignored? (hidden or heavy folders, temporary files, .gitignore).
fn ignored(root: &Path, path: &Path, snap: &Snap) -> bool {
    let Ok(rel) = path.strip_prefix(root) else { return true };
    let comps: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    let Some((name, dirs)) = comps.split_last() else { return true };
    if dirs.iter().any(|d| skip_dir_name(d)) || temp_name(name) {
        return true;
    }
    snap.gitignore.as_ref().is_some_and(|g| g.matched_path_or_any_parents(path, false).is_ignore())
}

fn take_snapshot(root: &Path) -> Snap {
    let mut snap = Snap { complete: true, ..Default::default() };
    let mut gi = ignore::gitignore::GitignoreBuilder::new(root);
    if root.join(".gitignore").is_file() {
        gi.add(root.join(".gitignore"));
    }
    snap.gitignore = gi.build().ok();
    let mut bytes = 0usize;
    let walker = ignore::WalkBuilder::new(root)
        .hidden(false)
        .parents(true)
        .git_ignore(true)
        .git_exclude(true)
        .git_global(true)
        .ignore(true)
        .follow_links(false)
        .max_depth(Some(16))
        .filter_entry(|e| !(e.file_type().is_some_and(|t| t.is_dir()) && e.depth() > 0 && skip_dir_name(&e.file_name().to_string_lossy())))
        .build();
    for ent in walker.flatten() {
        if !ent.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let p = ent.path();
        let key = norm(p);
        if snap.files.len() >= SNAP_FILES || bytes >= SNAP_BYTES {
            snap.complete = false;
            break;
        }
        let size = ent.metadata().map(|m| m.len()).unwrap_or(u64::MAX);
        let limit = if is_pdf(p) { 20 * 1024 * 1024 } else { SNAP_FILE_MAX };
        if binary_ext(p) || size > limit {
            snap.skipped.insert(key);
            continue;
        }
        match std::fs::read(p) {
            Ok(b) if is_pdf(p) || !b.iter().take(8192).any(|&c| c == 0) => {
                bytes += b.len();
                snap.files.insert(key, b);
            }
            _ => {
                snap.skipped.insert(key);
            }
        }
    }
    snap.ready = true;
    snap
}

// --- State ----------------------------------------------------------------------------------------

pub struct Inner {
    entries: Mutex<Vec<Entry>>,
    next_id: AtomicU64,
    /// Copies from before a hook tool runs (key: tool_use_id or session+path).
    pending: Mutex<HashMap<String, (String, Content, Instant)>>,
    dirs: Mutex<HashMap<String, DirWatch>>,
    pub enabled: AtomicBool,
    pub claude: AtomicBool,
    pub folders: AtomicBool,
    app: OnceLock<AppHandle>,
    dirty: AtomicBool,
    version: AtomicU64,
    git_cache: Mutex<HashMap<String, Option<PathBuf>>>,
    events: OnceLock<Sender<(String, PathBuf)>>,
    /// Goes up every time a pane is watched: so a late "stop watching" doesn't take a new one with it.
    generation: AtomicU64,
    file: PathBuf,
}

pub struct ChangesState(pub Arc<Inner>);

impl ChangesState {
    pub fn new(file: PathBuf) -> Self {
        let mut entries: Vec<Entry> = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        prune(&mut entries);
        let next = entries.iter().map(|e| e.id).max().unwrap_or(0) + 1;
        let inner = Arc::new(Inner {
            entries: Mutex::new(entries),
            next_id: AtomicU64::new(next),
            pending: Mutex::new(HashMap::new()),
            dirs: Mutex::new(HashMap::new()),
            enabled: AtomicBool::new(true),
            claude: AtomicBool::new(true),
            folders: AtomicBool::new(true),
            app: OnceLock::new(),
            dirty: AtomicBool::new(false),
            version: AtomicU64::new(1),
            git_cache: Mutex::new(HashMap::new()),
            events: OnceLock::new(),
            generation: AtomicU64::new(1),
            file,
        });
        ChangesState(inner)
    }

    /// Starts the periodic save and the one that processes folder changes.
    pub fn start(&self, app: AppHandle) {
        let inner = self.0.clone();
        let _ = inner.app.set(app);
        let (tx, rx) = channel::<(String, PathBuf)>();
        let _ = inner.events.set(tx);
        let w = inner.clone();
        let _ = std::thread::Builder::new().name("cambios-carpetas".into()).spawn(move || {
            // Wait for a file to stop changing for half a second before reading it.
            let mut waiting: HashMap<PathBuf, (String, Instant)> = HashMap::new();
            loop {
                match rx.recv_timeout(Duration::from_millis(150)) {
                    Ok((dir, p)) => {
                        waiting.insert(p, (dir, Instant::now()));
                        while let Ok((dir, p)) = rx.try_recv() {
                            waiting.insert(p, (dir, Instant::now()));
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    Err(_) => return,
                }
                let ready: Vec<(PathBuf, String)> = waiting.iter().filter(|(_, (_, t))| t.elapsed() > Duration::from_millis(500)).map(|(p, (d, _))| (p.clone(), d.clone())).collect();
                let mut changed = false;
                for (p, d) in ready {
                    waiting.remove(&p);
                    changed |= on_fs_change(&w, &d, &p);
                }
                if changed {
                    w.changed();
                }
            }
        });
        let s = inner.clone();
        let _ = std::thread::Builder::new().name("cambios-guardar".into()).spawn(move || loop {
            std::thread::sleep(Duration::from_secs(2));
            if s.dirty.swap(false, SeqCst) {
                s.save();
            }
        });
    }
}

fn prune(entries: &mut Vec<Entry>) {
    let cutoff = now_ms().saturating_sub(KEEP_DAYS * 86_400_000);
    entries.retain(|e| e.last_at >= cutoff);
    entries.sort_by_key(|e| std::cmp::Reverse(e.last_at));
    entries.truncate(KEEP_ENTRIES);
    let mut total = 0usize;
    entries.retain(|e| {
        total += e.after.bytes() + e.before.as_ref().map(Content::bytes).unwrap_or(0);
        total <= KEEP_TEXT_BYTES
    });
}

impl Inner {
    fn changed(&self) {
        self.dirty.store(true, SeqCst);
        let v = self.version.fetch_add(1, SeqCst) + 1;
        if let Some(a) = self.app.get() {
            let _ = a.emit("changes-updated", v);
        }
    }

    fn save(&self) {
        let mut list = self.entries.lock().unwrap().clone();
        prune(&mut list);
        if let Ok(t) = serde_json::to_string(&list) {
            let tmp = self.file.with_extension("json.tmp");
            if std::fs::write(&tmp, t).is_ok() {
                let _ = std::fs::rename(&tmp, &self.file);
            }
        }
    }

    /// Root of the git repo that contains the folder (or None), cached.
    fn git_root(&self, dir: &Path) -> Option<PathBuf> {
        let k = norm(dir);
        if let Some(v) = self.git_cache.lock().unwrap().get(&k) {
            return v.clone();
        }
        let r = crate::git::run(dir, &["rev-parse", "--show-toplevel"], Duration::from_secs(5))
            .ok()
            .filter(|o| o.ok)
            .map(|o| PathBuf::from(o.stdout.trim()));
        self.git_cache.lock().unwrap().insert(k, r.clone());
        r
    }

    /// Version from the last commit (for files that weren't in the folder copy).
    fn git_head(&self, path: &Path) -> Option<Content> {
        if is_pdf(path) {
            return None;
        }
        let dir = path.parent()?;
        self.git_root(dir)?;
        let name = path.file_name()?.to_string_lossy().into_owned();
        let o = crate::git::run(dir, &["show", &format!("HEAD:./{name}")], Duration::from_secs(10)).ok()?;
        o.ok.then(|| Content::Text { text: o.stdout })
    }

    fn in_git(&self, path: &Path) -> bool {
        path.parent().is_some_and(|d| self.git_root(d).is_some())
    }

    /// What a file was like before the agent, according to the watched folder copies or git.
    fn baseline(&self, path: &Path) -> (Option<Content>, &'static str) {
        let key = norm(path);
        let snaps: Vec<Arc<Mutex<Snap>>> = self.dirs.lock().unwrap().values().filter(|d| key.starts_with(&norm(&d.root))).map(|d| d.snap.clone()).collect();
        for s in snaps {
            let s = s.lock().unwrap();
            if !s.ready {
                continue;
            }
            if let Some(b) = s.files.get(&key) {
                return (Some(decode(path, b)), "carpeta");
            }
            if s.complete && !s.skipped.contains(&key) {
                return (Some(Content::Missing), "carpeta");
            }
        }
        match self.git_head(path) {
            Some(c) => (Some(c), "git"),
            None => (None, "ninguna"),
        }
    }

    /// Records a change. Returns whether anything changed.
    fn record(&self, path: &Path, after: Content, agent: &str, tool: Option<&str>, hook_before: Option<Content>) -> bool {
        if after == Content::Unreadable {
            return false;
        }
        let key = norm(path);
        {
            let mut entries = self.entries.lock().unwrap();
            if let Some(e) = entries.iter_mut().find(|e| norm(Path::new(&e.path)) == key) {
                let mut changed = false;
                if e.before.is_none() {
                    if let Some(b) = hook_before {
                        e.before = Some(b);
                        e.base_from = "hook".into();
                        changed = true;
                    }
                }
                if e.after != after {
                    e.after = after;
                    e.events += 1;
                    e.manual = false;
                    changed = true;
                }
                if changed || !e.agents.iter().any(|a| a == agent) || tool.is_some_and(|t| !e.tools.iter().any(|x| x == t)) {
                    e.touch(agent, tool);
                    e.last_at = now_ms();
                    e.recount();
                    e.version += 1;
                    return true;
                }
                return false;
            }
        }
        let (before, from) = match hook_before {
            Some(b) => (Some(b), "hook"),
            None => self.baseline(path),
        };
        // Same as before, or something unknown was deleted (a folder, a temp file).
        if before.as_ref() == Some(&after) || (before.is_none() && after == Content::Missing) {
            return false;
        }
        let now = now_ms();
        let mut e = Entry {
            id: self.next_id.fetch_add(1, SeqCst),
            path: path.display().to_string(),
            first_at: now,
            last_at: now,
            agents: vec![],
            tools: vec![],
            events: 1,
            base_from: from.into(),
            before,
            after,
            in_git: self.in_git(path),
            adds: 0,
            dels: 0,
            version: 1,
            manual: false,
        };
        e.touch(agent, tool);
        e.recount();
        let mut entries = self.entries.lock().unwrap();
        entries.insert(0, e);
        true
    }
}

fn on_fs_change(inner: &Arc<Inner>, dir_key: &str, path: &Path) -> bool {
    if !inner.enabled.load(SeqCst) || !inner.folders.load(SeqCst) || path.is_dir() {
        return false;
    }
    let (agent, root, snap) = {
        let dirs = inner.dirs.lock().unwrap();
        let Some(d) = dirs.get(dir_key) else { return false };
        (d.agent_label(), d.root.clone(), d.snap.clone())
    };
    if agent.is_empty() || ignored(&root, path, &snap.lock().unwrap()) {
        return false;
    }
    let after = read_content(path);
    inner.record(path, after, &agent, None, None)
}

// --- Claude Code hook ---------------------------------------------------------------------------------

const HOOK_TOOLS: &[&str] = &["Write", "Edit", "MultiEdit", "NotebookEdit"];

fn hook_target(v: &Value) -> Option<(String, PathBuf, String)> {
    let tool = v.get("tool_name")?.as_str()?;
    if !HOOK_TOOLS.contains(&tool) {
        return None;
    }
    let input = v.get("tool_input")?;
    let raw = input.get("file_path").or_else(|| input.get("notebook_path")).and_then(Value::as_str)?;
    let mut p = PathBuf::from(raw);
    if p.is_relative() {
        p = PathBuf::from(v.get("cwd").and_then(Value::as_str).unwrap_or(".")).join(p);
    }
    let key = v
        .get("tool_use_id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("{}|{}", v.get("session_id").and_then(Value::as_str).unwrap_or(""), norm(&p)));
    Some((tool.to_string(), p, key))
}

/// PreToolUse: copy of the file as it is now.
pub fn hook_pre(inner: &Inner, v: &Value) {
    if !inner.enabled.load(SeqCst) || !inner.claude.load(SeqCst) {
        return;
    }
    let Some((_, path, key)) = hook_target(v) else { return };
    let before = read_content(&path);
    let mut p = inner.pending.lock().unwrap();
    p.retain(|_, (_, _, t)| t.elapsed() < Duration::from_secs(30 * 60));
    p.insert(key, (norm(&path), before, Instant::now()));
}

/// PostToolUse: the change is recorded with the earlier copy.
pub fn hook_post(inner: &Inner, v: &Value) {
    if !inner.enabled.load(SeqCst) || !inner.claude.load(SeqCst) {
        return;
    }
    let Some((tool, path, key)) = hook_target(v) else { return };
    let before = inner.pending.lock().unwrap().remove(&key).map(|(_, c, _)| c);
    let after = read_content(&path);
    if inner.record(&path, after, "Claude Code", Some(&tool), before) {
        inner.changed();
    }
}

// --- Commands --------------------------------------------------------------------------------------

#[tauri::command]
pub fn changes_list(state: tauri::State<ChangesState>) -> Vec<Summary> {
    let mut v: Vec<Summary> = state.0.entries.lock().unwrap().iter().map(Summary::from).collect();
    v.sort_by_key(|s| std::cmp::Reverse(s.last_at));
    v
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffOut {
    /// Unified diff (empty if there's no text to compare).
    text: String,
    note: Option<String>,
}

#[tauri::command]
pub fn changes_diff(state: tauri::State<ChangesState>, id: u64) -> Result<DiffOut, String> {
    let e = state.0.entries.lock().unwrap().iter().find(|e| e.id == id).cloned().ok_or(tr("Ese cambio ya no está en la lista.", "That change is no longer in the list.", "Essa alteração não está mais na lista."))?;
    let name = Path::new(&e.path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let size = |c: &Content| match c {
        Content::Binary { size } | Content::TooBig { size } => Some(*size),
        Content::Text { text } => Some(text.len() as u64),
        _ => None,
    };
    let kb = |n: Option<u64>| n.map(|n| format!("{:.1} KB", n as f64 / 1024.0)).unwrap_or_else(|| "—".into());
    match (&e.before, &e.after) {
        (_, Content::Binary { .. }) | (Some(Content::Binary { .. }), _) => {
            let (a, b) = (kb(e.before.as_ref().and_then(size)), kb(size(&e.after)));
            Ok(DiffOut { text: String::new(), note: Some(tr!("Archivo binario: {a} → {b}.", "Binary file: {a} → {b}.", "Arquivo binário: {a} → {b}.")) })
        }
        (_, Content::TooBig { size }) => {
            let s = kb(Some(*size));
            Ok(DiffOut { text: String::new(), note: Some(tr!("Demasiado grande para mostrar el cambio ({s}).", "Too large to show the change ({s}).", "Grande demais para mostrar a alteração ({s}).")) })
        }
        (_, Content::Unreadable) => Ok(DiffOut {
            text: String::new(),
            note: Some(
                tr(
                    "No se pudo leer el archivo (otro programa lo tenía abierto).",
                    "Couldn't read the file (another program had it open).",
                    "Não foi possível ler o arquivo (outro programa estava com ele aberto).",
                )
                .into(),
            ),
        }),
        (before, after) => {
            let a = before.as_ref().and_then(|c| c.text()).unwrap_or("");
            let b = after.text().unwrap_or("");
            let note = match (e.base_from.as_str(), before) {
                ("ninguna", _) | (_, None) => Some(tr(
                    "No había copia de cómo era antes: se muestra el contenido actual entero.",
                    "There was no copy of how it was before: showing the whole current content.",
                    "Não havia cópia de como era antes: mostrando todo o conteúdo atual.",
                )),
                ("git", _) => Some(tr(
                    "Comparado con el último commit (el archivo no entró en la copia de la carpeta).",
                    "Compared with the last commit (the file wasn't in the folder's copy).",
                    "Comparado com o último commit (o arquivo não entrou na cópia da pasta).",
                )),
                _ if e.after == Content::Missing => Some(tr("El archivo se borró.", "The file was deleted.", "O arquivo foi apagado.")),
                _ => None,
            };
            Ok(DiffOut { text: unified(a, b, &name), note: note.map(str::to_string) })
        }
    }
}

#[tauri::command]
pub fn changes_remove(state: tauri::State<ChangesState>, ids: Option<Vec<u64>>) {
    {
        let mut entries = state.0.entries.lock().unwrap();
        match ids {
            Some(ids) => entries.retain(|e| !ids.contains(&e.id)),
            None => entries.clear(),
        }
    }
    state.0.changed();
}

#[tauri::command]
pub fn changes_config(state: tauri::State<ChangesState>, enabled: bool, claude: bool, folders: bool) {
    state.0.enabled.store(enabled, SeqCst);
    state.0.claude.store(claude, SeqCst);
    state.0.folders.store(folders, SeqCst);
    if !enabled || !folders {
        state.0.dirs.lock().unwrap().clear();
    }
}

/// Starts watching the folder of a pane where an agent started.
#[tauri::command]
pub fn changes_watch(webview: tauri::Webview, state: tauri::State<ChangesState>, pane: String, dir: String, agent: String) -> bool {
    watch(&state.0, webview.label(), &pane, Path::new(&dir), &agent)
}

pub fn watch(inner: &Arc<Inner>, owner: &str, pane: &str, root: &Path, agent: &str) -> bool {
    use notify::{RecursiveMode, Watcher};
    if !inner.enabled.load(SeqCst) || !inner.folders.load(SeqCst) || !root.is_dir() || too_broad(root) {
        return false;
    }
    let key = norm(root);
    {
        let mut dirs = inner.dirs.lock().unwrap();
        for (k, d) in dirs.iter_mut() {
            if *k != key {
                d.panes.remove(pane);
            }
        }
        dirs.retain(|_, d| !d.panes.is_empty());
        let generation = inner.generation.fetch_add(1, SeqCst);
        if let Some(d) = dirs.get_mut(&key) {
            d.panes.insert(pane.into(), (owner.into(), agent.into(), generation));
            return true;
        }
        let snap = Arc::new(Mutex::new(Snap::default()));
        let mut panes = HashMap::new();
        panes.insert(pane.to_string(), (owner.to_string(), agent.to_string(), generation));
        dirs.insert(key.clone(), DirWatch { root: root.to_path_buf(), panes, snap, watcher: None });
    }
    // The copy and the watcher, in the background (a large folder takes a few seconds).
    let inner = inner.clone();
    let root = root.to_path_buf();
    let _ = std::thread::Builder::new().name("cambios-copia".into()).spawn(move || {
        let s = take_snapshot(&root);
        let Some(target) = inner.dirs.lock().unwrap().get(&key).map(|d| d.snap.clone()) else { return };
        *target.lock().unwrap() = s;
        let Some(tx) = inner.events.get().cloned() else { return };
        let k = key.clone();
        let w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if let Ok(ev) = res {
                if matches!(ev.kind, notify::EventKind::Access(_)) {
                    return;
                }
                for p in ev.paths {
                    let _ = tx.send((k.clone(), p));
                }
            }
        });
        if let Ok(mut w) = w {
            if w.watch(&root, RecursiveMode::Recursive).is_ok() {
                if let Some(d) = inner.dirs.lock().unwrap().get_mut(&key) {
                    d.watcher = Some(w);
                }
            }
        }
    });
    true
}

/// The agent finished (or the pane was closed): watching stops if nobody else uses that folder. It
/// waits a few seconds so as not to miss the last writes.
#[tauri::command]
pub fn changes_unwatch(state: tauri::State<ChangesState>, pane: String) {
    unwatch(&state.0, |p, _| p == pane);
}

pub fn unwatch_owner(state: &ChangesState, owner: &str) {
    unwatch(&state.0, |_, o| o == owner);
}

fn unwatch(inner: &Arc<Inner>, gone: impl Fn(&str, &str) -> bool) {
    // The panes that go away, with their current generation.
    let leaving: Vec<(String, u64)> = inner
        .dirs
        .lock()
        .unwrap()
        .values()
        .flat_map(|d| d.panes.iter().filter(|(p, (o, _, _))| gone(p, o)).map(|(p, (_, _, g))| (p.clone(), *g)).collect::<Vec<_>>())
        .collect();
    if leaving.is_empty() {
        return;
    }
    let inner = inner.clone();
    let _ = std::thread::Builder::new().name("cambios-soltar".into()).spawn(move || {
        std::thread::sleep(Duration::from_secs(3));
        let mut dirs = inner.dirs.lock().unwrap();
        for d in dirs.values_mut() {
            d.panes.retain(|p, (_, _, g)| !leaving.iter().any(|(lp, lg)| lp == p && lg == g));
        }
        dirs.retain(|_, d| !d.panes.is_empty());
    });
}

// --- Manual editing ---------------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Editable {
    text: String,
    /// Fingerprint of the file when opened: on save it's checked that nobody changed it in between.
    token: String,
    enc: Enc,
    crlf: bool,
}

fn fingerprint(b: &[u8]) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    b.hash(&mut h);
    format!("{:016x}-{}", h.finish(), b.len())
}

fn editable_path(state: &ChangesState, id: u64) -> Result<PathBuf, String> {
    let e = state.0.entries.lock().unwrap().iter().find(|e| e.id == id).map(|e| e.path.clone()).ok_or(tr("Ese archivo ya no está en la lista.", "That file is no longer in the list.", "Esse arquivo não está mais na lista."))?;
    let p = PathBuf::from(e);
    if is_pdf(&p) {
        return Err(tr("Los PDF no se pueden editar desde acá.", "PDFs can't be edited here.", "PDFs não podem ser editados aqui.").into());
    }
    Ok(p)
}

#[tauri::command]
pub fn changes_read(state: tauri::State<ChangesState>, id: u64) -> Result<Editable, String> {
    let p = editable_path(&state, id)?;
    let b = std::fs::read(&p).map_err(|e| tr!("No se pudo abrir {}: {e}", "Couldn't open {}: {e}", "Não foi possível abrir {}: {e}"; p.display()))?;
    if b.len() as u64 > MAX_TEXT {
        return Err(tr("El archivo es demasiado grande para editarlo acá.", "The file is too large to edit here.", "O arquivo é grande demais para editar aqui.").into());
    }
    let (text, enc) = decode_text(&b).ok_or(tr("El archivo no es de texto.", "The file isn't text.", "O arquivo não é de texto."))?;
    let crlf = text.contains("\r\n");
    Ok(Editable { text: text.replace("\r\n", "\n"), token: fingerprint(&b), enc, crlf })
}

/// Saves what was edited in the panel, with the file's encoding and line ending.
#[tauri::command]
pub fn changes_save(state: tauri::State<ChangesState>, id: u64, text: String, token: String, enc: Enc, crlf: bool) -> Result<(), String> {
    let p = editable_path(&state, id)?;
    let now = std::fs::read(&p).map_err(|e| tr!("No se pudo leer {}: {e}", "Couldn't read {}: {e}", "Não foi possível ler {}: {e}"; p.display()))?;
    if fingerprint(&now) != token {
        return Err(tr(
            "El archivo cambió desde que lo abriste (¿el agente lo volvió a tocar?). Volvé a abrirlo para no pisar esos cambios.",
            "The file changed since you opened it (did the agent touch it again?). Open it again so you don't overwrite those changes.",
            "O arquivo mudou desde que você o abriu (o agente mexeu nele de novo?). Abra-o de novo para não sobrescrever essas alterações.",
        )
        .into());
    }
    let text = text.replace("\r\n", "\n");
    let text = if crlf { text.replace('\n', "\r\n") } else { text };
    let bytes = encode_text(&text, enc)?;
    std::fs::write(&p, &bytes).map_err(|e| tr!("No se pudo guardar: {e}", "Couldn't save: {e}", "Não foi possível salvar: {e}"))?;
    let after = decode(&p, &bytes);
    {
        let mut entries = state.0.entries.lock().unwrap();
        if let Some(e) = entries.iter_mut().find(|e| e.id == id) {
            e.after = after;
            e.touch(tr("Vos (a mano)", "You (by hand)", "Você (à mão)"), None);
            e.manual = true;
            e.events += 1;
            e.last_at = now_ms();
            e.recount();
            e.version += 1;
        }
    }
    state.0.changed();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("alphaterm-changes-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn state(dir: &Path) -> ChangesState {
        ChangesState::new(dir.join("changes.json"))
    }

    #[test]
    fn codificaciones_de_ida_y_vuelta() {
        for enc in [Enc::Utf8, Enc::Utf8Bom, Enc::Utf16Le, Enc::Utf16Be, Enc::Latin1] {
            let b = encode_text("año 2026\nçà", enc).unwrap();
            assert_eq!(decode_text(&b), Some(("año 2026\nçà".to_string(), enc)), "{enc:?}");
        }
        assert!(decode_text(b"\x00\x01\x02binario").is_none());
        assert!(encode_text("€", Enc::Latin1).is_err());
    }

    /// Minimal valid PDF with one line of text per item.
    fn mini_pdf(lines: &[&str]) -> Vec<u8> {
        let content = format!("BT /F1 14 Tf 72 720 Td 18 TL {} ET", lines.iter().map(|l| format!("({l}) Tj T*")).collect::<Vec<_>>().join(" "));
        let objs = [
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".to_string(),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
            format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()),
        ];
        let mut pdf = b"%PDF-1.4\n".to_vec();
        let mut offs = vec![];
        for (i, o) in objs.iter().enumerate() {
            offs.push(pdf.len());
            pdf.extend(format!("{} 0 obj\n{o}\nendobj\n", i + 1).bytes());
        }
        let xref = pdf.len();
        pdf.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1).bytes());
        for o in offs {
            pdf.extend(format!("{o:010} 00000 n \n").bytes());
        }
        pdf.extend(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objs.len() + 1).bytes());
        pdf
    }

    #[test]
    fn los_pdf_se_comparan_por_su_texto() {
        let d = tmp("pdf");
        let f = d.join("informe.pdf");
        std::fs::write(&f, mini_pdf(&["Informe mensual", "Total: 100"])).unwrap();
        let before = read_content(&f);
        assert!(before.text().is_some_and(|t| t.contains("Informe mensual") && t.contains("Total: 100")), "{before:?}");
        std::fs::write(&f, mini_pdf(&["Informe mensual", "Total: 250"])).unwrap();
        let after = read_content(&f);
        let (add, del) = counts(before.text().unwrap(), after.text().unwrap());
        assert_eq!((add, del), (1, 1));
        assert!(!decode(Path::new("x.pdf"), b"%PDF-roto").text().is_some(), "un PDF roto queda como binario");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn cuenta_y_arma_el_diff() {
        assert_eq!(counts("a\nb\nc\n", "a\nB\nc\nd\n"), (2, 1));
        let d = unified("a\nb\n", "a\nc\n", "x.txt");
        assert!(d.contains("--- a/x.txt") && d.contains("-b") && d.contains("+c"), "{d}");
    }

    #[test]
    fn filtra_temporales_y_carpetas_pesadas() {
        let root = Path::new("C:\\p");
        let snap = Snap::default();
        assert!(ignored(root, Path::new("C:\\p\\node_modules\\x\\a.js"), &snap));
        assert!(ignored(root, Path::new("C:\\p\\.git\\index"), &snap));
        assert!(ignored(root, Path::new("C:\\p\\a.txt.tmp.123.456"), &snap));
        assert!(ignored(root, Path::new("C:\\p\\~$doc.docx"), &snap));
        assert!(!ignored(root, Path::new("C:\\p\\.env"), &snap), "un archivo oculto suelto sí cuenta");
        assert!(!ignored(root, Path::new("C:\\p\\src\\main.rs"), &snap));
        assert!(ignored(Path::new("C:\\otra"), Path::new("C:\\p\\a.txt"), &snap));
        assert!(too_broad(Path::new("C:\\")));
        assert!(!too_broad(Path::new("C:\\Users\\x\\Desktop\\proyecto")));
        let home = PathBuf::from(std::env::var_os("USERPROFILE").unwrap());
        assert!(too_broad(&home));
        assert!(too_broad(&home.join("AppData").join("Local")));
        assert!(too_broad(&std::env::temp_dir()));
        assert!(!too_broad(&std::env::temp_dir().join("un-proyecto")), "una subcarpeta de Temp sí");
    }

    #[test]
    fn hook_antes_y_despues() {
        let d = tmp("hook");
        let f = d.join("nota.txt");
        std::fs::write(&f, "uno\ndos\n").unwrap();
        let st = state(&d);
        let v = serde_json::json!({"tool_name": "Edit", "tool_use_id": "t1", "session_id": "s", "tool_input": {"file_path": f.display().to_string()}});
        hook_pre(&st.0, &v);
        std::fs::write(&f, "uno\nDOS\ntres\n").unwrap();
        hook_post(&st.0, &v);
        let e = st.0.entries.lock().unwrap()[0].clone();
        assert_eq!(e.base_from, "hook");
        assert_eq!((e.adds, e.dels), (2, 1));
        assert_eq!(e.agents, vec!["Claude Code"]);
        assert_eq!(e.tools, vec!["Edit"]);
        // Another edit: the diff is still against the first version.
        let v2 = serde_json::json!({"tool_name": "Write", "tool_use_id": "t2", "tool_input": {"file_path": f.display().to_string()}});
        hook_pre(&st.0, &v2);
        std::fs::write(&f, "uno\ndos\n").unwrap();
        hook_post(&st.0, &v2);
        let e = st.0.entries.lock().unwrap()[0].clone();
        assert_eq!(st.0.entries.lock().unwrap().len(), 1);
        assert_eq!((e.adds, e.dels), (0, 0), "volvió a quedar como antes");
        assert_eq!(e.tools, vec!["Edit", "Write"]);
        // New file.
        let n = d.join("nuevo.md");
        let v3 = serde_json::json!({"tool_name": "Write", "tool_use_id": "t3", "tool_input": {"file_path": n.display().to_string()}});
        hook_pre(&st.0, &v3);
        std::fs::write(&n, "# hola\n").unwrap();
        hook_post(&st.0, &v3);
        let s = Summary::from(&st.0.entries.lock().unwrap()[0]);
        assert!(s.created && !s.deleted && s.editable);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn copia_de_carpeta_y_cambios() {
        let d = tmp("carpeta");
        std::fs::create_dir_all(d.join("node_modules")).unwrap();
        std::fs::write(d.join("node_modules").join("x.js"), "x").unwrap();
        std::fs::write(d.join("a.txt"), "hola\n").unwrap();
        std::fs::write(d.join(".gitignore"), "salida/\n").unwrap();
        let snap = take_snapshot(&d);
        assert!(snap.complete);
        assert!(snap.files.contains_key(&norm(&d.join("a.txt"))));
        assert!(!snap.files.contains_key(&norm(&d.join("node_modules").join("x.js"))));
        assert!(ignored(&d, &d.join("salida").join("log.txt"), &snap), "lo que ignora git no cuenta");

        let st = state(&d);
        st.0.dirs.lock().unwrap().insert(
            norm(&d),
            DirWatch { root: d.clone(), panes: HashMap::from([("p1".to_string(), ("main".to_string(), "Codex".to_string(), 1))]), snap: Arc::new(Mutex::new(snap)), watcher: None },
        );
        std::fs::write(d.join("a.txt"), "hola\nchau\n").unwrap();
        assert!(on_fs_change(&st.0, &norm(&d), &d.join("a.txt")));
        std::fs::write(d.join("b.txt"), "nuevo\n").unwrap();
        assert!(on_fs_change(&st.0, &norm(&d), &d.join("b.txt")));
        assert!(!on_fs_change(&st.0, &norm(&d), &d.join("b.txt")), "sin cambios nuevos no se anota otra vez");
        let list: Vec<Summary> = st.0.entries.lock().unwrap().iter().map(Summary::from).collect();
        let a = list.iter().find(|s| s.path.ends_with("a.txt")).unwrap();
        assert_eq!((a.adds, a.dels, a.base_from.as_str()), (1, 0, "carpeta"));
        assert_eq!(a.agents, vec!["Codex"]);
        assert!(list.iter().find(|s| s.path.ends_with("b.txt")).unwrap().created);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn editar_y_guardar_respeta_crlf_y_no_pisa() {
        let d = tmp("editar");
        let f = d.join("w.bat");
        std::fs::write(&f, "@echo off\r\necho hola\r\n").unwrap();
        let st = state(&d);
        assert!(st.0.record(&f, read_content(&f), "Codex", None, Some(Content::Text { text: "@echo off\r\n".into() })));
        let id = st.0.entries.lock().unwrap()[0].id;
        let b = std::fs::read(&f).unwrap();
        let (text, enc) = decode_text(&b).unwrap();
        assert_eq!(enc, Enc::Utf8);
        let token = fingerprint(&b);
        let edited = text.replace("\r\n", "\n").replace("hola", "chau");
        // "Manual" save (same as the command does, without Tauri's State).
        let bytes = encode_text(&edited.replace('\n', "\r\n"), enc).unwrap();
        assert_eq!(fingerprint(&std::fs::read(&f).unwrap()), token);
        std::fs::write(&f, &bytes).unwrap();
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "@echo off\r\necho chau\r\n");
        assert_ne!(fingerprint(&std::fs::read(&f).unwrap()), token, "otra huella: un segundo guardado con la vieja se rechaza");
        assert!(id > 0);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn se_guarda_y_se_recupera() {
        let d = tmp("persistir");
        let f = d.join("x.txt");
        std::fs::write(&f, "a\n").unwrap();
        {
            let st = state(&d);
            st.0.record(&f, read_content(&f), "agy", None, Some(Content::Missing));
            st.0.save();
        }
        let st = state(&d);
        let e = st.0.entries.lock().unwrap()[0].clone();
        assert_eq!(e.agents, vec!["agy"]);
        assert!(st.0.next_id.load(SeqCst) > e.id);
        let _ = std::fs::remove_dir_all(&d);
    }
}
