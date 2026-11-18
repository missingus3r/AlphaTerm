pub mod agents;
pub mod control;
pub mod docker;
pub mod fonts;
pub mod git;
pub mod guardian;
pub mod history;
pub mod llm;
pub mod ports;
pub mod procinfo;
pub mod projects;
pub mod pty;
pub mod session;
pub mod settings;
pub mod sysmon;
pub mod usage;
pub mod windows;

use std::sync::Arc;
use tauri::{Manager, WindowEvent};

/// Momento en que arrancó el proceso (para medir el arranque en frío).
static STARTED: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

/// Marca de tiempo para benchmarks: ms desde que arrancó el proceso. Con ALPHATERM_BENCH=<archivo>
/// se agrega una línea "nombre ms" a ese archivo.
#[tauri::command]
fn bench_mark(webview: tauri::Webview, name: String) -> u128 {
    let ms = STARTED.get().map(|t| t.elapsed().as_millis()).unwrap_or(0);
    if let Ok(path) = std::env::var("ALPHATERM_BENCH") {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, "{} {} {}", webview.label(), name, ms);
        }
    }
    ms
}

pub fn run() {
    STARTED.get_or_init(std::time::Instant::now);
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(pty::PtyState::default()))
        .manage(procinfo::ProcState::default())
        .manage(sysmon::SysState::default())
        .manage(projects::WatchState::default())
        .manage(session::SessionState::default())
        .manage(history::HistoryState::default())
        .manage(guardian::GuardianState::default())
        .manage(control::ControlState::default())
        .manage({
            settings::migrate_from_novaterm();
            settings::SettingsState::new(settings::data_dir().join("settings.json"))
        })
        .setup(|app| {
            settings::SettingsState::watch(app.handle().clone());
            control::start(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                // Al cerrarse una ventana, sus shells mueren con ella (las otras ventanas siguen).
                window.state::<Arc<pty::PtyState>>().kill_owner(window.label());
                projects::unwatch_window(&window.state::<projects::WatchState>(), window.label());
                // Si ya no queda ninguna terminal, la configuración no se queda sola abierta.
                let app = window.app_handle();
                let terminals = app
                    .webview_windows()
                    .into_keys()
                    .filter(|l| l != "settings" && l != window.label())
                    .count();
                if window.label() != "settings" {
                    app.state::<session::SessionState>().window_closed(window.label(), terminals == 0);
                }
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
            agents::agents_detect,
            agents::agents_path_env,
            sysmon::sys_stats,
            sysmon::sys_top,
            usage::usage_get,
            ports::ports_list,
            ports::ports_kill,
            projects::projects_discover,
            projects::fs_list,
            projects::fs_watch,
            projects::fs_open,
            projects::fs_stat,
            projects::fs_head,
            session::session_put,
            history::history_add,
            docker::docker_status,
            docker::docker_desktop,
            docker::docker_containers,
            docker::docker_images,
            docker::docker_action,
            docker::docker_logs,
            docker::docker_start_preset,
            guardian::guardian_answer,
            control::control_respond,
            control::control_config,
            control::control_files,
            llm::llm_summarize,
            bench_mark,
            guardian::guardian_open,
            guardian::guardian_log,
            history::history_search,
            session::session_restore,
            session::session_claim,
            git::git_root,
            git::git_status,
            git::git_count,
            git::git_diff,
            git::git_stage,
            git::git_commit,
            git::git_log,
            git::git_show,
            git::git_branches,
            git::git_switch,
            git::git_remote,
            git::git_clone,
            git::git_init,
            usage::usage_statusline_status,
            usage::usage_statusline_install,
            fonts::font_file,
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar AlphaTerm");
}
