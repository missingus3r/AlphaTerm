//! Sesiones ConPTY. Cada sesión usa tres hilos:
//! - lector: lee la ConPTY de a 64 KB y manda los trozos por un canal acotado;
//! - agrupador: junta los trozos (ver `batcher`) y los manda al frontend por un `Channel` binario;
//! - vigía: espera a que termine el proceso, cierra la pseudoconsola (sin eso ConPTY no da EOF)
//!   y deja el código de salida para que el agrupador lo informe después del último byte.

pub mod batcher;
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

/// Bytes en vuelo antes de frenar al proceso (y desde dónde se lo vuelve a soltar).
const HIGH_WATER: u64 = 2 * 1024 * 1024;
const LOW_WATER: u64 = 512 * 1024;
/// Trozos de hasta 64 KB en cola entre el lector y el agrupador.
const QUEUE_CHUNKS: usize = 32;

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PtyEvent {
    Exit { code: Option<u32> },
}

struct Session {
    /// Ventana dueña de la sesión: al cerrarse esa ventana se matan sus sesiones.
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

    /// Mata las sesiones de una ventana (se recargó la vista o se cerró la ventana).
    pub fn kill_owner(&self, owner: &str) {
        let mine: Vec<_> = self.sessions.lock().unwrap().values().filter(|s| s.owner == owner).cloned().collect();
        for s in mine {
            kill_session(&s);
        }
    }

    /// PID de la shell de todas las sesiones (de todas las ventanas).
    pub fn all_shell_pids(&self) -> Vec<u32> {
        self.sessions.lock().unwrap().values().filter_map(|s| s.pid).collect()
    }

    fn shell_pids(&self, ids: &[u32]) -> Vec<(u32, u32)> {
        let map = self.sessions.lock().unwrap();
        ids.iter().filter_map(|id| Some((*id, map.get(id)?.pid?))).collect()
    }

    fn get(&self, id: u32) -> Result<Arc<Session>, String> {
        self.sessions.lock().unwrap().get(&id).cloned().ok_or_else(|| format!("no existe la sesión {id}"))
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
    /// Build de Windows, para la opción `windowsPty` de xterm.js.
    windows_build: u32,
}

#[tauri::command]
pub fn term_info() -> TermInfo {
    let build = sysinfo::System::kernel_version().ok().and_then(|v| v.parse().ok()).unwrap_or(0);
    TermInfo { profiles: profiles::detect(), default_profile: profiles::DEFAULT_PROFILE.into(), windows_build: build }
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { cols: cols.max(2), rows: rows.max(1), pixel_width: 0, pixel_height: 0 }
}

fn home_dir() -> PathBuf {
    std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\"))
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
            // Variables de la API de control (para que un agente de esta pestaña pueda usarla).
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

/// Lanza una sesión. `on_data` recibe los lotes (devolver `false` corta la sesión) y `on_exit`
/// se llama una sola vez, después del último lote.
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

/// Igual que `spawn`, con variables de entorno extra (por ejemplo, las de un agente).
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
        .ok_or_else(|| format!("perfil desconocido: {profile_id}"))?;
    if !profile.available {
        return Err(format!("{} no está instalado en esta máquina", profile.name));
    }

    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;
    let launch = integration::launch_for(&profile.id, &profile.args);
    let mut cmd = CommandBuilder::new(&profile.command);
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
            // Margen para que ConPTY termine de volcar la última salida antes de cerrarla.
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
            // El vigía casi siempre ya dejó el código; si el lector cortó antes, se espera un poco.
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

/// Mata las sesiones de la ventana que llama. El frontend lo hace al arrancar, para no dejar
/// shells huérfanas si la vista se recargó.
#[tauri::command]
pub fn pty_kill_owned(webview: Webview, state: State<'_, Arc<PtyState>>) {
    state.kill_owner(webview.label());
}

/// Proceso en primer plano de cada sesión pedida (para la heurística del título).
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

    /// Abre una ConPTY real con cmd, escribe un comando y espera la salida y el fin.
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
        // ConPTY arranca preguntando la posición del cursor (ESC[6n) y espera la respuesta;
        // en la app la contesta xterm.js.
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

    #[test]
    fn kill_corta_la_sesion() {
        let state = Arc::new(PtyState::default());
        let (etx, erx) = channel::<Option<u32>>();
        let info = spawn(&state, "test", "cmd", None, 80, 24, |_| true, move |c| etx.send(c).unwrap()).unwrap();
        state.write(info.id, b"[1;1R").unwrap();
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

    /// Throughput de ConPTY + lector + agrupador, sin frontend (ack inmediato).
    /// `cargo test --release bench_conpty -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn bench_conpty() {
        // NOVA_BENCH_CMD cambia el comando (por ejemplo `type archivo.txt`).
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

    /// Lectura cruda de la ConPTY, sin agrupador ni canales: el techo de lo que entrega.
    /// `NOVA_BENCH_CMD="type archivo" cargo test --release bench_raw -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn bench_raw() {
        // NOVA_BENCH_EXE + NOVA_BENCH_ARGS (separados por |) lanza el programa directo; si no,
        // NOVA_BENCH_CMD va por `cmd /c`.
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

    /// Junta salida hasta que aparezca `needle` (o se venza el plazo).
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
        state.write(info.id, b"\x1b[1;1R").unwrap();
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

    #[test]
    fn powershell_emite_marcas_y_codigo() {
        check_shell("powershell", "cmd /c exit 4", 4);
    }

    #[test]
    fn git_bash_emite_marcas_y_codigo() {
        if profiles::detect().iter().any(|p| p.id == "gitbash" && p.available) {
            check_shell("gitbash", "(exit 5)", 5);
        }
    }
}
