pub mod pty;

use std::sync::Arc;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(pty::PtyState::default()))
        .invoke_handler(tauri::generate_handler![
            pty::term_info,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_ack,
            pty::pty_kill,
            pty::pty_kill_all,
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar NovaTerm");
}
