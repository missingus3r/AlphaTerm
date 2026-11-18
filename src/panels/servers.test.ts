import { describe, expect, it } from "vitest";
import { candidate, fmtUptime, isRunning, mergeRecipe, recipeFor, urlFor, type Server } from "./servers";
import type { Recipe } from "../settings/schema";

const srv = (o: Partial<Server> = {}): Server => ({
  pid: 30, name: "node.exe", ports: [5173], addrs: ["127.0.0.1"], cmdline: "node vite", cwd: "C:\\web",
  uptime: 10, shellPid: 10, system: false, ...o,
});
const pane = { tabId: "t", paneId: "p", title: "x", cwd: "C:\\web", lastCommand: "npm run dev", running: true };
let n = 0;
const id = () => `r${++n}`;

describe("recetas de servidores", () => {
  it("se arma una candidata solo si la pestaña corre un comando conocido", () => {
    expect(candidate(srv(), pane)).toMatchObject({ command: "npm run dev", cwd: "C:\\web", ports: [5173], auto: true });
    expect(candidate(srv(), { ...pane, running: false })).toBeNull();
    expect(candidate(srv(), { ...pane, lastCommand: undefined })).toBeNull();
    expect(candidate(srv(), undefined)).toBeNull();
  });

  it("no duplica: misma carpeta y comando suma puertos", () => {
    const c = candidate(srv(), pane)!;
    let list = mergeRecipe([], c, id);
    expect(list).toHaveLength(1);
    list = mergeRecipe(list, { ...c, command: "npm  run DEV", cwd: "c:\\web\\", ports: [24678] }, id);
    expect(list).toHaveLength(1);
    expect(list[0].ports).toEqual([5173, 24678]);
    // Sin cambios y visto hace poco: devuelve la misma lista (no se reescribe la configuración).
    expect(mergeRecipe(list, { ...c, ports: [5173] }, id)).toBe(list);
  });

  it("las automáticas se limitan a 20; las manuales no se tocan", () => {
    let list: Recipe[] = [{ id: "m", name: "manual", command: "x", cwd: "C:\\m", ports: [1], auto: false, env: {} }];
    for (let i = 0; i < 25; i++) list = mergeRecipe(list, { name: "a", command: `cmd${i}`, cwd: "C:\\a", ports: [i + 2], auto: true, lastSeen: i, env: {} }, id);
    expect(list.filter((r) => r.auto)).toHaveLength(20);
    expect(list.find((r) => r.id === "m")).toBeTruthy();
    expect(list.some((r) => r.command === "cmd0")).toBe(false);
  });

  it("encuentra la receta de un servidor y sabe si una receta corre", () => {
    const r: Recipe = { id: "r", name: "web", command: "npm run dev", cwd: "C:\\web", ports: [5173], auto: true, env: {} };
    expect(recipeFor(srv(), [r])?.id).toBe("r");
    expect(recipeFor(srv({ cwd: "C:\\otra" }), [r])).toBeUndefined();
    expect(isRunning(r, [srv()])).toBe(true);
    expect(isRunning(r, [srv({ ports: [3000] })])).toBe(false);
  });

  it("formatos", () => {
    expect(fmtUptime(42)).toBe("42 s");
    expect(fmtUptime(3725)).toBe("1 h 2 min");
    expect(fmtUptime(3 * 86400)).toBe("3 días");
    expect(urlFor(srv(), 5173)).toBe("http://localhost:5173");
    expect(urlFor(srv({ addrs: ["[::1]"] }), 5173)).toBe("http://[::1]:5173");
  });
});
