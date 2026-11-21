import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    calls.push(cmd);
    if (cmd === "git_root") return "C:\\proy";
    if (cmd === "git_branches") return [{ name: "main", current: true, remote: false }];
    return [];
  }),
}));

import { liveSources } from "./generators";

describe("generadores", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("reusan el pedido en curso y lo guardan unos segundos (no un proceso por tecla)", async () => {
    const s = liveSources(() => "C:\\proy");
    const [a, b] = await Promise.all([s.gen("gitBranches", "C:\\proy"), s.gen("gitBranches", "C:\\proy")]);
    const c = await s.gen("gitBranches", "C:\\proy");
    expect(a.map((v) => v.v)).toEqual(["main"]);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(calls.filter((x) => x === "git_branches")).toHaveLength(1);
    await s.gen("dockerContainers", "C:\\proy");
    await s.gen("dockerContainers", "C:\\proy");
    expect(calls.filter((x) => x === "docker_containers")).toHaveLength(1);
  });
});
