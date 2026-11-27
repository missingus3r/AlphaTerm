//! Updates between computers (app-versions, github.com/missingus3r/app-versions).
//!
//! On startup (once per process, a few seconds after the window shows) AlphaTerm runs
//! `node <app-versions>/bin/check.mjs alphaterm --current <version>` with no window. That script decides
//! whether a newer published version exists and whether this computer's code may be moved to it, and starts
//! the update by itself. The only thing AlphaTerm reads back is `status/alphaterm.json` in the per-computer
//! folder (same rule as app-versions' lib/home.mjs):
//!   Windows: %LOCALAPPDATA%\app-versions · Linux: $XDG_DATA_HOME/app-versions (if absolute) or
//!   ~/.local/share/app-versions · APP_VERSIONS_HOME overrides both.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use tauri::AppHandle;

use crate::i18n::tr;

const APP_ID: &str = "alphaterm";
/// The check waits a moment so it never competes with the window opening.
const START_DELAY: Duration = Duration::from_secs(3);

/// The per-computer folder of app-versions; `get` reads an environment variable.
pub fn home_dir_from(get: impl Fn(&str) -> Option<OsString>, windows: bool) -> Option<PathBuf> {
    if let Some(h) = get("APP_VERSIONS_HOME").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(h));
    }
    if windows {
        let base = get("LOCALAPPDATA")
            .map(PathBuf::from)
            .or_else(|| get("USERPROFILE").map(|p| PathBuf::from(p).join("AppData").join("Local")))?;
        return Some(base.join("app-versions"));
    }
    // Only an absolute XDG_DATA_HOME counts (the spec); checked as text so the rule is the same on any OS.
    let xdg = get("XDG_DATA_HOME").filter(|v| v.to_string_lossy().starts_with('/')).map(PathBuf::from);
    let base = xdg.or_else(|| get("HOME").map(|h| PathBuf::from(h).join(".local").join("share")))?;
    Some(base.join("app-versions"))
}

/// Dev builds (`tauri dev`, usually an older version than the published one) would otherwise move and rebuild
/// the real clone in the background; they only check when APP_VERSIONS_HOME points at a test folder.
pub fn should_check(debug_build: bool, has_override: bool) -> bool {
    !debug_build || has_override
}

fn home_dir() -> Option<PathBuf> {
    home_dir_from(|k| std::env::var_os(k), cfg!(windows))
}

/// The clone of app-versions registered on this computer (config.json), if any.
pub fn versions_repo(home: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(home.join("config.json")).ok()?;
    let cfg: serde_json::Value = serde_json::from_str(&text).ok()?;
    cfg["versionsRepo"].as_str().map(PathBuf::from)
}

/// status/alphaterm.json, or None when missing or unreadable (the scripts write it atomically anyway).
pub fn read_status(home: &Path) -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(home.join("status").join(format!("{APP_ID}.json"))).ok()?;
    serde_json::from_str(&text).ok()
}

/// Runs `node <app-versions>/bin/<script> <args>` with no window; a thread waits for it (no zombie on Linux).
fn run_script(repo: &Path, script: &str, args: Vec<String>) -> Result<(), String> {
    let path = repo.join("bin").join(script);
    if !path.is_file() {
        return Err(format!("{}: {}", tr("No está el script", "Script not found", "Script não encontrado"), path.display()));
    }
    let mut cmd = Command::new("node");
    cmd.arg(&path).args(&args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    crate::os::no_window(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| format!("node: {e}"))?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

/// Once per process, from `setup`: a few seconds later, asks app-versions whether to update.
/// Without app-versions on this computer (or without node), nothing happens and nothing is shown.
pub fn start(app: AppHandle) {
    let version = app.package_info().version.to_string();
    if !should_check(cfg!(debug_assertions), std::env::var_os("APP_VERSIONS_HOME").is_some()) {
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(START_DELAY);
        let Some(repo) = home_dir().and_then(|h| versions_repo(&h)) else { return };
        if let Err(e) = run_script(&repo, "check.mjs", vec![APP_ID.into(), "--current".into(), version]) {
            eprintln!("app-versions: {e}");
        }
    });
}

#[tauri::command]
pub fn update_status() -> Option<serde_json::Value> {
    home_dir().and_then(|h| read_status(&h))
}

/// "Reintentar": runs update.mjs again for the version in the status.
#[tauri::command]
pub fn update_retry() -> Result<(), String> {
    let home = home_dir().ok_or_else(|| tr("No hay carpeta de app-versions", "No app-versions folder", "Sem pasta do app-versions").to_string())?;
    let repo = versions_repo(&home).ok_or_else(|| tr("app-versions no está configurado en esta PC", "app-versions isn't set up on this computer", "app-versions não está configurado neste PC").to_string())?;
    let version = read_status(&home)
        .and_then(|s| s["version"].as_str().map(str::to_string))
        .ok_or_else(|| tr("No hay una versión para reintentar", "No version to retry", "Não há versão para tentar de novo").to_string())?;
    run_script(&repo, "update.mjs", vec![APP_ID.into(), "--version".into(), version])
}

/// "Ver registro": opens the log of the last update.
#[tauri::command]
pub fn update_open_log() -> Result<(), String> {
    let log = update_status()
        .and_then(|s| s["log"].as_str().map(PathBuf::from))
        .ok_or_else(|| tr("No hay registro", "No log", "Sem registro").to_string())?;
    crate::os::open(&log)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::path::PathBuf;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<OsString> {
        let pairs: Vec<(String, String)> = pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        move |k: &str| pairs.iter().find(|(key, _)| key == k).map(|(_, v)| OsString::from(v))
    }

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("at-updates-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn home_override_wins() {
        assert_eq!(home_dir_from(env(&[("APP_VERSIONS_HOME", "/x")]), false), Some(PathBuf::from("/x")));
    }

    #[test]
    fn home_on_windows_uses_localappdata() {
        assert_eq!(home_dir_from(env(&[("LOCALAPPDATA", "C:\\L")]), true), Some(PathBuf::from("C:\\L").join("app-versions")));
    }

    #[test]
    fn home_on_linux_ignores_a_relative_xdg_data_home() {
        let expected = PathBuf::from("/h").join(".local").join("share").join("app-versions");
        assert_eq!(home_dir_from(env(&[("HOME", "/h"), ("XDG_DATA_HOME", "rel")]), false), Some(expected));
        assert_eq!(home_dir_from(env(&[("HOME", "/h"), ("XDG_DATA_HOME", "/d")]), false), Some(PathBuf::from("/d").join("app-versions")));
    }

    #[test]
    fn status_reads_whole_files_only() {
        let home = temp("status");
        assert!(read_status(&home).is_none());
        std::fs::create_dir_all(home.join("status")).unwrap();
        std::fs::write(home.join("status").join("alphaterm.json"), "{\"id\":").unwrap();
        assert!(read_status(&home).is_none(), "half-written file");
        std::fs::write(home.join("status").join("alphaterm.json"), "{\"state\":\"building\",\"version\":\"0.8.3\"}").unwrap();
        assert_eq!(read_status(&home).unwrap()["version"], "0.8.3");
    }

    #[test]
    fn dev_builds_only_check_against_a_test_folder() {
        assert!(should_check(false, false), "release builds always check");
        assert!(!should_check(true, false), "tauri dev of an old version must not rebuild the real clone");
        assert!(should_check(true, true), "with APP_VERSIONS_HOME (a test folder) dev builds check too");
    }

    #[test]
    fn versions_repo_comes_from_the_config() {
        let home = temp("config");
        assert!(versions_repo(&home).is_none());
        std::fs::write(home.join("config.json"), "{\"versionsRepo\":\"/v\",\"apps\":{}}").unwrap();
        assert_eq!(versions_repo(&home), Some(PathBuf::from("/v")));
    }
}
