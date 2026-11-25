import { describe, expect, it } from "vitest";
import { agentKind, buildCommand, launchParts, launchSummary, optionsFor, quoteArg, shellKindOf } from "./agentLaunch";

const ag = (command: string, launch: Record<string, string | boolean>) => ({ command, launch });

describe("opciones de arranque de los agentes", () => {
  it("reconoce el agente por el programa del comando", () => {
    expect(agentKind("claude --model opus")).toBe("claude");
    expect(agentKind('"C:\\Program Files\\x\\codex.exe" -s read-only')).toBe("codex");
    expect(agentKind("C:/bin/agy.cmd")).toBe("agy");
    expect(optionsFor("mi-agente")).toEqual([]);
  });

  it("comillas según la shell", () => {
    expect(quoteArg("--model", "ps5")).toBe("--model");
    expect(quoteArg("model_reasoning_effort=high", "cmd")).toBe("model_reasoning_effort=high");
    expect(quoteArg("hola mundo", "ps5")).toBe("'hola mundo'");
    expect(quoteArg("it's", "pwsh")).toBe("'it''s'");
    expect(quoteArg('di "sí"', "ps5")).toBe(`'di \\"sí\\"'`);
    expect(quoteArg("it's", "posix")).toBe(`'it'\\''s'`);
    expect(quoteArg('a "b"', "cmd")).toBe(`"a \\"b\\""`);
    expect(quoteArg("Bash,Edit", "ps5")).toBe("'Bash,Edit'"); // the comma builds an array in PowerShell
    expect(shellKindOf("powershell")).toBe("ps5");
    expect(shellKindOf("gitbash")).toBe("posix");
  });

  it("arma el comando de Claude con el primer mensaje antes de los flags", () => {
    const a = ag("claude", { model: "opus", effort: "high", permissionMode: "auto", addDir: "C:\\a; C:\\b c", prompt: "hacé los tests", verbose: false });
    expect(buildCommand(a, "ps5")).toBe("claude 'hacé los tests' --model opus --effort high --permission-mode auto --add-dir C:\\a --add-dir 'C:\\b c'");
  });

  it("Codex: esfuerzo por -c y retomar como subcomando", () => {
    const a = ag("codex", { effort: "xhigh", resumeLast: true, sandbox: "workspace-write" });
    expect(buildCommand(a, "ps5", ["-x"])).toBe("codex resume --last -c model_reasoning_effort=xhigh --sandbox workspace-write -x");
    expect(launchParts(ag("codex", { resumeLast: true, resume: true })).sub).toEqual(["resume", "--last"]);
  });

  it("al reabrir la sesión no repite las opciones de sesión", () => {
    const a = ag("claude", { continue: true, prompt: "hola", model: "sonnet" });
    expect(buildCommand(a, "ps5", [], { resuming: true, resumeArgs: "--continue" })).toBe("claude --continue --model sonnet");
  });

  it("valores vacíos o apagados no suman nada", () => {
    expect(buildCommand(ag("agy", { model: "", effort: "  ", skipPermissions: false }), "cmd")).toBe("agy");
    expect(buildCommand({ command: "opencode" } as never, "cmd")).toBe("opencode");
  });

  it("resumen corto debajo del nombre", () => {
    expect(launchSummary(ag("claude", { model: "opus", effort: "max", permissionMode: "plan", name: "x" }))).toBe("opus · max · plan · +1");
    expect(launchSummary(ag("claude", { skipPermissions: true }))).toBe("⚠ saltar todos los permisos");
    expect(launchSummary(ag("claude", {}))).toBe("");
  });
});
