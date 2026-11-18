pub mod fonts;
pub mod procinfo;
pub mod pty;
pub mod settings;
pub mod windows;

use std::sync::Arc;
use tauri::{Manager, WindowEvent};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(pty::PtyState::default()))
        .manage(procinfo::ProcState::default())
        .manage(settings::SettingsState::new(settings::data_dir().join("settings.json")))
        .setup(|app| {
            settings::SettingsState::watch(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                // Al cerrarse una ventana, sus shells mueren con ella (las otras ventanas siguen).
                window.state::<Arc<pty::PtyState>>().kill_owner(window.label());
                // Si ya no queda ninguna terminal, la configuración no se queda sola abierta.
                let app = window.app_handle();
                let terminals = app
                    .webview_windows()
                    .into_keys()
                    .filter(|l| l != "settings" && l != window.label())
                    .count();
                if terminals == 0 {
                    if let Some(w) = app.get_webview_window("settings") {
                        let _ = w.close();
                    }
                }
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
            settings::settings_load,
            settings::settings_save,
            settings::settings_reveal,
            settings::settings_open,
            settings::background_store,
            settings::background_read,
            fonts::fonts_list,
            fonts::font_file,
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar NovaTerm");
}
