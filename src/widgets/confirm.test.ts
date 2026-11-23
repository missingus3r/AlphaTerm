import { describe, expect, it } from "vitest";
import { answerConfirm, askConfirm, pendingConfirm } from "./confirm";

describe("confirmación dentro de la app", () => {
  it("espera la respuesta y la devuelve", async () => {
    const p = askConfirm("¿Cerrar?", "Cerrar");
    expect(pendingConfirm()).toMatchObject({ message: "¿Cerrar?", ok: "Cerrar" });
    answerConfirm(true);
    await expect(p).resolves.toBe(true);
    expect(pendingConfirm()).toBeNull();
    const q = askConfirm("¿Otra?");
    answerConfirm(false);
    await expect(q).resolves.toBe(false);
  });

  it("una pregunta nueva cancela la que estaba abierta", async () => {
    const first = askConfirm("primera");
    const second = askConfirm("segunda");
    await expect(first).resolves.toBe(false);
    expect(pendingConfirm()?.message).toBe("segunda");
    answerConfirm(true);
    await expect(second).resolves.toBe(true);
  });

  it("contestar sin nada abierto no hace nada", () => {
    expect(() => answerConfirm(true)).not.toThrow();
    expect(pendingConfirm()).toBeNull();
  });
});
