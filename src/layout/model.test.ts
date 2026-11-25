import { describe, expect, it } from "vitest";
import * as M from "./model";
import {
  addTab,
  closePane,
  closeTab,
  cycleTab,
  leaf,
  leaves,
  moveTab,
  neighbor,
  newTab,
  renameTab,
  selectTabIndex,
  setRatio,
  splitPane,
  type Layout,
} from "./model";

const start = (): Layout => {
  const t = newTab("powershell");
  return { tabs: [t], activeTab: t.id };
};

describe("pestañas", () => {
  it("una pestaña nueva se agrega a la derecha de la activa y queda activa", () => {
    let l = start();
    const first = l.tabs[0].id;
    const b = newTab("cmd");
    l = addTab(l, b);
    l = selectTabIndex(l, 0);
    const c = newTab("gitbash");
    l = addTab(l, c);
    expect(l.tabs.map((t) => t.id)).toEqual([first, c.id, b.id]);
    expect(l.activeTab).toBe(c.id);
  });

  it("al cerrar la activa queda la de la derecha, o la de la izquierda si era la última", () => {
    let l = start();
    const [a, b, c] = [l.tabs[0], newTab("x"), newTab("y")];
    l = addTab(addTab(l, b), c);
    l = closeTab({ ...l, activeTab: b.id }, b.id);
    expect(l.activeTab).toBe(c.id);
    l = closeTab(l, c.id);
    expect(l.activeTab).toBe(a.id);
    l = closeTab(l, a.id);
    expect(l.tabs).toEqual([]);
  });

  it("ciclar da la vuelta y el índice -1 es la última", () => {
    let l = addTab(addTab(start(), newTab("x")), newTab("y"));
    const ids = l.tabs.map((t) => t.id);
    expect(cycleTab(l, 1).activeTab).toBe(ids[0]);
    expect(cycleTab(selectTabIndex(l, 0), -1).activeTab).toBe(ids[2]);
    expect(selectTabIndex(l, -1).activeTab).toBe(ids[2]);
    expect(selectTabIndex(l, 7).activeTab).toBe(l.activeTab);
  });

  it("mover y renombrar (vacío borra el nombre manual)", () => {
    let l = addTab(addTab(start(), newTab("x")), newTab("y"));
    const ids = l.tabs.map((t) => t.id);
    l = moveTab(l, ids[2], 0);
    expect(l.tabs.map((t) => t.id)).toEqual([ids[2], ids[0], ids[1]]);
    l = renameTab(l, ids[0], "  backend  ");
    expect(l.tabs[1].manualTitle).toBe("backend");
    l = renameTab(l, ids[0], "   ");
    expect(l.tabs[1].manualTitle).toBeUndefined();
  });
});

describe("paneles", () => {
  it("dividir agrega el panel nuevo, lo activa, y cerrar vuelve a una hoja", () => {
    let l = start();
    const tab = l.tabs[0];
    const p1 = tab.activePane;
    const p2 = leaf("cmd");
    l = splitPane(l, tab.id, p1, "row", p2);
    expect(leaves(l.tabs[0].root).map((x) => x.id)).toEqual([p1, p2.id]);
    expect(l.tabs[0].activePane).toBe(p2.id);
    l = closePane(l, tab.id, p2.id);
    expect(l.tabs[0].root.kind).toBe("leaf");
    expect(l.tabs[0].activePane).toBe(p1);
  });

  it("cerrar el último panel cierra la pestaña", () => {
    let l = addTab(start(), newTab("cmd"));
    const t = l.tabs[1];
    l = closePane(l, t.id, t.activePane);
    expect(l.tabs).toHaveLength(1);
  });

  it("el ratio se limita entre 0,1 y 0,9", () => {
    let l = start();
    const t = l.tabs[0];
    l = splitPane(l, t.id, t.activePane, "column", leaf("cmd"));
    const sid = l.tabs[0].root.id;
    l = setRatio(l, t.id, sid, 2);
    expect((l.tabs[0].root as { ratio: number }).ratio).toBe(0.9);
    l = setRatio(l, t.id, sid, -1);
    expect((l.tabs[0].root as { ratio: number }).ratio).toBe(0.1);
  });

  it("vecinos por dirección en una grilla 2x2", () => {
    // A | B
    // --+--
    // C | D
    let l = start();
    const t = l.tabs[0];
    const A = t.activePane;
    const B = leaf("x");
    const C = leaf("x");
    const D = leaf("x");
    l = splitPane(l, t.id, A, "row", B);
    l = splitPane(l, t.id, A, "column", C);
    l = splitPane(l, t.id, B.id, "column", D);
    const root = l.tabs[0].root;
    expect(neighbor(root, A, "right")).toBe(B.id);
    expect(neighbor(root, A, "down")).toBe(C.id);
    expect(neighbor(root, D.id, "left")).toBe(C.id);
    expect(neighbor(root, D.id, "up")).toBe(B.id);
    expect(neighbor(root, A, "left")).toBeUndefined();
    expect(neighbor(root, A, "up")).toBeUndefined();
  });
});

describe("colores y carpetas de pestañas", () => {
  const base = () => {
    const ts = [M.newTab("pwsh"), M.newTab("pwsh"), M.newTab("pwsh"), M.newTab("pwsh")];
    return { l: { tabs: ts, activeTab: ts[0].id } as M.Layout, ids: ts.map((t) => t.id) };
  };

  it("color del título", () => {
    const { l, ids } = base();
    const c = M.setTabColor(l, ids[1], "#ff0000");
    expect(c.tabs[1].color).toBe("#ff0000");
    expect(M.setTabColor(c, ids[1], undefined).tabs[1].color).toBeUndefined();
  });

  it("crear una carpeta junta sus pestañas", () => {
    const { l, ids } = base();
    const g = M.createGroup(l, "Front", [ids[0], ids[2]]);
    expect(g.groups).toHaveLength(1);
    expect(g.tabs.map((t) => t.id)).toEqual([ids[0], ids[2], ids[1], ids[3]]);
    expect(g.tabs[0].groupId).toBe(g.groups![0].id);
  });

  it("mover a y sacar de una carpeta; la vacía desaparece", () => {
    const { l, ids } = base();
    let g = M.createGroup(l, "A", [ids[0]]);
    const gid = g.groups![0].id;
    g = M.moveToGroup(g, ids[3], gid);
    expect(g.tabs.map((t) => t.id)).toEqual([ids[0], ids[3], ids[1], ids[2]]);
    g = M.moveToGroup(g, ids[0], null);
    expect(g.tabs.find((t) => t.id === ids[0])!.groupId).toBeUndefined();
    g = M.moveToGroup(g, ids[3], null);
    expect(g.groups).toEqual([]);
  });

  it("cerrar la última pestaña de una carpeta la borra; addTab hereda la carpeta", () => {
    const { l, ids } = base();
    let g = M.createGroup(l, "A", [ids[0]]);
    const added = M.addTab(g, M.newTab("pwsh"));
    expect(added.tabs[1].groupId).toBe(g.groups![0].id);
    expect(added.groups).toEqual(g.groups);
    g = M.closeTab(g, ids[0]);
    expect(g.groups).toEqual([]);
  });

  it("plegar, renombrar y desarmar", () => {
    const { l, ids } = base();
    let g = M.createGroup(l, "A", [ids[0], ids[1]]);
    const gid = g.groups![0].id;
    g = M.updateGroup(g, gid, { collapsed: true, name: "B" });
    expect(g.groups![0]).toMatchObject({ collapsed: true, name: "B" });
    g = M.ungroup(g, gid);
    expect(g.groups).toEqual([]);
    expect(g.tabs.every((t) => !t.groupId)).toBe(true);
  });
});

describe("paneles de navegador", () => {
  it("se crean, se actualizan y se encuentran", () => {
    const t = M.newTab("powershell");
    const b = M.browserLeaf("http://localhost:3000", t.activePane);
    let l = M.splitPane({ tabs: [t], activeTab: t.id }, t.id, t.activePane, "row", b);
    expect(M.isBrowser(M.findLeaf(l.tabs[0].root, b.id))).toBe(true);
    expect(M.browserOf(l.tabs[0])?.id).toBe(b.id);
    l = M.setBrowser(l, b.id, { url: "http://localhost:3000/otra" });
    expect(M.findLeaf(l.tabs[0].root, b.id)?.browser).toEqual({ url: "http://localhost:3000/otra", owner: t.activePane });
    // On a pane that isn't a browser nothing changes (same reference).
    expect(M.setBrowser(l, t.activePane, { url: "x" })).toBe(l);
  });
});

describe("mover paneles", () => {
  /** Tab with two panes side by side: A | B. */
  const two = () => {
    const t = M.newTab("powershell", "C:\\a");
    const A = t.activePane;
    const B = M.leaf("cmd", "C:\\b", { command: "claude", agentId: "claude" });
    const l = M.splitPane({ tabs: [t], activeTab: t.id }, t.id, A, "row", B);
    return { l, tab: t.id, A, B };
  };
  const ids = (l: M.Layout) => M.leaves(l.tabs[0].root).map((x) => x.id);

  it("a la izquierda de otro", () => {
    const { l, tab, A, B } = two();
    const r = M.movePane(l, tab, B.id, A, "left");
    expect(ids(r)).toEqual([B.id, A]);
    const root = r.tabs[0].root;
    expect(root.kind === "split" && root.dir).toBe("row");
    expect(root.kind === "split" && root.ratio).toBe(0.5);
    expect(r.tabs[0].activePane).toBe(B.id);
  });

  it("abajo con tres paneles", () => {
    const { l, tab, A, B } = two();
    const C = M.leaf("cmd");
    let x = M.splitPane(l, tab, B.id, "column", C); // A | (B over C)
    x = M.movePane(x, tab, A, C.id, "bottom");
    expect(ids(x)).toEqual([B.id, C.id, A]);
    const r = M.paneRects(x.tabs[0].root).get(A)!;
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(0.75);
    expect(r.w).toBeCloseTo(1);
    expect(r.h).toBeCloseTo(0.25);
  });

  it("el centro intercambia y no toca proporciones", () => {
    const { l, tab, A, B } = two();
    const C = M.leaf("cmd");
    let x = M.splitPane(l, tab, B.id, "row", C); // A | (B | C)
    x = M.setRatio(x, tab, x.tabs[0].root.id, 0.3);
    x = M.movePane(x, tab, A, C.id, "center");
    expect(ids(x)).toEqual([C.id, B.id, A]);
    const root = x.tabs[0].root;
    expect(root.kind === "split" && root.ratio).toBe(0.3);
  });

  it("sobre sí mismo, con un panel solo o con ids que no existen no cambia nada", () => {
    const { l, tab, A, B } = two();
    expect(M.movePane(l, tab, A, A, "left")).toBe(l);
    expect(M.movePane(l, tab, "no-existe", A, "left")).toBe(l);
    expect(M.movePane(l, tab, A, "no-existe", "right")).toBe(l);
    expect(M.movePane(l, "otra-pestaña", A, B.id, "right")).toBe(l);
    expect(M.swapPanes(l, tab, A, A)).toBe(l);
    const solo = start();
    const only = solo.tabs[0].activePane;
    expect(M.movePane(solo, solo.tabs[0].id, only, only, "center")).toBe(solo);
  });

  it("mover no crea paneles", () => {
    const { l, tab, A, B } = two();
    const r = M.movePane(l, tab, B.id, A, "top");
    expect(M.findLeaf(r.tabs[0].root, B.id)).toEqual(B);
    const s = M.movePane(l, tab, B.id, A, "center");
    expect(M.findLeaf(s.tabs[0].root, B.id)).toEqual(B);
  });

  it("igualar deja todos del mismo tamaño en cada eje", () => {
    const { l, tab, A, B } = two();
    const C = M.leaf("cmd");
    const row = M.equalize(M.splitPane(l, tab, B.id, "row", C), tab); // A | (B | C)
    for (const r of M.paneRects(row.tabs[0].root).values()) expect(r.w).toBeCloseTo(1 / 3);

    let col = M.splitPane(l, tab, B.id, "column", C); // A | (B over C)
    const root = col.tabs[0].root;
    col = M.setRatio(col, tab, root.id, 0.8);
    col = M.setRatio(col, tab, root.kind === "split" ? root.b.id : "", 0.2);
    col = M.equalize(col, tab);
    const rects = M.paneRects(col.tabs[0].root);
    expect(rects.get(A)!.w).toBeCloseTo(0.5);
    expect(rects.get(B.id)!.w).toBeCloseTo(0.5);
    expect(rects.get(B.id)!.h).toBeCloseTo(0.5);
    expect(rects.get(C.id)!.h).toBeCloseTo(0.5);
  });
});

describe("zonas para soltar y frenado del divisor", () => {
  const full = { x: 0, y: 0, w: 1, h: 1 };

  it("el borde más cercano o el centro", () => {
    expect(M.dropZone(full, 0.05, 0.5)).toBe("left");
    expect(M.dropZone(full, 0.95, 0.5)).toBe("right");
    expect(M.dropZone(full, 0.5, 0.05)).toBe("top");
    expect(M.dropZone(full, 0.5, 0.95)).toBe("bottom");
    expect(M.dropZone(full, 0.5, 0.5)).toBe("center");
    expect(M.dropZone(full, 0.6, 0.62)).toBe("center");
    expect(M.dropZone({ x: 0.5, y: 0, w: 0.5, h: 1 }, 0.55, 0.5)).toBe("left");
  });

  it("el rectángulo que se pinta: la mitad del lado o el panel entero", () => {
    expect(M.zoneRect(full, "right")).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
    expect(M.zoneRect(full, "top")).toEqual({ x: 0, y: 0, w: 1, h: 0.5 });
    expect(M.zoneRect(full, "center")).toEqual(full);
  });

  it("qué panel está debajo del puntero", () => {
    const rects = new Map([
      ["a", { x: 0, y: 0, w: 0.5, h: 1 }],
      ["b", { x: 0.5, y: 0, w: 0.5, h: 1 }],
    ]);
    expect(M.paneAt(rects, 0.75, 0.5)).toBe("b");
    expect(M.paneAt(rects, 1.5, 0.5)).toBeUndefined();
  });

  it("se frena en un tercio, la mitad y dos tercios si está cerca", () => {
    expect(M.snapRatio(0.49, 800)).toBe(0.5);
    expect(M.snapRatio(0.47, 800)).toBe(0.47);
    expect(M.snapRatio(0.34, 600)).toBe(1 / 3);
    expect(M.snapRatio(0.9, 1000)).toBe(0.9);
  });
});
