//! Data for the title heuristic: each session's foreground process and git branch.

use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

/// Console hosts: they are children of the shell but are not "what is running".
const IGNORED: &[&str] = &["conhost.exe", "openconsole.exe"];

/// Is it a thread and not a process? On Linux sysinfo lists every thread (task) as one more entry, with the
/// process's memory and its own name ("Thread-8 (process_request_thread)"): they don't count as processes.
pub fn is_thread(p: &sysinfo::Process) -> bool {
    p.thread_kind().is_some()
}

#[derive(Default)]
pub struct ProcState {
    sys: Mutex<Option<System>>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Foreground {
    pub name: String,
    pub pid: u32,
}

struct Node {
    parent: Option<u32>,
    name: String,
    start: u64,
}

/// The newest descendant of the shell (ignoring console hosts). On a tie, the deepest.
fn pick_foreground(nodes: &HashMap<u32, Node>, shell: u32) -> Option<Foreground> {
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for (pid, n) in nodes {
        if let Some(p) = n.parent {
            children.entry(p).or_default().push(*pid);
        }
    }
    let mut best: Option<(u64, usize, u32)> = None;
    let mut stack = vec![(shell, 0usize)];
    let mut seen = 0;
    while let Some((pid, depth)) = stack.pop() {
        seen += 1;
        if seen > 10_000 {
            break; // just in case, against cycles of recycled PIDs
        }
        for &c in children.get(&pid).map(Vec::as_slice).unwrap_or(&[]) {
            let n = &nodes[&c];
            if n.start < nodes.get(&pid).map(|p| p.start).unwrap_or(0) {
                continue; // recycled PID: the "child" is older than the parent
            }
            stack.push((c, depth + 1));
            if IGNORED.contains(&n.name.to_lowercase().as_str()) {
                continue;
            }
            let key = (n.start, depth + 1, c);
            if best.is_none_or(|b| (key.0, key.1) > (b.0, b.1)) {
                best = Some(key);
            }
        }
    }
    best.map(|(_, _, pid)| {
        let raw = &nodes[&pid].name;
        let name = raw.strip_suffix(".exe").or_else(|| raw.strip_suffix(".EXE")).unwrap_or(raw).to_string();
        Foreground { name, pid }
    })
}

impl ProcState {
    pub fn foreground(&self, shells: &[u32]) -> HashMap<u32, Option<Foreground>> {
        let mut guard = self.sys.lock().unwrap();
        if guard.is_none() {
            *guard = System::new().ok();
        }
        let Some(sys) = guard.as_mut() else {
            return shells.iter().map(|&s| (s, None)).collect();
        };
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
        let nodes: HashMap<u32, Node> = sys
            .processes()
            .iter()
            .filter(|(_, p)| !is_thread(p))
            .map(|(pid, p)| {
                (
                    pid.as_u32(),
                    Node {
                        parent: p.parent().map(Pid::as_u32),
                        name: p.name().to_string_lossy().into_owned(),
                        start: p.start_time(),
                    },
                )
            })
            .collect();
        shells.iter().map(|&s| (s, pick_foreground(&nodes, s))).collect()
    }
}

/// Looks for the `.git` going up from `cwd`. Supports worktrees (`.git` as a file with `gitdir:`).
pub fn git_dir(cwd: &Path) -> Option<PathBuf> {
    for dir in cwd.ancestors() {
        let g = dir.join(".git");
        if g.is_dir() {
            return Some(g);
        }
        if g.is_file() {
            let text = std::fs::read_to_string(&g).ok()?;
            let target = text.trim().strip_prefix("gitdir:")?.trim();
            let p = PathBuf::from(target);
            return Some(if p.is_absolute() { p } else { dir.join(p) });
        }
    }
    None
}

/// Current branch by reading `HEAD` (without launching git). Detached: the first 7 characters of the hash.
pub fn git_branch(cwd: &Path) -> Option<String> {
    let head = std::fs::read_to_string(git_dir(cwd)?.join("HEAD")).ok()?;
    let head = head.trim();
    match head.strip_prefix("ref: refs/heads/") {
        Some(b) => Some(b.to_string()),
        None if head.len() >= 7 && head.chars().all(|c| c.is_ascii_hexdigit()) => Some(head[..7].to_string()),
        None => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Linux: a program with threads is one process (its threads aren't the "foreground process").
    #[cfg(not(windows))]
    #[test]
    fn los_hilos_no_son_procesos() {
        let mut child = std::process::Command::new("python3")
            .args(["-c", "import threading,time\nfor i in range(3): threading.Thread(target=time.sleep, args=(30,), name=f'hilo-{i}').start()\nprint('ok', flush=True); time.sleep(30)"])
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let mut line = String::new();
        std::io::BufRead::read_line(&mut std::io::BufReader::new(child.stdout.take().unwrap()), &mut line).unwrap();
        let mut sys = System::new().unwrap();
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
        let all = sys.processes().values().filter(|p| p.pid().as_u32() == child.id() || p.parent().map(Pid::as_u32) == Some(child.id())).count();
        let procs = sys.processes().values().filter(|p| !is_thread(p)).filter(|p| p.pid().as_u32() == child.id() || p.parent().map(Pid::as_u32) == Some(child.id())).count();
        let _ = child.kill();
        let _ = child.wait();
        assert!(all > 1, "sysinfo debería listar los hilos ({all})");
        assert_eq!(procs, 1);
    }

    fn node(parent: Option<u32>, name: &str, start: u64) -> Node {
        Node { parent, name: name.into(), start }
    }

    #[test]
    fn elige_el_descendiente_mas_nuevo_e_ignora_conhost() {
        let mut n = HashMap::new();
        n.insert(10, node(None, "powershell.exe", 100));
        n.insert(11, node(Some(10), "conhost.exe", 101));
        n.insert(12, node(Some(10), "node.exe", 105));
        n.insert(13, node(Some(12), "esbuild.exe", 106));
        n.insert(14, node(Some(10), "git.exe", 103));
        assert_eq!(pick_foreground(&n, 10), Some(Foreground { name: "esbuild".into(), pid: 13 }));
        n.remove(&13);
        n.remove(&12);
        assert_eq!(pick_foreground(&n, 10).unwrap().name, "git");
        n.remove(&14);
        assert_eq!(pick_foreground(&n, 10), None);
    }

    #[test]
    fn ignora_pid_reciclado() {
        let mut n = HashMap::new();
        n.insert(10, node(None, "bash.exe", 200));
        n.insert(11, node(Some(10), "viejo.exe", 50));
        assert_eq!(pick_foreground(&n, 10), None);
    }

    #[test]
    fn rama_de_git() {
        let dir = std::env::temp_dir().join(format!("nt-git-{}", std::process::id()));
        let sub = dir.join("a").join("b");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        std::fs::write(dir.join(".git").join("HEAD"), "ref: refs/heads/feature/x\n").unwrap();
        assert_eq!(git_branch(&sub).as_deref(), Some("feature/x"));
        std::fs::write(dir.join(".git").join("HEAD"), "0123456789abcdef0123456789abcdef01234567\n").unwrap();
        assert_eq!(git_branch(&dir).as_deref(), Some("0123456"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
