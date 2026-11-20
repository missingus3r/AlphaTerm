use std::path::{Path, PathBuf};

/// Copia la ConPTY de Microsoft al lado del ejecutable (y de los binarios de test en `deps\`),
/// porque portable-pty solo la usa si la encuentra ahí.
fn copy_conpty() {
    // En tiempo de ejecución (no env!): así sigue andando si se mueve o renombra la carpeta.
    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let src = Path::new(&manifest).join("conpty");
    println!("cargo:rerun-if-changed=conpty");
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    // OUT_DIR = target\<perfil>\build\<crate>\out
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

/// Commit y fecha de compilación, para mostrar la versión en el footer ("0.2.0 · 60d56fe+").
/// El "+" marca que había cambios sin commitear al compilar.
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
    copy_conpty();
    build_info();
    // El manifiesto de Windows (controles comunes v6) lo incrusta el linker y no el recurso de
    // tauri-build: así también lo tienen los binarios de test. Sin él no arrancan
    // (STATUS_ENTRYPOINT_NOT_FOUND: TaskDialogIndirect solo existe en los controles v6).
    let manifest = Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("windows-app-manifest.xml");
    println!("cargo:rerun-if-changed=windows-app-manifest.xml");
    let mut attrs = tauri_build::Attributes::new();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        attrs = attrs.windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }
    tauri_build::try_build(attrs).expect("tauri-build");
}
