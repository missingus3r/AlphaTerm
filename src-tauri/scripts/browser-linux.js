// AlphaTerm, built-in browser on Linux (WebKitGTK): what WebView2's DevTools protocol gives on Windows.
// Injected before browser-overlay.js in every page.
// - `__alphaterm(json)`: the function the marking layer uses to talk to AlphaTerm. On Windows it's
//   a CDP binding; here it's the `message` command of the `browser-page` plugin, through Tauri's IPC
//   (only the browsers' webviews may call it).
// - Console and errors: console.* calls, uncaught errors and rejected promises are sent to AlphaTerm
//   (on Windows they come from Runtime.consoleAPICalled / Runtime.exceptionThrown).
// - `__alphaInput`: clicks, typing and keys for the agents (on Windows, Input.dispatch*). They are DOM
//   events (not "trusted" ones), so the default actions are done by hand: following links and
//   submitting forms with a click, Enter, Tab, Backspace, arrows…
(() => {
  if (window.__alphaInput) return;

  // Tauri's invoke, kept now: the page could replace window.__TAURI_INTERNALS__ later.
  const internals = window.__TAURI_INTERNALS__;
  const invoke = internals && typeof internals.invoke === "function" ? internals.invoke.bind(internals) : null;
  const post = (s) => {
    // Errors are swallowed: logging them would go through the console hook and come back here.
    if (invoke) invoke("plugin:browser-page|message", { msg: String(s) }).catch(() => {});
  };
  Object.defineProperty(window, "__alphaterm", { value: post, configurable: true });

  // --- Console --------------------------------------------------------------------------------
  // WebKit's `stack` has only the frames (Chromium's starts with the message): both go.
  const errText = (e) => (e && e.stack ? `${String(e)}\n${e.stack}` : String(e));
  const text = (a) => {
    if (typeof a === "string") return a;
    if (a instanceof Error) return errText(a);
    try {
      const s = JSON.stringify(a);
      return s === undefined ? String(a) : s;
    } catch {
      return String(a);
    }
  };
  const send = (level, args, at) => post(JSON.stringify({ type: "console", level, text: Array.from(args, text).join(" ").slice(0, 4000), at: at || null }));
  const LEVELS = { log: "log", info: "info", warn: "warning", error: "error", debug: "debug", trace: "trace" };
  for (const [name, level] of Object.entries(LEVELS)) {
    const orig = console[name];
    if (typeof orig !== "function") continue;
    console[name] = function (...args) {
      send(level, args);
      return orig.apply(this, args);
    };
  }
  const origAssert = console.assert;
  console.assert = function (cond, ...args) {
    if (!cond) send("assert", args.length ? args : ["Assertion failed"]);
    return origAssert.apply(this, [cond, ...args]);
  };
  window.addEventListener("error", (e) => {
    if (!(e instanceof ErrorEvent)) return;
    const msg = e.error instanceof Error ? errText(e.error) : e.message;
    post(JSON.stringify({ type: "exception", text: String(msg || "Error").slice(0, 4000), at: e.filename ? `${e.filename}:${e.lineno}` : null }));
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    post(JSON.stringify({ type: "exception", text: ("Uncaught (in promise) " + text(r)).slice(0, 4000), at: null }));
  });

  // --- Input ------------------------------------------------------------------------------------
  const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable=""], [contenteditable="true"]';
  const editable = (el) =>
    !!el && (el.isContentEditable || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !/^(button|submit|reset|checkbox|radio|file|image|color|range|hidden)$/i.test(el.type)));
  const focusables = () =>
    Array.from(document.querySelectorAll(FOCUSABLE)).filter((el) => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length > 0);

  function mouse(el, type, x, y, extra) {
    const o = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0, ...extra };
    const E = type.startsWith("pointer") && typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
    return el.dispatchEvent(new E(type, type.startsWith("pointer") ? { pointerId: 1, pointerType: "mouse", isPrimary: true, ...o } : o));
  }

  function click(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return { ok: false };
    mouse(el, "pointerover", x, y);
    mouse(el, "mouseover", x, y);
    mouse(el, "pointermove", x, y);
    mouse(el, "mousemove", x, y);
    const down = mouse(el, "pointerdown", x, y, { buttons: 1 }) & mouse(el, "mousedown", x, y, { buttons: 1 });
    if (down) {
      const f = el.closest(FOCUSABLE);
      if (f && typeof f.focus === "function") f.focus();
      else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    }
    mouse(el, "pointerup", x, y);
    mouse(el, "mouseup", x, y);
    // A dispatched click also runs the default action (follows links, submits, toggles checkboxes).
    mouse(el, "click", x, y, { detail: 1 });
    return { ok: true };
  }

  function insert(text) {
    const el = document.activeElement;
    if (document.execCommand && document.execCommand("insertText", false, text)) return true;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
      // Native setter: React and the like watch it.
      const proto = el.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const set = Object.getOwnPropertyDescriptor(proto, "value").set;
      const s = el.selectionStart ?? el.value.length;
      const e = el.selectionEnd ?? el.value.length;
      set.call(el, el.value.slice(0, s) + text + el.value.slice(e));
      try {
        el.setSelectionRange(s + text.length, s + text.length);
      } catch {}
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return true;
    }
    return false;
  }

  function typeText(text) {
    insert(text);
    return { typed: text.length };
  }

  function defaultAction(k, el, mods) {
    const ctrl = !!(mods & 2);
    const shift = !!(mods & 8);
    const input = el && el.tagName === "INPUT";
    switch (k.key) {
      case "Enter":
        if (el && el.tagName === "TEXTAREA") return insert("\n");
        if (el && el.isContentEditable) return document.execCommand("insertParagraph");
        // WebKit already submits on the dispatched keypress (implicit submission): only if it didn't.
        if (input && el.form && !k.submitted) return el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit();
        if (input) return;
        if (el && (el.tagName === "A" || el.tagName === "BUTTON" || el.tagName === "SUMMARY")) return el.click();
        return;
      case " ":
        if (el && (el.tagName === "BUTTON" || (input && /^(checkbox|radio|button|submit|reset)$/i.test(el.type)))) return el.click();
        if (editable(el)) return insert(" ");
        return window.scrollBy(0, shift ? -innerHeight * 0.8 : innerHeight * 0.8);
      case "Tab": {
        const all = focusables();
        if (!all.length) return;
        const i = all.indexOf(el);
        const next = all[(i + (shift ? -1 : 1) + all.length) % all.length] || all[0];
        return next.focus();
      }
      case "Backspace":
        return editable(el) && document.execCommand("delete");
      case "Delete":
        return editable(el) && document.execCommand("forwardDelete");
      case "ArrowLeft":
      case "ArrowRight":
      case "Home":
      case "End":
        if (editable(el) && typeof el.selectionStart === "number") {
          const n = el.value.length;
          const p = k.key === "Home" ? 0 : k.key === "End" ? n : Math.max(0, Math.min(n, el.selectionStart + (k.key === "ArrowLeft" ? -1 : 1)));
          try {
            el.setSelectionRange(p, p);
          } catch {}
          return;
        }
        if (k.key === "Home") return window.scrollTo(0, 0);
        if (k.key === "End") return window.scrollTo(0, document.documentElement.scrollHeight);
        return window.scrollBy(k.key === "ArrowLeft" ? -40 : 40, 0);
      case "ArrowUp":
      case "ArrowDown":
        if (editable(el) && el.tagName !== "INPUT") return;
        return window.scrollBy(0, k.key === "ArrowUp" ? -40 : 40);
      case "PageUp":
      case "PageDown":
        return window.scrollBy(0, (k.key === "PageUp" ? -1 : 1) * innerHeight * 0.8);
      default:
        if (ctrl && k.key.toLowerCase() === "a") return document.execCommand("selectAll");
        if (k.text && !ctrl && !(mods & 1) && editable(el)) return insert(k.text);
    }
  }

  /** `k`: { key, code, keyCode, text, modifiers } (modifiers like CDP: 1 Alt, 2 Ctrl, 4 Meta, 8 Shift). */
  function key(k) {
    const el = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
    const m = k.modifiers || 0;
    const o = {
      key: k.key,
      code: k.code,
      keyCode: k.keyCode,
      which: k.keyCode,
      bubbles: true,
      cancelable: true,
      composed: true,
      altKey: !!(m & 1),
      ctrlKey: !!(m & 2),
      metaKey: !!(m & 4),
      shiftKey: !!(m & 8),
    };
    const go = el.dispatchEvent(new KeyboardEvent("keydown", o));
    if (go && k.text) {
      const form = el.form;
      const seen = () => (k.submitted = true);
      if (form) form.addEventListener("submit", seen, true);
      el.dispatchEvent(new KeyboardEvent("keypress", { ...o, charCode: k.text.charCodeAt(0) }));
      if (form) form.removeEventListener("submit", seen, true);
    }
    if (go) defaultAction(k, el, m);
    (document.activeElement || el).dispatchEvent(new KeyboardEvent("keyup", o));
    return { pressed: k.key };
  }

  Object.defineProperty(window, "__alphaInput", { value: { click, type: typeText, key }, configurable: true });
})();
