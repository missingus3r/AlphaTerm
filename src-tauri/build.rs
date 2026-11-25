use std::path::{Path, PathBuf};

/// Copies Microsoft's ConPTY next to the executable (and to the test binaries in `deps\`),
/// because portable-pty only uses it if it finds it there.
fn copy_conpty() {
    // At run time (not env!): so it keeps working if the folder is moved or renamed.
    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let src = Path::new(&manifest).join("conpty");
    println!("cargo:rerun-if-changed=conpty");
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    // OUT_DIR = target\<profile>\build\<crate>\out
    let Some(profile_dir) = out.ancestors().nth(3) else { return };
    for dir in [profile_dir.to_path_buf(), profile_dir.join("deps")] {
        let _ = std::fs::create_dir_all(&dir);
        for f in ["conpty.dll", "OpenConsole.exe"] {
            let from = src.join(f);
            let to = dir.join(f);
            let stale = std::fs::metadata(&to).map(|m| m.len()).ok() != std::fs::metadata(&from).map(|m| m.len()).ok();
            if stale {
                if let Err(e) = std::fs::copy(&from, &to) {
                    println!("cargo:warning=no se pudo copiar {f}: {e}");
                }
            }
        }
    }
}

/// Commit and build date, to show the version in the footer ("0.2.0 · 60d56fe+").
/// The "+" marks that there were uncommitted changes at build time.
fn build_info() {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let repo = Path::new(&manifest).parent().unwrap().to_path_buf();
    let git = |args: &[&str]| {
        std::process::Command::new("git").current_dir(&repo).args(args).output().ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    };
    let commit = git(&["describe", "--always", "--dirty=+", "--exclude=*"]).unwrap_or_default();
    let built = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    println!("cargo:rustc-env=ALPHATERM_COMMIT={commit}");
    println!("cargo:rustc-env=ALPHATERM_BUILT={built}");
    for f in [".git/HEAD", ".git/index"] {
        println!("cargo:rerun-if-changed={}", repo.join(f).display());
    }
}

fn main() {
    // ConPTY is Windows only (on Linux portable-pty uses the system's PTY).
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        copy_conpty();
    }
    build_info();
    // The Windows manifest (common controls v6) is embedded by the linker and not by the tauri-build
    // resource: that way the test binaries have it too. Without it they don't start
    // (STATUS_ENTRYPOINT_NOT_FOUND: TaskDialogIndirect only exists in controls v6).
    let manifest = Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("windows-app-manifest.xml");
    println!("cargo:rerun-if-changed=windows-app-manifest.xml");
    // The built-in browser's pages (remote content) send their messages to this command (Linux; on Windows
    // they go through a DevTools binding). An inlined plugin, so it gets its own permission without
    // making every app command need one.
    let mut attrs = tauri_build::Attributes::new().plugin("browser-page", tauri_build::InlinedPlugin::new().commands(&["message"]));
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        attrs = attrs.windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }
    tauri_build::try_build(attrs).expect("tauri-build");
}
