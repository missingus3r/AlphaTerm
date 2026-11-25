//! Built-in browser: a child WebView2 inside the AlphaTerm window, placed exactly
//! over the spot of its pane (the frontend sends the rectangle). It's driven through the
//! DevTools protocol (CDP) of WebView2 itself: screenshots, clicks, keys, evaluating JS and reading the console.
//!
//! `scripts/browser-overlay.js` (the marking layer) is injected into every page. The layer talks to
//! AlphaTerm through the `__alphaterm` function, added with `Runtime.addBinding`: marks
//! arrive as `Runtime.bindingCalled` events and are forwarded to the window as `browser-marks`.
//!
//! On Linux the child is a WebKitGTK webview, driven with WebKit's own API (`webkit.rs`); the marks,
//! the console and the errors arrive through a script message handler (`scripts/browser-linux.js`).
//!
//! The methods that talk to CDP (or WebKit) block waiting for the response: never call them from the main
//! thread (commands are async and go through `spawn_blocking`; the control API uses its own threads).

use crate::i18n::{tr, Lang};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
#[cfg(windows)]
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};

const OVERLAY_JS: &str = include_str!("../scripts/browser-overlay.js");
/// Linux: the `__alphaterm` channel, console, errors and input (what CDP gives on Windows).
#[cfg(target_os = "linux")]
const PLATFORM_JS: &str = include_str!("../scripts/browser-linux.js");
#[cfg(not(target_os = "linux"))]
const PLATFORM_JS: &str = "";
#[cfg(windows)]
const CDP_TIMEOUT: Duration = Duration::from_secs(20);
const CONSOLE_MAX: usize = 300;

pub struct Entry {
    pub id: String,
    pub label: String,
    pub window: String,
    /// "Owner" terminal pane (the agent that opened it, or the one requests go to).
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
    // Just a port ("5173"): the local server.
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
    app.state::<BrowserState>().0.lock().unwrap().get(id).cloned().ok_or_else(|| tr!("No hay un navegador con id {id}", "There's no browser with id {id}", "Não há um navegador com id {id}"))
}

pub(crate) fn webview(app: &AppHandle, e: &Entry) -> Result<tauri::Webview, String> {
    app.get_webview(&e.label).ok_or_else(|| tr("El navegador ya no está abierto", "The browser is no longer open", "O navegador não está mais aberto").into())
}

/// List of open browsers (for the API).
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

/// Browser for an API request: the requested one, the calling pane's, or the last one opened.
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
    all.into_iter().next().ok_or_else(|| {
        tr(
            "No hay ningún navegador abierto en AlphaTerm. Abrí uno con browser_open y la URL.",
            "There's no browser open in AlphaTerm. Open one with browser_open and the URL.",
            "Não há nenhum navegador aberto no AlphaTerm. Abra um com browser_open e a URL.",
        )
        .into()
    })
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
    let raw = rx
        .recv_timeout(CDP_TIMEOUT)
        .map_err(|_| tr!("El navegador no contestó {method} a tiempo", "The browser didn't answer {method} in time", "O navegador não respondeu {method} a tempo"))??;
    serde_json::from_str(&raw).map_err(|err| tr!("{method}: respuesta inválida ({err})", "{method}: invalid response ({err})", "{method}: resposta inválida ({err})"))
}

#[cfg(not(any(windows, target_os = "linux")))]
fn unsupported<T>() -> Result<T, String> {
    Err(tr("El navegador integrado solo está hecho para Windows y Linux", "The built-in browser only works on Windows and Linux", "O navegador integrado só funciona no Windows e no Linux").into())
}

/// Subscribes to the DevTools events of interest (marks, console, errors).
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

/// Linux: the page's messages (marks, page, edit mode, console, errors) arrive through `message` (the `browser-page` plugin).
#[cfg(not(windows))]
fn subscribe(_app: &AppHandle, _e: &Arc<Entry>) {}

/// Command of the `browser-page` plugin: what a browser page sends with `__alphaterm` (Linux,
/// `scripts/browser-linux.js`). Only the browsers' webviews may call it (`capabilities/browser-pages.json`),
/// and each one only reaches its own entry: it's found by the label of the webview that calls.
#[tauri::command]
pub fn message(app: AppHandle, webview: tauri::Webview, msg: String) {
    let id = app.state::<BrowserState>().0.lock().unwrap().values().find(|e| e.label == webview.label()).map(|e| e.id.clone());
    if let Some(id) = id {
        on_message(&app, &id, &msg);
    }
}

/// A message of the `__alphaterm` function (the marking layer; on Linux, also the console and errors).
fn on_message(app: &AppHandle, id: &str, payload: &str) {
    let Ok(e) = get(app, id) else { return };
    let Ok(msg) = serde_json::from_str::<Value>(payload) else { return };
    let s = |k: &str| msg.get(k).and_then(Value::as_str).map(str::to_string);
    match msg.get("type").and_then(Value::as_str) {
        Some("console") => push_console(app, &e, &s("level").unwrap_or_else(|| "log".into()), s("text").unwrap_or_default(), s("at")),
        Some("exception") => push_console(app, &e, "exception", s("text").unwrap_or_else(|| "Error".into()), s("at")),
        _ => on_binding(app, &e, id, &msg),
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
fn on_event(app: &AppHandle, id: &str, ev: &str, raw: &str) {
    let Ok(e) = get(app, id) else { return };
    let Ok(v) = serde_json::from_str::<Value>(raw) else { return };
    match ev {
        "Runtime.bindingCalled" => {
            if v.get("name").and_then(Value::as_str) != Some("__alphaterm") {
                return;
            }
            if let Some(p) = v.get("payload").and_then(Value::as_str) {
                on_message(app, id, p);
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

fn on_binding(app: &AppHandle, e: &Entry, id: &str, msg: &Value) {
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
            // New page: the previous page's marks no longer apply.
            *e.marks.lock().unwrap() = json!([]);
            let _ = app.emit_to(&e.window, "browser-page", json!({ "id": id, "url": msg.get("url"), "title": msg.get("title"), "hmr": msg.get("hmr") }));
        }
        Some("edit") => {
            let _ = app.emit_to(&e.window, "browser-edit", json!({ "id": id, "on": msg.get("on") }));
        }
        _ => {}
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
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

// --- Operations -------------------------------------------------------------------------------

/// Evaluates JS in the page (awaits promises) and returns the value as JSON.
pub fn eval(app: &AppHandle, e: &Entry, js: &str) -> Result<Value, String> {
    #[cfg(target_os = "linux")]
    return crate::webkit::eval(app, e, js);
    #[cfg(not(any(windows, target_os = "linux")))]
    return unsupported();
    #[cfg(windows)]
    eval_cdp(app, e, js)
}

#[cfg(windows)]
fn eval_cdp(app: &AppHandle, e: &Entry, js: &str) -> Result<Value, String> {
    let r = cdp(app, e, "Runtime.evaluate", json!({ "expression": js, "returnByValue": true, "awaitPromise": true, "userGesture": true }))?;
    if let Some(ex) = r.get("exceptionDetails") {
        let msg = ex["exception"]["description"].as_str().or(ex["text"].as_str()).unwrap_or(tr("Error en el script", "Script error", "Erro no script"));
        return Err(msg.to_string());
    }
    Ok(r["result"].get("value").cloned().unwrap_or(Value::Null))
}

/// PNG capture: the viewport, the whole page, or a clip (document coordinates, CSS px).
pub fn screenshot(app: &AppHandle, e: &Entry, clip: Option<(f64, f64, f64, f64)>, full: bool) -> Result<Vec<u8>, String> {
    #[cfg(target_os = "linux")]
    return crate::webkit::screenshot(app, e, clip, full);
    #[cfg(not(any(windows, target_os = "linux")))]
    return unsupported();
    #[cfg(windows)]
    screenshot_cdp(app, e, clip, full)
}

#[cfg(windows)]
fn screenshot_cdp(app: &AppHandle, e: &Entry, clip: Option<(f64, f64, f64, f64)>, full: bool) -> Result<Vec<u8>, String> {
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
    let data = r["data"].as_str().ok_or(tr("La captura vino vacía", "The screenshot came back empty", "A captura veio vazia"))?;
    base64::engine::general_purpose::STANDARD.decode(data).map_err(|err| err.to_string())
}

fn no_element(selector: &str) -> String {
    tr!("No encontré ningún elemento con el selector {selector}", "No element matches the selector {selector}", "Nenhum elemento corresponde ao seletor {selector}")
}

/// Center of an element in the viewport (scrolls it into view first).
fn point_of(app: &AppHandle, e: &Entry, selector: &str) -> Result<(f64, f64, String), String> {
    let js = format!(
        "(() => {{ const el = document.querySelector({sel}); if (!el) return null; el.scrollIntoView({{block:'center', inline:'center'}}); \
         const r = el.getBoundingClientRect(); return {{ x: r.left + r.width / 2, y: r.top + r.height / 2, what: el.tagName.toLowerCase() + ' ' + (el.innerText || el.value || '').trim().slice(0, 60) }}; }})()",
        sel = json!(selector)
    );
    let v = eval(app, e, &js)?;
    if v.is_null() {
        return Err(no_element(selector));
    }
    Ok((v["x"].as_f64().unwrap_or(0.0), v["y"].as_f64().unwrap_or(0.0), v["what"].as_str().unwrap_or("").to_string()))
}

pub fn click(app: &AppHandle, e: &Entry, selector: Option<&str>, x: Option<f64>, y: Option<f64>) -> Result<Value, String> {
    let (px, py, what) = match selector {
        Some(s) => point_of(app, e, s)?,
        None => (
            x.ok_or(tr("Falta selector o x/y", "Missing selector or x/y", "Falta selector ou x/y"))?,
            y.ok_or(tr("Falta y", "Missing y", "Falta y"))?,
            String::new(),
        ),
    };
    // So the marking layer doesn't swallow the click if it's in edit mode.
    let _ = eval(app, e, "window.__alphaPass = true");
    let res = mouse_click(app, e, px, py);
    let _ = eval(app, e, "window.__alphaPass = false");
    res?;
    Ok(json!({ "clicked": { "x": px, "y": py }, "element": what }))
}

#[cfg(windows)]
fn mouse_click(app: &AppHandle, e: &Entry, px: f64, py: f64) -> Result<(), String> {
    for (t, buttons) in [("mouseMoved", 0), ("mousePressed", 1), ("mouseReleased", 0)] {
        cdp(app, e, "Input.dispatchMouseEvent", json!({ "type": t, "x": px, "y": py, "button": if t == "mouseMoved" { "none" } else { "left" }, "buttons": buttons, "clickCount": 1 }))?;
    }
    Ok(())
}

/// Linux: DOM events at that point (see `scripts/browser-linux.js`).
#[cfg(not(windows))]
fn mouse_click(app: &AppHandle, e: &Entry, px: f64, py: f64) -> Result<(), String> {
    let r = eval(app, e, &format!("__alphaInput.click({px}, {py})"))?;
    if r["ok"].as_bool() == Some(false) {
        return Err(tr!("No hay ningún elemento en {px}, {py}", "There's no element at {px}, {py}", "Não há nenhum elemento em {px}, {py}"));
    }
    Ok(())
}

pub fn type_text(app: &AppHandle, e: &Entry, text: &str, selector: Option<&str>) -> Result<Value, String> {
    if let Some(s) = selector {
        click(app, e, Some(s), None, None)?;
    }
    #[cfg(windows)]
    cdp(app, e, "Input.insertText", json!({ "text": text }))?;
    #[cfg(not(windows))]
    eval(app, e, &format!("__alphaInput.type({})", json!(text)))?;
    Ok(json!({ "typed": text.chars().count() }))
}

/// Special keys by name: Enter, Tab, Escape, Backspace, Delete, ArrowUp/Down/Left/Right,
/// Home, End, PageUp, PageDown. With modifiers: "Ctrl+A", "Shift+Tab".
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
        _ => return Err(tr!("No conozco la tecla {name}", "Unknown key {name}", "Tecla desconhecida: {name}")),
    };
    let plain_char = text.is_none() && key.chars().count() == 1 && m & 2 == 0 && m & 1 == 0;
    let down_text = text.map(str::to_string).or_else(|| plain_char.then(|| key.clone()));
    #[cfg(not(windows))]
    {
        let _ = (vk, &down_text);
        let k = json!({ "key": key, "code": code, "keyCode": vk, "text": down_text, "modifiers": m });
        let _ = eval(app, e, "window.__alphaPass = true");
        let r = eval(app, e, &format!("__alphaInput.key({k})"));
        let _ = eval(app, e, "window.__alphaPass = false");
        r?;
        Ok(json!({ "pressed": combo }))
    }
    #[cfg(windows)]
    {
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
}

/// Reload (`hard`: without the cache).
fn reload(app: &AppHandle, e: &Entry, hard: bool) -> Result<(), String> {
    #[cfg(windows)]
    return cdp(app, e, "Page.reload", json!({ "ignoreCache": hard })).map(|_| ());
    #[cfg(target_os = "linux")]
    return crate::webkit::reload(app, e, hard);
    #[cfg(not(any(windows, target_os = "linux")))]
    return unsupported();
}

fn stop_loading(app: &AppHandle, e: &Entry) -> Result<(), String> {
    #[cfg(windows)]
    return cdp(app, e, "Page.stopLoading", json!({})).map(|_| ());
    #[cfg(target_os = "linux")]
    return crate::webkit::stop(app, e);
    #[cfg(not(any(windows, target_os = "linux")))]
    return unsupported();
}

pub fn navigate(app: &AppHandle, e: &Entry, url: &str) -> Result<String, String> {
    let u = normalize_url(url);
    let parsed: tauri::Url = u.parse().map_err(|err| tr!("URL inválida: {err}", "Invalid URL: {err}", "URL inválida: {err}"))?;
    webview(app, e)?.navigate(parsed).map_err(|err| err.to_string())?;
    Ok(u)
}

/// Waits for the page to finish loading (or for the time to run out).
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

// --- Request to the agent ----------------------------------------------------------------------

fn stamp() -> String {
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    format!("pedido-{ms}")
}

fn line_of_mark(l: Lang, m: &Value) -> String {
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
        let more = if text.chars().count() > 70 { "…" } else { "" };
        desc.push_str(&tr_in!(l; " «{t}{more}»", " \"{t}{more}\"", " \"{t}{more}\""));
    }
    if let Some(c) = m.get("component").filter(|c| !c.is_null()) {
        let (name, framework) = (c["name"].as_str().unwrap_or("?"), c["framework"].as_str().unwrap_or(""));
        desc.push_str(&tr_in!(l; " · componente {name} ({framework})", " · component {name} ({framework})", " · componente {name} ({framework})"));
        if let Some(f) = c["source"]["file"].as_str() {
            match c["source"]["line"].as_i64() {
                Some(n) => desc.push_str(&tr_in!(l; " en {f}:{n}", " in {f}:{n}", " em {f}:{n}")),
                None => desc.push_str(&tr_in!(l; " en {f}", " in {f}", " em {f}")),
            }
        }
    }
    if let Some(sel) = m["selector"].as_str() {
        desc.push_str(&tr_in!(l; " · selector `{sel}`", " · selector `{sel}`", " · seletor `{sel}`"));
    }
    desc
}

/// Text typed to the agent in its terminal. Pure (tested).
#[allow(clippy::too_many_arguments)]
pub fn compose(l: Lang, text: &str, url: &str, marks: &[Value], shots: &[(usize, String)], page_shot: Option<&str>, full_shot: Option<&str>, detail: &str, global: bool) -> String {
    let mut out = String::new();
    out.push_str(&tr_in!(l;
        "Pedido desde el navegador de AlphaTerm (página {url}):\n",
        "Request from AlphaTerm's built-in browser (page {url}):\n",
        "Pedido do navegador integrado do AlphaTerm (página {url}):\n"
    ));
    out.push_str(text.trim());
    out.push_str("\n\n");
    out.push_str(l.pick(
        "Hacé el cambio en el código fuente del proyecto: el navegador lo muestra al recargar (el servidor de desarrollo recarga solo).\n",
        "Make the change in the project's source code: the browser shows it on reload (the dev server reloads by itself).\n",
        "Faça a alteração no código-fonte do projeto: o navegador mostra ao recarregar (o servidor de desenvolvimento recarrega sozinho).\n",
    ));
    if global {
        out.push_str(l.pick("Es un cambio global, sobre todo el sitio.\n", "It's a global change, across the whole site.\n", "É uma alteração global, em todo o site.\n"));
    }
    if !marks.is_empty() {
        out.push_str(if global {
            l.pick("Además marqué estos elementos:\n", "I also marked these elements:\n", "Também marquei estes elementos:\n")
        } else {
            l.pick("Elementos marcados:\n", "Marked elements:\n", "Elementos marcados:\n")
        });
        for (i, m) in marks.iter().enumerate() {
            let n = m["n"].as_u64().map(|n| n as usize).unwrap_or(i + 1);
            out.push_str(&format!("{n}. {}", line_of_mark(l, m)));
            if let Some((_, p)) = shots.iter().find(|(k, _)| *k == n) {
                out.push_str(&tr_in!(l; " · captura {p}", " · screenshot {p}", " · captura {p}"));
            }
            out.push('\n');
        }
    }
    if let Some(p) = page_shot {
        let numbered = if marks.is_empty() { "" } else { l.pick(" (con los elementos numerados)", " (with the elements numbered)", " (com os elementos numerados)") };
        out.push_str(&tr_in!(l; "Captura de lo que se ve{numbered}: {p}\n", "Screenshot of the visible area{numbered}: {p}\n", "Captura da área visível{numbered}: {p}\n"));
    }
    if let Some(p) = full_shot {
        out.push_str(&tr_in!(l; "Captura de la página entera: {p}\n", "Full-page screenshot: {p}\n", "Captura da página inteira: {p}\n"));
    }
    out.push_str(&tr_in!(l;
        "Detalle (HTML, estilos y posición de cada elemento): {detail}",
        "Details (HTML, styles and position of each element): {detail}",
        "Detalhes (HTML, estilos e posição de cada elemento): {detail}"
    ));
    out
}

fn detail_md(l: Lang, text: &str, url: &str, title: &str, marks: &[Value], global: bool) -> String {
    let yes = if global { l.pick("sí", "yes", "sim") } else { l.pick("no", "no", "não") };
    let text = text.trim();
    let mut md = tr_in!(l;
        "# Pedido desde el navegador de AlphaTerm\n\n- Página: {url}\n- Título: {title}\n- Cambio global: {yes}\n\n## Pedido\n\n{text}\n",
        "# Request from AlphaTerm's built-in browser\n\n- Page: {url}\n- Title: {title}\n- Global change: {yes}\n\n## Request\n\n{text}\n",
        "# Pedido do navegador integrado do AlphaTerm\n\n- Página: {url}\n- Título: {title}\n- Alteração global: {yes}\n\n## Pedido\n\n{text}\n"
    );
    for (i, m) in marks.iter().enumerate() {
        let n = m["n"].as_u64().unwrap_or(i as u64 + 1);
        let line = line_of_mark(l, m);
        md.push_str(&tr_in!(l; "\n## Elemento {n}\n\n{line}\n\n", "\n## Element {n}\n\n{line}\n\n", "\n## Elemento {n}\n\n{line}\n\n"));
        if let Some(c) = m.get("component").filter(|c| !c.is_null()) {
            let chain: Vec<&str> = c["chain"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
            if chain.len() > 1 {
                let chain = chain.join(" ← ");
                md.push_str(&tr_in!(l; "- Componentes (de adentro hacia afuera): {chain}\n", "- Components (innermost first): {chain}\n", "- Componentes (de dentro para fora): {chain}\n"));
            }
        }
        let r = &m["rect"];
        let (x, y, w, h) = (&r["x"], &r["y"], &r["w"], &r["h"]);
        md.push_str(&tr_in!(l;
            "- Posición en la página: x={x} y={y} · tamaño {w}×{h} px\n",
            "- Position on the page: x={x} y={y} · size {w}×{h} px\n",
            "- Posição na página: x={x} y={y} · tamanho {w}×{h} px\n"
        ));
        if let Some(attrs) = m["attrs"].as_object().filter(|a| !a.is_empty()) {
            md.push_str(l.pick("- Atributos: ", "- Attributes: ", "- Atributos: "));
            md.push_str(&attrs.iter().map(|(k, v)| format!("{k}=\"{}\"", v.as_str().unwrap_or(""))).collect::<Vec<_>>().join(", "));
            md.push('\n');
        }
        if let Some(st) = m["styles"].as_object().filter(|a| !a.is_empty()) {
            md.push_str(l.pick("- Estilos calculados:\n", "- Computed styles:\n", "- Estilos calculados:\n"));
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
    std::fs::write(&p, bytes).map_err(|err| tr!("No se pudo guardar {}: {err}", "Couldn't save {}: {err}", "Não foi possível salvar {}: {err}"; p.display()))?;
    Ok(p.display().to_string())
}

/// Builds the request: screenshots (viewport with numbers, each mark cropped, the whole page if global),
/// `pedido.md` and `marcas.json`, and the text for the agent.
pub fn request(app: &AppHandle, e: &Entry, text: &str, global: bool, l: Lang) -> Result<Value, String> {
    let marks: Vec<Value> = e.marks.lock().unwrap().as_array().cloned().unwrap_or_default();
    if marks.is_empty() && !global {
        return Err(l
            .pick(
                "No hay elementos marcados (o marcá «Todo el sitio»).",
                "There are no marked elements (or check \"Whole site\").",
                "Não há elementos marcados (ou marque \"Todo o site\").",
            )
            .into());
    }
    let info = eval(app, e, "({ url: location.href, title: document.title })").unwrap_or(json!({}));
    let url = info["url"].as_str().unwrap_or("").to_string();
    let title = info["title"].as_str().unwrap_or("").to_string();
    let dir: PathBuf = crate::os::temp_dir().join("navegador").join(stamp());
    std::fs::create_dir_all(&dir).map_err(|err| tr_in!(l; "No se pudo crear {}: {err}", "Couldn't create {}: {err}", "Não foi possível criar {}: {err}"; dir.display()))?;

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
    std::fs::write(&detail, detail_md(l, text, &url, &title, &marks, global)).map_err(|err| err.to_string())?;
    let _ = crate::settings::save_to(&dir.join("marcas.json"), &json!({ "url": url, "title": title, "text": text, "global": global, "marks": marks }));
    let message = compose(l, text, &url, &marks, &shots, page_shot.as_deref(), full_shot.as_deref(), &detail.display().to_string(), global);
    Ok(json!({ "message": message, "dir": dir.display().to_string(), "marks": marks.len() }))
}

// --- Frontend commands --------------------------------------------------------------------------

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
        set_rect(&app, &e, &wv, x, y, w, h)?;
        let _ = wv.show();
        return Ok(u);
    }
    let parsed: tauri::Url = u.parse().map_err(|err| tr!("URL inválida: {err}", "Invalid URL: {err}", "URL inválida: {err}"))?;
    let label = label_of(&id);
    let win_label = window.label().to_string();
    let (app_nav, id_nav, win_nav) = (app.clone(), id.clone(), win_label.clone());
    let (app_title, id_title, win_title) = (app.clone(), id.clone(), win_label.clone());
    let (app_new, label_new) = (app.clone(), label.clone());
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(parsed))
        .initialization_script(format!("window.__ALPHATERM_LANG__ = \"{}\";\n{PLATFORM_JS}\n{OVERLAY_JS}", crate::i18n::lang().code()))
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
        // New windows (target=_blank, window.open): they open in the same pane.
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
        .map_err(|err| tr!("No se pudo crear el navegador: {err}", "Couldn't create the browser: {err}", "Não foi possível criar o navegador: {err}"))?;
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
    #[cfg(target_os = "linux")]
    {
        let (app3, e3) = (app.clone(), e.clone());
        blocking(move || crate::webkit::attach(&app3, &e3, x, y, w, h)).await?;
    }
    subscribe(&app, &e);
    let app2 = app.clone();
    blocking(move || {
        #[cfg(windows)]
        {
            cdp(&app2, &e, "Runtime.enable", json!({}))?;
            cdp(&app2, &e, "Runtime.addBinding", json!({ "name": "__alphaterm" }))?;
            cdp(&app2, &e, "Page.enable", json!({}))?;
        }
        // The first page may have loaded before the function was there: it's asked directly (otherwise,
        // it reports by itself in its `load` event).
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

/// Places the browser over its pane (logical px of the window). On Linux it's a layer of the overlay (see `webkit.rs`).
#[allow(clippy::too_many_arguments)]
fn set_rect(_app: &AppHandle, _e: &Entry, wv: &tauri::Webview, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let _ = wv;
        crate::webkit::place(_app, _e, x, y, w, h)
    }
    #[cfg(not(target_os = "linux"))]
    {
        wv.set_bounds(tauri::Rect { position: LogicalPosition::new(x, y).into(), size: LogicalSize::new(w.max(1.0), h.max(1.0)).into() }).map_err(|err| err.to_string())
    }
}

#[tauri::command]
pub fn browser_bounds(app: AppHandle, id: String, x: f64, y: f64, w: f64, h: f64, visible: bool) -> Result<(), String> {
    let e = get(&app, &id)?;
    let wv = webview(&app, &e)?;
    if visible {
        set_rect(&app, &e, &wv, x, y, w, h)?;
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
            "reload" => reload(&app, &e, false),
            "hard-reload" => reload(&app, &e, true),
            "stop" => stop_loading(&app, &e),
            other => Err(tr!("Acción desconocida: {other}", "Unknown action: {other}", "Ação desconhecida: {other}")),
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
pub async fn browser_request(app: AppHandle, id: String, text: String, global: bool, lang: Option<String>) -> Result<Value, String> {
    // The language of the window making the request (if it sends it); otherwise, the app's.
    let l = lang.as_deref().and_then(Lang::parse).unwrap_or_else(crate::i18n::lang);
    blocking(move || {
        let e = get(&app, &id)?;
        request(&app, &e, &text, global, l)
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
        #[cfg(target_os = "linux")]
        crate::webkit::forget(&e.label);
        if let Some(wv) = app.get_webview(&e.label) {
            let _ = wv.close();
        }
    }
    Ok(())
}

/// A window was closed: its browsers went with it.
pub fn window_closed(app: &AppHandle, label: &str) {
    app.state::<BrowserState>().0.lock().unwrap().retain(|_, e| e.window != label);
}

// --- Control API (agents) ----------------------------------------------------------------------

/// "Missing <parameter>" (the parameter name isn't translated).
fn missing(name: &str) -> String {
    tr!("Falta {name}", "Missing {name}", "Falta {name}")
}

fn st(p: &Value, k: &str) -> Option<String> {
    p.get(k).and_then(Value::as_str).map(str::to_string).filter(|s| !s.is_empty())
}

/// `browser_*` methods that the backend resolves directly (opening a new one is done by the frontend).
pub fn control(app: &AppHandle, method: &str, p: &Value, caller: &Option<String>) -> Result<Value, String> {
    if method == "browser_list" {
        return Ok(json!({ "browsers": list(app) }));
    }
    let e = resolve(app, st(p, "browser"), caller)?;
    let id = e.id.clone();
    match method {
        "browser_navigate" => {
            let url = st(p, "url").ok_or_else(|| missing("url"))?;
            let u = navigate(app, &e, &url)?;
            wait_load(app, &e, p.get("timeout_ms").and_then(Value::as_u64).unwrap_or(10_000));
            Ok(json!({ "browser": id, "url": u, "page": page(&e) }))
        }
        "browser_reload" => {
            reload(app, &e, p.get("hard").and_then(Value::as_bool).unwrap_or(false))?;
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
                    return Err(no_element(&sel));
                }
                screenshot(app, &e, Some((r["x"].as_f64().unwrap_or(0.0), r["y"].as_f64().unwrap_or(0.0), r["w"].as_f64().unwrap_or(1.0), r["h"].as_f64().unwrap_or(1.0))), false)?
            } else {
                screenshot(app, &e, None, p.get("full").and_then(Value::as_bool).unwrap_or(false))?
            };
            let dir = crate::os::temp_dir().join("navegador").join("capturas");
            std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
            let name = format!("captura-{}.png", stamp().trim_start_matches("pedido-"));
            let path = write_png(&dir, &name, &bytes)?;
            Ok(json!({ "browser": id, "path": path, "bytes": bytes.len() }))
        }
        "browser_click" => click(app, &e, st(p, "selector").as_deref(), p.get("x").and_then(Value::as_f64), p.get("y").and_then(Value::as_f64)),
        "browser_type" => type_text(app, &e, &st(p, "text").ok_or_else(|| missing("text"))?, st(p, "selector").as_deref()),
        "browser_key" => key(app, &e, &st(p, "key").ok_or_else(|| missing("key"))?),
        "browser_scroll" => {
            let dy = p.get("dy").and_then(Value::as_f64).unwrap_or(600.0);
            let dx = p.get("dx").and_then(Value::as_f64).unwrap_or(0.0);
            let v = match st(p, "selector") {
                Some(sel) => eval(app, &e, &format!("(() => {{ const el = document.querySelector({}); if (!el) return null; el.scrollIntoView({{block:'center'}}); return {{ x: scrollX, y: scrollY }}; }})()", json!(sel)))?,
                None => eval(app, &e, &format!("(() => {{ scrollBy({dx}, {dy}); return {{ x: scrollX, y: scrollY }}; }})()"))?,
            };
            Ok(json!({ "browser": id, "scroll": v }))
        }
        "browser_eval" => Ok(json!({ "browser": id, "value": eval(app, &e, &st(p, "js").ok_or_else(|| missing("js"))?)? })),
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
        other => Err(tr!("Método desconocido: {other}", "Unknown method: {other}", "Método desconhecido: {other}")),
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
        let m = compose(Lang::Es, "Hacelo azul", "http://localhost:5173/", &marks, &shots, Some("C:\\t\\pagina.png"), None, "C:\\t\\pedido.md", false);
        assert!(m.starts_with("Pedido desde el navegador de AlphaTerm (página http://localhost:5173/):\nHacelo azul\n"));
        assert!(m.contains("1. <button class=\"btn primary\"> «Enviar» · componente Submit (React) en src/Submit.tsx:12 · selector `main > button` · captura C:\\t\\marca-1.png\n"));
        assert!(m.contains("con los elementos numerados"));
        assert!(m.ends_with("C:\\t\\pedido.md"));
        assert!(!m.contains("cambio global"));
        let g = compose(Lang::Es, "Todo más grande", "http://x/", &[], &[], None, Some("C:\\t\\full.png"), "d.md", true);
        assert!(g.contains("Es un cambio global"));
        assert!(g.contains("Captura de la página entera: C:\\t\\full.png"));
        assert!(!g.contains("Elementos marcados"));
        let en = compose(Lang::En, "Make it blue", "http://x/", &marks, &shots, Some("p.png"), None, "d.md", false);
        assert!(en.starts_with("Request from AlphaTerm's built-in browser (page http://x/):\nMake it blue\n"), "{en}");
        assert!(en.contains("1. <button class=\"btn primary\"> \"Enviar\" · component Submit (React) in src/Submit.tsx:12 · selector `main > button` · screenshot C:\\t\\marca-1.png\n"), "{en}");
        assert!(en.contains("Screenshot of the visible area (with the elements numbered): p.png"));
        let pt = compose(Lang::Pt, "x", "u", &[], &[], None, None, "d.md", true);
        assert!(pt.contains("É uma alteração global"), "{pt}");
    }

    #[test]
    fn detalle_con_html_y_estilos() {
        let marks = vec![json!({ "n": 2, "tag": "div", "html": "<div>hola</div>", "styles": { "color": "red" }, "rect": { "x": 1, "y": 2, "w": 3, "h": 4 } })];
        let md = detail_md(Lang::Es, "pedido", "u", "t", &marks, false);
        assert!(md.contains("## Elemento 2"));
        assert!(md.contains("  - color: red"));
        assert!(md.contains("```html\n<div>hola</div>\n```"));
        assert!(md.contains("x=1 y=2 · tamaño 3×4 px"));
        let en = detail_md(Lang::En, "request", "u", "t", &marks, true);
        assert!(en.contains("## Element 2") && en.contains("- Global change: yes") && en.contains("- Computed styles:"), "{en}");
        assert!(en.contains("x=1 y=2 · size 3×4 px"));
    }
}
