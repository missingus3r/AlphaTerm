//! Shell integration: how each profile is launched so that it emits OSC 133 / 633 / 7.
//! - PowerShell (5.1 and 7): the script goes through `-EncodedCommand`, which the execution policy
//!   doesn't block (on some work PCs .ps1 files are blocked).
//! - Git Bash and bash on Linux: `--init-file` with a script that first loads the user's own files.
//! - zsh (Linux): `ZDOTDIR` points to a folder whose `.zshenv`/`.zshrc` load the user's and add the marks.
//! - fish (Linux): `--init-command` sources the script (after the user's config.fish).
//! - cmd: only the PROMPT variable (prompt and folder marks; no exit code or command).
//! - WSL and custom profiles: no integration.

use base64::Engine;
use std::path::PathBuf;

const PS_SCRIPT: &str = include_str!("../../shell/alphaterm.ps1");
const BASH_SCRIPT: &str = include_str!("../../shell/alphaterm.bash");
const ZSH_SCRIPT: &str = include_str!("../../shell/alphaterm.zsh");
const FISH_SCRIPT: &str = include_str!("../../shell/alphaterm.fish");

/// cmd's PROMPT: `$e` is ESC and the OSCs end with ST (`ESC \`).
/// 133;D without a code (cmd doesn't expose it), 9;9 with the folder, 133;A/B around the prompt.
pub const CMD_PROMPT: &str = r"$e]133;D$e\$e]9;9;$P$e\$e]133;A$e\$P$G$e]133;B$e\";

pub struct Launch {
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

/// PowerShell script encoded the way `-EncodedCommand` expects (UTF-16LE in base64).
pub fn powershell_encoded() -> String {
    let script = PS_SCRIPT.replace("\r\n", "\n");
    let utf16: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    base64::engine::general_purpose::STANDARD.encode(utf16)
}

/// Writes a script with LF line endings (git may have converted it to CRLF) to `<temp>/<rel>`,
/// only if it changed, and returns its path.
fn script_file(rel: &[&str], body: &str) -> std::io::Result<PathBuf> {
    let mut path: PathBuf = crate::os::temp_dir();
    for r in rel {
        path.push(r);
    }
    std::fs::create_dir_all(path.parent().unwrap())?;
    let body = body.replace("\r\n", "\n");
    if std::fs::read_to_string(&path).ok().as_deref() != Some(body.as_str()) {
        std::fs::write(&path, body)?;
    }
    Ok(path)
}

/// The bash script's path with forward slashes, which bash understands (also Git Bash).
fn bash_init_file() -> std::io::Result<String> {
    Ok(script_file(&["alphaterm.bash"], BASH_SCRIPT)?.to_string_lossy().replace('\\', "/"))
}

/// Folder for `ZDOTDIR`: its `.zshenv` and `.zshrc` are the same script, which knows which one it is by
/// `ALPHATERM_ZSH_STAGE`.
fn zsh_dotdir() -> std::io::Result<PathBuf> {
    script_file(&["zsh", ".zshenv"], ZSH_SCRIPT)?;
    Ok(script_file(&["zsh", ".zshrc"], ZSH_SCRIPT)?.parent().unwrap().to_path_buf())
}

/// A path quoted for fish's `source` ('…' with \\ and \' escaped).
fn fish_quote(p: &str) -> String {
    format!("'{}'", p.replace('\\', "\\\\").replace('\'', "\\'"))
}

/// Arguments and variables to launch the profile with integration. If something fails, it launches without it.
pub fn launch_for(profile_id: &str, base_args: &[String]) -> Launch {
    let plain = || Launch { args: base_args.to_vec(), env: vec![] };
    match profile_id {
        "powershell" | "pwsh" => Launch {
            args: vec!["-NoLogo".into(), "-NoExit".into(), "-EncodedCommand".into(), powershell_encoded()],
            env: vec![],
        },
        "gitbash" | "bash" => match bash_init_file() {
            Ok(path) => Launch { args: vec!["--init-file".into(), path, "-i".into()], env: vec![] },
            Err(_) => plain(),
        },
        "zsh" => match zsh_dotdir() {
            Ok(dir) => {
                let mut env = vec![("ZDOTDIR".into(), dir.to_string_lossy().into_owned()), ("ALPHATERM_ZSH_STAGE".into(), "env".into())];
                // If the user has their own ZDOTDIR, the script goes back to it.
                if let Some(user) = std::env::var_os("ZDOTDIR").filter(|v| !v.is_empty()) {
                    env.push(("ALPHATERM_USER_ZDOTDIR".into(), user.to_string_lossy().into_owned()));
                }
                Launch { args: vec!["-i".into()], env }
            }
            Err(_) => plain(),
        },
        "fish" => match script_file(&["alphaterm.fish"], FISH_SCRIPT) {
            Ok(path) => Launch { args: vec!["-i".into(), "--init-command".into(), format!("source {}", fish_quote(&path.to_string_lossy()))], env: vec![] },
            Err(_) => plain(),
        },
        "cmd" => Launch { args: base_args.to_vec(), env: vec![("PROMPT".into(), CMD_PROMPT.into())] },
        _ => plain(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_script_de_powershell_se_decodifica_igual() {
        let b64 = powershell_encoded();
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64).unwrap();
        let u16s: Vec<u16> = bytes.chunks(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        let back = String::from_utf16(&u16s).unwrap();
        assert!(back.contains("133;A"));
        assert!(!back.contains('\r'));
        // Fits comfortably in the Windows command line (32,767 characters).
        assert!(powershell_encoded().len() < 20_000);
    }

    #[test]
    fn zsh_y_fish_con_sus_scripts() {
        let z = launch_for("zsh", &[]);
        let dir = &z.env.iter().find(|(k, _)| k == "ZDOTDIR").unwrap().1;
        let rc = std::fs::read_to_string(PathBuf::from(dir).join(".zshrc")).unwrap();
        assert!(rc.contains("133;A") && !rc.contains('\r'));
        assert!(PathBuf::from(dir).join(".zshenv").is_file());
        assert!(z.env.iter().any(|(k, v)| k == "ALPHATERM_ZSH_STAGE" && v == "env"));
        let f = launch_for("fish", &[]);
        assert_eq!(f.args[1], "--init-command");
        assert!(f.args[2].starts_with("source '") && f.args[2].ends_with("alphaterm.fish'"), "{:?}", f.args);
        assert_eq!(fish_quote("/a b/it's"), r"'/a b/it\'s'");
    }

    #[test]
    fn bash_queda_con_finales_lf() {
        let l = launch_for("gitbash", &[]);
        assert_eq!(l.args[0], "--init-file");
        let body = std::fs::read_to_string(&l.args[1]).unwrap();
        assert!(!body.contains('\r'));
        assert!(body.contains("PS0="));
    }

    #[test]
    fn wsl_va_sin_integracion() {
        let base = vec!["-x".to_string()];
        let l = launch_for("wsl", &base);
        assert_eq!(l.args, base);
        assert!(l.env.is_empty());
    }
}
