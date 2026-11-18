//! Puertos TCP en escucha: quién los abrió, desde dónde y hace cuánto. Detener (árbol de procesos).

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

/// Lee la tabla de sockets en escucha (IPv4 e IPv6) con el PID dueño.
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
            size = len; // la tabla creció entre llamadas: reintentar
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

#[cfg(not(windows))]
pub fn listening() -> Vec<Listen> {
    Vec::new()
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub pid: u32,
    pub name: String,
    pub ports: Vec<u16>,
    /// Direcciones en las que escucha ("0.0.0.0", "127.0.0.1", "[::]"…).
    pub addrs: Vec<String>,
    pub cmdline: String,
    pub cwd: Option<String>,
    /// Segundos desde que arrancó.
    pub uptime: u64,
    /// PID de la shell de NovaTerm de la que desciende (si nació en una pestaña).
    pub shell_pid: Option<u32>,
    /// Proceso del sistema (no conviene tocarlo).
    pub system: bool,
}

const SYSTEM_NAMES: &[&str] = &[
    "system", "svchost.exe", "lsass.exe", "wininit.exe", "services.exe", "spoolsv.exe", "smss.exe", "csrss.exe",
    "winlogon.exe", "dashost.exe", "searchindexer.exe", "msmpeng.exe", "nissrv.exe", "jhi_service.exe",
];

/// Agrupa por proceso y busca de qué shell desciende cada uno.
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
        let parents: HashMap<u32, Option<u32>> = sys.processes().iter().map(|(p, pr)| (p.as_u32(), pr.parent().map(Pid::as_u32))).collect();
        Ok(group(&listens, &parents, &shells)
            .into_iter()
            .map(|(pid, ports, addrs, shell_pid)| {
                let p = sys.process(Pid::from_u32(pid));
                let name = p.map(|p| p.name().to_string_lossy().into_owned()).unwrap_or_else(|| if pid == 4 { "System".into() } else { format!("PID {pid}") });
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

/// Detiene un proceso y todo lo que cuelga de él (taskkill /T /F).
#[tauri::command]
pub async fn ports_kill(pid: u32) -> Result<String, String> {
    if pid <= 4 || pid == std::process::id() {
        return Err("Ese proceso no se puede detener desde acá.".into());
    }
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
            Err(if text.is_empty() { format!("taskkill terminó con {}", out.status) } else { text })
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agrupa_y_encuentra_la_shell() {
        let l = |port, pid, addr: &str| Listen { port, pid, addr: addr.into() };
        let listens = vec![l(5173, 30, "127.0.0.1"), l(5173, 30, "[::1]"), l(24678, 30, "127.0.0.1"), l(135, 900, "0.0.0.0")];
        // 10 = shell de NovaTerm → 20 (npm) → 30 (node)
        let parents: HashMap<u32, Option<u32>> = [(10, Some(1)), (20, Some(10)), (30, Some(20)), (900, Some(5))].into_iter().collect();
        let g = group(&listens, &parents, &[10]);
        assert_eq!(g[0], (900, vec![135], vec!["0.0.0.0".to_string()], None));
        assert_eq!(g[1], (30, vec![5173, 24678], vec!["127.0.0.1".to_string(), "[::1]".to_string()], Some(10)));
    }

    #[test]
    fn lee_la_tabla_real() {
        // En Windows siempre hay algo escuchando (por ejemplo el 135 de RPC).
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
