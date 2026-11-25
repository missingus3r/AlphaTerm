//! Windows: each window is independent (its tabs and its sessions).

use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

static NEXT: AtomicU32 = AtomicU32::new(1);

/// Opens a new window. It's async because on Windows creating windows from a synchronous
/// command can block the event thread.
#[tauri::command]
pub async fn window_new(app: AppHandle, restore: Option<serde_json::Value>) -> Result<String, String> {
    use tauri::Manager;
    let label = format!("win-{}", NEXT.fetch_add(1, Ordering::SeqCst));
    // When restoring a session, the new window asks for its state as soon as it loads.
    if let Some(v) = restore {
        app.state::<crate::session::SessionState>().set_pending(&label, v);
    }
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("AlphaTerm")
        .inner_size(1100.0, 700.0)
        .min_inner_size(480.0, 300.0)
        // Transparent so that the background (Mica, Acrylic, opacity) is painted by the frontend.
        .transparent(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(label)
}

/// Git branch of a folder (for the tab title).
#[tauri::command]
pub fn git_branch(cwd: String) -> Option<String> {
    crate::procinfo::git_branch(std::path::Path::new(&cwd))
}
