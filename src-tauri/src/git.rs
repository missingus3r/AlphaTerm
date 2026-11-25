//! Git via the CLI (respects the Credential Manager, the proxy and the user's configuration).
//! Everything runs without a visible console, without terminal prompts (GIT_TERMINAL_PROMPT=0) and
//! with unescaped paths (core.quotepath=false, so that ñ displays correctly).

use crate::i18n::tr;
use serde::Serialize;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

#[derive(Debug)]
pub struct Out {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

fn git_cmd(dir: &Path, args: &[&str]) -> Command {
    let mut c = Command::new("git");
    c.current_dir(dir)
        .args(["-c", "core.quotepath=false", "-c", "color.ui=false"])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    c
}

/// Runs git with a time limit (network commands can hang).
pub fn run(dir: &Path, args: &[&str], limit: Duration) -> Result<Out, String> {
    let mut child = git_cmd(dir, args).spawn().map_err(|e| tr!("No se pudo ejecutar git: {e}", "Couldn't run git: {e}", "Não foi possível executar o git: {e}"))?;
    let mut so = child.stdout.take().unwrap();
    let mut se = child.stderr.take().unwrap();
    let ro = std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = std::io::Read::read_to_end(&mut so, &mut b);
        b
    });
    let re = std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = std::io::Read::read_to_end(&mut se, &mut b);
        b
    });
    let start = std::time::Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
            break s;
        }
        if start.elapsed() > limit {
            let _ = child.kill();
            let (cmd, secs) = (args.first().unwrap_or(&""), limit.as_secs());
            return Err(tr!("git {cmd} tardó más de {secs} s", "git {cmd} took longer than {secs} s", "git {cmd} demorou mais de {secs} s"));
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    Ok(Out {
        ok: status.success(),
        stdout: String::from_utf8_lossy(&ro.join().unwrap_or_default()).into_owned(),
        stderr: String::from_utf8_lossy(&re.join().unwrap_or_default()).trim().to_string(),
    })
}

const FAST: Duration = Duration::from_secs(20);
const NET: Duration = Duration::from_secs(180);

fn ok(dir: &Path, args: &[&str], limit: Duration) -> Result<String, String> {
    let o = run(dir, args, limit)?;
    if o.ok {
        Ok(o.stdout)
    } else {
        Err(if o.stderr.is_empty() { tr!("git {} falló", "git {} failed", "git {} falhou"; args.join(" ")) } else { o.stderr })
    }
}

// --- Status ---

#[derive(Serialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    /// Previous path (renames and copies).
    pub orig: Option<String>,
    /// Index (staged) status: ".", "M", "A", "D", "R", "C", "U".
    pub index: String,
    /// Working tree status: ".", "M", "D", "?" (untracked), "U".
    pub work: String,
    pub conflict: bool,
}

#[derive(Serialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub branch: Option<String>,
    pub oid: Option<String>,
    pub upstream: Option<String>,
    pub ahead: i64,
    pub behind: i64,
    pub files: Vec<FileChange>,
}

/// Parses `git status --porcelain=v2 --branch -z`.
pub fn parse_status(raw: &str) -> Status {
    let mut st = Status::default();
    let mut recs = raw.split('\0').filter(|r| !r.is_empty());
    while let Some(r) = recs.next() {
        if let Some(h) = r.strip_prefix("# ") {
            let (k, v) = h.split_once(' ').unwrap_or((h, ""));
            match k {
                "branch.oid" => st.oid = (v != "(initial)").then(|| v.to_string()),
                "branch.head" => st.branch = (v != "(detached)").then(|| v.to_string()),
                "branch.upstream" => st.upstream = Some(v.to_string()),
                "branch.ab" => {
                    for t in v.split_whitespace() {
                        if let Some(a) = t.strip_prefix('+') {
                            st.ahead = a.parse().unwrap_or(0);
                        } else if let Some(b) = t.strip_prefix('-') {
                            st.behind = b.parse().unwrap_or(0);
                        }
                    }
                }
                _ => {}
            }
            continue;
        }
        let kind = &r[..1];
        match kind {
            "1" => {
                // 1 XY sub mH mI mW hH hI path
                let f: Vec<&str> = r.splitn(9, ' ').collect();
                if f.len() == 9 {
                    let xy = f[1];
                    st.files.push(FileChange { path: f[8].into(), orig: None, index: xy[..1].into(), work: xy[1..2].into(), conflict: false });
                }
            }
            "2" => {
                // 2 XY sub mH mI mW hH hI Xscore path  (and in the next record, the original path)
                let f: Vec<&str> = r.splitn(10, ' ').collect();
                if f.len() == 10 {
                    let xy = f[1];
                    let orig = recs.next().map(str::to_string);
                    st.files.push(FileChange { path: f[9].into(), orig, index: xy[..1].into(), work: xy[1..2].into(), conflict: false });
                }
            }
            "u" => {
                // u XY sub m1 m2 m3 mW h1 h2 h3 path
                let f: Vec<&str> = r.splitn(11, ' ').collect();
                if f.len() == 11 {
                    st.files.push(FileChange { path: f[10].into(), orig: None, index: "U".into(), work: "U".into(), conflict: true });
                }
            }
            "?" => st.files.push(FileChange { path: r[2..].into(), orig: None, index: ".".into(), work: "?".into(), conflict: false }),
            _ => {}
        }
    }
    st
}

/// Root of the repo that contains `dir` (or an error if it isn't a repo).
#[tauri::command]
pub async fn git_root(dir: String) -> Result<Option<String>, String> {
    blocking(move || {
        let o = run(Path::new(&dir), &["rev-parse", "--show-toplevel"], FAST)?;
        // git answers with "/"; on Windows the rest of the app uses "\\".
        Ok(o.ok.then(|| if cfg!(windows) { o.stdout.trim().replace('/', "\\") } else { o.stdout.trim().to_string() }))
    })
    .await
}

#[tauri::command]
pub async fn git_status(root: String) -> Result<Status, String> {
    blocking(move || ok(Path::new(&root), &["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"], FAST).map(|s| parse_status(&s))).await
}

/// Number of changed files (for the tab counter). Cheap: no branch.
#[tauri::command]
pub async fn git_count(dir: String) -> Result<Option<usize>, String> {
    blocking(move || {
        let o = run(Path::new(&dir), &["status", "--porcelain=v2", "-z", "--untracked-files=normal"], FAST)?;
        Ok(o.ok.then(|| parse_status(&o.stdout).files.len()))
    })
    .await
}

/// Diff of a file. `staged`: what is in the index against HEAD. Untracked: everything added.
#[tauri::command]
pub async fn git_diff(root: String, path: String, staged: bool, untracked: bool) -> Result<String, String> {
    blocking(move || {
        let r = Path::new(&root);
        if untracked {
            // --no-index returns 1 when there are differences: it's not an error.
            let o = run(r, &["diff", "--no-index", "--no-color", "--", "/dev/null", &path], FAST)?;
            return Ok(o.stdout);
        }
        let mut args = vec!["diff", "--no-color", "--no-ext-diff"];
        if staged {
            args.push("--cached");
        }
        args.extend(["--", &path]);
        ok(r, &args, FAST)
    })
    .await
}

#[tauri::command]
pub async fn git_stage(root: String, paths: Vec<String>, stage: bool) -> Result<(), String> {
    blocking(move || {
        let mut args: Vec<&str> = if stage { vec!["add", "--"] } else { vec!["restore", "--staged", "--"] };
        args.extend(paths.iter().map(String::as_str));
        // In a repo without commits, "restore --staged" doesn't exist: "rm --cached" is used.
        match ok(Path::new(&root), &args, FAST) {
            Err(e) if !stage && e.contains("HEAD") => {
                let mut a = vec!["rm", "--cached", "-r", "--quiet", "--"];
                a.extend(paths.iter().map(String::as_str));
                ok(Path::new(&root), &a, FAST).map(|_| ())
            }
            other => other.map(|_| ()),
        }
    })
    .await
}

#[tauri::command]
pub async fn git_commit(root: String, message: String) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err(tr("El mensaje del commit está vacío", "The commit message is empty", "A mensagem do commit está vazia").into());
    }
    blocking(move || {
        let dir = crate::os::temp_dir();
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let tmp = dir.join(format!("commit-{}.txt", std::process::id()));
        std::fs::write(&tmp, &message).map_err(|e| e.to_string())?;
        let r = ok(Path::new(&root), &["commit", "-F", &tmp.display().to_string()], NET);
        let _ = std::fs::remove_file(&tmp);
        r.map(|s| s.lines().next().unwrap_or("").to_string())
    })
    .await
}

// --- History ---

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogRow {
    /// Drawing of this line's graph ("* ", "| * ", "|/ "…).
    pub graph: String,
    pub hash: Option<String>,
    pub short: Option<String>,
    pub author: Option<String>,
    pub when: Option<String>,
    pub subject: Option<String>,
    pub refs: Option<String>,
}

const SEP: char = '\u{1f}';

pub fn parse_log(raw: &str) -> Vec<LogRow> {
    raw.lines()
        .map(|line| match line.split_once(SEP) {
            Some((graph, rest)) => {
                let f: Vec<&str> = rest.split(SEP).collect();
                let get = |i: usize| f.get(i).map(|s| s.to_string()).filter(|s| !s.is_empty());
                LogRow { graph: graph.to_string(), hash: get(0), short: get(1), author: get(2), when: get(3), subject: get(4), refs: get(5) }
            }
            None => LogRow { graph: line.to_string(), hash: None, short: None, author: None, when: None, subject: None, refs: None },
        })
        .collect()
}

#[tauri::command]
pub async fn git_log(root: String, limit: u32) -> Result<Vec<LogRow>, String> {
    blocking(move || {
        let n = limit.clamp(1, 2000).to_string();
        let o = run(Path::new(&root), &["log", "--graph", "--all", "--date-order", "--format=%x1f%H%x1f%h%x1f%an%x1f%ar%x1f%s%x1f%D", "-n", &n], FAST)?;
        // A repo without commits has no history: that's not an error for the panel.
        if !o.ok && (o.stderr.contains("does not have any commits") || o.stderr.contains("no tiene ningún commit")) {
            return Ok(vec![]);
        }
        if !o.ok {
            return Err(o.stderr);
        }
        Ok(parse_log(&o.stdout))
    })
    .await
}

#[tauri::command]
pub async fn git_show(root: String, hash: String) -> Result<String, String> {
    if !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(tr("hash inválido", "invalid hash", "hash inválido").into());
    }
    blocking(move || ok(Path::new(&root), &["show", "--no-color", "--stat", "--patch", "--format=fuller", &hash], FAST)).await
}

// --- Branches ---

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    pub current: bool,
    pub remote: bool,
    pub upstream: Option<String>,
}

pub fn parse_branches(raw: &str) -> Vec<Branch> {
    raw.lines()
        .filter_map(|l| {
            let f: Vec<&str> = l.split(SEP).collect();
            let full = *f.first()?;
            if full.ends_with("/HEAD") {
                return None;
            }
            let remote = full.starts_with("refs/remotes/");
            let name = full.trim_start_matches("refs/heads/").trim_start_matches("refs/remotes/").to_string();
            Some(Branch { name, current: f.get(1) == Some(&"*"), remote, upstream: f.get(2).filter(|s| !s.is_empty()).map(|s| s.to_string()) })
        })
        .collect()
}

#[tauri::command]
pub async fn git_branches(root: String) -> Result<Vec<Branch>, String> {
    blocking(move || {
        ok(Path::new(&root), &["for-each-ref", "--format=%(refname)%1f%(HEAD)%1f%(upstream:short)", "refs/heads", "refs/remotes"], FAST).map(|s| parse_branches(&s))
    })
    .await
}

/// Valid branch name (the bare minimum so options aren't passed to git by accident).
pub fn valid_branch(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('-')
        && !name.contains("..")
        && !name.ends_with('/')
        && !name.ends_with(".lock")
        && name.chars().all(|c| !c.is_whitespace() && !"~^:?*[\\".contains(c) && !c.is_control())
}

#[tauri::command]
pub async fn git_switch(root: String, branch: String, create: bool) -> Result<String, String> {
    if !valid_branch(&branch) {
        return Err(tr!("\"{branch}\" no es un nombre de rama válido", "\"{branch}\" isn't a valid branch name", "\"{branch}\" não é um nome de branch válido"));
    }
    blocking(move || {
        let args: Vec<&str> = if create { vec!["switch", "-c", &branch] } else { vec!["switch", &branch] };
        let o = run(Path::new(&root), &args, FAST)?;
        if o.ok {
            Ok(o.stderr) // git switch reports on stderr
        } else {
            Err(o.stderr)
        }
    })
    .await
}

// --- Remote ---

#[tauri::command]
pub async fn git_remote(root: String, op: String) -> Result<String, String> {
    blocking(move || {
        let r = Path::new(&root);
        let o = match op.as_str() {
            "fetch" => run(r, &["fetch", "--all", "--prune"], NET)?,
            "pull" => run(r, &["pull", "--ff-only"], NET)?,
            "push" => {
                let has_upstream = run(r, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], FAST)?.ok;
                if has_upstream {
                    run(r, &["push"], NET)?
                } else {
                    run(r, &["push", "-u", "origin", "HEAD"], NET)?
                }
            }
            other => return Err(tr!("operación desconocida: {other}", "unknown operation: {other}", "operação desconhecida: {other}")),
        };
        let text = [o.stdout.trim(), o.stderr.trim()].iter().filter(|s| !s.is_empty()).cloned().collect::<Vec<_>>().join("\n");
        if o.ok {
            Ok(if text.is_empty() { tr("Listo, sin cambios.", "Done, no changes.", "Pronto, sem alterações.").into() } else { text })
        } else {
            Err(text)
        }
    })
    .await
}

#[tauri::command]
pub async fn git_clone(url: String, parent: String) -> Result<String, String> {
    if url.starts_with('-') || url.trim().is_empty() {
        return Err(tr("URL inválida", "Invalid URL", "URL inválida").into());
    }
    blocking(move || {
        let o = run(Path::new(&parent), &["clone", "--", url.trim()], Duration::from_secs(900))?;
        if !o.ok {
            return Err(o.stderr);
        }
        // "Cloning into 'carpeta'..." → path of the clone.
        let name = o.stderr.split('\'').nth(1).map(str::to_string).unwrap_or_else(|| {
            url.trim().trim_end_matches('/').trim_end_matches(".git").rsplit(['/', ':']).next().unwrap_or("repo").to_string()
        });
        Ok(Path::new(&parent).join(name).display().to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_init(dir: String) -> Result<String, String> {
    blocking(move || ok(Path::new(&dir), &["init"], FAST)).await
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The repo's root comes in this system's form (on Linux, as git gives it: "/home/…").
    #[test]
    fn raiz_del_repo_en_la_forma_del_sistema() {
        let d = std::env::temp_dir().join(format!("alphaterm-gitroot-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("sub")).unwrap();
        assert!(run(&d, &["init", "-q"], FAST).unwrap().ok);
        let root = tauri::async_runtime::block_on(git_root(d.join("sub").display().to_string())).unwrap().unwrap();
        let expected = std::fs::canonicalize(&d).unwrap();
        assert_eq!(std::fs::canonicalize(&root).unwrap(), expected, "{root}");
        if cfg!(windows) {
            assert!(!root.contains('/'), "{root}");
        } else {
            assert!(root.starts_with('/') && !root.contains('\\'), "{root}");
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn status_porcelain_v2() {
        let raw = "# branch.oid abc123\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0\
1 .M N... 100644 100644 100644 aaa bbb src/a b.ts\0\
1 A. N... 000000 100644 100644 000 ccc nuevo.txt\0\
2 R. N... 100644 100644 100644 ddd eee R100 nuevo nombre.md\0viejo.md\0\
u UU N... 100644 100644 100644 100644 f1 f2 f3 conflicto.rs\0\
? sin seguir ñ.txt\0";
        let s = parse_status(raw);
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));
        assert_eq!((s.ahead, s.behind), (2, 1));
        assert_eq!(s.files.len(), 5);
        assert_eq!(s.files[0], FileChange { path: "src/a b.ts".into(), orig: None, index: ".".into(), work: "M".into(), conflict: false });
        assert_eq!(s.files[2].orig.as_deref(), Some("viejo.md"));
        assert_eq!(s.files[2].path, "nuevo nombre.md");
        assert!(s.files[3].conflict);
        assert_eq!(s.files[4].work, "?");
        assert_eq!(s.files[4].path, "sin seguir ñ.txt");
        let empty = parse_status("# branch.oid (initial)\0# branch.head (detached)\0");
        assert_eq!((empty.oid, empty.branch), (None, None));
    }

    #[test]
    fn log_con_grafo() {
        let raw = "* \u{1f}aaa\u{1f}a1\u{1f}Bruno\u{1f}hace 2 horas\u{1f}F2: algo\u{1f}HEAD -> main\n|\\  \n| * \u{1f}bbb\u{1f}b1\u{1f}Ana\u{1f}ayer\u{1f}fix\u{1f}";
        let l = parse_log(raw);
        assert_eq!(l.len(), 3);
        assert_eq!(l[0].graph, "* ");
        assert_eq!(l[0].refs.as_deref(), Some("HEAD -> main"));
        assert_eq!(l[1].hash, None);
        assert_eq!(l[2].subject.as_deref(), Some("fix"));
        assert_eq!(l[2].refs, None);
    }

    #[test]
    fn ramas() {
        let raw = "refs/heads/main\u{1f}*\u{1f}origin/main\nrefs/heads/feat/x\u{1f} \u{1f}\nrefs/remotes/origin/HEAD\u{1f} \u{1f}\nrefs/remotes/origin/main\u{1f} \u{1f}";
        let b = parse_branches(raw);
        assert_eq!(b.len(), 3);
        assert!(b[0].current && !b[0].remote);
        assert_eq!(b[0].upstream.as_deref(), Some("origin/main"));
        assert_eq!(b[1].name, "feat/x");
        assert!(b[2].remote);
        assert_eq!(b[2].name, "origin/main");
    }

    #[test]
    fn nombres_de_rama() {
        assert!(valid_branch("feat/nueva-cosa"));
        assert!(!valid_branch("-f"));
        assert!(!valid_branch("a..b"));
        assert!(!valid_branch("con espacio"));
        assert!(!valid_branch("x.lock"));
    }

    #[test]
    fn ciclo_real_en_un_repo_temporal() {
        let d = std::env::temp_dir().join(format!("alphaterm-git-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let rt = |f: std::pin::Pin<Box<dyn std::future::Future<Output = Result<String, String>>>>| tauri::async_runtime::block_on(f);
        rt(Box::pin(git_init(d.display().to_string()))).unwrap();
        let root = d.display().to_string();
        ok(&d, &["config", "user.email", "test@example.com"], FAST).unwrap();
        ok(&d, &["config", "user.name", "Test"], FAST).unwrap();
        std::fs::write(d.join("a.txt"), "hola\n").unwrap();
        let st = tauri::async_runtime::block_on(git_status(root.clone())).unwrap();
        assert_eq!(st.files[0].work, "?");
        let diff = tauri::async_runtime::block_on(git_diff(root.clone(), "a.txt".into(), false, true)).unwrap();
        assert!(diff.contains("+hola"));
        tauri::async_runtime::block_on(git_stage(root.clone(), vec!["a.txt".into()], true)).unwrap();
        // Remove from the index in a repo without commits (uses rm --cached) and add again.
        tauri::async_runtime::block_on(git_stage(root.clone(), vec!["a.txt".into()], false)).unwrap();
        tauri::async_runtime::block_on(git_stage(root.clone(), vec!["a.txt".into()], true)).unwrap();
        let first = tauri::async_runtime::block_on(git_commit(root.clone(), "primer commit\n\ncon cuerpo".into())).unwrap();
        assert!(first.contains("primer commit"));
        let log = tauri::async_runtime::block_on(git_log(root.clone(), 10)).unwrap();
        assert_eq!(log.len(), 1);
        tauri::async_runtime::block_on(git_switch(root.clone(), "otra".into(), true)).unwrap();
        let br = tauri::async_runtime::block_on(git_branches(root.clone())).unwrap();
        assert!(br.iter().any(|b| b.name == "otra" && b.current));
        assert_eq!(tauri::async_runtime::block_on(git_count(root.clone())).unwrap(), Some(0));
        let _ = std::fs::remove_dir_all(&d);
    }
}
