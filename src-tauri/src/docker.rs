//! Docker con la CLI: estado del motor, contenedores, imágenes, acciones, logs y "recetas"
//! (contenedores configurados para iniciar con un clic). Lo usan el panel y la API de control.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

fn docker() -> Option<PathBuf> {
    crate::agents::resolve_in("docker", &crate::agents::search_dirs())
}

pub fn run(args: &[&str], limit: Duration) -> Result<String, String> {
    let exe = docker().ok_or("Docker no está instalado (no se encontró docker en el PATH)")?;
    let mut c = Command::new(exe);
    c.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    let mut child = c.spawn().map_err(|e| e.to_string())?;
    let mut so = child.stdout.take().unwrap();
    let mut se = child.stderr.take().unwrap();
    let ro = std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = std::io::Read::read_to_end(&mut so, &mut b);
        b
    });
    let re = std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = std::io::Read::read_to_end(&mut se, &mut b);
        b
    });
    let start = std::time::Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
            break s;
        }
        if start.elapsed() > limit {
            let _ = child.kill();
            return Err(format!("docker {} tardó demasiado", args.first().unwrap_or(&"")));
        }
        std::thread::sleep(Duration::from_millis(30));
    };
    let out = String::from_utf8_lossy(&ro.join().unwrap_or_default()).into_owned();
    let err = String::from_utf8_lossy(&re.join().unwrap_or_default()).trim().to_string();
    if status.success() {
        Ok(out)
    } else {
        Err(if err.is_empty() { format!("docker {} falló", args.join(" ")) } else { err })
    }
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub installed: bool,
    pub running: bool,
    pub version: Option<String>,
    pub error: Option<String>,
    pub desktop: bool,
}

fn desktop_exe() -> Option<PathBuf> {
    let p = PathBuf::from(std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into())).join("Docker").join("Docker").join("Docker Desktop.exe");
    p.exists().then_some(p)
}

#[tauri::command]
pub async fn docker_status() -> EngineStatus {
    tauri::async_runtime::spawn_blocking(|| {
        if docker().is_none() {
            return EngineStatus { installed: false, running: false, version: None, error: None, desktop: desktop_exe().is_some() };
        }
        match run(&["version", "--format", "{{.Server.Version}}"], Duration::from_secs(10)) {
            Ok(v) => EngineStatus { installed: true, running: true, version: Some(v.trim().to_string()), error: None, desktop: desktop_exe().is_some() },
            Err(e) => EngineStatus { installed: true, running: false, version: None, error: Some(e), desktop: desktop_exe().is_some() },
        }
    })
    .await
    .unwrap_or(EngineStatus { installed: false, running: false, version: None, error: Some("error interno".into()), desktop: false })
}

/// Abre Docker Desktop (arranca el motor).
#[tauri::command]
pub fn docker_desktop() -> Result<(), String> {
    let exe = desktop_exe().ok_or("No se encontró Docker Desktop")?;
    Command::new(exe).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Container {
    pub id: String,
    pub name: String,
    pub image: String,
    pub state: String,
    pub status: String,
    pub ports: String,
    pub created: String,
}

pub fn parse_ps(raw: &str) -> Vec<Container> {
    raw.lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .map(|v| {
            let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
            Container { id: s("ID"), name: s("Names"), image: s("Image"), state: s("State"), status: s("Status"), ports: s("Ports"), created: s("RunningFor") }
        })
        .collect()
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Image {
    pub id: String,
    pub repo: String,
    pub tag: String,
    pub size: String,
}

pub fn parse_images(raw: &str) -> Vec<Image> {
    raw.lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .map(|v| {
            let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
            Image { id: s("ID"), repo: s("Repository"), tag: s("Tag"), size: s("Size") }
        })
        .collect()
}

pub fn containers() -> Result<Vec<Container>, String> {
    run(&["ps", "-a", "--no-trunc", "--format", "{{json .}}"], Duration::from_secs(15)).map(|s| parse_ps(&s))
}

#[tauri::command]
pub async fn docker_containers() -> Result<Vec<Container>, String> {
    tauri::async_runtime::spawn_blocking(containers).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn docker_images() -> Result<Vec<Image>, String> {
    tauri::async_runtime::spawn_blocking(|| run(&["images", "--format", "{{json .}}"], Duration::from_secs(15)).map(|s| parse_images(&s)))
        .await
        .map_err(|e| e.to_string())?
}

fn valid_ref(s: &str) -> bool {
    !s.is_empty() && !s.starts_with('-') && s.chars().all(|c| c.is_ascii_alphanumeric() || "._-/:@".contains(c))
}

/// start | stop | restart | rm (rm fuerza: también si está corriendo).
pub fn action(target: &str, act: &str) -> Result<String, String> {
    if !valid_ref(target) {
        return Err("Contenedor inválido".into());
    }
    let args: Vec<&str> = match act {
        "start" => vec!["start", target],
        "stop" => vec!["stop", target],
        "restart" => vec!["restart", target],
        "rm" => vec!["rm", "-f", target],
        other => return Err(format!("Acción desconocida: {other}")),
    };
    run(&args, Duration::from_secs(90)).map(|s| s.trim().to_string())
}

#[tauri::command]
pub async fn docker_action(target: String, act: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || action(&target, &act)).await.map_err(|e| e.to_string())?
}

pub fn logs(target: &str, tail: u32) -> Result<String, String> {
    if !valid_ref(target) {
        return Err("Contenedor inválido".into());
    }
    let n = tail.clamp(1, 5000).to_string();
    // Los logs salen por stdout y stderr del contenedor: se piden juntos.
    let exe = docker().ok_or("Docker no está instalado")?;
    let mut c = Command::new(exe);
    c.args(["logs", "--tail", &n, "--timestamps", target]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    let o = c.output().map_err(|e| e.to_string())?;
    let mut s = String::from_utf8_lossy(&o.stdout).into_owned();
    s.push_str(&String::from_utf8_lossy(&o.stderr));
    if o.status.success() {
        Ok(s)
    } else {
        Err(s)
    }
}

#[tauri::command]
pub async fn docker_logs(target: String, tail: u32) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || logs(&target, tail)).await.map_err(|e| e.to_string())?
}

/// Contenedor configurado para iniciar con un clic.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub name: String,
    pub image: String,
    #[serde(default)]
    pub ports: Vec<String>,
    #[serde(default)]
    pub env: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    pub volumes: Vec<String>,
    /// Comando del contenedor (opcional), separado por espacios.
    #[serde(default)]
    pub command: String,
}

/// Argumentos de `docker run` para una receta (sin shell: cada valor va como argumento aparte).
pub fn run_args(p: &Preset) -> Result<Vec<String>, String> {
    if !valid_ref(&p.image) {
        return Err(format!("Imagen inválida: {}", p.image));
    }
    let name: String = p.name.chars().map(|c| if c.is_ascii_alphanumeric() || "_.-".contains(c) { c } else { '-' }).collect();
    let name = name.trim_matches('-').to_lowercase();
    if name.is_empty() {
        return Err("La receta necesita un nombre".into());
    }
    let mut a = vec!["run".to_string(), "-d".into(), "--name".into(), name];
    for port in &p.ports {
        if !port.chars().all(|c| c.is_ascii_digit() || c == ':' || c == '.' || c == '/') || port.is_empty() {
            return Err(format!("Puerto inválido: {port}"));
        }
        a.extend(["-p".into(), port.clone()]);
    }
    for (k, v) in &p.env {
        if k.is_empty() || k.contains('=') {
            return Err(format!("Variable inválida: {k}"));
        }
        a.extend(["-e".into(), format!("{k}={v}")]);
    }
    for vol in &p.volumes {
        if vol.trim().is_empty() || vol.starts_with('-') {
            return Err(format!("Volumen inválido: {vol}"));
        }
        a.extend(["-v".into(), vol.clone()]);
    }
    a.push(p.image.clone());
    a.extend(p.command.split_whitespace().map(str::to_string));
    Ok(a)
}

/// Inicia una receta: si el contenedor ya existe, lo arranca; si no, lo crea con `docker run`.
pub fn start_preset(p: &Preset) -> Result<String, String> {
    let args = run_args(p)?;
    let name = args[3].clone();
    if containers()?.iter().any(|c| c.name == name) {
        return action(&name, "start").map(|_| format!("Se inició {name}"));
    }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run(&refs, Duration::from_secs(600)).map(|id| format!("Se creó {name} ({})", &id.trim()[..12.min(id.trim().len())]))
}

#[tauri::command]
pub async fn docker_start_preset(preset: Preset) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || start_preset(&preset)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parsea_ps_e_images() {
        let ps = r#"{"ID":"abc","Names":"db","Image":"postgres:16","State":"running","Status":"Up 2 hours","Ports":"0.0.0.0:5432->5432/tcp","RunningFor":"2 hours ago"}"#;
        let c = parse_ps(ps);
        assert_eq!(c[0].name, "db");
        assert_eq!(c[0].state, "running");
        let im = parse_images(r#"{"ID":"1","Repository":"redis","Tag":"7","Size":"117MB"}"#);
        assert_eq!(im[0].repo, "redis");
    }

    #[test]
    fn argumentos_de_run_sin_shell() {
        let p = Preset {
            name: "Mi Postgres".into(),
            image: "postgres:16".into(),
            ports: vec!["5432:5432".into()],
            env: [("POSTGRES_PASSWORD".to_string(), "dev pass".to_string())].into_iter().collect(),
            volumes: vec!["pgdata:/var/lib/postgresql/data".into()],
            command: "".into(),
        };
        assert_eq!(
            run_args(&p).unwrap(),
            vec!["run", "-d", "--name", "mi-postgres", "-p", "5432:5432", "-e", "POSTGRES_PASSWORD=dev pass", "-v", "pgdata:/var/lib/postgresql/data", "postgres:16"]
        );
        assert!(run_args(&Preset { image: "--privileged".into(), ..p.clone() }).is_err());
        assert!(run_args(&Preset { ports: vec!["5432; rm".into()], ..p.clone() }).is_err());
        assert!(action("-rf", "rm").is_err());
    }
}
