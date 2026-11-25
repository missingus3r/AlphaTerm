//! History of commands from all tabs and windows (those that arrive through the shell
//! integration), in `%APPDATA%\AlphaTerm\history.jsonl`. The last 5000 are kept.

use serde::{Deserialize, Serialize};
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::Mutex;

const MAX: usize = 5000;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub command: String,
    pub cwd: Option<String>,
    pub exit_code: Option<i64>,
    /// Unix ms.
    pub at: u64,
    pub shell: Option<String>,
}

#[derive(Default)]
pub struct HistoryState {
    items: Mutex<Option<Vec<Entry>>>,
}

fn file() -> PathBuf {
    crate::settings::data_dir().join("history.jsonl")
}

fn load() -> Vec<Entry> {
    let Ok(f) = std::fs::File::open(file()) else { return vec![] };
    std::io::BufReader::new(f).lines().map_while(Result::ok).filter_map(|l| serde_json::from_str(&l).ok()).collect()
}

/// Searches by words (all must appear, in the command or in the folder), newest first
/// and without repeating the same command in the same folder.
pub fn search(items: &[Entry], query: &str, limit: usize) -> Vec<Entry> {
    let words: Vec<String> = query.to_lowercase().split_whitespace().map(str::to_string).collect();
    let mut seen = std::collections::HashSet::new();
    items
        .iter()
        .rev()
        .filter(|e| {
            let hay = format!("{} {}", e.command, e.cwd.as_deref().unwrap_or("")).to_lowercase();
            words.iter().all(|w| hay.contains(w))
        })
        .filter(|e| seen.insert((e.command.clone(), e.cwd.clone().unwrap_or_default().to_lowercase())))
        .take(limit)
        .cloned()
        .collect()
}

#[tauri::command]
pub fn history_add(state: tauri::State<HistoryState>, entry: Entry) -> Result<(), String> {
    let cmd = entry.command.trim();
    if cmd.is_empty() || cmd.len() > 4000 {
        return Ok(());
    }
    let mut g = state.items.lock().unwrap();
    let items = g.get_or_insert_with(load);
    items.push(Entry { command: cmd.to_string(), ..entry.clone() });
    let path = file();
    if let Some(d) = path.parent() {
        let _ = std::fs::create_dir_all(d);
    }
    if items.len() > MAX + 1000 {
        // The file is trimmed and rewritten in full from time to time.
        let drop = items.len() - MAX;
        items.drain(..drop);
        let text: String = items.iter().filter_map(|e| serde_json::to_string(e).ok()).map(|l| l + "\n").collect();
        return std::fs::write(&path, text).map_err(|e| e.to_string());
    }
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&path).map_err(|e| e.to_string())?;
    let line = serde_json::to_string(items.last().unwrap()).map_err(|e| e.to_string())?;
    writeln!(f, "{line}").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn history_search(state: tauri::State<HistoryState>, query: String, limit: Option<usize>) -> Vec<Entry> {
    let mut g = state.items.lock().unwrap();
    let items = g.get_or_insert_with(load);
    search(items, &query, limit.unwrap_or(300).min(2000))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(cmd: &str, cwd: &str, at: u64) -> Entry {
        Entry { command: cmd.into(), cwd: Some(cwd.into()), exit_code: Some(0), at, shell: None }
    }

    #[test]
    fn busca_lo_mas_nuevo_sin_repetir() {
        let items = vec![e("git status", "C:\\a", 1), e("npm run dev", "C:\\web", 2), e("git status", "C:\\a", 3), e("git log", "C:\\web", 4)];
        let r = search(&items, "", 10);
        assert_eq!(r.iter().map(|x| x.at).collect::<Vec<_>>(), vec![4, 3, 2]);
        let r = search(&items, "GIT web", 10);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].command, "git log");
        assert_eq!(search(&items, "", 1).len(), 1);
    }
}
