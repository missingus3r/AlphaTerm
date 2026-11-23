import { describe, expect, it } from "vitest";
import * as M from "./model";
import { restore, serialize } from "./session";
import { BUILTIN_AGENTS } from "../settings/schema";

const opts = { relaunch: false, agents: BUILTIN_AGENTS, profileOk: (id: string) => id !== "pwsh", fallbackProfile: "powershell" };

describe("sesión", () => {
  it("guarda la carpeta actual y qué agente era, sin el comando", () => {
    const a = M.newTab("powershell", "C:\\a");
    const b = M.newTab("powershell", "C:\\b", { command: "claude", env: { PATH: "x" }, agentId: "claude" });
    let l: M.Layout = { tabs: [a, b], activeTab: b.id };
    l = M.createGroup(M.setTabColor(l, a.id, "#f00"), "G", [a.id]);
    const s = serialize(l, (id) => (id === a.activePane ? { cwd: "C:\\a\\sub" } : undefined), { windowTitle: "Mi ventana" });
    const json = JSON.parse(JSON.stringify(s));
    const leafA = M.leaves(json.layout.tabs[0].root)[0];
    const leafB = M.leaves(json.layout.tabs[1].root)[0];
    expect(leafA.cwd).toBe("C:\\a\\sub");
    expect(leafB.startup).toEqual({ command: "", agentId: "claude" });
    expect(json.layout.tabs[0].color).toBe("#f00");
    expect(json.layout.groups).toHaveLength(1);
    expect(json.windowTitle).toBe("Mi ventana");
  });

  it("restaura sin relanzar agentes y con perfiles que existan", () => {
    const t = M.newTab("pwsh", "C:\\x", { command: "", agentId: "claude" });
    const r = restore({ version: 1, layout: { tabs: [t], activeTab: "no-existe" } }, opts)!;
    const leaf = M.leaves(r.layout.tabs[0].root)[0];
    expect(leaf.profileId).toBe("powershell");
    expect(leaf.startup).toBeUndefined();
    expect(r.layout.activeTab).toBe(t.id);
  });

  it("relanza agentes retomando la conversación", () => {
    const t = M.newTab("powershell", "C:\\x", { command: "", agentId: "claude" });
    const r = restore({ version: 1, layout: { tabs: [t], activeTab: t.id } }, { ...opts, relaunch: true, env: { PATH: "p" } })!;
    expect(M.leaves(r.layout.tabs[0].root)[0].startup).toEqual({ command: "claude --continue", env: { PATH: "p" }, agentId: "claude" });
  });

  it("guarda y restaura paneles de navegador (URL y dueño)", () => {
    const t = M.newTab("powershell", "C:\\x");
    const b = M.browserLeaf("http://localhost:5173/", t.activePane);
    const l = M.splitPane({ tabs: [t], activeTab: t.id }, t.id, t.activePane, "row", b);
    const json = JSON.parse(JSON.stringify(serialize(l, () => undefined)));
    const r = restore(json, opts)!;
    const leaf = M.leaves(r.layout.tabs[0].root).find((x) => x.browser)!;
    expect(leaf.browser).toEqual({ url: "http://localhost:5173/", owner: t.activePane });
    expect(leaf.startup).toBeUndefined();
  });

  it("guarda la distribución movida", () => {
    const t = M.newTab("powershell", "C:\\x");
    const B = M.leaf("powershell", "C:\\y");
    let l = M.splitPane({ tabs: [t], activeTab: t.id }, t.id, t.activePane, "row", B);
    l = M.movePane(l, t.id, B.id, t.activePane, "left");
    const r = restore(JSON.parse(JSON.stringify(serialize(l, () => undefined))), opts)!;
    expect(M.leaves(r.layout.tabs[0].root).map((x) => x.id)).toEqual([B.id, t.activePane]);
  });

  it("ignora basura", () => {
    expect(restore(null, opts)).toBeNull();
    expect(restore({ version: 1, layout: { tabs: [] } }, opts)).toBeNull();
    expect(restore({ version: 2 }, opts)).toBeNull();
  });
});
