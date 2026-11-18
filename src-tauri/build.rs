use std::path::{Path, PathBuf};

/// Copia la ConPTY de Microsoft al lado del ejecutable (y de los binarios de test en `deps\`),
/// porque portable-pty solo la usa si la encuentra ahí.
fn copy_conpty() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("conpty");
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

fn main() {
    copy_conpty();
    tauri_build::build()
}
