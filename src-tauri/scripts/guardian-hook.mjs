#!/usr/bin/env node
// Hook de Claude Code (lo instala AlphaTerm con --settings al lanzar Claude Code).
// - PreToolUse: AlphaTerm copia cómo está el archivo (para el panel de modificaciones) y el
//   guardián pregunta antes de editar, crear o borrar archivos. Si el usuario no lo permite,
//   Claude Code recibe "deny" con el motivo.
// - PostToolUse: AlphaTerm anota cómo quedó el archivo.
// - Stop: Claude Code terminó de contestar (el navegador integrado pasa de "trabajando" a "listo").
// Si AlphaTerm no responde, no frena (Claude Code sigue con sus propios permisos).
import fs from "node:fs";
import path from "node:path";

/** Carpeta de AlphaTerm: la de control.json y settings.json. */
const DIR = path.join(process.env.APPDATA || "", "AlphaTerm");

// Idioma del motivo (es, en, pt): ALPHATERM_LANG (lo tienen las pestañas de AlphaTerm) o, si no
// está, la clave `language` de settings.json, en la misma carpeta que control.json; si no, español.
function detectLang() {
  const ok = (l) => (typeof l === "string" && ["es", "en", "pt"].includes(l.trim().toLowerCase()) ? l.trim().toLowerCase() : null);
  const env = ok(process.env.ALPHATERM_LANG);
  if (env) return env;
  try {
    return ok(JSON.parse(fs.readFileSync(path.join(DIR, "settings.json"), "utf8").replace(/^\uFEFF/, "")).language) ?? "es";
  } catch {
    return "es";
  }
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", async () => {
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  let url = process.env.ALPHATERM_CONTROL_URL;
  let token = process.env.ALPHATERM_CONTROL_TOKEN;
  if (!url || !token) {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(DIR, "control.json"), "utf8"));
      url = c.url;
      token = c.token;
    } catch {
      process.exit(0);
    }
  }
  try {
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    if (process.env.ALPHATERM_PANE) headers["X-AlphaTerm-Pane"] = process.env.ALPHATERM_PANE;
    if (input.hook_event_name === "Stop") {
      await fetch(`${url}/v1/agent_stop`, { method: "POST", headers, body: "{}", signal: AbortSignal.timeout(10_000) });
      process.exit(0);
    }
    if (input.hook_event_name === "PostToolUse") {
      await fetch(`${url}/v1/changes_post`, { method: "POST", headers, body: JSON.stringify(input), signal: AbortSignal.timeout(20_000) });
      process.exit(0);
    }
    const r = await fetch(`${url}/v1/guardian`, { method: "POST", headers, body: JSON.stringify(input), signal: AbortSignal.timeout(595_000) });
    const data = await r.json();
    if (data.decision === "deny") {
      const lang = detectLang();
      const reason = {
        es: "El guardián de AlphaTerm lo bloqueó: el usuario no permitió este cambio. No lo intentes de otra forma; preguntale qué prefiere.",
        en: "AlphaTerm's Guardian blocked it: the user didn't allow this change. Don't try it another way; ask them what they prefer.",
        pt: "O Guardião do AlphaTerm bloqueou: o usuário não permitiu esta alteração. Não tente de outra forma; pergunte o que ele prefere.",
      }[lang];
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: reason,
          },
        }),
      );
    }
  } catch {
    // AlphaTerm cerrado o sin respuesta: no se frena.
  }
  process.exit(0);
});
