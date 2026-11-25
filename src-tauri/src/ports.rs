//! Listening TCP ports: who opened them, from where and how long ago. Stop (process tree).

use serde::Serialize;
use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Listen {
    pub port: u16,
    pub addr: String,
    pub pid: u32,
}

/// Reads the table of listening sockets (IPv4 and IPv6) with the owning PID.
#[cfg(windows)]
pub fn listening() -> Vec<Listen> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCP6ROW_OWNER_PID, MIB_TCPROW_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER,
    };
    const AF_INET: u32 = 2;
    const AF_INET6: u32 = 23;

    fn table(af: u32) -> Vec<u8> {
        let mut size: u32 = 0;
        unsafe { GetExtendedTcpTable(std::ptr::null_mut(), &mut size, 0, af, TCP_TABLE_OWNER_PID_LISTENER, 0) };
        for _ in 0..4 {
            let mut buf = vec![0u8; size as usize + 1024];
            let mut len = buf.len() as u32;
            let r = unsafe { GetExtendedTcpTable(buf.as_mut_ptr().cast(), &mut len, 0, af, TCP_TABLE_OWNER_PID_LISTENER, 0) };
            if r == 0 {
                return buf;
            }
            size = len; // the table grew between calls: retry
        }
        Vec::new()
    }

    let port = |p: u32| u16::from_be(p as u16);
    let mut out = Vec::new();
    let v4 = table(AF_INET);
    if v4.len() >= 4 {
        let n = u32::from_ne_bytes(v4[0..4].try_into().unwrap()) as usize;
        let rows = unsafe { std::slice::from_raw_parts(v4.as_ptr().add(4).cast::<MIB_TCPROW_OWNER_PID>(), n) };
        for r in rows {
            let a = r.dwLocalAddr.to_ne_bytes();
            out.push(Listen { port: port(r.dwLocalPort), addr: format!("{}.{}.{}.{}", a[0], a[1], a[2], a[3]), pid: r.dwOwningPid });
        }
    }
    let v6 = table(AF_INET6);
    if v6.len() >= 4 {
        let n = u32::from_ne_bytes(v6[0..4].try_into().unwrap()) as usize;
        let rows = unsafe { std::slice::from_raw_parts(v6.as_ptr().add(4).cast::<MIB_TCP6ROW_OWNER_PID>(), n) };
        for r in rows {
            let addr = std::net::Ipv6Addr::from(r.ucLocalAddr);
            out.push(Listen { port: port(r.dwLocalPort), addr: format!("[{addr}]"), pid: r.dwOwningPid });
        }
    }
    out
}

/// Linux: the LISTEN sockets of `/proc/net/tcp` and `tcp6`; the owner is found by the socket inode
/// among the `fd`s of each process. Those of other users (root's sshd, cups…) can't be read without
/// privileges: they stay with PID 0 and are shown as system ones.
#[cfg(not(windows))]
pub fn listening() -> Vec<Listen> {
    let mut socks = Vec::new();
    for (file, v6) in [("/proc/net/tcp", false), ("/proc/net/tcp6", true)] {
        if let Ok(text) = std::fs::read_to_string(file) {
            socks.extend(parse_proc_net_tcp(&text, v6));
        }
    }
    if socks.is_empty() {
        return Vec::new();
    }
    let wanted: std::collections::HashSet<u64> = socks.iter().map(|s| s.2).collect();
    let mut owner: HashMap<u64, u32> = HashMap::new();
    if let Ok(rd) = std::fs::read_dir("/proc") {
        for e in rd.flatten() {
            let Some(pid) = e.file_name().to_str().and_then(|n| n.parse::<u32>().ok()) else { continue };
            let Ok(fds) = std::fs::read_dir(e.path().join("fd")) else { continue };
            for fd in fds.flatten() {
                let Ok(target) = std::fs::read_link(fd.path()) else { continue };
                let t = target.to_string_lossy();
                if let Some(inode) = t.strip_prefix("socket:[").and_then(|r| r.strip_suffix(']')).and_then(|n| n.parse::<u64>().ok()) {
                    if wanted.contains(&inode) {
                        owner.entry(inode).or_insert(pid);
                    }
                }
            }
        }
    }
    socks.into_iter().map(|(port, addr, inode)| Listen { port, addr, pid: owner.get(&inode).copied().unwrap_or(0) }).collect()
}

/// Lines of `/proc/net/tcp[6]` in LISTEN state (`0A`) → (port, address, socket inode).
/// Addresses are hexadecimal in the kernel's byte order: groups of 4 bytes, each one little-endian.
#[cfg_attr(windows, allow(dead_code))]
pub fn parse_proc_net_tcp(text: &str, v6: bool) -> Vec<(u16, String, u64)> {
    text.lines()
        .skip(1)
        .filter_map(|l| {
            let f: Vec<&str> = l.split_whitespace().collect();
            if f.len() < 10 || f[3] != "0A" {
                return None;
            }
            let (addr_hex, port_hex) = f[1].split_once(':')?;
            let port = u16::from_str_radix(port_hex, 16).ok()?;
            let mut bytes = Vec::new();
            for chunk in addr_hex.as_bytes().chunks(8) {
                let word = u32::from_str_radix(std::str::from_utf8(chunk).ok()?, 16).ok()?;
                bytes.extend_from_slice(&word.to_le_bytes());
            }
            let addr = if v6 {
                let b: [u8; 16] = bytes.try_into().ok()?;
                let ip = std::net::Ipv6Addr::from(b);
                // A v4 address listened on through IPv6 ("::ffff:127.0.0.1") is shown as v4.
                match ip.to_ipv4_mapped() {
                    Some(v4) => v4.to_string(),
                    None => format!("[{ip}]"),
                }
            } else {
                let b: [u8; 4] = bytes.try_into().ok()?;
                std::net::Ipv4Addr::from(b).to_string()
            };
            Some((port, addr, f[9].parse().ok()?))
        })
        .collect()
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub pid: u32,
    pub name: String,
    pub ports: Vec<u16>,
    /// Addresses it listens on ("0.0.0.0", "127.0.0.1", "[::]"…).
    pub addrs: Vec<String>,
    pub cmdline: String,
    pub cwd: Option<String>,
    /// Seconds since it started.
    pub uptime: u64,
    /// PID of the AlphaTerm shell it descends from (if it was born in a tab).
    pub shell_pid: Option<u32>,
    /// System process (better not to touch it).
    pub system: bool,
}

const SYSTEM_NAMES: &[&str] = &[
    "system", "svchost.exe", "lsass.exe", "wininit.exe", "services.exe", "spoolsv.exe", "smss.exe", "csrss.exe",
    "winlogon.exe", "dashost.exe", "searchindexer.exe", "msmpeng.exe", "nissrv.exe", "jhi_service.exe",
    // Linux (only if they belong to the user; root's ones already come as PID 0).
    "systemd", "systemd-resolved", "sshd", "cupsd", "avahi-daemon", "dnsmasq", "gnome-shell", "gsd-sharing", "kdeconnectd",
];

/// Groups by process and looks for which shell each one descends from.
pub fn group(listens: &[Listen], parents: &HashMap<u32, Option<u32>>, shells: &[u32]) -> Vec<(u32, Vec<u16>, Vec<String>, Option<u32>)> {
    let mut by_pid: HashMap<u32, (BTreeSet<u16>, BTreeSet<String>)> = HashMap::new();
    for l in listens {
        let e = by_pid.entry(l.pid).or_default();
        e.0.insert(l.port);
        e.1.insert(l.addr.clone());
    }
    let shell_of = |mut pid: u32| -> Option<u32> {
        for _ in 0..64 {
            if shells.contains(&pid) {
                return Some(pid);
            }
            pid = (*parents.get(&pid)?)?;
        }
        None
    };
    let mut out: Vec<(u32, Vec<u16>, Vec<String>, Option<u32>)> = by_pid.into_iter().map(|(pid, (p, a))| (pid, p.into_iter().collect(), a.into_iter().collect(), shell_of(pid))).collect();
    out.sort_by_key(|(_, ports, _, _)| ports.first().copied().unwrap_or(0));
    out
}

#[tauri::command]
pub async fn ports_list(state: tauri::State<'_, Arc<crate::pty::PtyState>>) -> Result<Vec<Server>, String> {
    let shells = state.all_shell_pids();
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<Server>, String> {
        let listens = listening();
        let mut sys = System::new().map_err(|e| e.to_string())?;
        sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always).with_cwd(UpdateKind::Always),
        );
        let parents: HashMap<u32, Option<u32>> = sys.processes().iter().filter(|(_, pr)| !crate::procinfo::is_thread(pr)).map(|(p, pr)| (p.as_u32(), pr.parent().map(Pid::as_u32))).collect();
        Ok(group(&listens, &parents, &shells)
            .into_iter()
            .map(|(pid, ports, addrs, shell_pid)| {
                let p = sys.process(Pid::from_u32(pid));
                let name = p.map(|p| p.name().to_string_lossy().into_owned()).unwrap_or_else(|| {
                    if pid == 4 || pid == 0 {
                        crate::i18n::tr("Sistema", "System", "Sistema").into()
                    } else {
                        format!("PID {pid}")
                    }
                });
                let cmdline = p
                    .map(|p| p.cmd().iter().map(|s| s.to_string_lossy()).collect::<Vec<_>>().join(" "))
                    .unwrap_or_default();
                Server {
                    pid,
                    system: pid <= 4 || SYSTEM_NAMES.contains(&name.to_lowercase().as_str()),
                    name,
                    ports,
                    addrs,
                    cmdline,
                    cwd: p.and_then(|p| p.cwd()).map(|c| c.display().to_string()).filter(|c| !c.is_empty()),
                    uptime: p.map(|p| p.run_time()).unwrap_or(0),
                    shell_pid,
                }
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stops a process and everything hanging from it (taskkill /T /F).
#[tauri::command]
pub async fn ports_kill(pid: u32) -> Result<String, String> {
    if pid <= 4 || pid == std::process::id() {
        return Err(crate::i18n::tr("Ese proceso no se puede detener desde acá.", "That process can't be stopped from here.", "Esse processo não pode ser encerrado daqui.").into());
    }
    #[cfg(not(windows))]
    return tauri::async_runtime::spawn_blocking(move || kill_tree(pid)).await.map_err(|e| e.to_string())?;
    #[cfg(windows)]
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new("taskkill");
        cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        let out = cmd.output().map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&out.stdout).trim().to_string() + String::from_utf8_lossy(&out.stderr).trim();
        if out.status.success() {
            Ok(text)
        } else {
            Err(if text.is_empty() { tr!("taskkill terminó con {}", "taskkill exited with {}", "taskkill terminou com {}"; out.status) } else { text })
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Linux: SIGTERM to the process and all its descendants (children first); whatever is still alive
/// after 2 s gets SIGKILL, like `taskkill /T /F`.
#[cfg(not(windows))]
fn kill_tree(pid: u32) -> Result<String, String> {
    use sysinfo::Signal;
    let mut sys = System::new().map_err(|e| e.to_string())?;
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    if sys.process(Pid::from_u32(pid)).is_none() {
        return Err(tr!("No existe el proceso {pid}", "Process {pid} doesn't exist", "O processo {pid} não existe"));
    }
    let parents: HashMap<u32, Option<u32>> = sys.processes().iter().filter(|(_, pr)| !crate::procinfo::is_thread(pr)).map(|(p, pr)| (p.as_u32(), pr.parent().map(Pid::as_u32))).collect();
    let tree = descendants(pid, &parents);
    let mut denied = false;
    for p in tree.iter().rev() {
        if let Some(proc_) = sys.process(Pid::from_u32(*p)) {
            if proc_.kill_with(Signal::Term) == Some(false) {
                denied |= *p == pid;
            }
        }
    }
    if denied {
        return Err(tr!("No hay permiso para detener el proceso {pid}", "No permission to stop process {pid}", "Sem permissão para encerrar o processo {pid}"));
    }
    let end = std::time::Instant::now() + std::time::Duration::from_secs(2);
    loop {
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
        let alive: Vec<u32> = tree.iter().copied().filter(|p| sys.process(Pid::from_u32(*p)).is_some_and(|x| x.status() != sysinfo::ProcessStatus::Zombie)).collect();
        if alive.is_empty() {
            break;
        }
        if std::time::Instant::now() > end {
            for p in alive {
                if let Some(x) = sys.process(Pid::from_u32(p)) {
                    x.kill_with(Signal::Kill);
                }
            }
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    Ok(tr!("Se detuvo el proceso {pid} ({} en total)", "Process {pid} was stopped ({} in total)", "O processo {pid} foi encerrado ({} no total)"; tree.len()))
}

/// The process and everything that hangs from it, parents before children.
#[cfg_attr(windows, allow(dead_code))]
pub fn descendants(pid: u32, parents: &HashMap<u32, Option<u32>>) -> Vec<u32> {
    let mut out = vec![pid];
    let mut i = 0;
    while i < out.len() {
        let cur = out[i];
        let mut kids: Vec<u32> = parents.iter().filter(|(_, par)| **par == Some(cur)).map(|(k, _)| *k).filter(|k| !out.contains(k)).collect();
        kids.sort();
        out.extend(kids);
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agrupa_y_encuentra_la_shell() {
        let l = |port, pid, addr: &str| Listen { port, pid, addr: addr.into() };
        let listens = vec![l(5173, 30, "127.0.0.1"), l(5173, 30, "[::1]"), l(24678, 30, "127.0.0.1"), l(135, 900, "0.0.0.0")];
        // 10 = AlphaTerm shell → 20 (npm) → 30 (node)
        let parents: HashMap<u32, Option<u32>> = [(10, Some(1)), (20, Some(10)), (30, Some(20)), (900, Some(5))].into_iter().collect();
        let g = group(&listens, &parents, &[10]);
        assert_eq!(g[0], (900, vec![135], vec!["0.0.0.0".to_string()], None));
        assert_eq!(g[1], (30, vec![5173, 24678], vec!["127.0.0.1".to_string(), "[::1]".to_string()], Some(10)));
    }

    #[test]
    fn lee_proc_net_tcp() {
        let v4 = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n\
                     0: 0100007F:927D 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 127379 1 0\n\
                     1: 0100007F:927D 0100007F:B000 01 00000000:00000000 00:00000000 00000000  1000        0 5555 1 0\n\
                     2: 00000000:1435 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 42 1 0\n";
        assert_eq!(parse_proc_net_tcp(v4, false), vec![(37501, "127.0.0.1".to_string(), 127379), (5173, "0.0.0.0".to_string(), 42)]);
        let v6 = "  sl  local_address                         remote_address                        st\n\
                     0: 00000000000000000000000001000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 77 1 0\n\
                     1: 0000000000000000FFFF00000100007F:0050 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 78 1 0\n\
                     2: 00000000000000000000000000000000:0016 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  0        0 79 1 0\n";
        assert_eq!(
            parse_proc_net_tcp(v6, true),
            vec![(8080, "[::1]".to_string(), 77), (80, "127.0.0.1".to_string(), 78), (22, "[::]".to_string(), 79)]
        );
    }

    #[test]
    fn arbol_de_procesos() {
        let parents: HashMap<u32, Option<u32>> = [(10, Some(1)), (20, Some(10)), (30, Some(20)), (31, Some(20)), (99, Some(1))].into_iter().collect();
        assert_eq!(descendants(10, &parents), vec![10, 20, 30, 31]);
        assert_eq!(descendants(99, &parents), vec![99]);
    }

    /// Linux: a real server of this same test is found with its PID, and stopping it kills its tree.
    #[cfg(not(windows))]
    #[test]
    fn encuentra_y_detiene_un_servidor_real() {
        let mut child = std::process::Command::new("python3")
            .args(["-c", "import socket,time; s=socket.socket(); s.bind(('127.0.0.1',0)); s.listen(); print(s.getsockname()[1], flush=True); time.sleep(60)"])
            .stdout(std::process::Stdio::piped())
            .spawn()
            .expect("python3");
        let mut line = String::new();
        std::io::BufRead::read_line(&mut std::io::BufReader::new(child.stdout.take().unwrap()), &mut line).unwrap();
        let port: u16 = line.trim().parse().unwrap();
        let l = listening();
        let found = l.iter().find(|x| x.port == port).unwrap_or_else(|| panic!("no está el puerto {port}: {l:?}"));
        assert_eq!(found.pid, child.id());
        assert_eq!(found.addr, "127.0.0.1");
        kill_tree(child.id()).unwrap();
        let status = child.wait().unwrap();
        assert!(!status.success());
    }

    #[cfg(windows)]
    #[test]
    fn lee_la_tabla_real() {
        // On Windows something is always listening (for example RPC's 135).
        let l = listening();
        assert!(!l.is_empty());
        assert!(l.iter().all(|x| x.port > 0));
    }

    #[test]
    fn no_mata_procesos_del_sistema() {
        let r = tauri::async_runtime::block_on(ports_kill(4));
        assert!(r.is_err());
    }
}
