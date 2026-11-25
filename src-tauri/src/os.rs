//! What changes between Windows and Linux: the user's folder, where the app keeps its data,
//! opening and showing files, and launching helper programs without a console window.
//! The rest of the modules go through here instead of reading `USERPROFILE`/`APPDATA` themselves.

use std::path::{Path, PathBuf};
use std::process::Command;

/// The user's folder (`%USERPROFILE%` on Windows, `$HOME` on Linux).
pub fn home() -> PathBuf {
    #[cfg(windows)]
    let v = std::env::var_os("USERPROFILE");
    #[cfg(not(windows))]
    let v = std::env::var_os("HOME");
    v.filter(|v| !v.is_empty()).map(PathBuf::from).unwrap_or_else(|| {
        if cfg!(windows) {
            PathBuf::from("C:\\")
        } else {
            PathBuf::from("/")
        }
    })
}

/// Base folder for the app's data: `%APPDATA%` on Windows; `$XDG_CONFIG_HOME` (or `~/.config`) on Linux.
pub fn config_base() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("APPDATA").filter(|v| !v.is_empty()).map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("XDG_CONFIG_HOME")
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .or_else(|| Some(home().join(".config")))
    }
}

/// The app's own temporary folder (pasted images, browser screenshots, the shell integration scripts).
/// On Windows, `%TEMP%\AlphaTerm`. On Linux `/tmp` is shared by every user (anyone could create
/// `/tmp/AlphaTerm` first and leave a script there), so it's the user's runtime folder
/// (`$XDG_RUNTIME_DIR`, only theirs) or, without it, `~/.cache/AlphaTerm`.
pub fn temp_dir() -> PathBuf {
    #[cfg(windows)]
    {
        std::env::temp_dir().join("AlphaTerm")
    }
    #[cfg(not(windows))]
    {
        let abs = |k: &str| std::env::var_os(k).map(PathBuf::from).filter(|p| p.is_absolute());
        abs("XDG_RUNTIME_DIR")
            .filter(|p| p.is_dir())
            .or_else(|| abs("XDG_CACHE_HOME"))
            .unwrap_or_else(|| home().join(".cache"))
            .join("AlphaTerm")
    }
}

/// Helper programs (git, docker, the agents' CLIs…) never open a console window on Windows.
pub fn no_window(_cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        _cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
}

/// Opens a folder or a file with the program associated with it.
pub fn open(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    let mut c = {
        let mut c = Command::new("explorer.exe");
        c.arg(path);
        c
    };
    #[cfg(not(windows))]
    let mut c = {
        let mut c = Command::new("xdg-open");
        c.arg(path);
        c
    };
    no_window(&mut c);
    spawn_detached(c)
}

/// Shows a file selected in the file manager (a folder is opened as is).
pub fn reveal(path: &Path) -> Result<(), String> {
    if path.is_dir() {
        return open(path);
    }
    #[cfg(windows)]
    {
        let mut c = Command::new("explorer.exe");
        c.arg(format!("/select,{}", path.display()));
        no_window(&mut c);
        spawn_detached(c)
    }
    #[cfg(not(windows))]
    {
        // The freedesktop way (Nautilus, Dolphin, Nemo…); if no file manager answers it, the folder is opened.
        let uri = file_uri(path);
        let shown = Command::new("gdbus")
            .args([
                "call", "--session", "--dest", "org.freedesktop.FileManager1", "--object-path", "/org/freedesktop/FileManager1",
                "--method", "org.freedesktop.FileManager1.ShowItems",
            ])
            .arg(format!("['{uri}']"))
            .arg("")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if shown {
            return Ok(());
        }
        open(path.parent().unwrap_or(path))
    }
}

/// `file://` URI of an absolute path, with the characters that need it escaped.
pub fn file_uri(path: &Path) -> String {
    let s = path.to_string_lossy();
    let mut out = String::from("file://");
    for b in s.as_bytes() {
        match *b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b'-' | b'_' | b'.' | b'~' => out.push(*b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Launches a program without waiting for it, and reaps it so it doesn't stay as a zombie.
fn spawn_detached(mut c: Command) -> Result<(), String> {
    let mut child = c
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn carpeta_de_usuario_y_de_datos() {
        assert!(home().is_absolute());
        let base = config_base().unwrap();
        assert!(base.is_absolute(), "{base:?}");
        let t = temp_dir();
        assert!(t.is_absolute() && t.ends_with("AlphaTerm"), "{t:?}");
        #[cfg(not(windows))]
        assert!(!t.starts_with("/tmp"), "nunca en el /tmp compartido: {t:?}");
    }

    #[cfg(not(windows))]
    #[test]
    fn uri_de_archivo_escapada() {
        assert_eq!(file_uri(Path::new("/home/yo/Mis cosas/á.txt")), "file:///home/yo/Mis%20cosas/%C3%A1.txt");
    }
}
