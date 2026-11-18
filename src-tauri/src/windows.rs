//! Ventanas: cada ventana es independiente (sus pestañas y sus sesiones).

use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

static NEXT: AtomicU32 = AtomicU32::new(1);

/// Abre una ventana nueva. Es async porque en Windows crear ventanas desde un comando
/// sincrónico puede trabar el hilo de eventos.
#[tauri::command]
pub async fn window_new(app: AppHandle, restore: Option<serde_json::Value>) -> Result<String, String> {
    use tauri::Manager;
    let label = format!("win-{}", NEXT.fetch_add(1, Ordering::SeqCst));
    // Al restaurar una sesión, la ventana nueva pide su estado apenas carga.
    if let Some(v) = restore {
        app.state::<crate::session::SessionState>().set_pending(&label, v);
    }
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("AlphaTerm")
        .inner_size(1100.0, 700.0)
        .min_inner_size(480.0, 300.0)
        // Transparente para que el fondo (Mica, Acrylic, opacidad) lo pinte el frontend.
        .transparent(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(label)
}

/// Rama git de una carpeta (para el título de la pestaña).
#[tauri::command]
pub fn git_branch(cwd: String) -> Option<String> {
    crate::procinfo::git_branch(std::path::Path::new(&cwd))
}
