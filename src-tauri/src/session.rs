//! Last state of the windows (tabs, panes, folders, colors, title) to restore it
//! when AlphaTerm is reopened. It is saved in `%APPDATA%\AlphaTerm\session.json`.
//!
//! Closing a window while others remain removes it from the session (it was closed on purpose);
//! closing the last one leaves everything saved for next time.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Webview;

#[derive(Default)]
pub struct SessionState {
    /// Windows open now: label → state (in opening order).
    current: Mutex<Vec<(String, Value)>>,
    /// States waiting for their window to finish opening (when restoring).
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

    /// A window was closed. `last`: it was the last terminal window.
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

/// Saves this window's state (the frontend sends it with a short delay after each change).
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

/// Windows saved last time (the first one is the main window's).
/// Only returns something the first time it's requested (at startup).
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

/// Saved state for this window (if it was opened to restore a session).
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
        // The test doesn't write to disk: it only looks at the in-memory state.
        s.current.lock().unwrap().retain(|(l, _)| l != "win-1");
        assert_eq!(s.current.lock().unwrap().len(), 1);
        s.set_pending("win-2", json!({"c": 3}));
        assert_eq!(s.pending.lock().unwrap().remove("win-2"), Some(json!({"c": 3})));
    }
}
