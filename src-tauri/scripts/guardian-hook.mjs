#!/usr/bin/env node
// Hook PreToolUse de Claude Code (lo instala AlphaTerm con --settings al lanzar Claude Code).
// Le pregunta al guardián de AlphaTerm antes de editar, crear o borrar archivos. Si el usuario
// no lo permite, Claude Code recibe "deny" con el motivo. Si AlphaTerm no responde, no frena
// (Claude Code sigue con sus propios permisos).
import fs from "node:fs";
import path from "node:path";

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
      const c = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA || "", "AlphaTerm", "control.json"), "utf8"));
      url = c.url;
      token = c.token;
    } catch {
      process.exit(0);
    }
  }
  try {
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    if (process.env.ALPHATERM_PANE) headers["X-AlphaTerm-Pane"] = process.env.ALPHATERM_PANE;
    const r = await fetch(`${url}/v1/guardian`, { method: "POST", headers, body: JSON.stringify(input), signal: AbortSignal.timeout(595_000) });
    const data = await r.json();
    if (data.decision === "deny") {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: "El guardián de AlphaTerm lo bloqueó: el usuario no permitió este cambio. No lo intentes de otra forma; preguntale qué prefiere.",
          },
        }),
      );
    }
  } catch {
    // AlphaTerm cerrado o sin respuesta: no se frena.
  }
  process.exit(0);
});
