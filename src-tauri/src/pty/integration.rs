//! Shell integration: cómo se lanza cada perfil para que emita OSC 133 / 633 / 7.
//! - PowerShell (5.1 y 7): el script va por `-EncodedCommand`, que no lo frena la política de
//!   ejecución (en algunas PCs de trabajo los .ps1 están bloqueados).
//! - Git Bash: `--init-file` con un script que primero carga lo que cargaría un shell de login.
//! - cmd: solo la variable PROMPT (marca de prompt y carpeta; sin código de salida ni comando).
//! - WSL y perfiles custom: sin integración.

use base64::Engine;
use std::path::PathBuf;

const PS_SCRIPT: &str = include_str!("../../shell/novaterm.ps1");
const BASH_SCRIPT: &str = include_str!("../../shell/novaterm.bash");

/// PROMPT de cmd: `$e` es ESC y las OSC terminan con ST (`ESC \`).
/// 133;D sin código (cmd no lo expone), 9;9 con la carpeta, 133;A/B alrededor del prompt.
pub const CMD_PROMPT: &str = r"$e]133;D$e\$e]9;9;$P$e\$e]133;A$e\$P$G$e]133;B$e\";

pub struct Launch {
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

/// Script de PowerShell codificado como espera `-EncodedCommand` (UTF-16LE en base64).
pub fn powershell_encoded() -> String {
    let script = PS_SCRIPT.replace("\r\n", "\n");
    let utf16: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    base64::engine::general_purpose::STANDARD.encode(utf16)
}

/// Escribe el script de bash con finales LF (git puede haberlo convertido a CRLF) y devuelve
/// la ruta con barras normales, que bash entiende.
fn bash_init_file() -> std::io::Result<String> {
    let dir = std::env::temp_dir().join("NovaTerm");
    std::fs::create_dir_all(&dir)?;
    let path: PathBuf = dir.join("novaterm.bash");
    let body = BASH_SCRIPT.replace("\r\n", "\n");
    if std::fs::read_to_string(&path).ok().as_deref() != Some(body.as_str()) {
        std::fs::write(&path, body)?;
    }
    Ok(path.to_string_lossy().replace('\\', "/"))
}

/// Argumentos y variables para lanzar el perfil con integración. Si algo falla, se lanza sin ella.
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
        // Cabe holgado en la línea de comandos de Windows (32.767 caracteres).
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
