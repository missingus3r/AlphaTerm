//! Navegador integrado: un WebView2 hijo dentro de la ventana de AlphaTerm, puesto exactamente
//! sobre el lugar de su panel (el frontend le manda el rectángulo). Se maneja por el protocolo de
//! DevTools (CDP) del propio WebView2: capturas, clics, teclas, evaluar JS y leer la consola.
//!
//! En cada página se inyecta `scripts/browser-overlay.js` (la capa de marcado). La capa le habla a
//! AlphaTerm por la función `__alphaterm`, que se agrega con `Runtime.addBinding`: las marcas
//! llegan como eventos `Runtime.bindingCalled` y se reenvían a la ventana como `browser-marks`.
//!
//! Los métodos que hablan con CDP bloquean esperando la respuesta: nunca llamarlos desde el hilo
//! principal (los comandos son async y van por `spawn_blocking`; la API de control usa sus hilos).

use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};

const OVERLAY_JS: &str = include_str!("../scripts/browser-overlay.js");
const CDP_TIMEOUT: Duration = Duration::from_secs(20);
const CONSOLE_MAX: usize = 300;

pub struct Entry {
    pub id: String,
    pub label: String,
    pub window: String,
    /// Panel de terminal "dueño" (el agente que lo abrió, o al que van los pedidos).
    pub owner: Mutex<Option<String>>,
    pub opened: Instant,
    console: Mutex<VecDeque<Value>>,
    console_seq: Mutex<u64>,
    marks: Mutex<Value>,
    page: Mutex<Value>,
}

#[derive(Default)]
pub struct BrowserState(Mutex<HashMap<String, Arc<Entry>>>);

fn label_of(id: &str) -> String {
    let clean: String = id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
    format!("browser-{clean}")
}

/// "localhost:5173" → "http://localhost:5173"; "ejemplo.com" → "https://ejemplo.com".
pub fn normalize_url(raw: &str) -> String {
    let s = raw.trim();
    if s.is_empty() {
        return "about:blank".into();
    }
    if s.contains("://") || s.starts_with("about:") || s.starts_with("data:") {
        return s.to_string();
    }
    // Solo un puerto ("5173"): el servidor local.
    if s.chars().all(|c| c.is_ascii_digit()) {
        return format!("http://localhost:{s}");
    }
    let host = s.split(['/', '?', '#']).next().unwrap_or("");
    let local = host.starts_with("localhost")
        || host.starts_with("127.")
        || host.starts_with("0.0.0.0")
        || host.starts_with("[::1]")
        || host.ends_with(".localhost")
        || host.ends_with(".test")
        || host.split(':').next().map(|h| h.chars().all(|c| c.is_ascii_digit() || c == '.')).unwrap_or(false);
    if local {
        format!("http://{s}")
    } else {
        format!("https://{s}")
    }
}

pub fn get(app: &AppHandle, id: &str) -> Result<Arc<Entry>, String> {
    app.state::<BrowserState>().0.lock().unwrap().get(id).cloned().ok_or_else(|| format!("No hay un navegador con id {id}"))
}

fn webview(app: &AppHandle, e: &Entry) -> Result<tauri::Webview, String> {
    app.get_webview(&e.label).ok_or_else(|| "El navegador ya no está abierto".into())
}

/// Lista de navegadores abiertos (para la API).
pub fn list(app: &AppHandle) -> Vec<Value> {
    let state = app.state::<BrowserState>();
    let mut v: Vec<_> = state.0.lock().unwrap().values().cloned().collect();
    v.sort_by_key(|e| e.opened);
    v.iter()
        .map(|e| {
            let page = e.page.lock().unwrap().clone();
            json!({ "browser": e.id, "window": e.window, "owner": *e.owner.lock().unwrap(), "url": page.get("url"), "title": page.get("title") })
        })
        .collect()
}

/// Navegador para un pedido de la API: el pedido, el del panel que llama, o el último abierto.
pub fn resolve(app: &AppHandle, wanted: Option<String>, caller: &Option<String>) -> Result<Arc<Entry>, String> {
    if let Some(id) = wanted.filter(|s| !s.is_empty()) {
        return get(app, &id);
    }
    let state = app.state::<BrowserState>();
    let mut all: Vec<_> = state.0.lock().unwrap().values().cloned().collect();
    all.sort_by_key(|e| std::cmp::Reverse(e.opened));
    if let Some(c) = caller {
        if let Some(e) = all.iter().find(|e| e.owner.lock().unwrap().as_deref() == Some(c.as_str())) {
            return Ok(e.clone());
        }
    }
    all.into_iter().next().ok_or_else(|| "No hay ningún navegador abierto en AlphaTerm. Abrí uno con browser_open y la URL.".into())
}

// --- CDP -------------------------------------------------------------------------------------

#[cfg(windows)]
pub fn cdp(app: &AppHandle, e: &Entry, method: &str, params: Value) -> Result<Value, String> {
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use windows_core::HSTRING;
    let wv = webview(app, e)?;
    let (tx, rx) = mpsc::channel::<Result<String, String>>();
    let m = method.to_string();
    let ps = params.to_string();
    wv.with_webview(move |pw| {
        let tx2 = tx.clone();
        let r = (|| -> windows_core::Result<()> {
            unsafe {
                let core = pw.controller().CoreWebView2()?;
                let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |hr, json| {
                    let _ = tx2.send(hr.map(|_| json).map_err(|err| format!("{err}")));
                    Ok(())
                }));
                core.CallDevToolsProtocolMethod(&HSTRING::from(m.as_str()), &HSTRING::from(ps.as_str()), &handler)
            }
        })();
        if let Err(err) = r {
            let _ = tx.send(Err(format!("{err}")));
        }
    })
    .map_err(|err| err.to_string())?;
    let raw = rx.recv_timeout(CDP_TIMEOUT).map_err(|_| format!("El navegador no contestó {method} a tiempo"))??;
    serde_json::from_str(&raw).map_err(|err| format!("{method}: respuesta inválida ({err})"))
}

#[cfg(not(windows))]
pub fn cdp(_app: &AppHandle, _e: &Entry, _method: &str, _params: Value) -> Result<Value, String> {
    Err("El navegador integrado solo está hecho para Windows".into())
}

/// Suscribe los eventos de DevTools que interesan (marcas, consola, errores).
#[cfg(windows)]
fn subscribe(app: &AppHandle, e: &Arc<Entry>) {
    use webview2_com::{take_pwstr, DevToolsProtocolEventReceivedEventHandler};
    use windows_core::{HSTRING, PWSTR};
    let Ok(wv) = webview(app, e) else { return };
    let app = app.clone();
    let id = e.id.clone();
    let _ = wv.with_webview(move |pw| unsafe {
        let Ok(core) = pw.controller().CoreWebView2() else { return };
        for ev in ["Runtime.bindingCalled", "Runtime.consoleAPICalled", "Runtime.exceptionThrown"] {
            let Ok(rcv) = core.GetDevToolsProtocolEventReceiver(&HSTRING::from(ev)) else { continue };
            let app = app.clone();
            let id = id.clone();
            let handler = DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_, args| {
                if let Some(a) = args {
                    let mut p = PWSTR::null();
                    if a.ParameterObjectAsJson(&mut p).is_ok() {
                        let s = take_pwstr(p);
                        on_event(&app, &id, ev, &s);
                    }
                }
                Ok(())
            }));
            let mut token = 0i64;
            let _ = rcv.add_DevToolsProtocolEventReceived(&handler, &mut token);
        }
    });
}

#[cfg(not(windows))]
fn subscribe(_app: &AppHandle, _e: &Arc<Entry>) {}

fn on_event(app: &AppHandle, id: &str, ev: &str, raw: &str) {
    let Ok(e) = get(app, id) else { return };
    let Ok(v) = serde_json::from_str::<Value>(raw) else { return };
    match ev {
        "Runtime.bindingCalled" => {
            if v.get("name").and_then(Value::as_str) != Some("__alphaterm") {
                return;
            }
            let Some(msg) = v.get("payload").and_then(Value::as_str).and_then(|p| serde_json::from_str::<Value>(p).ok()) else { return };
            match msg.get("type").and_then(Value::as_str) {
                Some("marks") => {
                    let marks = msg.get("marks").cloned().unwrap_or(json!([]));
                    *e.marks.lock().unwrap() = marks.clone();
                    let _ = app.emit_to(&e.window, "browser-marks", json!({ "id": id, "marks": marks }));
                }
                Some("page") => {
                    {
                        let mut page = e.page.lock().unwrap();
                        for k in ["url", "title", "hmr"] {
                            if let Some(x) = msg.get(k) {
                                page[k] = x.clone();
                            }
                        }
                    }
                    // Página nueva: las marcas de la anterior ya no valen.
                    *e.marks.lock().unwrap() = json!([]);
                    let _ = app.emit_to(&e.window, "browser-page", json!({ "id": id, "url": msg.get("url"), "title": msg.get("title"), "hmr": msg.get("hmr") }));
                }
                Some("edit") => {
                    let _ = app.emit_to(&e.window, "browser-edit", json!({ "id": id, "on": msg.get("on") }));
                }
                _ => {}
            }
        }
        "Runtime.consoleAPICalled" => {
            let level = v.get("type").and_then(Value::as_str).unwrap_or("log").to_string();
            let text = v
                .get("args")
                .and_then(Value::as_array)
                .map(|args| args.iter().map(remote_text).collect::<Vec<_>>().join(" "))
                .unwrap_or_default();
            push_console(app, &e, &level, text, None);
        }
        "Runtime.exceptionThrown" => {
            let d = &v["exceptionDetails"];
            let text = d["exception"]["description"].as_str().or(d["text"].as_str()).unwrap_or("Error").to_string();
            let at = d["url"].as_str().map(|u| format!("{u}:{}", d["lineNumber"].as_i64().unwrap_or(0) + 1));
            push_console(app, &e, "exception", text, at);
        }
        _ => {}
    }
}

fn remote_text(a: &Value) -> String {
    if let Some(v) = a.get("value") {
        return match v {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        };
    }
    a.get("description").and_then(Value::as_str).or(a.get("unserializableValue").and_then(Value::as_str)).unwrap_or("").to_string()
}

fn push_console(app: &AppHandle, e: &Entry, level: &str, text: String, at: Option<String>) {
    let seq = {
        let mut s = e.console_seq.lock().unwrap();
        *s += 1;
        *s
    };
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let item = json!({ "seq": seq, "level": level, "text": text.chars().take(4000).collect::<String>(), "at": at, "time": ms });
    {
        let mut c = e.console.lock().unwrap();
        c.push_back(item);
        while c.len() > CONSOLE_MAX {
            c.pop_front();
        }
    }
    if level == "error" || level == "exception" || level == "assert" {
        let _ = app.emit_to(&e.window, "browser-error", json!({ "id": e.id, "text": text.chars().take(300).collect::<String>() }));
    }
}

// --- Operaciones ------------------------------------------------------------------------------

/// Evalúa JS en la página (espera promesas) y devuelve el valor como JSON.
pub fn eval(app: &AppHandle, e: &Entry, js: &str) -> Result<Value, String> {
    let r = cdp(app, e, "Runtime.evaluate", json!({ "expression": js, "returnByValue": true, "awaitPromise": true, "userGesture": true }))?;
    if let Some(ex) = r.get("exceptionDetails") {
        let msg = ex["exception"]["description"].as_str().or(ex["text"].as_str()).unwrap_or("Error en el script");
        return Err(msg.to_string());
    }
    Ok(r["result"].get("value").cloned().unwrap_or(Value::Null))
}

/// Captura en PNG: la vista, la página entera, o un recorte (coordenadas de documento, px CSS).
pub fn screenshot(app: &AppHandle, e: &Entry, clip: Option<(f64, f64, f64, f64)>, full: bool) -> Result<Vec<u8>, String> {
    use base64::Engine;
    let mut params = json!({ "format": "png" });
    if let Some((x, y, w, h)) = clip {
        params["clip"] = json!({ "x": x.max(0.0), "y": y.max(0.0), "width": w.max(1.0), "height": h.max(1.0), "scale": 1 });
        params["captureBeyondViewport"] = json!(true);
    } else if full {
        let m = cdp(app, e, "Page.getLayoutMetrics", json!({}))?;
        let cs = if m.get("cssContentSize").is_some() { &m["cssContentSize"] } else { &m["contentSize"] };
        let w = cs["width"].as_f64().unwrap_or(1280.0);
        let h = cs["height"].as_f64().unwrap_or(800.0).min(16_000.0);
        params["clip"] = json!({ "x": 0, "y": 0, "width": w, "height": h, "scale": 1 });
        params["captureBeyondViewport"] = json!(true);
    }
    let r = cdp(app, e, "Page.captureScreenshot", params)?;
    let data = r["data"].as_str().ok_or("La captura vino vacía")?;
    base64::engine::general_purpose::STANDARD.decode(data).map_err(|err| err.to_string())
}

/// Centro de un elemento en la vista (lo trae a la vista antes).
fn point_of(app: &AppHandle, e: &Entry, selector: &str) -> Result<(f64, f64, String), String> {
    let js = format!(
        "(() => {{ const el = document.querySelector({sel}); if (!el) return null; el.scrollIntoView({{block:'center', inline:'center'}}); \
         const r = el.getBoundingClientRect(); return {{ x: r.left + r.width / 2, y: r.top + r.height / 2, what: el.tagName.toLowerCase() + ' ' + (el.innerText || el.value || '').trim().slice(0, 60) }}; }})()",
        sel = json!(selector)
    );
    let v = eval(app, e, &js)?;
    if v.is_null() {
        return Err(format!("No encontré ningún elemento con el selector {selector}"));
    }
    Ok((v["x"].as_f64().unwrap_or(0.0), v["y"].as_f64().unwrap_or(0.0), v["what"].as_str().unwrap_or("").to_string()))
}

pub fn click(app: &AppHandle, e: &Entry, selector: Option<&str>, x: Option<f64>, y: Option<f64>) -> Result<Value, String> {
    let (px, py, what) = match selector {
        Some(s) => point_of(app, e, s)?,
        None => (x.ok_or("Falta selector o x/y")?, y.ok_or("Falta y")?, String::new()),
    };
    // Que la capa de marcado no se trague el clic si está en modo edición.
    let _ = eval(app, e, "window.__alphaPass = true");
    let mut res = Ok(());
    for (t, buttons) in [("mouseMoved", 0), ("mousePressed", 1), ("mouseReleased", 0)] {
        let r = cdp(app, e, "Input.dispatchMouseEvent", json!({ "type": t, "x": px, "y": py, "button": if t == "mouseMoved" { "none" } else { "left" }, "buttons": buttons, "clickCount": 1 }));
        if let Err(err) = r {
            res = Err(err);
            break;
        }
    }
    let _ = eval(app, e, "window.__alphaPass = false");
    res?;
    Ok(json!({ "clicked": { "x": px, "y": py }, "element": what }))
}

pub fn type_text(app: &AppHandle, e: &Entry, text: &str, selector: Option<&str>) -> Result<Value, String> {
    if let Some(s) = selector {
        click(app, e, Some(s), None, None)?;
    }
    cdp(app, e, "Input.insertText", json!({ "text": text }))?;
    Ok(json!({ "typed": text.chars().count() }))
}

/// Teclas especiales por nombre: Enter, Tab, Escape, Backspace, Delete, ArrowUp/Down/Left/Right,
/// Home, End, PageUp, PageDown. Con modificadores: "Ctrl+A", "Shift+Tab".
pub fn key(app: &AppHandle, e: &Entry, combo: &str) -> Result<Value, String> {
    let parts: Vec<&str> = combo.split('+').map(str::trim).collect();
    let (mods, name) = parts.split_at(parts.len().saturating_sub(1));
    let name = name.first().copied().unwrap_or("");
    let mut m = 0;
    for x in mods {
        match x.to_ascii_lowercase().as_str() {
            "alt" => m |= 1,
            "ctrl" | "control" => m |= 2,
            "meta" | "cmd" | "win" => m |= 4,
            "shift" => m |= 8,
            _ => {}
        }
    }
    let (key, code, vk, text): (String, String, i64, Option<&str>) = match name.to_ascii_lowercase().as_str() {
        "enter" | "return" => ("Enter".into(), "Enter".into(), 13, Some("\r")),
        "tab" => ("Tab".into(), "Tab".into(), 9, None),
        "escape" | "esc" => ("Escape".into(), "Escape".into(), 27, None),
        "backspace" => ("Backspace".into(), "Backspace".into(), 8, None),
        "delete" | "supr" => ("Delete".into(), "Delete".into(), 46, None),
        "arrowup" | "up" => ("ArrowUp".into(), "ArrowUp".into(), 38, None),
        "arrowdown" | "down" => ("ArrowDown".into(), "ArrowDown".into(), 40, None),
        "arrowleft" | "left" => ("ArrowLeft".into(), "ArrowLeft".into(), 37, None),
        "arrowright" | "right" => ("ArrowRight".into(), "ArrowRight".into(), 39, None),
        "home" => ("Home".into(), "Home".into(), 36, None),
        "end" => ("End".into(), "End".into(), 35, None),
        "pageup" => ("PageUp".into(), "PageUp".into(), 33, None),
        "pagedown" => ("PageDown".into(), "PageDown".into(), 34, None),
        "space" => (" ".into(), "Space".into(), 32, Some(" ")),
        s if s.chars().count() == 1 => {
            let c = name.chars().next().unwrap();
            let up = c.to_ascii_uppercase();
            (c.to_string(), if c.is_ascii_digit() { format!("Digit{c}") } else { format!("Key{up}") }, up as i64, None)
        }
        _ => return Err(format!("No conozco la tecla {name}")),
    };
    let plain_char = text.is_none() && key.chars().count() == 1 && m & 2 == 0 && m & 1 == 0;
    let down_text = text.map(str::to_string).or_else(|| plain_char.then(|| key.clone()));
    let mut down = json!({ "type": if down_text.is_some() { "keyDown" } else { "rawKeyDown" }, "key": key, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk, "modifiers": m });
    if let Some(t) = &down_text {
        down["text"] = json!(t);
        down["unmodifiedText"] = json!(t);
    }
    let _ = eval(app, e, "window.__alphaPass = true");
    let r1 = cdp(app, e, "Input.dispatchKeyEvent", down);
    let r2 = cdp(app, e, "Input.dispatchKeyEvent", json!({ "type": "keyUp", "key": key, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk, "modifiers": m }));
    let _ = eval(app, e, "window.__alphaPass = false");
    r1?;
    r2?;
    Ok(json!({ "pressed": combo }))
}

pub fn navigate(app: &AppHandle, e: &Entry, url: &str) -> Result<String, String> {
    let u = normalize_url(url);
    let parsed: tauri::Url = u.parse().map_err(|err| format!("URL inválida: {err}"))?;
    webview(app, e)?.navigate(parsed).map_err(|err| err.to_string())?;
    Ok(u)
}

/// Espera a que la página termine de cargar (o se cumpla el tiempo).
pub fn wait_load(app: &AppHandle, e: &Entry, ms: u64) {
    let end = Instant::now() + Duration::from_millis(ms);
    std::thread::sleep(Duration::from_millis(250));
    while Instant::now() < end {
        if let Ok(Value::String(s)) = eval(app, e, "document.readyState") {
            if s == "complete" {
                return;
            }
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

pub fn console(e: &Entry, since: u64, errors_only: bool) -> Vec<Value> {
    e.console
        .lock()
        .unwrap()
        .iter()
        .filter(|c| c["seq"].as_u64().unwrap_or(0) > since)
        .filter(|c| !errors_only || matches!(c["level"].as_str(), Some("error" | "exception" | "assert" | "warning")))
        .cloned()
        .collect()
}

pub fn marks(e: &Entry) -> Value {
    e.marks.lock().unwrap().clone()
}

pub fn page(e: &Entry) -> Value {
    e.page.lock().unwrap().clone()
}

// --- Pedido al agente --------------------------------------------------------------------------

fn stamp() -> String {
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    format!("pedido-{ms}")
}

fn line_of_mark(m: &Value) -> String {
    let tag = m["tag"].as_str().unwrap_or("?");
    let mut desc = format!("<{tag}");
    if let Some(id) = m["id"].as_str() {
        desc.push_str(&format!(" id=\"{id}\""));
    }
    let classes: Vec<&str> = m["classes"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    if !classes.is_empty() {
        desc.push_str(&format!(" class=\"{}\"", classes.join(" ")));
    }
    desc.push('>');
    let text = m["text"].as_str().unwrap_or("").trim();
    if !text.is_empty() {
        let t: String = text.chars().take(70).collect();
        desc.push_str(&format!(" «{t}{}»", if text.chars().count() > 70 { "…" } else { "" }));
    }
    if let Some(c) = m.get("component").filter(|c| !c.is_null()) {
        desc.push_str(&format!(" · componente {} ({})", c["name"].as_str().unwrap_or("?"), c["framework"].as_str().unwrap_or("")));
        if let Some(f) = c["source"]["file"].as_str() {
            match c["source"]["line"].as_i64() {
                Some(l) => desc.push_str(&format!(" en {f}:{l}")),
                None => desc.push_str(&format!(" en {f}")),
            }
        }
    }
    if let Some(sel) = m["selector"].as_str() {
        desc.push_str(&format!(" · selector `{sel}`"));
    }
    desc
}

/// Texto que se le escribe al agente en su terminal. Puro (testeado).
pub fn compose(text: &str, url: &str, marks: &[Value], shots: &[(usize, String)], page_shot: Option<&str>, full_shot: Option<&str>, detail: &str, global: bool) -> String {
    let mut out = String::new();
    out.push_str(&format!("Pedido desde el navegador de AlphaTerm (página {url}):\n"));
    out.push_str(text.trim());
    out.push_str("\n\n");
    out.push_str("Hacé el cambio en el código fuente del proyecto: el navegador lo muestra al recargar (el servidor de desarrollo recarga solo).\n");
    if global {
        out.push_str("Es un cambio global, sobre todo el sitio.\n");
    }
    if !marks.is_empty() {
        out.push_str(if global { "Además marqué estos elementos:\n" } else { "Elementos marcados:\n" });
        for (i, m) in marks.iter().enumerate() {
            let n = m["n"].as_u64().map(|n| n as usize).unwrap_or(i + 1);
            out.push_str(&format!("{n}. {}", line_of_mark(m)));
            if let Some((_, p)) = shots.iter().find(|(k, _)| *k == n) {
                out.push_str(&format!(" · captura {p}"));
            }
            out.push('\n');
        }
    }
    if let Some(p) = page_shot {
        out.push_str(&format!("Captura de lo que se ve{}: {p}\n", if marks.is_empty() { "" } else { " (con los elementos numerados)" }));
    }
    if let Some(p) = full_shot {
        out.push_str(&format!("Captura de la página entera: {p}\n"));
    }
    out.push_str(&format!("Detalle (HTML, estilos y posición de cada elemento): {detail}"));
    out
}

fn detail_md(text: &str, url: &str, title: &str, marks: &[Value], global: bool) -> String {
    let mut md = format!("# Pedido desde el navegador de AlphaTerm\n\n- Página: {url}\n- Título: {title}\n- Cambio global: {}\n\n## Pedido\n\n{}\n", if global { "sí" } else { "no" }, text.trim());
    for (i, m) in marks.iter().enumerate() {
        let n = m["n"].as_u64().unwrap_or(i as u64 + 1);
        md.push_str(&format!("\n## Elemento {n}\n\n{}\n\n", line_of_mark(m)));
        if let Some(c) = m.get("component").filter(|c| !c.is_null()) {
            let chain: Vec<&str> = c["chain"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
            if chain.len() > 1 {
                md.push_str(&format!("- Componentes (de adentro hacia afuera): {}\n", chain.join(" ← ")));
            }
        }
        let r = &m["rect"];
        md.push_str(&format!("- Posición en la página: x={} y={} · tamaño {}×{} px\n", r["x"], r["y"], r["w"], r["h"]));
        if let Some(attrs) = m["attrs"].as_object().filter(|a| !a.is_empty()) {
            md.push_str("- Atributos: ");
            md.push_str(&attrs.iter().map(|(k, v)| format!("{k}=\"{}\"", v.as_str().unwrap_or(""))).collect::<Vec<_>>().join(", "));
            md.push('\n');
        }
        if let Some(st) = m["styles"].as_object().filter(|a| !a.is_empty()) {
            md.push_str("- Estilos calculados:\n");
            for (k, v) in st {
                md.push_str(&format!("  - {k}: {}\n", v.as_str().unwrap_or("")));
            }
        }
        if let Some(h) = m["html"].as_str() {
            md.push_str(&format!("\n```html\n{h}\n```\n"));
        }
    }
    md
}

fn write_png(dir: &Path, name: &str, bytes: &[u8]) -> Result<String, String> {
    let p = dir.join(name);
    std::fs::write(&p, bytes).map_err(|err| format!("No se pudo guardar {}: {err}", p.display()))?;
    Ok(p.display().to_string())
}

/// Arma el pedido: capturas (vista con números, cada marca recortada, página entera si es global),
/// `pedido.md` y `marcas.json`, y el texto para el agente.
pub fn request(app: &AppHandle, e: &Entry, text: &str, global: bool) -> Result<Value, String> {
    let marks: Vec<Value> = e.marks.lock().unwrap().as_array().cloned().unwrap_or_default();
    if marks.is_empty() && !global {
        return Err("No hay elementos marcados (o marcá «Todo el sitio»).".into());
    }
    let info = eval(app, e, "({ url: location.href, title: document.title })").unwrap_or(json!({}));
    let url = info["url"].as_str().unwrap_or("").to_string();
    let title = info["title"].as_str().unwrap_or("").to_string();
    let dir: PathBuf = std::env::temp_dir().join("AlphaTerm").join("navegador").join(stamp());
    std::fs::create_dir_all(&dir).map_err(|err| format!("No se pudo crear {}: {err}", dir.display()))?;

    let _ = eval(app, e, "window.__alphaOverlay && __alphaOverlay.hideHover()");
    std::thread::sleep(Duration::from_millis(60));
    let page_shot = screenshot(app, e, None, false).ok().and_then(|b| write_png(&dir, "pagina.png", &b).ok());
    let _ = eval(app, e, "window.__alphaOverlay && __alphaOverlay.chrome(false)");
    std::thread::sleep(Duration::from_millis(60));
    let mut shots = Vec::new();
    for (i, m) in marks.iter().enumerate() {
        let n = m["n"].as_u64().map(|n| n as usize).unwrap_or(i + 1);
        let r = &m["rect"];
        let (x, y, w, h) = (r["x"].as_f64().unwrap_or(0.0), r["y"].as_f64().unwrap_or(0.0), r["w"].as_f64().unwrap_or(0.0), r["h"].as_f64().unwrap_or(0.0));
        if w < 1.0 || h < 1.0 {
            continue;
        }
        const PAD: f64 = 12.0;
        if let Ok(b) = screenshot(app, e, Some((x - PAD, y - PAD, w + PAD * 2.0, (h + PAD * 2.0).min(4000.0))), false) {
            if let Ok(p) = write_png(&dir, &format!("marca-{n}.png"), &b) {
                shots.push((n, p));
            }
        }
    }
    let full_shot = if global { screenshot(app, e, None, true).ok().and_then(|b| write_png(&dir, "pagina-completa.png", &b).ok()) } else { None };
    let _ = eval(app, e, "window.__alphaOverlay && __alphaOverlay.chrome(true)");

    let detail = dir.join("pedido.md");
    std::fs::write(&detail, detail_md(text, &url, &title, &marks, global)).map_err(|err| err.to_string())?;
    let _ = crate::settings::save_to(&dir.join("marcas.json"), &json!({ "url": url, "title": title, "text": text, "global": global, "marks": marks }));
    let message = compose(text, &url, &marks, &shots, page_shot.as_deref(), full_shot.as_deref(), &detail.display().to_string(), global);
    Ok(json!({ "message": message, "dir": dir.display().to_string(), "marks": marks.len() }))
}

// --- Comandos del frontend ----------------------------------------------------------------------

fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> impl std::future::Future<Output = Result<T, String>> {
    async move { tauri::async_runtime::spawn_blocking(f).await.map_err(|err| err.to_string())? }
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn browser_open(app: AppHandle, window: tauri::Window, id: String, url: String, x: f64, y: f64, w: f64, h: f64, owner: Option<String>) -> Result<String, String> {
    let u = normalize_url(&url);
    if let Ok(e) = get(&app, &id) {
        if let Some(o) = owner {
            *e.owner.lock().unwrap() = Some(o);
        }
        let wv = webview(&app, &e)?;
        let _ = wv.set_bounds(tauri::Rect { position: LogicalPosition::new(x, y).into(), size: LogicalSize::new(w.max(1.0), h.max(1.0)).into() });
        let _ = wv.show();
        return Ok(u);
    }
    let parsed: tauri::Url = u.parse().map_err(|err| format!("URL inválida: {err}"))?;
    let label = label_of(&id);
    let win_label = window.label().to_string();
    let (app_nav, id_nav, win_nav) = (app.clone(), id.clone(), win_label.clone());
    let (app_title, id_title, win_title) = (app.clone(), id.clone(), win_label.clone());
    let (app_new, label_new) = (app.clone(), label.clone());
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(parsed))
        .initialization_script(OVERLAY_JS)
        .on_page_load(move |_wv, payload| {
            let loading = matches!(payload.event(), PageLoadEvent::Started);
            let url = payload.url().to_string();
            if let Ok(e) = get(&app_nav, &id_nav) {
                e.page.lock().unwrap()["url"] = json!(url);
            }
            let _ = app_nav.emit_to(&win_nav, "browser-nav", json!({ "id": id_nav, "url": url, "loading": loading }));
        })
        .on_document_title_changed(move |_wv, title| {
            if let Ok(e) = get(&app_title, &id_title) {
                e.page.lock().unwrap()["title"] = json!(title);
            }
            let _ = app_title.emit_to(&win_title, "browser-title", json!({ "id": id_title, "title": title }));
        })
        // Ventanas nuevas (target=_blank, window.open): se abren en el mismo panel.
        .on_new_window(move |url, _features| {
            let (app, label) = (app_new.clone(), label_new.clone());
            std::thread::spawn(move || {
                if let Some(wv) = app.get_webview(&label) {
                    let _ = wv.navigate(url);
                }
            });
            NewWindowResponse::Deny
        });
    let wv = window
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(w.max(1.0), h.max(1.0)))
        .map_err(|err| format!("No se pudo crear el navegador: {err}"))?;
    let e = Arc::new(Entry {
        id: id.clone(),
        label,
        window: win_label,
        owner: Mutex::new(owner),
        opened: Instant::now(),
        console: Mutex::new(VecDeque::new()),
        console_seq: Mutex::new(0),
        marks: Mutex::new(json!([])),
        page: Mutex::new(json!({ "url": u })),
    });
    let _ = wv.label();
    app.state::<BrowserState>().0.lock().unwrap().insert(id.clone(), e.clone());
    subscribe(&app, &e);
    let app2 = app.clone();
    blocking(move || {
        cdp(&app2, &e, "Runtime.enable", json!({}))?;
        cdp(&app2, &e, "Runtime.addBinding", json!({ "name": "__alphaterm" }))?;
        cdp(&app2, &e, "Page.enable", json!({}))?;
        // La primera página pudo cargar antes de la función: se le pregunta directamente (si no,
        // avisa sola en su evento `load`).
        if let Ok(v) = eval(&app2, &e, "window.__alphaOverlay ? { url: location.href, title: document.title, hmr: __alphaOverlay.hmr() } : null") {
            if v.is_object() {
                *e.page.lock().unwrap() = v.clone();
                let _ = app2.emit_to(&e.window, "browser-page", json!({ "id": e.id, "url": v["url"], "title": v["title"], "hmr": v["hmr"] }));
            }
        }
        Ok(())
    })
    .await?;
    Ok(u)
}

#[tauri::command]
pub fn browser_bounds(app: AppHandle, id: String, x: f64, y: f64, w: f64, h: f64, visible: bool) -> Result<(), String> {
    let e = get(&app, &id)?;
    let wv = webview(&app, &e)?;
    if visible {
        wv.set_bounds(tauri::Rect { position: LogicalPosition::new(x, y).into(), size: LogicalSize::new(w.max(1.0), h.max(1.0)).into() }).map_err(|err| err.to_string())?;
        wv.show().map_err(|err| err.to_string())
    } else {
        wv.hide().map_err(|err| err.to_string())
    }
}

#[tauri::command]
pub async fn browser_navigate(app: AppHandle, id: String, url: String) -> Result<String, String> {
    let e = get(&app, &id)?;
    navigate(&app, &e, &url)
}

/// back | forward | reload | hard-reload | stop
#[tauri::command]
pub async fn browser_go(app: AppHandle, id: String, action: String) -> Result<(), String> {
    blocking(move || {
        let e = get(&app, &id)?;
        match action.as_str() {
            "back" => eval(&app, &e, "history.back()").map(|_| ()),
            "forward" => eval(&app, &e, "history.forward()").map(|_| ()),
            "reload" => cdp(&app, &e, "Page.reload", json!({})).map(|_| ()),
            "hard-reload" => cdp(&app, &e, "Page.reload", json!({ "ignoreCache": true })).map(|_| ()),
            "stop" => cdp(&app, &e, "Page.stopLoading", json!({})).map(|_| ()),
            other => Err(format!("Acción desconocida: {other}")),
        }
    })
    .await
}

#[tauri::command]
pub async fn browser_eval(app: AppHandle, id: String, js: String) -> Result<Value, String> {
    blocking(move || {
        let e = get(&app, &id)?;
        eval(&app, &e, &js)
    })
    .await
}

#[tauri::command]
pub async fn browser_request(app: AppHandle, id: String, text: String, global: bool) -> Result<Value, String> {
    blocking(move || {
        let e = get(&app, &id)?;
        request(&app, &e, &text, global)
    })
    .await
}

#[tauri::command]
pub fn browser_set_owner(app: AppHandle, id: String, owner: Option<String>) -> Result<(), String> {
    *get(&app, &id)?.owner.lock().unwrap() = owner;
    Ok(())
}

#[tauri::command]
pub fn browser_close(app: AppHandle, id: String) -> Result<(), String> {
    let e = app.state::<BrowserState>().0.lock().unwrap().remove(&id);
    if let Some(e) = e {
        if let Some(wv) = app.get_webview(&e.label) {
            let _ = wv.close();
        }
    }
    Ok(())
}

/// Se cerró una ventana: sus navegadores se fueron con ella.
pub fn window_closed(app: &AppHandle, label: &str) {
    app.state::<BrowserState>().0.lock().unwrap().retain(|_, e| e.window != label);
}

// --- API de control (agentes) ------------------------------------------------------------------

fn st(p: &Value, k: &str) -> Option<String> {
    p.get(k).and_then(Value::as_str).map(str::to_string).filter(|s| !s.is_empty())
}

/// Métodos `browser_*` que resuelve el backend directamente (abrir uno nuevo lo hace el frontend).
pub fn control(app: &AppHandle, method: &str, p: &Value, caller: &Option<String>) -> Result<Value, String> {
    if method == "browser_list" {
        return Ok(json!({ "browsers": list(app) }));
    }
    let e = resolve(app, st(p, "browser"), caller)?;
    let id = e.id.clone();
    match method {
        "browser_navigate" => {
            let url = st(p, "url").ok_or("Falta url")?;
            let u = navigate(app, &e, &url)?;
            wait_load(app, &e, p.get("timeout_ms").and_then(Value::as_u64).unwrap_or(10_000));
            Ok(json!({ "browser": id, "url": u, "page": page(&e) }))
        }
        "browser_reload" => {
            cdp(app, &e, "Page.reload", json!({ "ignoreCache": p.get("hard").and_then(Value::as_bool).unwrap_or(false) }))?;
            wait_load(app, &e, 10_000);
            Ok(json!({ "browser": id, "reloaded": true }))
        }
        "browser_screenshot" => {
            let bytes = if let Some(sel) = st(p, "selector") {
                let js = format!(
                    "(() => {{ const el = document.querySelector({}); if (!el) return null; const r = el.getBoundingClientRect(); return {{ x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }}; }})()",
                    json!(sel)
                );
                let r = eval(app, &e, &js)?;
                if r.is_null() {
                    return Err(format!("No encontré ningún elemento con el selector {sel}"));
                }
                screenshot(app, &e, Some((r["x"].as_f64().unwrap_or(0.0), r["y"].as_f64().unwrap_or(0.0), r["w"].as_f64().unwrap_or(1.0), r["h"].as_f64().unwrap_or(1.0))), false)?
            } else {
                screenshot(app, &e, None, p.get("full").and_then(Value::as_bool).unwrap_or(false))?
            };
            let dir = std::env::temp_dir().join("AlphaTerm").join("navegador").join("capturas");
            std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
            let name = format!("captura-{}.png", stamp().trim_start_matches("pedido-"));
            let path = write_png(&dir, &name, &bytes)?;
            Ok(json!({ "browser": id, "path": path, "bytes": bytes.len() }))
        }
        "browser_click" => click(app, &e, st(p, "selector").as_deref(), p.get("x").and_then(Value::as_f64), p.get("y").and_then(Value::as_f64)),
        "browser_type" => type_text(app, &e, &st(p, "text").ok_or("Falta text")?, st(p, "selector").as_deref()),
        "browser_key" => key(app, &e, &st(p, "key").ok_or("Falta key")?),
        "browser_scroll" => {
            let dy = p.get("dy").and_then(Value::as_f64).unwrap_or(600.0);
            let dx = p.get("dx").and_then(Value::as_f64).unwrap_or(0.0);
            let v = match st(p, "selector") {
                Some(sel) => eval(app, &e, &format!("(() => {{ const el = document.querySelector({}); if (!el) return null; el.scrollIntoView({{block:'center'}}); return {{ x: scrollX, y: scrollY }}; }})()", json!(sel)))?,
                None => eval(app, &e, &format!("(() => {{ scrollBy({dx}, {dy}); return {{ x: scrollX, y: scrollY }}; }})()"))?,
            };
            Ok(json!({ "browser": id, "scroll": v }))
        }
        "browser_eval" => Ok(json!({ "browser": id, "value": eval(app, &e, &st(p, "js").ok_or("Falta js")?)? })),
        "browser_snapshot" => {
            let max = p.get("max_lines").and_then(Value::as_u64).unwrap_or(400);
            let v = eval(app, &e, &format!("window.__alphaOverlay ? __alphaOverlay.snapshot({max}) : document.body.innerText.slice(0, 20000)"))?;
            Ok(json!({ "browser": id, "page": page(&e), "outline": v }))
        }
        "browser_console" => {
            let since = p.get("since").and_then(Value::as_u64).unwrap_or(0);
            let errors = p.get("errors_only").and_then(Value::as_bool).unwrap_or(false);
            Ok(json!({ "browser": id, "entries": console(&e, since, errors) }))
        }
        "browser_marks" => Ok(json!({ "browser": id, "page": page(&e), "marks": marks(&e) })),
        other => Err(format!("Método desconocido: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normaliza_urls() {
        assert_eq!(normalize_url("localhost:5173"), "http://localhost:5173");
        assert_eq!(normalize_url("127.0.0.1:3000/x"), "http://127.0.0.1:3000/x");
        assert_eq!(normalize_url("5173"), "http://localhost:5173");
        assert_eq!(normalize_url("ejemplo.com"), "https://ejemplo.com");
        assert_eq!(normalize_url("https://a.b/c"), "https://a.b/c");
        assert_eq!(normalize_url("app.test"), "http://app.test");
        assert_eq!(normalize_url(""), "about:blank");
    }

    #[test]
    fn arma_el_pedido() {
        let marks = vec![json!({
            "n": 1, "tag": "button", "classes": ["btn", "primary"], "text": "Enviar",
            "selector": "main > button", "component": { "name": "Submit", "framework": "React", "source": { "file": "src/Submit.tsx", "line": 12 } }
        })];
        let shots = vec![(1usize, "C:\\t\\marca-1.png".to_string())];
        let m = compose("Hacelo azul", "http://localhost:5173/", &marks, &shots, Some("C:\\t\\pagina.png"), None, "C:\\t\\pedido.md", false);
        assert!(m.starts_with("Pedido desde el navegador de AlphaTerm (página http://localhost:5173/):\nHacelo azul\n"));
        assert!(m.contains("1. <button class=\"btn primary\"> «Enviar» · componente Submit (React) en src/Submit.tsx:12 · selector `main > button` · captura C:\\t\\marca-1.png\n"));
        assert!(m.contains("con los elementos numerados"));
        assert!(m.ends_with("C:\\t\\pedido.md"));
        assert!(!m.contains("cambio global"));
        let g = compose("Todo más grande", "http://x/", &[], &[], None, Some("C:\\t\\full.png"), "d.md", true);
        assert!(g.contains("Es un cambio global"));
        assert!(g.contains("Captura de la página entera: C:\\t\\full.png"));
        assert!(!g.contains("Elementos marcados"));
    }

    #[test]
    fn detalle_con_html_y_estilos() {
        let marks = vec![json!({ "n": 2, "tag": "div", "html": "<div>hola</div>", "styles": { "color": "red" }, "rect": { "x": 1, "y": 2, "w": 3, "h": 4 } })];
        let md = detail_md("pedido", "u", "t", &marks, false);
        assert!(md.contains("## Elemento 2"));
        assert!(md.contains("  - color: red"));
        assert!(md.contains("```html\n<div>hola</div>\n```"));
        assert!(md.contains("x=1 y=2 · tamaño 3×4 px"));
    }
}
