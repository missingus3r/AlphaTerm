//! Perfiles de shell: qué ejecutable se lanza y si está instalado en esta máquina.

use serde::Serialize;
use std::env;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Serialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    /// Ruta absoluta si se encontró; si no, el nombre buscado.
    pub command: String,
    pub args: Vec<String>,
    pub available: bool,
}

fn sys_root() -> PathBuf {
    PathBuf::from(env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into()))
}

/// Busca un ejecutable en el PATH (con extensión explícita, para no confundir shims).
pub fn find_in_path(exe: &str) -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    env::split_paths(&path).map(|d| d.join(exe)).find(|p| p.is_file())
}

fn first_existing(cands: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    cands.into_iter().find(|p| p.is_file())
}

/// Git Bash: `bin\bash.exe` del Git for Windows (el de `usr\bin` no prepara el entorno de login,
/// y `System32\bash.exe` es el de WSL).
fn git_bash() -> Option<PathBuf> {
    let mut cands = vec![];
    for var in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Ok(base) = env::var(var) {
            let base = PathBuf::from(base);
            cands.push(base.join(r"Git\bin\bash.exe"));
            cands.push(base.join(r"Programs\Git\bin\bash.exe"));
        }
    }
    // git.exe en el PATH suele estar en <Git>\cmd\git.exe.
    if let Some(git) = find_in_path("git.exe") {
        if let Some(root) = git.parent().and_then(Path::parent) {
            cands.push(root.join(r"bin\bash.exe"));
        }
    }
    first_existing(cands)
}

fn make(id: &str, name: &str, found: Option<PathBuf>, fallback: &str, args: &[&str]) -> Profile {
    Profile {
        id: id.into(),
        name: name.into(),
        available: found.is_some(),
        command: found.map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|| fallback.into()),
        args: args.iter().map(|s| s.to_string()).collect(),
    }
}

pub fn detect() -> Vec<Profile> {
    let sys32 = sys_root().join("System32");
    let pwsh = find_in_path("pwsh.exe").or_else(|| {
        let pf = env::var("ProgramFiles").ok()?;
        first_existing([PathBuf::from(pf).join(r"PowerShell\7\pwsh.exe")])
    });
    let cmd = env::var("ComSpec").ok().map(PathBuf::from).filter(|p| p.is_file());
    vec![
        make(
            "powershell",
            "Windows PowerShell",
            first_existing([sys32.join(r"WindowsPowerShell\v1.0\powershell.exe")]),
            "powershell.exe",
            &["-NoLogo"],
        ),
        make("pwsh", "PowerShell 7", pwsh, "pwsh.exe", &["-NoLogo"]),
        // El nombre queda en español: el frontend lo traduce y lo reconoce en el historial (matchesShell).
        make("cmd", "Símbolo del sistema", cmd.or_else(|| first_existing([sys32.join("cmd.exe")])), "cmd.exe", &[]),
        make("gitbash", "Git Bash", git_bash(), "bash.exe", &["--login", "-i"]),
        make("wsl", "WSL", first_existing([sys32.join("wsl.exe")]), "wsl.exe", &[]),
    ]
}

pub const DEFAULT_PROFILE: &str = "powershell";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detecta_los_perfiles_base() {
        let ps = detect();
        let ids: Vec<_> = ps.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, ["powershell", "pwsh", "cmd", "gitbash", "wsl"]);
        // En cualquier Windows hay PowerShell 5.1 y cmd.
        assert!(ps.iter().find(|p| p.id == "powershell").unwrap().available);
        assert!(ps.iter().find(|p| p.id == "cmd").unwrap().available);
        for p in ps.iter().filter(|p| p.available) {
            assert!(Path::new(&p.command).is_absolute(), "{p:?}");
        }
    }

    #[test]
    fn git_bash_no_es_el_de_wsl() {
        if let Some(b) = git_bash() {
            let s = b.to_string_lossy().to_lowercase();
            assert!(!s.contains("system32"), "{s}");
            assert!(s.ends_with(r"bin\bash.exe"));
        }
    }
}
