import { describe, expect, it } from "vitest";
import { changeTags, matchesFilter, totals, type ChangeSummary } from "./changes";

const c = (p: Partial<ChangeSummary>): ChangeSummary => ({
  id: 1, path: "C:\\p\\a.txt", firstAt: 0, lastAt: 0, agents: ["Codex"], tools: [], events: 1, baseFrom: "carpeta", inGit: false, pdf: false,
  adds: 1, dels: 0, version: 1, manual: false, created: false, deleted: false, kind: "text", size: 10, editable: true, ...p,
});

describe("panel de modificaciones", () => {
  it("filtra por git y por nombre", () => {
    const enGit = c({ inGit: true, path: "C:\\repo\\src\\main.rs" });
    const suelto = c({ path: "C:\\notas\\lista.txt" });
    expect(matchesFilter(enGit, "nogit", "")).toBe(false);
    expect(matchesFilter(suelto, "nogit", "")).toBe(true);
    expect(matchesFilter(enGit, "git", "")).toBe(true);
    expect(matchesFilter(suelto, "all", "NOTAS")).toBe(true);
    expect(matchesFilter(suelto, "all", "repo")).toBe(false);
  });

  it("suma los cambios", () => {
    expect(totals([c({ adds: 3, dels: 1 }), c({ adds: 2, dels: 5 })])).toEqual({ files: 2, adds: 5, dels: 6 });
  });

  it("etiqueta lo importante", () => {
    expect(changeTags(c({ created: true, inGit: true })).map((t) => t.label)).toEqual(["nuevo", "en git"]);
    expect(changeTags(c({ baseFrom: "ninguna" })).map((t) => t.label)).toEqual(["sin copia previa"]);
    expect(changeTags(c({ baseFrom: "git", pdf: true, manual: true })).map((t) => t.label)).toEqual(["PDF (texto)", "vs último commit", "editado a mano"]);
  });
});
