import { describe, expect, it } from "vitest";
import { mergeProjects, projectName, type Found } from "./projects";

const f = (path: string, src: string, lastUsed: number, o: Partial<Found> = {}): Found => ({ path, sources: [src], lastUsed, exists: true, git: false, ...o });

describe("lista de proyectos", () => {
  it("junta descubiertos, manuales y recientes sin repetir", () => {
    const list = mergeProjects([f("C:\\web", "claude", 10, { git: true }), f("C:\\api", "codex", 20)], ["c:\\WEB\\", "C:\\nuevo"], ["C:\\api"], []);
    expect(list.map((p) => p.path)).toEqual(["C:\\web", "C:\\nuevo", "C:\\api"]);
    expect(list[0].sources).toEqual(["claude", "manual"]);
    expect(list[0].git).toBe(true);
    expect(list[2].sources).toEqual(["codex", "reciente"]);
  });

  it("marca los ocultos", () => {
    const list = mergeProjects([f("C:\\web", "claude", 1)], [], [], ["c:\\web"]);
    expect(list[0].hidden).toBe(true);
  });

  it("nombre del proyecto", () => {
    expect(projectName("C:\\Users\\yo\\NovaTerm\\")).toBe("NovaTerm");
    expect(projectName("C:\\")).toBe("C:");
  });
});
