//! Clean environment for shells.
//!
//! If AlphaTerm is opened from another program (Claude Code, VS Code, a CI task…), it inherits its
//! environment: variables that turn off colors (NO_COLOR=1, which Claude Code sets for its tools),
//! "child session" marks and even tokens. Those are removed from the shells, unless the user has
//! them defined in their Windows environment (registry): there they are a preference and are respected.

use std::collections::HashSet;

const EXACT: &[&str] = &["NO_COLOR", "FORCE_COLOR", "CLICOLOR", "CLICOLOR_FORCE", "CLAUDECODE", "CLAUDE_PID", "CI"];
const PREFIXES: &[&str] = &["CLAUDE_CODE_", "CLAUDE_AGENT_", "CLAUDE_PREVIEW_", "CODEX_SANDBOX", "VSCODE_GIT_", "TERM_SESSION_"];

/// Is it a variable inherited from the program that opened AlphaTerm that must not reach the shell?
pub fn is_inherited_noise(name: &str) -> bool {
    let up = name.to_ascii_uppercase();
    EXACT.contains(&up.as_str()) || PREFIXES.iter().any(|p| up.starts_with(p))
}

/// Names of the variables defined in the user's and system's persistent environment.
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

/// Process variables that must be removed from a new shell.
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
