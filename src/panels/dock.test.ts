import { describe, expect, it } from "vitest";
import * as D from "./dock";

const ids = (d: D.Dock) => d.cols.map((c) => c.panels.map((p) => p.id));

describe("paneles en mosaico", () => {
  it("abrir: debajo mientras haya lugar, después al costado", () => {
    let d: D.Dock = { cols: [] };
    d = D.openPanel(d, "agents");
    d = D.openPanel(d, "docker");
    d = D.openPanel(d, "git");
    expect(ids(d)).toEqual([["agents", "docker"], ["git"]]);
    expect(D.openPanel(d, "git")).toBe(d);
    expect(D.openIds(d)).toEqual(["agents", "docker", "git"]);
  });

  it("cerrar saca columnas vacías y toggle alterna", () => {
    let d = D.openPanel(D.openPanel(D.openPanel({ cols: [] }, "agents"), "docker"), "git");
    d = D.closePanel(d, "git");
    expect(ids(d)).toEqual([["agents", "docker"]]);
    d = D.togglePanel(d, "agents");
    expect(ids(d)).toEqual([["docker"]]);
    expect(D.isOpen(D.togglePanel(d, "agents"), "agents")).toBe(true);
  });

  it("ancho con límites y alto entre paneles", () => {
    let d = D.openPanel(D.openPanel({ cols: [] }, "agents"), "docker");
    const c = d.cols[0].id;
    expect(D.setColWidth(d, c, 50).cols[0].width).toBe(D.MIN_W);
    expect(D.setColWidth(d, c, 5000).cols[0].width).toBe(D.MAX_W);
    d = D.resizeSplit(d, c, 0, 0.7);
    expect(d.cols[0].panels[0].size).toBeCloseTo(1.4);
    expect(d.cols[0].panels[1].size).toBeCloseTo(0.6);
    d = D.resizeSplit(d, c, 0, 0.99);
    expect(d.cols[0].panels[1].size).toBeCloseTo(0.3); // minimum 15 % of the height
  });

  it("mover junto a otro panel o a una columna nueva", () => {
    let d = D.openPanel(D.openPanel(D.openPanel({ cols: [] }, "agents"), "docker"), "git");
    d = D.movePanel(d, "git", { kind: "panel", target: "agents", after: false });
    expect(ids(d)).toEqual([["git", "agents", "docker"]]);
    d = D.movePanel(d, "docker", { kind: "newCol", index: 0 });
    expect(ids(d)).toEqual([["docker"], ["git", "agents"]]);
    d = D.movePanel(d, "docker", { kind: "newCol", index: 2 });
    expect(ids(d)).toEqual([["git", "agents"], ["docker"]]);
  });

  it("normaliza lo guardado", () => {
    expect(D.normalizeDock(null)).toEqual({ cols: [] });
    const d = D.normalizeDock({ cols: [{ id: "a", width: 10, panels: [{ id: "git" }, { id: "nada" }, { id: "git" }] }, { panels: [] }] });
    expect(d.cols).toEqual([{ id: "a", width: D.MIN_W, panels: [{ id: "git", size: 1 }] }]);
  });
});
