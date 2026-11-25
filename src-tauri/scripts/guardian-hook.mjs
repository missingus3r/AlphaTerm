#!/usr/bin/env node
// Claude Code hook (AlphaTerm installs it with --settings when launching Claude Code).
// - PreToolUse: AlphaTerm copies the state of the file (for the Changes panel) and the
//   Guardian asks before editing, creating or deleting files. If the user doesn't allow it,
//   Claude Code receives "deny" with the reason.
// - PostToolUse: AlphaTerm records how the file ended up.
// - Stop: Claude Code finished answering (the built-in browser goes from "working" to "ready").
// If AlphaTerm doesn't respond, it doesn't block (Claude Code continues with its own permissions).
import fs from "node:fs";
import path from "node:path";

/** AlphaTerm folder: the one with control.json and settings.json. */
const DIR = path.join(process.env.APPDATA || "", "AlphaTerm");

// Language of the reason (es, en, pt): ALPHATERM_LANG (AlphaTerm's tabs have it) or, if it is not
// set, the `language` key of settings.json, in the same folder as control.json; otherwise, Spanish.
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
    // AlphaTerm closed or not responding: not blocked.
  }
  process.exit(0);
});
