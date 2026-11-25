//! ConPTY sessions. Each session uses three threads:
//! - reader: reads the ConPTY 64 KB at a time and sends the chunks through a bounded channel;
//! - batcher: merges the chunks (see `batcher`) and sends them to the frontend through a binary `Channel`;
//! - watcher: waits for the process to end, closes the pseudo-console (without that ConPTY gives no EOF)
//!   and leaves the exit code for the batcher to report after the last byte.

pub mod batcher;
pub mod env;
pub mod integration;
pub mod profiles;

use batcher::{BatchConfig, Flow};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::sync_channel;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{State, Webview};

/// Bytes in flight before throttling the process (and the level at which it's resumed).
const HIGH_WATER: u64 = 2 * 1024 * 1024;
const LOW_WATER: u64 = 512 * 1024;
/// Chunks of up to 64 KB queued between the reader and the batcher.
const QUEUE_CHUNKS: usize = 32;

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PtyEvent {
    Exit { code: Option<u32> },
}

struct Session {
    /// Window that owns the session: when that window closes, its sessions are killed.
    owner: String,
    pid: Option<u32>,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    flow: Arc<Flow>,
}

#[derive(Default)]
pub struct PtyState {
    sessions: Mutex<HashMap<u32, Arc<Session>>>,
    next_id: AtomicU32,
}

impl PtyState {
    pub fn write(&self, id: u32, data: &[u8]) -> Result<(), String> {
        let s = self.get(id)?;
        let mut w = s.writer.lock().unwrap();
        w.write_all(data).and_then(|_| w.flush()).map_err(|e| e.to_string())
    }

    /// Kills a window's sessions (the view was reloaded or the window was closed).
    pub fn kill_owner(&self, owner: &str) {
        let mine: Vec<_> = self.sessions.lock().unwrap().values().filter(|s| s.owner == owner).cloned().collect();
        for s in mine {
            kill_session(&s);
        }
    }

    /// PID of the shell of every session (across all windows).
    pub fn all_shell_pids(&self) -> Vec<u32> {
        self.sessions.lock().unwrap().values().filter_map(|s| s.pid).collect()
    }

    fn shell_pids(&self, ids: &[u32]) -> Vec<(u32, u32)> {
        let map = self.sessions.lock().unwrap();
        ids.iter().filter_map(|id| Some((*id, map.get(id)?.pid?))).collect()
    }

    fn get(&self, id: u32) -> Result<Arc<Session>, String> {
        self.sessions.lock().unwrap().get(&id).cloned().ok_or_else(|| tr!("no existe la sesión {id}", "session {id} doesn't exist", "a sessão {id} não existe"))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnInfo {
    id: u32,
    pid: Option<u32>,
    profile: profiles::Profile,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TermInfo {
    profiles: Vec<profiles::Profile>,
    default_profile: String,
    /// Windows build, for xterm.js's `windowsPty` option (0 outside Windows: no ConPTY).
    windows_build: u32,
    /// "windows" or "linux": paths, shells and a few texts change with it.
    os: &'static str,
}

#[tauri::command]
pub fn term_info() -> TermInfo {
    let build = if cfg!(windows) { sysinfo::System::kernel_version().ok().and_then(|v| v.parse().ok()).unwrap_or(0) } else { 0 };
    TermInfo { profiles: profiles::detect(), default_profile: profiles::default_profile(), windows_build: build, os: std::env::consts::OS }
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { cols: cols.max(2), rows: rows.max(1), pixel_width: 0, pixel_height: 0 }
}

fn home_dir() -> PathBuf {
    crate::os::home()
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn pty_spawn(
    webview: Webview,
    state: State<'_, Arc<PtyState>>,
    profile_id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    env: Option<HashMap<String, String>>,
    on_data: Channel<InvokeResponseBody>,
    on_event: Channel<PtyEvent>,
) -> Result<SpawnInfo, String> {
    spawn_env(
        state.inner(),
        webview.label(),
        &profile_id,
        cwd,
        cols,
        rows,
        &{
            // Control API variables (so an agent in this tab can use it).
            use tauri::Manager;
            let mut e = env.unwrap_or_default();
            for (k, v) in webview.app_handle().state::<crate::control::ControlState>().env() {
                e.insert(k, v);
            }
            e
        },
        move |bytes| on_data.send(InvokeResponseBody::Raw(bytes)).is_ok(),
        move |code| {
            let _ = on_event.send(PtyEvent::Exit { code });
        },
    )
}

/// Launches a session. `on_data` receives the batches (returning `false` ends the session) and `on_exit`
/// is called exactly once, after the last batch.
#[allow(clippy::too_many_arguments)]
pub fn spawn(
    state: &Arc<PtyState>,
    owner: &str,
    profile_id: &str,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_data: impl FnMut(Vec<u8>) -> bool + Send + 'static,
    on_exit: impl FnOnce(Option<u32>) + Send + 'static,
) -> Result<SpawnInfo, String> {
    spawn_env(state, owner, profile_id, cwd, cols, rows, &HashMap::new(), on_data, on_exit)
}

/// Same as `spawn`, with extra environment variables (for example, an agent's).
#[allow(clippy::too_many_arguments)]
pub fn spawn_env(
    state: &Arc<PtyState>,
    owner: &str,
    profile_id: &str,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    extra_env: &HashMap<String, String>,
    mut on_data: impl FnMut(Vec<u8>) -> bool + Send + 'static,
    on_exit: impl FnOnce(Option<u32>) + Send + 'static,
) -> Result<SpawnInfo, String> {
    let profile = profiles::detect()
        .into_iter()
        .find(|p| p.id == profile_id)
        .ok_or_else(|| tr!("perfil desconocido: {profile_id}", "unknown profile: {profile_id}", "perfil desconhecido: {profile_id}"))?;
    if !profile.available {
        return Err(tr!("{} no está instalado en esta máquina", "{} isn't installed on this machine", "{} não está instalado nesta máquina"; profile.name));
    }

    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;
    let launch = integration::launch_for(&profile.id, &profile.args);
    let mut cmd = CommandBuilder::new(&profile.command);
    // Without what was inherited from the program that opened AlphaTerm (NO_COLOR, Claude Code flags and tokens…).
    static PERSISTENT: OnceLock<std::collections::HashSet<String>> = OnceLock::new();
    let persistent = PERSISTENT.get_or_init(env::persistent_names);
    for name in env::to_remove(std::env::vars_os().filter_map(|(k, _)| k.into_string().ok()), persistent) {
        cmd.env_remove(name);
    }
    cmd.args(&launch.args);
    for (k, v) in &launch.env {
        cmd.env(k, v);
    }
    let dir = cwd.map(PathBuf::from).filter(|p| p.is_dir()).unwrap_or_else(home_dir);
    cmd.cwd(dir);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "AlphaTerm");
    cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
    cmd.env("ALPHATERM_LANG", crate::i18n::lang().code());
    for (k, v) in extra_env {
        if !k.is_empty() && !k.contains('=') {
            cmd.env(k, v);
        }
    }

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let pid = child.process_id();
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let flow = Arc::new(Flow::new(HIGH_WATER, LOW_WATER));
    let session = Arc::new(Session {
        owner: owner.to_string(),
        pid,
        writer: Mutex::new(writer),
        master: Mutex::new(Some(pair.master)),
        killer: Mutex::new(child.clone_killer()),
        flow: flow.clone(),
    });
    let id = state.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    state.sessions.lock().unwrap().insert(id, session.clone());

    let (tx, rx) = sync_channel::<Vec<u8>>(QUEUE_CHUNKS);
    thread::Builder::new()
        .name(format!("pty{id}-lector"))
        .spawn(move || {
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if tx.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                }
            }
        })
        .map_err(|e| e.to_string())?;

    let exit_code: Arc<OnceLock<Option<u32>>> = Arc::new(OnceLock::new());
    let code_w = exit_code.clone();
    let sess_w = session.clone();
    thread::Builder::new()
        .name(format!("pty{id}-vigia"))
        .spawn(move || {
            let code = child.wait().ok().map(|s| s.exit_code());
            let _ = code_w.set(code);
            // Margin so ConPTY finishes flushing the last output before closing it.
            thread::sleep(Duration::from_millis(60));
            sess_w.master.lock().unwrap().take();
        })
        .map_err(|e| e.to_string())?;

    let state_b = state.clone();
    thread::Builder::new()
        .name(format!("pty{id}-lotes"))
        .spawn(move || {
            batcher::run(rx, BatchConfig::default(), &flow, &mut on_data);
            flow.close();
            // The watcher almost always has already left the code; if the reader ended first, wait a bit.
            for _ in 0..40 {
                if exit_code.get().is_some() {
                    break;
                }
                thread::sleep(Duration::from_millis(50));
            }
            state_b.sessions.lock().unwrap().remove(&id);
            on_exit(exit_code.get().copied().flatten());
        })
        .map_err(|e| e.to_string())?;

    Ok(SpawnInfo { id, pid, profile })
}

#[tauri::command]
pub fn pty_write(state: State<'_, Arc<PtyState>>, id: u32, data: String) -> Result<(), String> {
    state.write(id, data.as_bytes())
}

#[tauri::command]
pub fn pty_resize(state: State<'_, Arc<PtyState>>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let s = state.get(id)?;
    let m = s.master.lock().unwrap();
    match m.as_ref() {
        Some(m) => m.resize(size(cols, rows)).map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[tauri::command]
pub fn pty_ack(state: State<'_, Arc<PtyState>>, id: u32, bytes: u64) {
    if let Ok(s) = state.get(id) {
        s.flow.ack(bytes);
    }
}

fn kill_session(s: &Session) {
    s.flow.close();
    let _ = s.killer.lock().unwrap().kill();
}

#[tauri::command]
pub fn pty_kill(state: State<'_, Arc<PtyState>>, id: u32) {
    if let Ok(s) = state.get(id) {
        kill_session(&s);
    }
}

/// Kills the sessions of the calling window. The frontend does it at startup, so as not to leave
/// orphan shells if the view was reloaded.
#[tauri::command]
pub fn pty_kill_owned(webview: Webview, state: State<'_, Arc<PtyState>>) {
    state.kill_owner(webview.label());
}

/// Foreground process of each requested session (for the title heuristic).
#[tauri::command]
pub fn pty_foreground(
    state: State<'_, Arc<PtyState>>,
    procs: State<'_, crate::procinfo::ProcState>,
    ids: Vec<u32>,
) -> HashMap<u32, Option<crate::procinfo::Foreground>> {
    let pairs = state.shell_pids(&ids);
    let shells: Vec<u32> = pairs.iter().map(|p| p.1).collect();
    let fg = procs.foreground(&shells);
    pairs.into_iter().map(|(id, pid)| (id, fg.get(&pid).cloned().flatten())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;
    use std::time::Instant;

    /// Opens a real ConPTY with cmd, writes a command and waits for the output and the end.
    #[cfg(windows)]
    #[test]
    fn conpty_real_eco_y_salida() {
        let state = Arc::new(PtyState::default());
        let (dtx, drx) = channel::<Vec<u8>>();
        let (etx, erx) = channel::<Option<u32>>();
        let info = spawn(
            &state,
            "test",
            "cmd",
            None,
            80,
            24,
            move |b| dtx.send(b).is_ok(),
            move |c| etx.send(c).unwrap(),
        )
        .expect("spawn");
        assert!(info.pid.is_some());
        // ConPTY starts by asking for the cursor position (ESC[6n) and waits for the reply;
        // in the app xterm.js answers it.
        state.write(info.id, b"[1;1R").unwrap();
        state.write(info.id, b"echo NOVA_%COMSPEC:~0,1%_OK\r").unwrap();
        state.write(info.id, b"exit 7\r").unwrap();
        let code = match erx.recv_timeout(Duration::from_secs(15)) {
            Ok(c) => c,
            Err(_) => {
                let out: Vec<u8> = drx.try_iter().flatten().collect();
                panic!("la sesión no terminó; salida: {:?}", String::from_utf8_lossy(&out));
            }
        };
        assert_eq!(code, Some(7));
        let out: Vec<u8> = drx.try_iter().flatten().collect();
        let text = String::from_utf8_lossy(&out);
        assert!(text.contains("NOVA_C_OK"), "salida: {text}");
        assert!(state.sessions.lock().unwrap().is_empty(), "la sesión quedó registrada");
    }

    /// Linux: a real PTY with bash, a command and its output, and the exit code at the end.
    #[cfg(not(windows))]
    #[test]
    fn pty_real_eco_y_salida() {
        let state = Arc::new(PtyState::default());
        let (dtx, drx) = channel::<Vec<u8>>();
        let (etx, erx) = channel::<Option<u32>>();
        let info = spawn(&state, "test", "bash", None, 80, 24, move |b| dtx.send(b).is_ok(), move |c| etx.send(c).unwrap()).expect("spawn");
        assert!(info.pid.is_some());
        assert!(info.profile.available);
        state.write(info.id, b"echo NOVA_$((40+2))_OK; [ \"$TERM_PROGRAM\" = AlphaTerm ] && echo PROG_OK\r").unwrap();
        state.write(info.id, b"exit 7\r").unwrap();
        let code = match erx.recv_timeout(Duration::from_secs(15)) {
            Ok(c) => c,
            Err(_) => {
                let out: Vec<u8> = drx.try_iter().flatten().collect();
                panic!("la sesión no terminó; salida: {:?}", String::from_utf8_lossy(&out));
            }
        };
        assert_eq!(code, Some(7));
        let out: Vec<u8> = drx.try_iter().flatten().collect();
        let text = String::from_utf8_lossy(&out);
        assert!(text.contains("NOVA_42_OK") && text.contains("PROG_OK"), "salida: {text}");
        assert!(state.sessions.lock().unwrap().is_empty(), "la sesión quedó registrada");
    }

    #[test]
    fn kill_corta_la_sesion() {
        let state = Arc::new(PtyState::default());
        let (etx, erx) = channel::<Option<u32>>();
        let shell = if cfg!(windows) { "cmd" } else { "bash" };
        let info = spawn(&state, "test", shell, None, 80, 24, |_| true, move |c| etx.send(c).unwrap()).unwrap();
        if cfg!(windows) {
            state.write(info.id, b"\x1b[1;1R").unwrap();
        }
        let t = Instant::now();
        state.get(info.id).map(|s| kill_session(&s)).unwrap();
        erx.recv_timeout(Duration::from_secs(10)).expect("kill no terminó la sesión");
        assert!(t.elapsed() < Duration::from_secs(5));
    }
}

#[cfg(test)]
mod bench {
    use super::*;
    use std::sync::atomic::AtomicU64;
    use std::sync::mpsc::channel;
    use std::time::Instant;

    /// ConPTY + reader + batcher throughput, without the frontend (immediate ack).
    /// `cargo test --release bench_conpty -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn bench_conpty() {
        // NOVA_BENCH_CMD changes the command (for example `type archivo.txt`).
        let cmdline = std::env::var("NOVA_BENCH_CMD")
            .unwrap_or_else(|_| r#""C:\Program Files\Git\usr\bin\seq.exe" 1 300000"#.into());
        let state = Arc::new(PtyState::default());
        let bytes = Arc::new(AtomicU64::new(0));
        let lotes = Arc::new(AtomicU64::new(0));
        let (b2, l2) = (bytes.clone(), lotes.clone());
        let st2 = state.clone();
        let (etx, erx) = channel::<Option<u32>>();
        let id_cell: Arc<OnceLock<u32>> = Arc::new(OnceLock::new());
        let id2 = id_cell.clone();
        let info = spawn(
            &state,
            "test",
            "cmd",
            None,
            200,
            50,
            move |b| {
                b2.fetch_add(b.len() as u64, Ordering::Relaxed);
                l2.fetch_add(1, Ordering::Relaxed);
                if let Some(id) = id2.get() {
                    if let Ok(s) = st2.get(*id) {
                        s.flow.ack(b.len() as u64);
                    }
                }
                true
            },
            move |c| etx.send(c).unwrap(),
        )
        .unwrap();
        id_cell.set(info.id).unwrap();
        state.write(info.id, b"\x1b[1;1R").unwrap();
        std::thread::sleep(Duration::from_millis(500));
        let b0 = bytes.load(Ordering::Relaxed);
        let t = Instant::now();
        state.write(info.id, format!("{cmdline} & exit\r").as_bytes()).unwrap();
        erx.recv_timeout(Duration::from_secs(300)).unwrap();
        let secs = t.elapsed().as_secs_f64();
        let n = bytes.load(Ordering::Relaxed) - b0;
        println!(
            "ConPTY: {:.1} MB en {:.2} s = {:.2} MB/s, {} lotes",
            n as f64 / 1e6,
            secs,
            n as f64 / 1e6 / secs,
            lotes.load(Ordering::Relaxed)
        );
    }
}

#[cfg(test)]
mod bench_raw {
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::io::{Read, Write};
    use std::time::{Duration, Instant};

    /// Raw ConPTY read, without batcher or channels: the ceiling of what it delivers.
    /// `NOVA_BENCH_CMD="type archivo" cargo test --release bench_raw -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn bench_raw() {
        // NOVA_BENCH_EXE + NOVA_BENCH_ARGS (separated by |) launches the program directly; otherwise,
        // NOVA_BENCH_CMD goes through `cmd /c`.
        let pair = native_pty_system()
            .openpty(PtySize { rows: 50, cols: 200, pixel_width: 0, pixel_height: 0 })
            .unwrap();
        let cmd = match std::env::var("NOVA_BENCH_EXE") {
            Ok(exe) => {
                let mut c = CommandBuilder::new(exe);
                let args = std::env::var("NOVA_BENCH_ARGS").unwrap_or_default();
                c.args(args.split('|').filter(|a| !a.is_empty()));
                c
            }
            Err(_) => {
                let mut c = CommandBuilder::new("cmd.exe");
                c.args(["/c", &std::env::var("NOVA_BENCH_CMD").expect("NOVA_BENCH_CMD")]);
                c
            }
        };
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        writer.write_all(b"\x1b[1;1R").unwrap();
        let t = Instant::now();
        let h = std::thread::spawn(move || {
            let mut buf = vec![0u8; 64 * 1024];
            let (mut n, mut reads) = (0u64, 0u64);
            while let Ok(k) = reader.read(&mut buf) {
                if k == 0 {
                    break;
                }
                n += k as u64;
                reads += 1;
            }
            (n, reads)
        });
        child.wait().unwrap();
        let secs = t.elapsed().as_secs_f64();
        std::thread::sleep(Duration::from_millis(100));
        drop(pair.master);
        let (n, reads) = h.join().unwrap();
        println!("crudo: {:.1} MB en {:.2} s = {:.2} MB/s, {} lecturas", n as f64 / 1e6, secs, n as f64 / 1e6 / secs, reads);
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use std::sync::mpsc::{channel, Receiver};
    use std::time::Instant;

    /// Collects output until `needle` appears (or the deadline expires).
    fn wait_for(rx: &Receiver<Vec<u8>>, acc: &mut String, needle: &str, secs: u64) -> bool {
        let end = Instant::now() + Duration::from_secs(secs);
        while !acc.contains(needle) {
            let left = end.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return false;
            }
            if let Ok(b) = rx.recv_timeout(left) {
                acc.push_str(&String::from_utf8_lossy(&b));
            }
        }
        true
    }

    fn check_shell(profile: &str, failing: &str, code: u32) {
        let state = Arc::new(PtyState::default());
        let (tx, rx) = channel::<Vec<u8>>();
        let info = spawn(&state, "test", profile, None, 120, 30, move |b| tx.send(b).is_ok(), |_| {}).unwrap();
        // ConPTY asks for the cursor position at startup (xterm.js answers it in the app); a Unix PTY doesn't.
        if cfg!(windows) {
            state.write(info.id, b"\x1b[1;1R").unwrap();
        }
        let mut out = String::new();
        assert!(wait_for(&rx, &mut out, "\x1b]133;B", 30), "{profile}: no llegó el fin del prompt: {out:?}");
        assert!(out.contains("\x1b]7;file://") || out.contains("\x1b]9;9;"), "{profile}: sin carpeta: {out:?}");
        state.write(info.id, format!("{failing}\r").as_bytes()).unwrap();
        let end = format!("\x1b]133;D;{code}");
        assert!(wait_for(&rx, &mut out, &end, 30), "{profile}: no llegó {end:?}: {out:?}");
        assert!(out.contains("\x1b]633;E;"), "{profile}: sin texto del comando: {out:?}");
        assert!(out.contains("\x1b]133;C"), "{profile}: sin inicio de comando");
        state.write(info.id, b"exit\r").unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn powershell_emite_marcas_y_codigo() {
        check_shell("powershell", "cmd /c exit 4", 4);
    }

    /// Waits for a complete OSC that starts with `prefix` and returns what's between the prefix and the BEL.
    fn wait_osc(rx: &Receiver<Vec<u8>>, acc: &mut String, from: usize, prefix: &str, secs: u64) -> Option<String> {
        let end = Instant::now() + Duration::from_secs(secs);
        loop {
            if let Some(i) = acc[from..].find(prefix).map(|i| i + from + prefix.len()) {
                if let Some(j) = acc[i..].find('\x07') {
                    return Some(acc[i..i + j].to_string());
                }
            }
            let left = end.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return None;
            }
            if let Ok(b) = rx.recv_timeout(left) {
                acc.push_str(&String::from_utf8_lossy(&b));
            }
        }
    }

    #[cfg(windows)]
    fn completions(payload: &str) -> serde_json::Value {
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD.decode(payload.trim()).expect("base64");
        serde_json::from_slice(&bytes).expect("json")
    }

    /// Risk 1 of the command suggestions design: the hidden shortcut (F12,e) reaches PSReadLine through
    /// the ConPTY, runs TabExpansion2 and the reply comes back as an OSC 7717 without touching the buffer.
    #[cfg(windows)]
    #[test]
    fn powershell_completa_con_f12() {
        let dir = std::env::temp_dir().join("alphaterm-f12");
        std::fs::create_dir_all(dir.join("CarpetaUno")).unwrap();
        let state = Arc::new(PtyState::default());
        let (tx, rx) = channel::<Vec<u8>>();
        let mut env = HashMap::new();
        env.insert("ALPHATERM_NONCE".to_string(), "abc123".to_string());
        let info = spawn_env(&state, "test", "powershell", Some(dir.to_string_lossy().into_owned()), 120, 30, &env, move |b| tx.send(b).is_ok(), |_| {}).unwrap();
        state.write(info.id, b"\x1b[1;1R").unwrap();
        let mut out = String::new();
        assert!(wait_for(&rx, &mut out, "\x1b]7717;ready;abc123", 30), "sin aviso de listo: {out:?}");
        assert!(wait_for(&rx, &mut out, "\x1b]133;B", 30), "sin fin de prompt: {out:?}");

        let from = out.len();
        state.write(info.id, b"Get-ChildIt\x1b[24~e").unwrap();
        let p = wait_osc(&rx, &mut out, from, "\x1b]7717;c;abc123;", 30).unwrap_or_else(|| panic!("sin completados: {out:?}"));
        let v = completions(&p);
        assert_eq!(v["b"], "Get-ChildIt");
        assert_eq!(v["c"], 11);
        assert_eq!(v["i"], 0);
        let texts: Vec<&str> = v["r"].as_array().unwrap().iter().filter_map(|r| r["t"].as_str()).collect();
        assert!(texts.contains(&"Get-ChildItem"), "{texts:?}");

        // What was typed is erased (11 backspaces) and the folders are requested for `cd `.
        let from = out.len();
        state.write(info.id, &[b"\x7f".repeat(11), b"cd \x1b[24~e".to_vec()].concat()).unwrap();
        let p = wait_osc(&rx, &mut out, from, "\x1b]7717;c;abc123;", 30).unwrap_or_else(|| panic!("sin completados de cd: {out:?}"));
        let v = completions(&p);
        assert_eq!(v["b"], "cd ");
        let dirs: Vec<&str> =
            v["r"].as_array().unwrap().iter().filter(|r| r["k"] == "ProviderContainer").filter_map(|r| r["t"].as_str()).collect();
        assert!(dirs.iter().any(|d| d.contains("CarpetaUno")), "{v}");

        // The nonce doesn't stay in the session's environment (nor in anything launched from it).
        state.write(info.id, &[b"\x7f".repeat(3), b"Write-Output \"N=[$env:ALPHATERM_NONCE]\"\r".to_vec()].concat()).unwrap();
        assert!(wait_for(&rx, &mut out, "N=[]", 30), "el nonce sigue en el entorno: {out:?}");
        state.write(info.id, b"exit\r").unwrap();
    }

    #[test]
    fn git_bash_emite_marcas_y_codigo() {
        if profiles::detect().iter().any(|p| p.id == "gitbash" && p.available) {
            check_shell("gitbash", "(exit 5)", 5);
        }
    }

    /// Linux shells: prompt marks, folder (OSC 7 with an absolute path, no doubled slash),
    /// command text and exit code. zsh and fish are tested only if they are installed.
    #[cfg(not(windows))]
    #[test]
    fn shells_de_linux_emiten_marcas_y_codigo() {
        check_shell("bash", "(exit 5)", 5);
        for (p, fail, code) in [("zsh", "(exit 6)", 6), ("fish", "false", 1)] {
            if profiles::detect().iter().any(|x| x.id == p && x.available) {
                check_shell(p, fail, code);
            }
        }
    }

    #[cfg(not(windows))]
    #[test]
    fn osc7_con_ruta_absoluta() {
        let dir = std::env::temp_dir().join(format!("alphaterm osc7 {}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for p in ["bash", "zsh", "fish"] {
            if !profiles::detect().iter().any(|x| x.id == p && x.available) {
                continue;
            }
            let state = Arc::new(PtyState::default());
            let (tx, rx) = channel::<Vec<u8>>();
            let info = spawn(&state, "test", p, Some(dir.to_string_lossy().into_owned()), 120, 30, move |b| tx.send(b).is_ok(), |_| {}).unwrap();
            let mut out = String::new();
            let osc = wait_osc(&rx, &mut out, 0, "\x1b]7;file://", 30).unwrap_or_else(|| panic!("{p}: sin OSC 7: {out:?}"));
            let path = &osc[osc.find('/').expect("host/ruta")..];
            assert_eq!(path, dir.to_string_lossy().replace(' ', "%20"), "{p}");
            state.write(info.id, b"exit\r").unwrap();
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
