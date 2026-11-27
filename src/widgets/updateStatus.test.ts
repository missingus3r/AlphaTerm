import { describe, expect, it } from "vitest";
import { changeText, noticeFor, type UpdateStatus } from "./updateStatus";

const status = (s: Partial<UpdateStatus>): UpdateStatus => ({ id: "alphaterm", state: "up-to-date", version: "0.8.3", ...s });

describe("aviso de actualización", () => {
  it("no avisa nada de una versión que ya es la que corre (estado viejo de otra corrida)", () => {
    expect(noticeFor(status({ state: "installed", version: "0.8.3" }), "0.8.3")).toBeNull();
    expect(noticeFor(status({ state: "failed", version: "0.8.2" }), "0.8.3")).toBeNull();
  });

  it("mientras baja, instala dependencias o compila, es «actualizando» con el paso", () => {
    expect(noticeFor(status({ state: "building" }), "0.8.2")).toEqual({ kind: "updating", text: "Actualizando a 0.8.3…", step: "compilando" });
    expect(noticeFor(status({ state: "pulling" }), "0.8.2")?.step).toBe("bajando");
    expect(noticeFor(status({ state: "deps" }), "0.8.2")?.step).toBe("dependencias");
    expect(noticeFor(status({ state: "updating" }), "0.8.2")?.kind).toBe("updating");
  });

  it("instalada: se usa la próxima vez", () => {
    expect(noticeFor(status({ state: "installed" }), "0.8.2")).toEqual({ kind: "installed", text: "AlphaTerm 0.8.3 instalada: se usa la próxima vez que la abras" });
  });

  it("bloqueada: dice por qué", () => {
    expect(noticeFor(status({ state: "blocked", reason: "dirty" }), "0.8.2")?.text).toBe("Hay 0.8.3, pero en esta PC tenés cambios sin subir");
    expect(noticeFor(status({ state: "blocked", reason: "unpushed" }), "0.8.2")?.text).toBe("Hay 0.8.3, pero en esta PC tenés cambios sin subir");
    expect(noticeFor(status({ state: "blocked", reason: "branch", branch: "x" }), "0.8.2")?.text).toBe("Hay 0.8.3, pero esta PC está en la rama x");
    expect(noticeFor(status({ state: "blocked", reason: "ahead-of-version" }), "0.8.2")?.text).toBe("Hay 0.8.3, pero el código de esta PC está más adelante");
    expect(noticeFor(status({ state: "blocked", reason: "diverged" }), "0.8.2")?.text).toBe("Hay 0.8.3, pero el código de esta PC está más adelante");
    expect(noticeFor(status({ state: "blocked", reason: "no-repo" }), "0.8.2")?.text).toBe("Hay 0.8.3, pero esta PC no puede actualizarse sola");
  });

  it("falló: lo dice", () => {
    expect(noticeFor(status({ state: "failed", reason: "build" }), "0.8.2")).toEqual({ kind: "failed", text: "No se pudo actualizar a 0.8.3" });
  });

  it("sin red, sin soporte, al día o sin estado: nada", () => {
    expect(noticeFor(status({ state: "offline" }), "0.8.2")).toBeNull();
    expect(noticeFor(status({ state: "unsupported" }), "0.8.2")).toBeNull();
    expect(noticeFor(status({ state: "up-to-date" }), "0.8.2")).toBeNull();
    expect(noticeFor(null, "0.8.2")).toBeNull();
  });

  it("los cambios salen en el idioma pedido, o en español si no hay traducción", () => {
    expect(changeText({ es: "Arreglo", en: "Fix" }, "en")).toBe("Fix");
    expect(changeText({ es: "Arreglo" }, "pt")).toBe("Arreglo");
    expect(changeText({ es: "Arreglo", en: "Fix" }, "es")).toBe("Arreglo");
  });
});
