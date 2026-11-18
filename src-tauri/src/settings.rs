//! Configuración en `%APPDATA%\NovaTerm\settings.json`.
//!
//! El backend no conoce el esquema (lo define y normaliza el frontend): guarda un objeto JSON,
//! lo escribe de forma atómica, avisa a todas las ventanas cuando cambia y detecta ediciones
//! hechas a mano en el archivo. Nunca pisa un archivo roto sin guardar antes una copia.

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

/// Carpeta de datos de la app (`%APPDATA%\NovaTerm`).
pub fn data_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    base.join("NovaTerm")
}

/// Huella del archivo para saber si cambió (fecha de modificación + tamaño).
type Stamp = Option<(SystemTime, u64)>;

fn stamp(path: &Path) -> Stamp {
    fs::metadata(path).ok().map(|m| (m.modified().unwrap_or(SystemTime::UNIX_EPOCH), m.len()))
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Loaded {
    pub path: String,
    /// `None` si el archivo no existe o no se pudo leer (se usan los valores por defecto).
    pub value: Option<Value>,
    pub warning: Option<String>,
}

#[derive(Serialize, Clone)]
struct Changed {
    /// Ventana que guardó, o "file" si alguien editó el archivo a mano.
    source: String,
    value: Value,
}

pub fn load_from(path: &Path) -> Loaded {
    let shown = path.display().to_string();
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Loaded { path: shown, value: None, warning: None },
        Err(e) => return Loaded { path: shown, value: None, warning: Some(format!("No se pudo leer: {e}")) },
    };
    // Un BOM al principio (Bloc de notas viejo) no es un error.
    match serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}')) {
        Ok(v @ Value::Object(_)) => Loaded { path: shown, value: Some(v), warning: None },
        Ok(_) => Loaded {
            path: shown,
            value: None,
            warning: Some("settings.json no es un objeto JSON.".into()),
        },
        Err(e) => Loaded {
            path: shown,
            value: None,
            warning: Some(format!(
                "settings.json tiene un error en la línea {}, columna {}.",
                e.line(),
                e.column()
            )),
        },
    }
}

/// Escribe el JSON de forma atómica (archivo temporal + rename). Si el archivo actual existe
/// pero está roto, antes lo copia a `settings.json.bak` para no perder lo que se escribió a mano.
pub fn save_to(path: &Path, value: &Value) -> Result<(), String> {
    if !value.is_object() {
        return Err("La configuración tiene que ser un objeto JSON".into());
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("No se pudo crear {}: {e}", dir.display()))?;
    }
    if path.exists() && load_from(path).warning.is_some() {
        let _ = fs::copy(path, path.with_extension("json.bak"));
    }
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text + "\n").map_err(|e| format!("No se pudo escribir: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("No se pudo reemplazar el archivo: {e}"))
}

pub struct SettingsState {
    path: PathBuf,
    /// Huella de la última versión conocida (escrita por nosotros o ya avisada).
    known: Mutex<Stamp>,
}

impl SettingsState {
    pub fn new(path: PathBuf) -> Self {
        let known = Mutex::new(stamp(&path));
        Self { path, known }
    }

    /// Vigila el archivo y avisa a las ventanas cuando alguien lo edita a mano.
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
                // Un archivo a medio escribir por un editor puede no parsear: se espera a la próxima vuelta.
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
        // Escritura y huella bajo el mismo candado: el vigilante no confunde esto con una edición a mano.
        let mut known = state.known.lock().unwrap();
        save_to(&state.path, &value)?;
        *known = stamp(&state.path);
    }
    app.emit(EVENT, Changed { source: webview.label().to_string(), value }).map_err(|e| e.to_string())
}

/// Abre el archivo con el programa asociado (para editarlo a mano).
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

/// Abre la ventana de configuración (o la trae al frente si ya está abierta).
#[tauri::command]
pub async fn settings_open(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.unminimize();
        return w.set_focus().map_err(|e| e.to_string());
    }
    WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App("index.html".into()))
        .title("Configuración — NovaTerm")
        .inner_size(920.0, 680.0)
        .min_inner_size(640.0, 420.0)
        .background_color(tauri::webview::Color(13, 16, 23, 255))
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// --- Imagen de fondo ----------------------------------------------------------------------------

fn backgrounds_dir() -> PathBuf {
    data_dir().join("fondos")
}

/// Nombre de archivo seguro (sin rutas ni caracteres raros) con extensión de imagen conocida.
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

/// Guarda una copia de la imagen elegida en `%APPDATA%\NovaTerm\fondos` (así sigue andando
/// aunque el original se mueva). Recibe los bytes crudos y el nombre en el header `x-name`.
#[tauri::command]
pub fn background_store(request: tauri::ipc::Request) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Se esperaban los bytes de la imagen".into());
    };
    if bytes.len() > MAX_IMAGE {
        return Err("La imagen pesa más de 25 MB".into());
    }
    let raw = request.headers().get("x-name").and_then(|v| v.to_str().ok()).unwrap_or("fondo.png");
    let name = percent_decode(raw);
    let name = safe_image_name(&name).ok_or("Formato no soportado (png, jpg, webp, gif o bmp)")?;
    let dir = backgrounds_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

/// Lee una imagen de fondo. Solo de la carpeta de fondos: no es un lector de archivos genérico.
#[tauri::command]
pub fn background_read(path: String) -> Result<tauri::ipc::Response, String> {
    let dir = fs::canonicalize(backgrounds_dir()).map_err(|_| "No hay imágenes de fondo guardadas".to_string())?;
    let file = fs::canonicalize(&path).map_err(|_| format!("No existe {path}"))?;
    if !file.starts_with(&dir) {
        return Err("La imagen tiene que estar en la carpeta de fondos de NovaTerm".into());
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
        let d = std::env::temp_dir().join(format!("novaterm-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
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
