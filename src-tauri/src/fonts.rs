//! Installed fonts: the system and user registry on Windows, fontconfig (`fc-list`) on Linux.
//!
//! The frontend filters which ones are monospaced by measuring them, and xterm's ligatures addon
//! needs the bytes of the font file: we provide them from here, without asking the WebView
//! for the "local fonts" permission.

use std::collections::BTreeMap;
use std::path::PathBuf;

#[cfg(windows)]
const KEY: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts";

const STYLES: &[&str] = &[
    "regular", "bold", "italic", "oblique", "light", "extralight", "ultralight", "semilight", "demilight",
    "semibold", "demibold", "medium", "black", "heavy", "thin", "extrabold", "ultrabold", "book", "normal",
    "condensed", "semicondensed", "extended", "retina",
];

/// A registry entry ("Cascadia Code Bold (TrueType)") → families and whether it's the regular variant.
/// Collections come as "Cambria & Cambria Math (TrueType)".
pub fn parse_entry(name: &str) -> Vec<(String, bool)> {
    let base = match name.rfind(" (") {
        Some(i) if name.ends_with(')') => &name[..i],
        _ => name,
    };
    base.split(" & ")
        .filter_map(|part| {
            let words: Vec<&str> = part.split_whitespace().collect();
            let mut end = words.len();
            let mut styled = false;
            while end > 1 && STYLES.contains(&words[end - 1].to_lowercase().as_str()) {
                if !words[end - 1].eq_ignore_ascii_case("regular") && !words[end - 1].eq_ignore_ascii_case("normal") {
                    styled = true;
                }
                end -= 1;
            }
            let family = words[..end].join(" ");
            (!family.is_empty()).then_some((family, !styled))
        })
        .collect()
}

/// Family → file (we prefer the regular variant, otherwise the first one that shows up).
fn table() -> BTreeMap<String, PathBuf> {
    let mut out: BTreeMap<String, (PathBuf, bool)> = BTreeMap::new();
    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        use winreg::RegKey;
        let sys_fonts = std::env::var_os("WINDIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows")).join("Fonts");
        for root in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
            let Ok(key) = RegKey::predef(root).open_subkey(KEY) else { continue };
            for (name, value) in key.enum_values().flatten() {
                let Ok(file) = <String as winreg::types::FromRegValue>::from_reg_value(&value) else { continue };
                let path = PathBuf::from(&file);
                // System ones come without a path; user-installed ones, with the full path.
                let path = if path.is_absolute() { path } else { sys_fonts.join(path) };
                for (family, regular) in parse_entry(&name) {
                    match out.get(&family) {
                        Some((_, true)) => {}
                        Some((_, false)) if !regular => {}
                        _ => {
                            out.insert(family, (path.clone(), regular));
                        }
                    }
                }
            }
        }
    }
    #[cfg(not(windows))]
    {
        if let Ok(o) = std::process::Command::new("fc-list").args([":", "family", "style", "file"]).output() {
            for (family, path, regular) in parse_fc_list(&String::from_utf8_lossy(&o.stdout)) {
                match out.get(&family) {
                    Some((_, true)) => {}
                    Some((_, false)) if !regular => {}
                    _ => {
                        out.insert(family, (path, regular));
                    }
                }
            }
        }
    }
    out.into_iter().map(|(k, (p, _))| (k, p)).collect()
}

/// `fc-list : family style file` lines ("/x/a.ttf: Fira Code,Fira Code Light:style=Light,Regular")
/// → (family, file, is it the regular variant). Only the first name of each family list is taken
/// (the others are its localized or style names).
#[cfg_attr(windows, allow(dead_code))]
pub fn parse_fc_list(text: &str) -> Vec<(String, PathBuf, bool)> {
    text.lines()
        .filter_map(|line| {
            let (file, rest) = line.split_once(": ")?;
            let (families, style) = match rest.split_once(":style=") {
                Some((f, st)) => (f, st),
                None => (rest.trim_end_matches(':'), "Regular"),
            };
            let family = families.split(',').next()?.trim().replace("\\-", "-");
            if family.is_empty() || family.starts_with('.') {
                return None;
            }
            // The first style is the real one ("Medium,Regular" is Medium: the second is an alias).
            let first = style.split(',').next().unwrap_or("").trim().to_ascii_lowercase();
            let regular = matches!(first.as_str(), "regular" | "normal" | "book" | "roman" | "");
            Some((family, PathBuf::from(file), regular))
        })
        .collect()
}

/// Installed families (all of them; the frontend keeps the monospaced ones).
#[tauri::command]
pub fn fonts_list() -> Vec<String> {
    table().into_keys().collect()
}

/// Bytes of a family's file (so the ligatures addon can read its tables).
#[tauri::command]
pub fn font_file(family: String) -> Result<tauri::ipc::Response, String> {
    let t = table();
    let path = t.get(&family).ok_or_else(|| tr!("No se encontró la fuente {family}", "Font {family} wasn't found", "A fonte {family} não foi encontrada"))?;
    let bytes = std::fs::read(path).map_err(|e| tr!("No se pudo leer {}: {e}", "Couldn't read {}: {e}", "Não foi possível ler {}: {e}"; path.display()))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn separa_familia_y_estilo() {
        assert_eq!(parse_entry("Cascadia Code Regular (TrueType)"), vec![("Cascadia Code".into(), true)]);
        assert_eq!(parse_entry("Cascadia Mono SemiBold Italic (TrueType)"), vec![("Cascadia Mono".into(), false)]);
        assert_eq!(parse_entry("Consolas (TrueType)"), vec![("Consolas".into(), true)]);
        assert_eq!(
            parse_entry("Cambria & Cambria Math (TrueType)"),
            vec![("Cambria".into(), true), ("Cambria Math".into(), true)]
        );
        // A lone style word is the name, not a style.
        assert_eq!(parse_entry("Bold (OpenType)"), vec![("Bold".into(), true)]);
        assert_eq!(parse_entry("JetBrains Mono ExtraBold"), vec![("JetBrains Mono".into(), false)]);
    }

    #[test]
    fn lee_la_salida_de_fc_list() {
        let text = "/usr/share/fonts/a/FiraCode-Light.ttf: Fira Code,Fira Code Light:style=Light,Regular\n\
                    /usr/share/fonts/a/FiraCode-Regular.ttf: Fira Code:style=Regular\n\
                    /usr/share/fonts/b/x.otf: .Hidden:style=Regular\n\
                    /usr/share/fonts/c/sinestilo.ttf: Sin Estilo:\n";
        let v = parse_fc_list(text);
        assert_eq!(v.len(), 3);
        assert_eq!(v[0], ("Fira Code".into(), PathBuf::from("/usr/share/fonts/a/FiraCode-Light.ttf"), false));
        assert_eq!(v[1], ("Fira Code".into(), PathBuf::from("/usr/share/fonts/a/FiraCode-Regular.ttf"), true));
        assert_eq!(v[2], ("Sin Estilo".into(), PathBuf::from("/usr/share/fonts/c/sinestilo.ttf"), true));
    }

    #[cfg(not(windows))]
    #[test]
    fn encuentra_fuentes_reales_en_linux() {
        let t = table();
        // Ubuntu brings DejaVu (and every desktop has some monospaced font from fontconfig).
        let mono = t.keys().find(|k| k.contains("Mono")).unwrap_or_else(|| panic!("sin fuentes Mono: {:?}", t.keys().take(20).collect::<Vec<_>>()));
        assert!(t[mono].exists());
        if let Some(p) = t.get("DejaVu Sans Mono") {
            assert!(p.file_name().unwrap().to_string_lossy().eq_ignore_ascii_case("DejaVuSansMono.ttf"), "la variante normal gana: {p:?}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn encuentra_fuentes_reales() {
        let t = table();
        assert!(t.contains_key("Consolas"), "Consolas viene con Windows");
        assert!(t["Consolas"].exists());
        // The regular variant wins over bold.
        assert!(t["Consolas"].file_name().unwrap().to_string_lossy().eq_ignore_ascii_case("consola.ttf"));
    }
}
