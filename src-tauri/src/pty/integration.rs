//! Shell integration: how each profile is launched so that it emits OSC 133 / 633 / 7.
//! - PowerShell (5.1 and 7): the script goes through `-EncodedCommand`, which the execution policy
//!   doesn't block (on some work PCs .ps1 files are blocked).
//! - Git Bash: `--init-file` with a script that first loads what a login shell would load.
//! - cmd: only the PROMPT variable (prompt and folder marks; no exit code or command).
//! - WSL and custom profiles: no integration.

use base64::Engine;
use std::path::PathBuf;

const PS_SCRIPT: &str = include_str!("../../shell/alphaterm.ps1");
const BASH_SCRIPT: &str = include_str!("../../shell/alphaterm.bash");

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

/// Writes the bash script with LF line endings (git may have converted it to CRLF) and returns
/// the path with forward slashes, which bash understands.
fn bash_init_file() -> std::io::Result<String> {
    let dir = std::env::temp_dir().join("AlphaTerm");
    std::fs::create_dir_all(&dir)?;
    let path: PathBuf = dir.join("alphaterm.bash");
    let body = BASH_SCRIPT.replace("\r\n", "\n");
    if std::fs::read_to_string(&path).ok().as_deref() != Some(body.as_str()) {
        std::fs::write(&path, body)?;
    }
    Ok(path.to_string_lossy().replace('\\', "/"))
}

/// Arguments and variables to launch the profile with integration. If something fails, it launches without it.
pub fn launch_for(profile_id: &str, base_args: &[String]) -> Launch {
    let plain = || Launch { args: base_args.to_vec(), env: vec![] };
    match profile_id {
        "powershell" | "pwsh" => Launch {
            args: vec!["-NoLogo".into(), "-NoExit".into(), "-EncodedCommand".into(), powershell_encoded()],
            env: vec![],
        },
        "gitbash" => match bash_init_file() {
            Ok(path) => Launch { args: vec!["--init-file".into(), path, "-i".into()], env: vec![] },
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
