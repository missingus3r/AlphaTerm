import { describe, expect, it } from "vitest";
import * as M from "./model";
import { autoScrollStep, tabDropAt, type TabSlot } from "./tabDrag";

describe("dónde cae una pestaña arrastrada", () => {
  // Tab A, folder header G and tab B, with the 2 px gaps of the bar.
  const slots: TabSlot[] = [
    { kind: "tab", id: "A", start: 0, end: 100 },
    { kind: "group", id: "G", start: 102, end: 150 },
    { kind: "tab", id: "B", start: 152, end: 252 },
  ];

  it("cada pestaña tiene dos mitades: antes y después", () => {
    expect(tabDropAt(slots, 10)).toEqual({ kind: "tab", id: "A", side: "before" });
    expect(tabDropAt(slots, 60)).toEqual({ kind: "tab", id: "A", side: "after" });
    expect(tabDropAt(slots, 251)).toEqual({ kind: "tab", id: "B", side: "after" });
  });

  it("la cabecera de una carpeta: antes de ella o adentro", () => {
    expect(tabDropAt(slots, 101)).toEqual({ kind: "group", id: "G", side: "before" }); // the gap counts as the next one
    expect(tabDropAt(slots, 140)).toEqual({ kind: "group", id: "G", side: "into" });
  });

  it("antes de la primera es la primera; después de la última, el final", () => {
    expect(tabDropAt(slots, -30)).toEqual({ kind: "tab", id: "A", side: "before" });
    expect(tabDropAt(slots, 400)).toEqual({ kind: "end" });
    expect(tabDropAt([], 10)).toBeNull();
  });
});

describe("reordenar arrastrando", () => {
  // a, [b, c] in folder g1, d
  const tabs = [{ id: "a" }, { id: "b", groupId: "g1" }, { id: "c", groupId: "g1" }, { id: "d" }];
  const order = (drop: M.TabDrop, id: string) => M.placeInOrder(tabs, id, drop).map((t) => (t.groupId ? `${t.id}:${t.groupId}` : t.id));

  it("junto a una pestaña toma su carpeta (o ninguna)", () => {
    expect(order({ kind: "tab", id: "c", side: "after" }, "a")).toEqual(["b:g1", "c:g1", "a:g1", "d"]);
    expect(order({ kind: "tab", id: "b", side: "before" }, "d")).toEqual(["a", "d:g1", "b:g1", "c:g1"]);
    expect(order({ kind: "tab", id: "d", side: "after" }, "b")).toEqual(["a", "c:g1", "d", "b"]);
    expect(order({ kind: "tab", id: "a", side: "before" }, "d")).toEqual(["d", "a", "b:g1", "c:g1"]);
  });

  it("en la cabecera: antes de la carpeta, suelta, o adentro, primera", () => {
    expect(order({ kind: "group", id: "g1", side: "before" }, "c")).toEqual(["a", "c", "b:g1", "d"]);
    expect(order({ kind: "group", id: "g1", side: "before" }, "b")).toEqual(["a", "b", "c:g1", "d"]);
    expect(order({ kind: "group", id: "g1", side: "into" }, "d")).toEqual(["a", "d:g1", "b:g1", "c:g1"]);
  });

  it("al final queda suelta", () => {
    expect(order({ kind: "end" }, "b")).toEqual(["a", "c:g1", "d", "b"]);
  });

  it("sobre sí misma o en un lugar que no existe, nada cambia", () => {
    expect(M.placeInOrder(tabs, "a", { kind: "tab", id: "a", side: "after" })).toBe(tabs);
    expect(M.placeInOrder(tabs, "a", { kind: "tab", id: "zz", side: "after" })).toBe(tabs);
    expect(M.placeInOrder(tabs, "zz", { kind: "end" })).toBe(tabs);
    expect(M.placeInOrder(tabs, "a", { kind: "group", id: "g9", side: "into" })).toBe(tabs);
  });

  it("dropChanges: solo marca los destinos que mueven algo", () => {
    expect(M.dropChanges(tabs, "a", { kind: "tab", id: "a", side: "before" })).toBe(false);
    expect(M.dropChanges(tabs, "a", { kind: "tab", id: "b", side: "before" })).toBe(true); // enters the folder
    expect(M.dropChanges(tabs, "d", { kind: "end" })).toBe(false);
    expect(M.dropChanges(tabs, "c", { kind: "tab", id: "b", side: "after" })).toBe(false);
    expect(M.dropChanges(tabs, "c", { kind: "tab", id: "d", side: "before" })).toBe(true); // leaves the folder
  });

  it("dropTab sobre el layout: la carpeta que queda vacía desaparece", () => {
    let l: M.Layout = { tabs: [M.newTab("pwsh"), M.newTab("pwsh"), M.newTab("pwsh")], activeTab: "" };
    const ids = l.tabs.map((t) => t.id);
    l = M.createGroup(l, "A", [ids[0]]);
    const moved = M.dropTab(l, ids[0], { kind: "end" });
    expect(moved.tabs.map((t) => t.id)).toEqual([ids[1], ids[2], ids[0]]);
    expect(moved.groups).toEqual([]);
    expect(M.dropTab(l, ids[1], { kind: "tab", id: ids[1], side: "before" })).toBe(l);
  });
});

describe("desplazar la lista al arrastrar contra un borde", () => {
  it("solo cerca de los bordes, más rápido cuanto más cerca", () => {
    expect(autoScrollStep(250, 0, 500)).toBe(0);
    expect(autoScrollStep(0, 0, 500)).toBe(-14);
    expect(autoScrollStep(14, 0, 500)).toBe(-7);
    expect(autoScrollStep(500, 0, 500)).toBe(14);
    expect(autoScrollStep(-50, 0, 500)).toBe(-14); // outside the list, at full speed
  });

  it("en una lista muy chica no desplaza", () => {
    expect(autoScrollStep(0, 0, 40)).toBe(0);
  });
});
