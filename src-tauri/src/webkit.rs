//! Built-in browser on Linux: what `browser.rs` does with WebView2's DevTools protocol on Windows,
//! done with WebKitGTK's own API.
//! - JS is evaluated with `call_async_javascript_function` (it also waits for promises).
//! - Screenshots with `webkit_web_view_get_snapshot` (cairo), cropped here for the marks.
//! - The page talks to AlphaTerm with Tauri's own IPC (the `browser-page` plugin, see
//!   `scripts/browser-linux.js`, which also forwards the console and the errors). Not with a script
//!   message handler of its own: wry listens to all of them and answers each one that isn't Tauri's
//!   with a `console.error` in the page (which the console hook would send again, endlessly).
//!
//! WebKit only lets itself be driven from GTK's main thread: every operation goes there through
//! `with_webview` and waits for the answer. Like with CDP, never call these from the main thread.

use crate::browser::Entry;
use crate::i18n::tr;
use serde_json::Value;
use std::sync::mpsc;
use std::time::Duration;
use tauri::AppHandle;
use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};

const TIMEOUT: Duration = Duration::from_secs(20);

/// Runs `f` with the WebKit view on the main thread and waits for what it sends through `done`.
fn on_main<T: Send + 'static>(
    app: &AppHandle,
    e: &Entry,
    f: impl FnOnce(webkit2gtk::WebView, mpsc::Sender<Result<T, String>>) + Send + 'static,
) -> Result<T, String> {
    let wv = crate::browser::webview(app, e)?;
    let (tx, rx) = mpsc::channel::<Result<T, String>>();
    let tx2 = tx.clone();
    wv.with_webview(move |pw| f(pw.inner(), tx2)).map_err(|err| err.to_string())?;
    drop(tx);
    rx.recv_timeout(TIMEOUT).map_err(|_| tr("El navegador no contestó a tiempo", "The browser didn't answer in time", "O navegador não respondeu a tempo").to_string())?
}

/// The body for `call_async_javascript_function`, like CDP's Runtime.evaluate: an expression returns its value
/// and statements their completion value (`const x = 1; x + 1` → 2); a promise is awaited. Whether it's an
/// expression is decided by compiling it with `new Function` (it doesn't run anything, and its SyntaxError is
/// caught: a failed compilation of the body itself would show up as "Script error." in the page).
fn body_for(js: &str) -> String {
    let src = serde_json::to_string(js).unwrap_or_default();
    format!(
        "const __src = {src};\nlet __expr = true;\ntry {{ new Function('return (' + __src + '\\n);'); }} catch (e) {{ if (!(e instanceof SyntaxError)) throw e; __expr = false; }}\nreturn await eval(__expr ? '(' + __src + '\\n)' : __src);"
    )
}

fn run_js(app: &AppHandle, e: &Entry, body: String) -> Result<Value, String> {
    on_main(app, e, move |view, done| {
        view.call_async_javascript_function(&body, None, None, None, None::<&webkit2gtk::gio::Cancellable>, move |r| {
            use javascriptcore::ValueExt;
            let out = match r {
                Ok(v) if v.is_undefined() || v.is_null() => Ok(Value::Null),
                Ok(v) => Ok(v.to_json(0).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null)),
                Err(err) => Err(err.message().to_string()),
            };
            let _ = done.send(out);
        });
    })
}

/// Evaluates JS in the page (awaits promises) and returns the value as JSON.
pub fn eval(app: &AppHandle, e: &Entry, js: &str) -> Result<Value, String> {
    match run_js(app, e, body_for(js)) {
        // A page whose CSP forbids eval: the code as the function's body (an expression gives its value;
        // statements, only with an explicit `return`).
        Err(err) if err.contains("EvalError") || err.contains("unsafe-eval") => match run_js(app, e, format!("return (\n{js}\n);")) {
            Err(err2) if err2.contains("SyntaxError") => run_js(app, e, js.to_string()),
            other => other,
        },
        other => other,
    }
}

/// PNG of the page: the visible area, or the whole document (optionally cropped to `clip`, in CSS px of the document).
pub fn screenshot(app: &AppHandle, e: &Entry, clip: Option<(f64, f64, f64, f64)>, full: bool) -> Result<Vec<u8>, String> {
    let region = if clip.is_some() || full { SnapshotRegion::FullDocument } else { SnapshotRegion::Visible };
    // Size of the document in CSS px, to go from them to the snapshot's pixels (HiDPI screens).
    let css_w = if region == SnapshotRegion::FullDocument {
        eval(app, e, "Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0, innerWidth)")?.as_f64().unwrap_or(0.0)
    } else {
        eval(app, e, "innerWidth")?.as_f64().unwrap_or(0.0)
    };
    let (w, h, rgba) = on_main(app, e, move |view, done| {
        view.snapshot(region, SnapshotOptions::NONE, None::<&webkit2gtk::gio::Cancellable>, move |r| {
            let _ = done.send(r.map_err(|err| err.message().to_string()).and_then(surface_rgba));
        });
    })?;
    let scale = if css_w > 0.0 { w as f64 / css_w } else { 1.0 };
    let (x0, y0, cw, ch) = match clip {
        Some((x, y, cw, ch)) => ((x.max(0.0) * scale) as u32, (y.max(0.0) * scale) as u32, (cw.max(1.0) * scale).ceil() as u32, (ch.max(1.0) * scale).ceil() as u32),
        None if full => (0, 0, w, h.min((16_000.0 * scale) as u32)),
        None => (0, 0, w, h),
    };
    let (cw, ch) = (cw.min(w.saturating_sub(x0)), ch.min(h.saturating_sub(y0)));
    if cw == 0 || ch == 0 {
        return Err(tr("La captura vino vacía", "The screenshot came back empty", "A captura veio vazia").into());
    }
    let cropped = crop(&rgba, w, x0, y0, cw, ch);
    // In CSS px, like CDP's screenshots with `scale: 1` on Windows (a HiDPI snapshot comes in device px).
    if scale > 1.01 {
        let (nw, nh) = (((cw as f64) / scale).round().max(1.0) as u32, ((ch as f64) / scale).round().max(1.0) as u32);
        return encode_png(nw, nh, &downscale(&cropped, cw, ch, nw, nh));
    }
    encode_png(cw, ch, &cropped)
}

/// Shrinks an RGBA image averaging the area each new pixel covers (any ratio: 2, 1.5, 1.25…).
pub fn downscale(rgba: &[u8], w: u32, h: u32, nw: u32, nh: u32) -> Vec<u8> {
    let (fx, fy) = (w as f64 / nw as f64, h as f64 / nh as f64);
    let mut out = Vec::with_capacity((nw * nh * 4) as usize);
    for oy in 0..nh {
        let (y0, y1) = ((oy as f64 * fy) as u32, (((oy + 1) as f64 * fy).ceil() as u32).min(h).max((oy as f64 * fy) as u32 + 1));
        for ox in 0..nw {
            let (x0, x1) = ((ox as f64 * fx) as u32, (((ox + 1) as f64 * fx).ceil() as u32).min(w).max((ox as f64 * fx) as u32 + 1));
            let mut acc = [0u32; 4];
            for y in y0..y1 {
                for x in x0..x1 {
                    let i = ((y * w + x) * 4) as usize;
                    for c in 0..4 {
                        acc[c] += rgba[i + c] as u32;
                    }
                }
            }
            let n = (y1 - y0) * (x1 - x0);
            out.extend(acc.iter().map(|v| ((v + n / 2) / n) as u8));
        }
    }
    out
}

/// cairo's ARGB32 (premultiplied, native byte order) → straight RGBA.
fn surface_rgba(s: cairo::Surface) -> Result<(u32, u32, Vec<u8>), String> {
    let mut img = cairo::ImageSurface::try_from(s).map_err(|_| "snapshot is not an image surface".to_string())?;
    img.flush();
    let (w, h, stride) = (img.width() as usize, img.height() as usize, img.stride() as usize);
    let data = img.data().map_err(|err| err.to_string())?;
    let mut out = Vec::with_capacity(w * h * 4);
    for y in 0..h {
        for x in 0..w {
            let i = y * stride + x * 4;
            let px = u32::from_ne_bytes([data[i], data[i + 1], data[i + 2], data[i + 3]]);
            out.extend_from_slice(&unpremultiply(px));
        }
    }
    Ok((w as u32, h as u32, out))
}

/// One ARGB32 pixel (premultiplied alpha) → RGBA.
pub fn unpremultiply(px: u32) -> [u8; 4] {
    let a = (px >> 24) as u8;
    let ch = |shift: u32| {
        let c = (px >> shift) & 0xff;
        if a == 0 {
            0
        } else {
            ((c * 255 + a as u32 / 2) / a as u32).min(255) as u8
        }
    };
    [ch(16), ch(8), ch(0), a]
}

pub fn crop(rgba: &[u8], w: u32, x0: u32, y0: u32, cw: u32, ch: u32) -> Vec<u8> {
    let mut out = Vec::with_capacity((cw * ch * 4) as usize);
    for y in y0..y0 + ch {
        let start = ((y * w + x0) * 4) as usize;
        out.extend_from_slice(&rgba[start..start + (cw * 4) as usize]);
    }
    out
}

fn encode_png(w: u32, h: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut buf, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut wr = enc.write_header().map_err(|err| err.to_string())?;
        wr.write_image_data(rgba).map_err(|err| err.to_string())?;
    }
    Ok(buf)
}

// --- Placement over the pane ------------------------------------------------------------------
//
// On Linux Tauri packs child webviews in the window's vertical GtkBox, next to the main one: they
// end up stacked (and shrink the interface) instead of on top of the pane. So the first time, the main
// webview goes inside a GtkOverlay and each browser is a layer of it, placed exactly at the pane's
// rectangle (logical px, the same ones the frontend sends) by the overlay's `get-child-position`.

/// x, y, width and height, in logical px.
type Rect = (i32, i32, i32, i32);

/// Rectangle of each browser, by its widget name (the webview's label).
static RECTS: std::sync::Mutex<Option<std::collections::HashMap<String, Rect>>> = std::sync::Mutex::new(None);

/// Moves the browser from the window's box to the overlay over the main webview, at its rectangle.
pub fn attach(app: &AppHandle, e: &Entry, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    let label = e.label.clone();
    on_main(app, e, move |view, done| {
        use gtk::prelude::*;
        view.set_widget_name(&label);
        let _ = done.send(adopt(&view).map(|_| place_widget(&view, x, y, w, h)));
    })
}

/// New rectangle for an already placed browser.
pub fn place(app: &AppHandle, e: &Entry, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    let wv = crate::browser::webview(app, e)?;
    // Without waiting: it's called every 150 ms while panes move.
    wv.with_webview(move |pw| place_widget(&pw.inner(), x, y, w, h)).map_err(|err| err.to_string())
}

/// The browser was closed: its rectangle is no longer needed.
pub fn forget(label: &str) {
    if let Some(m) = RECTS.lock().unwrap().as_mut() {
        m.remove(label);
    }
}

fn place_widget(view: &webkit2gtk::WebView, x: f64, y: f64, w: f64, h: f64) {
    use gtk::prelude::*;
    let r = (x.max(0.0).round() as i32, y.max(0.0).round() as i32, w.max(1.0).round() as i32, h.max(1.0).round() as i32);
    RECTS.lock().unwrap().get_or_insert_with(Default::default).insert(view.widget_name().to_string(), r);
    // Both things: WebKit lays the page out with the size request (without it, it stays narrow), and the
    // overlay places it exactly at the rectangle (the request alone is a minimum: it wouldn't shrink).
    view.set_size_request(r.2, r.3);
    view.queue_resize();
}

fn adopt(view: &webkit2gtk::WebView) -> Result<(), String> {
    use gtk::prelude::*;
    let parent = view.parent().ok_or("browser without a parent widget")?;
    if parent.is::<gtk::Overlay>() {
        return Ok(());
    }
    let vbox = parent.downcast::<gtk::Box>().map_err(|_| "unexpected browser container".to_string())?;
    let overlay = match vbox.children().into_iter().find_map(|c| c.downcast::<gtk::Overlay>().ok()) {
        Some(o) => o,
        None => {
            // The interface's webview: the first child of the box that isn't this browser.
            let main = vbox
                .children()
                .into_iter()
                .find(|c| c != view.upcast_ref::<gtk::Widget>() && c.is::<webkit2gtk::WebView>())
                .ok_or("main webview not found")?;
            let pos = vbox.children().iter().position(|c| *c == main).unwrap_or(0) as i32;
            let overlay = gtk::Overlay::new();
            // Exactly the rectangle that was asked for: the size request is only a minimum, and WebKit asks
            // for more (it keeps its previous size), so it wouldn't shrink with the pane.
            overlay.connect_get_child_position(|_, child| {
                let r = RECTS.lock().unwrap().as_ref()?.get(child.widget_name().as_str()).copied()?;
                Some(gtk::gdk::Rectangle::new(r.0, r.1, r.2, r.3))
            });
            // `main` holds a reference: removing it from the box doesn't destroy it.
            vbox.remove(&main);
            overlay.add(&main);
            vbox.pack_start(&overlay, true, true, 0);
            vbox.reorder_child(&overlay, pos);
            overlay.show();
            main.show();
            overlay
        }
    };
    vbox.remove(view);
    overlay.add_overlay(view);
    view.set_halign(gtk::Align::Start);
    view.set_valign(gtk::Align::Start);
    view.show();
    Ok(())
}

pub fn reload(app: &AppHandle, e: &Entry, hard: bool) -> Result<(), String> {
    on_main(app, e, move |view, done| {
        if hard {
            view.reload_bypass_cache();
        } else {
            view.reload();
        }
        let _ = done.send(Ok(()));
    })
}

pub fn stop(app: &AppHandle, e: &Entry) -> Result<(), String> {
    on_main(app, e, |view, done| {
        view.stop_loading();
        let _ = done.send(Ok(()));
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn despremultiplica_y_recorta() {
        // Opaque red, transparent, and half-transparent white (128 premultiplied = 255 straight).
        assert_eq!(unpremultiply(0xFFFF0000), [255, 0, 0, 255]);
        assert_eq!(unpremultiply(0x00000000), [0, 0, 0, 0]);
        assert_eq!(unpremultiply(0x80808080), [255, 255, 255, 128]);
        // 3×2 image, crop the 2×1 at (1, 1).
        let img: Vec<u8> = (0..6).flat_map(|i| [i as u8; 4]).collect();
        assert_eq!(crop(&img, 3, 1, 1, 2, 1), vec![4, 4, 4, 4, 5, 5, 5, 5]);
    }

    #[test]
    fn achica_promediando() {
        // 4×2 → 2×1: each pixel is the average of a 2×2 block.
        let img: Vec<u8> = [0u8, 100, 200, 250, 50, 150, 250, 254].iter().flat_map(|&v| [v, v, v, 255]).collect();
        assert_eq!(downscale(&img, 4, 2, 2, 1), vec![75, 75, 75, 255, 239, 239, 239, 255]);
        // Fractional ratio (3 → 2): doesn't go out of bounds and keeps the size.
        let img: Vec<u8> = (0..9).flat_map(|i| [i as u8 * 10; 4]).collect();
        assert_eq!(downscale(&img, 3, 3, 2, 2).len(), 2 * 2 * 4);
    }

    #[test]
    fn cuerpo_de_la_funcion() {
        let b = body_for("a\"b");
        assert!(b.starts_with("const __src = \"a\\\"b\";\n"), "{b}");
        assert!(b.ends_with("return await eval(__expr ? '(' + __src + '\\n)' : __src);"), "{b}");
    }
}
