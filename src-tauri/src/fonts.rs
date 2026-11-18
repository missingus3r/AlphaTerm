//! Fuentes instaladas en Windows (registro del sistema y del usuario).
//!
//! El frontend filtra cuáles son monoespaciadas midiéndolas, y el addon de ligaduras de xterm
//! necesita los bytes del archivo de la fuente: los damos desde acá, sin pedirle al WebView
//! el permiso de "fuentes locales".

use std::collections::BTreeMap;
use std::path::PathBuf;

const KEY: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts";

const STYLES: &[&str] = &[
    "regular", "bold", "italic", "oblique", "light", "extralight", "ultralight", "semilight", "demilight",
    "semibold", "demibold", "medium", "black", "heavy", "thin", "extrabold", "ultrabold", "book", "normal",
    "condensed", "semicondensed", "extended", "retina",
];

/// Una entrada del registro ("Cascadia Code Bold (TrueType)") → familias y si es la variante normal.
/// Las colecciones vienen como "Cambria & Cambria Math (TrueType)".
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

/// Familia → archivo (preferimos la variante normal, si no, la primera que aparezca).
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
                // Las del sistema vienen sin ruta; las instaladas por el usuario, con ruta completa.
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
    out.into_iter().map(|(k, (p, _))| (k, p)).collect()
}

/// Familias instaladas (todas; el frontend se queda con las monoespaciadas).
#[tauri::command]
pub fn fonts_list() -> Vec<String> {
    table().into_keys().collect()
}

/// Bytes del archivo de una familia (para que el addon de ligaduras lea sus tablas).
#[tauri::command]
pub fn font_file(family: String) -> Result<tauri::ipc::Response, String> {
    let t = table();
    let path = t.get(&family).ok_or_else(|| format!("No se encontró la fuente {family}"))?;
    let bytes = std::fs::read(path).map_err(|e| format!("No se pudo leer {}: {e}", path.display()))?;
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
        // Una palabra de estilo sola es el nombre, no un estilo.
        assert_eq!(parse_entry("Bold (OpenType)"), vec![("Bold".into(), true)]);
        assert_eq!(parse_entry("JetBrains Mono ExtraBold"), vec![("JetBrains Mono".into(), false)]);
    }

    #[test]
    fn encuentra_fuentes_reales() {
        let t = table();
        assert!(t.contains_key("Consolas"), "Consolas viene con Windows");
        assert!(t["Consolas"].exists());
        // La variante normal gana sobre la negrita.
        assert!(t["Consolas"].file_name().unwrap().to_string_lossy().eq_ignore_ascii_case("consola.ttf"));
    }
}
