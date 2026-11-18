pub mod procinfo;
pub mod pty;
pub mod windows;

use std::sync::Arc;
use tauri::{Manager, WindowEvent};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(pty::PtyState::default()))
        .manage(procinfo::ProcState::default())
        .on_window_event(|window, event| {
            // Al cerrarse una ventana, sus shells mueren con ella (las otras ventanas siguen).
            if let WindowEvent::Destroyed = event {
                window.state::<Arc<pty::PtyState>>().kill_owner(window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            pty::term_info,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_ack,
            pty::pty_kill,
            pty::pty_kill_owned,
            pty::pty_foreground,
            windows::window_new,
            windows::git_branch,
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar NovaTerm");
}
