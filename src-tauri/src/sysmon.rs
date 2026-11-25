//! System CPU and RAM, the top processes and what each tab consumes.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

/// A dedicated `System` (the title one refreshes other things and would ruin the CPU calculation).
#[derive(Default)]
pub struct SysState {
    sys: Mutex<Option<System>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    /// Total CPU, 0–100.
    cpu: f32,
    mem_used: u64,
    mem_total: u64,
    cores: usize,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProcRow {
    pub pid: u32,
    pub name: String,
    /// CPU as % of the whole machine (0–100).
    pub cpu: f32,
    pub mem: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TreeUse {
    pub cpu: f32,
    pub mem: u64,
    pub count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Top {
    top_cpu: Vec<ProcRow>,
    top_mem: Vec<ProcRow>,
    /// By PID of each tab's shell: the shell and everything hanging from it.
    trees: HashMap<u32, TreeUse>,
}

/// Sums CPU and memory of a process and all its descendants.
pub fn tree_use(rows: &HashMap<u32, (Option<u32>, f32, u64)>, root: u32) -> TreeUse {
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for (pid, (parent, _, _)) in rows {
        if let Some(p) = parent {
            children.entry(*p).or_default().push(*pid);
        }
    }
    let mut out = TreeUse::default();
    let mut stack = vec![root];
    let mut seen = std::collections::HashSet::new();
    while let Some(pid) = stack.pop() {
        if !seen.insert(pid) {
            continue;
        }
        if let Some((_, cpu, mem)) = rows.get(&pid) {
            out.cpu += cpu;
            out.mem += mem;
            out.count += 1;
        }
        stack.extend(children.get(&pid).into_iter().flatten().copied());
    }
    out
}

impl SysState {
    fn with<T>(&self, f: impl FnOnce(&mut System) -> T) -> Result<T, String> {
        let mut g = self.sys.lock().unwrap();
        if g.is_none() {
            *g = Some(System::new().map_err(|e| e.to_string())?);
        }
        Ok(f(g.as_mut().unwrap()))
    }
}

#[tauri::command]
pub fn sys_stats(state: tauri::State<SysState>) -> Result<Stats, String> {
    state.with(|s| {
        s.refresh_cpu_usage();
        s.refresh_memory();
        Stats { cpu: s.global_cpu_usage(), mem_used: s.used_memory(), mem_total: s.total_memory(), cores: s.cpus().len().max(1) }
    })
}

/// Top processes and per-tab usage. A process's CPU is computed between two calls:
/// the first time it gives 0 (the panel requests it every second while it is open).
#[tauri::command]
pub fn sys_top(state: tauri::State<SysState>, shells: Vec<u32>) -> Result<Top, String> {
    state.with(|s| {
        s.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_cpu().with_memory());
        let cores = s.cpus().len().max(1) as f32;
        let rows: Vec<ProcRow> = s
            .processes()
            .iter()
            .filter(|(pid, p)| pid.as_u32() != 0 && !crate::procinfo::is_thread(p))
            .map(|(pid, p)| ProcRow {
                pid: pid.as_u32(),
                name: p.name().to_string_lossy().into_owned(),
                cpu: p.cpu_usage() / cores,
                mem: p.memory(),
            })
            .collect();
        let map: HashMap<u32, (Option<u32>, f32, u64)> = s
            .processes()
            .iter()
            .filter(|(_, p)| !crate::procinfo::is_thread(p))
            .map(|(pid, p)| (pid.as_u32(), (p.parent().map(Pid::as_u32), p.cpu_usage() / cores, p.memory())))
            .collect();
        let mut by_cpu = rows.clone();
        by_cpu.sort_by(|a, b| b.cpu.total_cmp(&a.cpu));
        by_cpu.truncate(8);
        let mut by_mem = rows;
        by_mem.sort_by(|a, b| b.mem.cmp(&a.mem));
        by_mem.truncate(8);
        Top { top_cpu: by_cpu, top_mem: by_mem, trees: shells.iter().map(|&p| (p, tree_use(&map, p))).collect() }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suma_el_arbol() {
        let rows: HashMap<u32, (Option<u32>, f32, u64)> = [
            (10, (None, 1.0, 100)),
            (11, (Some(10), 2.0, 200)),
            (12, (Some(11), 3.0, 300)),
            (20, (Some(1), 50.0, 5000)),
        ]
        .into_iter()
        .collect();
        assert_eq!(tree_use(&rows, 10), TreeUse { cpu: 6.0, mem: 600, count: 3 });
        assert_eq!(tree_use(&rows, 99), TreeUse::default());
    }
}
