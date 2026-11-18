//! Entorno limpio para las shells.
//!
//! Si AlphaTerm se abre desde otro programa (Claude Code, VS Code, una tarea de CI…), hereda su
//! entorno: variables que apagan los colores (NO_COLOR=1 que pone Claude Code a sus herramientas),
//! marcas de "sesión hija" y hasta tokens. Esas se sacan de las shells, salvo que el usuario las
//! tenga definidas en su entorno de Windows (registro): ahí son una preferencia suya y se respetan.

use std::collections::HashSet;

const EXACT: &[&str] = &["NO_COLOR", "FORCE_COLOR", "CLICOLOR", "CLICOLOR_FORCE", "CLAUDECODE", "CLAUDE_PID", "CI"];
const PREFIXES: &[&str] = &["CLAUDE_CODE_", "CLAUDE_AGENT_", "CLAUDE_PREVIEW_", "CODEX_SANDBOX", "VSCODE_GIT_", "TERM_SESSION_"];

/// ¿Es una variable que se hereda del programa que abrió AlphaTerm y no tiene que llegar a la shell?
pub fn is_inherited_noise(name: &str) -> bool {
    let up = name.to_ascii_uppercase();
    EXACT.contains(&up.as_str()) || PREFIXES.iter().any(|p| up.starts_with(p))
}

/// Nombres de las variables definidas en el entorno persistente del usuario y del sistema.
pub fn persistent_names() -> HashSet<String> {
    let mut out = HashSet::new();
    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        use winreg::RegKey;
        for (root, key) in [
            (HKEY_CURRENT_USER, "Environment"),
            (HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
        ] {
            if let Ok(k) = RegKey::predef(root).open_subkey(key) {
                for (name, _) in k.enum_values().flatten() {
                    out.insert(name.to_ascii_uppercase());
                }
            }
        }
    }
    out
}

/// Variables del proceso que hay que sacarle a una shell nueva.
pub fn to_remove(current: impl Iterator<Item = String>, persistent: &HashSet<String>) -> Vec<String> {
    current.filter(|n| is_inherited_noise(n) && !persistent.contains(&n.to_ascii_uppercase())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saca_lo_heredado_y_respeta_lo_del_usuario() {
        let current = ["NO_COLOR", "CLAUDE_CODE_CHILD_SESSION", "CLAUDECODE", "PATH", "TERM", "CLAUDE_CODE_MESSAGING_TOKEN", "FORCE_COLOR", "Path", "CI"]
            .iter()
            .map(|s| s.to_string());
        let persistent: HashSet<String> = ["FORCE_COLOR".to_string(), "PATH".to_string()].into_iter().collect();
        let r = to_remove(current, &persistent);
        assert_eq!(r, vec!["NO_COLOR", "CLAUDE_CODE_CHILD_SESSION", "CLAUDECODE", "CLAUDE_CODE_MESSAGING_TOKEN", "CI"]);
        assert!(!is_inherited_noise("CLAUDE_CONFIG_DIR"), "una configuración del usuario, no del proceso padre");
        assert!(!is_inherited_noise("ANTHROPIC_API_KEY"));
    }
}
