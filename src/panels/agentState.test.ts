import { describe, expect, it } from "vitest";
import { agentState, envToText, paneBusy, parseEnvText, pushRecent } from "./agentState";

const base = { integrated: true, running: true, agentStarted: true };

describe("estado del agente", () => {
  it("de arranque a trabajando, esperando y terminado", () => {
    expect(agentState({ integrated: true, running: false })).toBe("starting");
    expect(agentState({ ...base, active: true })).toBe("working");
    expect(agentState({ ...base, active: false })).toBe("waiting");
    expect(agentState({ ...base, running: false, exitCode: 0 })).toBe("done");
    expect(agentState({ ...base, exited: true })).toBe("exited");
  });

  it("la campana pide atención aunque haya salida", () => {
    expect(agentState({ ...base, active: true, bell: true })).toBe("attention");
  });

  it("sin integración se guía por el proceso en primer plano", () => {
    expect(agentState({ integrated: false, running: false, agentStarted: true, fgProcess: "claude.exe" })).toBe("waiting");
    expect(agentState({ integrated: false, running: false, agentStarted: true })).toBe("done");
  });
});

describe("variables y carpetas", () => {
  it("parsea CLAVE=valor y descarta lo inválido", () => {
    expect(parseEnvText("A=1\n# comentario\nB = dos=2\n mal\n1X=no\nC=")).toEqual({ A: "1", B: " dos=2", C: "" });
    expect(envToText({ A: "1", B: "x y" })).toBe("A=1\nB=x y");
  });

  it("recientes: la última primero, sin repetir (sin importar mayúsculas ni barra final)", () => {
    expect(pushRecent(["C:\\a", "C:\\b"], "c:\\B\\")).toEqual(["c:\\B\\", "C:\\a"]);
    expect(pushRecent(Array.from({ length: 12 }, (_, i) => `d${i}`), "nueva")).toHaveLength(12);
  });
});

describe("panel ocupado (para preguntar antes de cerrarlo)", () => {
  it("corre algo si la shell integrada está en un comando o, sin integración, hay un programa al frente", () => {
    expect(paneBusy({ integrated: true, running: true })).toBe(true);
    expect(paneBusy({ integrated: true, running: false })).toBe(false);
    expect(paneBusy({ integrated: false, running: false, fgProcess: "ping" })).toBe(true);
    expect(paneBusy({ integrated: true, running: true, exited: true })).toBe(false);
  });
});
