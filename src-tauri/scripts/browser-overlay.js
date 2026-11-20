// Capa de marcado del navegador de AlphaTerm (se inyecta en cada página que abre el panel).
// - Modo edición: al pasar el mouse se resalta el elemento; al hacer clic se marca (número).
//   Alt+clic marca el elemento padre. Esc sale del modo edición.
// - Cada marca lleva lo que el agente necesita para encontrar el código: etiqueta, clases, texto,
//   selector, HTML, estilos, posición y, si la app lo expone, el componente y su archivo.
// - Le avisa a AlphaTerm por la función `__alphaterm` (la agrega AlphaTerm por DevTools).
(() => {
  if (window.top !== window || window.__alphaOverlay) return;
  const ACCENT = "#8b5cf6";
  const MARK = "#f97316";
  const notify = (msg) => {
    try {
      if (typeof window.__alphaterm === "function") window.__alphaterm(JSON.stringify(msg));
    } catch {
      /* AlphaTerm no está escuchando */
    }
  };

  let host, root, hoverBox, hoverLabel, layer;
  let edit = false;
  let chromeOn = true;
  let hovered = null;
  /** @type {{el: Element, data: any}[]} */
  let marks = [];

  function ensureHost() {
    if (host && host.isConnected) return;
    if (!host) {
      host = document.createElement("alphaterm-overlay");
      host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
      root = host.attachShadow({ mode: "open" });
      root.innerHTML = `<style>
        .box { position: fixed; pointer-events: none; box-sizing: border-box; border-radius: 3px; }
        .hover { border: 2px solid ${ACCENT}; background: ${ACCENT}14; display: none; }
        .label { position: fixed; pointer-events: none; display: none; font: 600 11px/1.3 "Segoe UI", system-ui, sans-serif;
          color: #fff; background: #1e1b2e; border: 1px solid ${ACCENT}; border-radius: 5px; padding: 2px 7px; white-space: nowrap;
          max-width: 70vw; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 3px 10px #0006; }
        .label i { font-style: normal; color: #c4b5fd; font-weight: 500; }
        .mark { border: 2px solid ${MARK}; background: ${MARK}12; }
        .chip { position: fixed; pointer-events: none; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box;
          border-radius: 9px; background: ${MARK}; color: #fff; font: 700 11px/18px "Segoe UI", system-ui, sans-serif;
          text-align: center; box-shadow: 0 2px 6px #0007; }
      </style><div class="layer"></div><div class="box hover"></div><div class="label"></div>`;
      layer = root.querySelector(".layer");
      hoverBox = root.querySelector(".hover");
      hoverLabel = root.querySelector(".label");
    }
    (document.documentElement || document).appendChild(host);
  }

  // --- Datos de un elemento -------------------------------------------------------------------
  const clip = (s, n) => (s.length > n ? s.slice(0, n) + "…" : s);
  const cssEsc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, "\\$&"));

  function selectorOf(el) {
    if (!(el instanceof Element)) return "";
    if (el.id && document.querySelectorAll("#" + cssEsc(el.id)).length === 1) return "#" + cssEsc(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement && parts.length < 10) {
      let part = cur.tagName.toLowerCase();
      if (cur.id && document.querySelectorAll("#" + cssEsc(cur.id)).length === 1) {
        parts.unshift("#" + cssEsc(cur.id));
        break;
      }
      const parent = cur.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === cur.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      const sel = parts.join(" > ");
      try {
        if (document.querySelectorAll(sel).length === 1) return sel;
      } catch {
        /* selector raro: seguir subiendo */
      }
      cur = parent;
    }
    return parts.join(" > ");
  }

  /** Archivo fuente desde una pila de React 19 (`_debugStack`): primer marco que no sea de React. */
  function fromStack(stack) {
    if (!stack) return null;
    for (const line of String(stack).split("\n")) {
      const m = line.match(/\(?((?:https?|file):\/\/[^\s)]+?):(\d+):(\d+)\)?\s*$/);
      if (!m) continue;
      const url = m[1];
      if (/node_modules|react-dom|react\.development|jsx-dev-runtime|\/@react-refresh|chunk-/.test(url)) continue;
      let file = url;
      try {
        file = decodeURIComponent(new URL(url).pathname).replace(/^\/@fs\//, "").replace(/^\//, "");
      } catch {
        /* queda la URL */
      }
      return { file, line: Number(m[2]) };
    }
    return null;
  }

  /** Componente de la app (React, Vue, Svelte, Angular) y, si se sabe, su archivo. */
  function componentOf(el) {
    try {
      const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
      if (key) {
        let f = el[key];
        const names = [];
        let source = null;
        let guard = 0;
        while (f && guard++ < 60) {
          const t = f.type;
          if (t && typeof t !== "string") {
            const name = t.displayName || t.name || (t.render && (t.render.displayName || t.render.name));
            if (name && !/^(Fragment|Suspense|StrictMode|Provider|Consumer)$/.test(name)) {
              names.push(name);
              if (!source) {
                if (f._debugSource) source = { file: f._debugSource.fileName, line: f._debugSource.lineNumber };
                else if (f._debugStack) source = fromStack(f._debugStack.stack || f._debugStack);
              }
            }
          }
          if (!source && f._debugSource && names.length === 0) source = { file: f._debugSource.fileName, line: f._debugSource.lineNumber };
          if (names.length >= 4) break;
          f = f.return;
        }
        if (names.length) return { framework: "React", name: names[0], chain: names, source };
      }
      let v = el;
      while (v && v !== document.body) {
        if (v.__vueParentComponent) {
          const c = v.__vueParentComponent;
          const chain = [];
          let p = c;
          while (p && chain.length < 4) {
            const n = p.type && (p.type.__name || p.type.name);
            if (n) chain.push(n);
            p = p.parent;
          }
          return { framework: "Vue", name: chain[0] || "?", chain, source: c.type && c.type.__file ? { file: c.type.__file } : null };
        }
        if (v.__vue__) {
          const o = v.__vue__.$options || {};
          return { framework: "Vue 2", name: o.name || o._componentTag || "?", chain: [], source: o.__file ? { file: o.__file } : null };
        }
        if (v.__svelte_meta && v.__svelte_meta.loc) {
          const l = v.__svelte_meta.loc;
          return { framework: "Svelte", name: (l.file || "").split("/").pop(), chain: [], source: { file: l.file, line: l.line + 1 } };
        }
        v = v.parentElement;
      }
      if (window.ng && typeof window.ng.getComponent === "function") {
        let a = el;
        while (a && a !== document.body) {
          const c = window.ng.getComponent(a);
          if (c) return { framework: "Angular", name: c.constructor.name, chain: [], source: null };
          a = a.parentElement;
        }
      }
    } catch {
      /* sin datos del framework */
    }
    return null;
  }

  const STYLE_KEYS = ["display", "position", "color", "background-color", "background-image", "font-family", "font-size", "font-weight", "line-height", "padding", "margin", "border", "border-radius", "width", "height", "gap", "box-shadow", "opacity"];

  function describe(el) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const styles = {};
    for (const k of STYLE_KEYS) {
      const v = cs.getPropertyValue(k);
      if (v && v !== "none" && v !== "normal" && v !== "auto" && v !== "0px" && v !== "rgba(0, 0, 0, 0)") styles[k] = v;
    }
    const attrs = {};
    for (const a of el.attributes) {
      if (a.name === "class" || a.name === "style" || a.name === "id") continue;
      if (/^(data-|aria-|role$|href$|type$|name$|placeholder$|alt$|src$|title$)/.test(a.name)) attrs[a.name] = clip(a.value, 120);
    }
    let text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    if (!text && "value" in el && typeof el.value === "string") text = el.value;
    if (!text && el.getAttribute("placeholder")) text = el.getAttribute("placeholder");
    const html = el.outerHTML || "";
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      classes: [...el.classList].slice(0, 12),
      text: clip(text, 160),
      selector: selectorOf(el),
      attrs,
      html: clip(html, 1500),
      rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
      styles,
      component: componentOf(el),
    };
  }

  const short = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    const cls = [...el.classList].slice(0, 2);
    if (cls.length) s += "." + cls.join(".");
    return s;
  };

  // --- Dibujo ---------------------------------------------------------------------------------
  function place(box, r) {
    box.style.left = r.left + "px";
    box.style.top = r.top + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";
  }

  function drawHover() {
    if (!edit || !hovered || !hovered.isConnected || !chromeOn) {
      if (hoverBox) hoverBox.style.display = hoverLabel.style.display = "none";
      return;
    }
    const r = hovered.getBoundingClientRect();
    place(hoverBox, r);
    hoverBox.style.display = "block";
    const c = componentOf(hovered);
    hoverLabel.innerHTML = "";
    hoverLabel.append(short(hovered));
    if (c) {
      const i = document.createElement("i");
      i.textContent = "  ·  " + c.name;
      hoverLabel.append(i);
    }
    const dim = document.createElement("i");
    dim.textContent = `  ${Math.round(r.width)}×${Math.round(r.height)}`;
    hoverLabel.append(dim);
    hoverLabel.style.display = "block";
    const top = r.top > 24 ? r.top - 22 : r.bottom + 4;
    hoverLabel.style.left = Math.max(2, Math.min(r.left, innerWidth - 240)) + "px";
    hoverLabel.style.top = top + "px";
  }

  function drawMarks() {
    if (!layer) return;
    layer.innerHTML = "";
    if (!chromeOn) return;
    marks.forEach((m, i) => {
      if (!m.el.isConnected) {
        // Se re-renderizó (HMR): se busca de nuevo por selector.
        try {
          const again = m.data.selector && document.querySelector(m.data.selector);
          if (again) m.el = again;
        } catch {
          /* nada */
        }
      }
      if (!m.el.isConnected) return;
      const r = m.el.getBoundingClientRect();
      const box = document.createElement("div");
      box.className = "box mark";
      place(box, r);
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.textContent = String(i + 1);
      chip.style.left = Math.max(0, r.left - 6) + "px";
      chip.style.top = Math.max(0, r.top - 9) + "px";
      layer.append(box, chip);
    });
  }

  let raf = 0;
  function redraw() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      ensureHost();
      drawHover();
      drawMarks();
    });
  }

  function send() {
    notify({ type: "marks", url: location.href, marks: marks.map((m, i) => ({ n: i + 1, ...m.data })) });
  }

  function toggle(el) {
    const i = marks.findIndex((m) => m.el === el);
    if (i >= 0) marks.splice(i, 1);
    else marks.push({ el, data: describe(el) });
    send();
    redraw();
  }

  // --- Eventos (solo en modo edición) ---------------------------------------------------------
  const ours = (e) => e.composedPath().includes(host);
  const targetOf = (e) => {
    const t = e.composedPath().find((n) => n instanceof Element && n !== host);
    return t instanceof Element ? t : null;
  };
  const block = (e) => {
    if (!edit || window.__alphaPass || ours(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup", "dblclick", "auxclick", "contextmenu", "submit", "touchstart"]) {
    window.addEventListener(type, block, true);
  }
  window.addEventListener(
    "click",
    (e) => {
      if (!edit || window.__alphaPass || ours(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      let t = targetOf(e);
      if (t && e.altKey && t.parentElement && t.parentElement !== document.documentElement) t = t.parentElement;
      if (t && t !== document.documentElement && t !== document.body) toggle(t);
    },
    true,
  );
  window.addEventListener(
    "mousemove",
    (e) => {
      if (!edit) return;
      let t = targetOf(e);
      if (t && e.altKey && t.parentElement) t = t.parentElement;
      if (t !== hovered) {
        hovered = t;
        redraw();
      }
    },
    true,
  );
  window.addEventListener(
    "keydown",
    (e) => {
      if (edit && e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setEdit(false);
        notify({ type: "edit", on: false });
      }
    },
    true,
  );
  window.addEventListener("scroll", redraw, true);
  window.addEventListener("resize", redraw);

  let editStyle = null;
  function setEdit(on) {
    edit = !!on;
    hovered = null;
    if (edit && !editStyle) {
      editStyle = document.createElement("style");
      editStyle.textContent = "*, *::before, *::after { cursor: crosshair !important; }";
    }
    if (edit) (document.head || document.documentElement).appendChild(editStyle);
    else if (editStyle) editStyle.remove();
    redraw();
    return edit;
  }

  // Seguir las marcas si la página cambia sola (animaciones, HMR).
  setInterval(() => {
    if (marks.length || edit) redraw();
  }, 400);

  // --- Foto de la estructura para el agente ---------------------------------------------------
  const INTERACTIVE = /^(a|button|input|select|textarea|summary|label|option)$/;
  function snapshot(max = 400) {
    const out = [];
    const walk = (el, depth) => {
      if (out.length >= max || !(el instanceof Element) || el === host) return;
      const tag = el.tagName.toLowerCase();
      if (/^(script|style|noscript|template|svg|path|meta|link)$/.test(tag)) return;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0 && !el.children.length) return;
      const role = el.getAttribute("role");
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").replace(/\s+/g, " ").trim();
      const interesting = INTERACTIVE.test(tag) || role || /^h[1-6]$/.test(tag) || tag === "img" || own;
      let next = depth;
      if (interesting) {
        let line = "  ".repeat(Math.min(depth, 12)) + tag + (role ? `[role=${role}]` : "");
        const name = el.getAttribute("aria-label") || (tag === "img" ? el.getAttribute("alt") : "") || (INTERACTIVE.test(tag) ? (el.innerText || el.value || el.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim() : own);
        if (name) line += ` "${clip(name, 80)}"`;
        if (tag === "a" && el.getAttribute("href")) line += ` href=${clip(el.getAttribute("href"), 80)}`;
        if (tag === "input") line += ` type=${el.type}${el.value ? ` value="${clip(el.value, 40)}"` : ""}`;
        if (INTERACTIVE.test(tag) || role) line += `  {${selectorOf(el)}}`;
        out.push(line);
        next = depth + 1;
      }
      for (const c of el.children) walk(c, next);
      if (el.shadowRoot) for (const c of el.shadowRoot.children) walk(c, next);
    };
    walk(document.body, 0);
    if (out.length >= max) out.push(`… (cortado en ${max} líneas)`);
    return out.join("\n");
  }

  function hmr() {
    return !!(
      document.querySelector('script[src*="/@vite/client"]') ||
      window.__vite_plugin_react_preamble_installed__ ||
      Object.keys(window).some((k) => k.startsWith("webpackHotUpdate")) ||
      window.__NEXT_DATA__ ||
      window.__NUXT__ ||
      window.next ||
      document.querySelector('script[src*="webpack-dev-server"], script[src*="livereload"], script[src*="browser-sync"]')
    );
  }

  window.__alphaOverlay = {
    setEdit,
    isEdit: () => edit,
    marks: () => marks.map((m, i) => ({ n: i + 1, ...m.data })),
    /** Vuelve a leer los datos de cada marca (después de un cambio en la página). */
    refresh() {
      marks.forEach((m) => m.el.isConnected && (m.data = describe(m.el)));
      send();
      return marks.length;
    },
    remove(n) {
      marks.splice(n - 1, 1);
      send();
      redraw();
    },
    clear() {
      marks = [];
      send();
      redraw();
    },
    /** Mostrar u ocultar lo que dibuja la capa (para capturas sin marcas). */
    chrome(on) {
      chromeOn = !!on;
      drawHover();
      drawMarks();
      return chromeOn;
    },
    /** Esconde solo el resaltado del mouse (las marcas numeradas siguen). */
    hideHover() {
      hovered = null;
      drawHover();
    },
    snapshot,
    hmr,
  };

  const ready = () => {
    ensureHost();
    notify({ type: "page", url: location.href, title: document.title, hmr: hmr() });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true });
  else ready();
  window.addEventListener("load", () => notify({ type: "page", url: location.href, title: document.title, hmr: hmr() }));
})();
