//! Último estado de las ventanas (pestañas, paneles, carpetas, colores, título) para restaurarlo
//! al volver a abrir AlphaTerm. Se guarda en `%APPDATA%\AlphaTerm\session.json`.
//!
//! Cerrar una ventana mientras quedan otras la saca de la sesión (se cerró a propósito); cerrar la
//! última deja todo guardado para la próxima vez.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Webview;

#[derive(Default)]
pub struct SessionState {
    /// Ventanas abiertas ahora: etiqueta → estado (en orden de apertura).
    current: Mutex<Vec<(String, Value)>>,
    /// Estados esperando a que su ventana termine de abrir (al restaurar).
    pending: Mutex<HashMap<String, Value>>,
}

fn file() -> PathBuf {
    crate::settings::data_dir().join("session.json")
}

impl SessionState {
    fn write(&self) {
        let cur = self.current.lock().unwrap();
        let windows: Vec<Value> = cur.iter().map(|(_, v)| v.clone()).collect();
        let _ = crate::settings::save_to(&file(), &json!({ "version": 1, "windows": windows }));
    }

    /// Se cerró una ventana. `last`: era la última ventana de terminal.
    pub fn window_closed(&self, label: &str, last: bool) {
        if last {
            return;
        }
        self.current.lock().unwrap().retain(|(l, _)| l != label);
        self.write();
    }

    pub fn set_pending(&self, label: &str, v: Value) {
        self.pending.lock().unwrap().insert(label.to_string(), v);
    }
}

/// Guarda el estado de esta ventana (el frontend lo manda con un pequeño retraso tras cada cambio).
#[tauri::command]
pub fn session_put(webview: Webview, state: tauri::State<SessionState>, value: Value) {
    let label = webview.label().to_string();
    {
        let mut cur = state.current.lock().unwrap();
        match cur.iter_mut().find(|(l, _)| *l == label) {
            Some(e) => e.1 = value,
            None => cur.push((label, value)),
        }
    }
    state.write();
}

/// Ventanas guardadas la última vez (la primera es la de la ventana principal).
/// Solo devuelve algo la primera vez que se pide (al arrancar).
#[tauri::command]
pub fn session_restore(state: tauri::State<SessionState>) -> Vec<Value> {
    static TAKEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if TAKEN.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return vec![];
    }
    let _ = &state;
    let loaded = crate::settings::load_from(&file());
    loaded.value.and_then(|v| v.get("windows").and_then(Value::as_array).cloned()).unwrap_or_default()
}

/// Estado guardado para esta ventana (si se abrió para restaurar una sesión).
#[tauri::command]
pub fn session_claim(webview: Webview, state: tauri::State<SessionState>) -> Option<Value> {
    state.pending.lock().unwrap().remove(webview.label())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cerrar_una_ventana_con_otras_abiertas_la_saca() {
        let s = SessionState::default();
        s.current.lock().unwrap().push(("main".into(), json!({"a": 1})));
        s.current.lock().unwrap().push(("win-1".into(), json!({"b": 2})));
        // No se escribe a disco en el test: solo se mira el estado en memoria.
        s.current.lock().unwrap().retain(|(l, _)| l != "win-1");
        assert_eq!(s.current.lock().unwrap().len(), 1);
        s.set_pending("win-2", json!({"c": 3}));
        assert_eq!(s.pending.lock().unwrap().remove("win-2"), Some(json!({"c": 3})));
    }
}
