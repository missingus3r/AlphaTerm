//! Settings in `%APPDATA%\AlphaTerm\settings.json`.
//!
//! The backend doesn't know the schema (the frontend defines and normalizes it): it stores a JSON object,
//! writes it atomically, notifies all windows when it changes and detects edits
//! made by hand to the file. It never overwrites a broken file without saving a copy first.

use crate::i18n::tr;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager, Webview, WebviewUrl, WebviewWindowBuilder};

pub const EVENT: &str = "settings-changed";
const POLL: Duration = Duration::from_millis(1000);
const MAX_IMAGE: usize = 25 * 1024 * 1024;

/// App data folder (`%APPDATA%\AlphaTerm`). With ALPHATERM_DATA_DIR another one is used (to
/// try a new version next to the open one without touching its session or its settings).
pub fn data_dir() -> PathBuf {
    if let Some(d) = std::env::var_os("ALPHATERM_DATA_DIR").filter(|d| !d.is_empty()) {
        return PathBuf::from(d);
    }
    let base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    base.join("AlphaTerm")
}

/// The app used to be called NovaTerm: the first time, `%APPDATA%\NovaTerm` is copied to `%APPDATA%\AlphaTerm`
/// (the old one isn't deleted). Returns whether it copied anything.
pub fn migrate_from_novaterm() -> bool {
    if std::env::var_os("ALPHATERM_DATA_DIR").is_some() {
        return false;
    }
    let Some(base) = std::env::var_os("APPDATA").map(PathBuf::from) else { return false };
    migrate_dir(&base.join("NovaTerm"), &data_dir())
}

pub fn migrate_dir(old: &Path, new: &Path) -> bool {
    if new.exists() || !old.is_dir() {
        return false;
    }
    fn copy(from: &Path, to: &Path) -> std::io::Result<()> {
        fs::create_dir_all(to)?;
        for e in fs::read_dir(from)? {
            let e = e?;
            let dest = to.join(e.file_name());
            if e.file_type()?.is_dir() {
                copy(&e.path(), &dest)?;
            } else {
                fs::copy(e.path(), dest)?;
            }
        }
        Ok(())
    }
    copy(old, new).is_ok()
}

/// Fingerprint of the file to know whether it changed (modification time + size).
type Stamp = Option<(SystemTime, u64)>;

fn stamp(path: &Path) -> Stamp {
    fs::metadata(path).ok().map(|m| (m.modified().unwrap_or(SystemTime::UNIX_EPOCH), m.len()))
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Loaded {
    pub path: String,
    /// `None` if the file doesn't exist or couldn't be read (defaults are used).
    pub value: Option<Value>,
    pub warning: Option<String>,
}

#[derive(Serialize, Clone)]
struct Changed {
    /// Window that saved, or "file" if someone edited the file by hand.
    source: String,
    value: Value,
}

pub fn load_from(path: &Path) -> Loaded {
    let shown = path.display().to_string();
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Loaded { path: shown, value: None, warning: None },
        Err(e) => return Loaded { path: shown, value: None, warning: Some(tr!("No se pudo leer: {e}", "Couldn't read: {e}", "Não foi possível ler: {e}")) },
    };
    // A BOM at the start (old Notepad) isn't an error.
    match serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}')) {
        Ok(v @ Value::Object(_)) => Loaded { path: shown, value: Some(v), warning: None },
        Ok(_) => Loaded {
            path: shown,
            value: None,
            warning: Some(tr("settings.json no es un objeto JSON.", "settings.json isn't a JSON object.", "settings.json não é um objeto JSON.").into()),
        },
        Err(e) => Loaded {
            path: shown,
            value: None,
            warning: Some(tr!(
                "settings.json tiene un error en la línea {}, columna {}.",
                "settings.json has an error at line {}, column {}.",
                "settings.json tem um erro na linha {}, coluna {}.";
                e.line(),
                e.column()
            )),
        },
    }
}

/// Writes the JSON atomically (temp file + rename). If the current file exists
/// but is broken, it first copies it to `settings.json.bak` so what was written by hand isn't lost.
pub fn save_to(path: &Path, value: &Value) -> Result<(), String> {
    if !value.is_object() {
        return Err(tr("La configuración tiene que ser un objeto JSON", "Settings must be a JSON object", "As configurações precisam ser um objeto JSON").into());
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| tr!("No se pudo crear {}: {e}", "Couldn't create {}: {e}", "Não foi possível criar {}: {e}"; dir.display()))?;
    }
    if path.exists() && load_from(path).warning.is_some() {
        let _ = fs::copy(path, path.with_extension("json.bak"));
    }
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text + "\n").map_err(|e| tr!("No se pudo escribir: {e}", "Couldn't write: {e}", "Não foi possível gravar: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| tr!("No se pudo reemplazar el archivo: {e}", "Couldn't replace the file: {e}", "Não foi possível substituir o arquivo: {e}"))
}

pub struct SettingsState {
    path: PathBuf,
    /// Fingerprint of the last known version (written by us or already notified).
    known: Mutex<Stamp>,
}

impl SettingsState {
    pub fn new(path: PathBuf) -> Self {
        let known = Mutex::new(stamp(&path));
        Self { path, known }
    }

    /// Watches the file and notifies the windows when someone edits it by hand.
    pub fn watch(app: AppHandle) {
        std::thread::Builder::new()
            .name("settings-watch".into())
            .spawn(move || loop {
                std::thread::sleep(POLL);
                let state = app.state::<SettingsState>();
                let mut known = state.known.lock().unwrap();
                let now = stamp(&state.path);
                if now == *known {
                    continue;
                }
                let loaded = load_from(&state.path);
                // A file half-written by an editor may not parse: wait for the next round.
                let Some(value) = loaded.value else {
                    if loaded.warning.is_some() {
                        *known = now;
                        let _ = app.emit("settings-error", loaded.warning);
                    }
                    continue;
                };
                *known = now;
                drop(known);
                let _ = app.emit(EVENT, Changed { source: "file".into(), value });
            })
            .expect("no se pudo iniciar el vigilante de settings");
    }
}

#[tauri::command]
pub fn settings_load(state: tauri::State<SettingsState>) -> Loaded {
    let _guard = state.known.lock().unwrap();
    load_from(&state.path)
}

#[tauri::command]
pub fn settings_save(app: AppHandle, webview: Webview, state: tauri::State<SettingsState>, value: Value) -> Result<(), String> {
    {
        // Write and fingerprint under the same lock: the watcher doesn't mistake this for a manual edit.
        let mut known = state.known.lock().unwrap();
        save_to(&state.path, &value)?;
        *known = stamp(&state.path);
    }
    app.emit(EVENT, Changed { source: webview.label().to_string(), value }).map_err(|e| e.to_string())
}

/// Opens the file with the associated program (to edit it by hand).
#[tauri::command]
pub fn settings_reveal(state: tauri::State<SettingsState>) -> Result<(), String> {
    if !state.path.exists() {
        save_to(&state.path, &Value::Object(Default::default()))?;
    }
    std::process::Command::new("explorer.exe")
        .arg(format!("/select,{}", state.path.display()))
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Opens the settings window (or brings it to the front if it's already open).
#[tauri::command]
pub async fn settings_open(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.unminimize();
        return w.set_focus().map_err(|e| e.to_string());
    }
    WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App("index.html".into()))
        .title(tr("Configuración — AlphaTerm", "Settings — AlphaTerm", "Configurações — AlphaTerm"))
        .inner_size(920.0, 680.0)
        .min_inner_size(640.0, 420.0)
        .background_color(tauri::webview::Color(13, 16, 23, 255))
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// --- Background image ---------------------------------------------------------------------------

fn backgrounds_dir() -> PathBuf {
    data_dir().join("fondos")
}

/// Safe file name (no paths or odd characters) with a known image extension.
pub fn safe_image_name(name: &str) -> Option<String> {
    let base = Path::new(name).file_name()?.to_string_lossy().to_string();
    let ext = Path::new(&base).extension()?.to_string_lossy().to_lowercase();
    if !["png", "jpg", "jpeg", "webp", "gif", "bmp"].contains(&ext.as_str()) {
        return None;
    }
    let clean: String = base
        .chars()
        .map(|c| if c.is_alphanumeric() || "-_. ".contains(c) { c } else { '_' })
        .collect();
    Some(clean)
}

/// Saves a copy of the chosen image in `%APPDATA%\AlphaTerm\fondos` (so it keeps working
/// even if the original is moved). Takes the raw bytes and the name in the `x-name` header.
#[tauri::command]
pub fn background_store(request: tauri::ipc::Request) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(tr("Se esperaban los bytes de la imagen", "Expected the image bytes", "Esperavam-se os bytes da imagem").into());
    };
    if bytes.len() > MAX_IMAGE {
        return Err(tr("La imagen pesa más de 25 MB", "The image is larger than 25 MB", "A imagem tem mais de 25 MB").into());
    }
    let raw = request.headers().get("x-name").and_then(|v| v.to_str().ok()).unwrap_or("fondo.png");
    let name = percent_decode(raw);
    let name = safe_image_name(&name).ok_or(tr("Formato no soportado (png, jpg, webp, gif o bmp)", "Unsupported format (png, jpg, webp, gif or bmp)", "Formato não suportado (png, jpg, webp, gif ou bmp)"))?;
    let dir = backgrounds_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

/// Reads a background image. Only from the backgrounds folder: it's not a generic file reader.
#[tauri::command]
pub fn background_read(path: String) -> Result<tauri::ipc::Response, String> {
    let dir = fs::canonicalize(backgrounds_dir()).map_err(|_| tr("No hay imágenes de fondo guardadas", "There are no saved background images", "Não há imagens de fundo salvas").to_string())?;
    let file = fs::canonicalize(&path).map_err(|_| tr!("No existe {path}", "{path} doesn't exist", "{path} não existe"))?;
    if !file.starts_with(&dir) {
        return Err(tr("La imagen tiene que estar en la carpeta de fondos de AlphaTerm", "The image must be in AlphaTerm's backgrounds folder", "A imagem precisa estar na pasta de fundos do AlphaTerm").into());
    }
    let bytes = fs::read(&file).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Some(v) = s.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("alphaterm-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn migra_la_carpeta_vieja_una_sola_vez() {
        let d = tmp_dir("migrate");
        let old = d.join("NovaTerm");
        let new = d.join("AlphaTerm");
        fs::create_dir_all(old.join("fondos")).unwrap();
        fs::write(old.join("settings.json"), "{}").unwrap();
        fs::write(old.join("fondos").join("a.png"), "x").unwrap();
        assert!(migrate_dir(&old, &new));
        assert!(new.join("fondos").join("a.png").exists());
        assert!(old.join("settings.json").exists(), "la vieja no se borra");
        assert!(!migrate_dir(&old, &new), "si ya existe la nueva, no se toca");
    }

    #[test]
    fn sin_archivo_no_hay_valor_ni_aviso() {
        let d = tmp_dir("missing");
        let l = load_from(&d.join("settings.json"));
        assert_eq!(l.value, None);
        assert_eq!(l.warning, None);
    }

    #[test]
    fn guarda_y_vuelve_a_leer() {
        let d = tmp_dir("roundtrip");
        let p = d.join("sub").join("settings.json");
        let v = json!({"version": 1, "appearance": {"fontSize": 15}});
        save_to(&p, &v).unwrap();
        assert_eq!(load_from(&p).value, Some(v));
        assert!(!p.with_extension("json.tmp").exists());
    }

    #[test]
    fn archivo_roto_avisa_y_se_respalda_antes_de_pisarlo() {
        let d = tmp_dir("broken");
        let p = d.join("settings.json");
        fs::write(&p, "{ \"appearance\": { \"fontSize\": 15, }").unwrap();
        let l = load_from(&p);
        assert_eq!(l.value, None);
        assert!(l.warning.unwrap().contains("línea 1"));
        save_to(&p, &json!({"version": 1})).unwrap();
        assert!(fs::read_to_string(p.with_extension("json.bak")).unwrap().contains("fontSize"));
        assert_eq!(load_from(&p).value, Some(json!({"version": 1})));
    }

    #[test]
    fn acepta_bom_y_rechaza_lo_que_no_es_objeto() {
        let d = tmp_dir("bom");
        let p = d.join("settings.json");
        fs::write(&p, "\u{feff}{\"a\":1}").unwrap();
        assert_eq!(load_from(&p).value, Some(json!({"a": 1})));
        fs::write(&p, "[1,2]").unwrap();
        assert!(load_from(&p).warning.is_some());
        assert!(save_to(&p, &json!([1])).is_err());
    }

    #[test]
    fn nombres_de_imagen_seguros() {
        assert_eq!(safe_image_name("C:\\x\\..\\mi fondo.PNG").as_deref(), Some("mi fondo.PNG"));
        assert_eq!(safe_image_name("../../evil.jpg").as_deref(), Some("evil.jpg"));
        assert_eq!(safe_image_name("a<b>.webp").as_deref(), Some("a_b_.webp"));
        assert_eq!(safe_image_name("script.exe"), None);
        assert_eq!(safe_image_name("sin_extension"), None);
        assert_eq!(percent_decode("mi%20fondo%C3%B1.png"), "mi fondoñ.png");
        assert_eq!(percent_decode("100%"), "100%");
    }
}
