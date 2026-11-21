import { describe, expect, it } from "vitest";
import { CATALOG, findSpec } from "./catalog";

describe("findSpec", () => {
  it("encuentra por cualquier nombre, sin mayúsculas ni .exe", () => {
    expect(findSpec("PING", "cmd")?.names).toContain("ping");
    expect(findSpec("ping.exe", "ps")?.names).toContain("ping");
    expect(findSpec("md", "cmd")?.names).toContain("mkdir");
  });

  it("los comandos internos de cmd que en PowerShell son alias de cmdlets no están en ps", () => {
    expect(findSpec("dir", "cmd")).not.toBeNull();
    expect(findSpec("dir", "ps")).toBeNull();
    expect(findSpec("curl", "ps")).toBeNull();
    expect(findSpec("cd", "ps")).not.toBeNull();
  });

  it("ping sugiere hosts; cd, carpetas; git checkout, ramas", () => {
    expect(findSpec("ping", "cmd")?.args).toBe("hosts");
    expect(findSpec("cd", "cmd")?.args).toBe("folders");
    const checkout = findSpec("git", "ps")?.subs?.find((s) => s.names.includes("checkout"));
    expect(checkout?.args).toBe("gitBranches");
    expect(findSpec("npm", "ps")?.subs?.find((s) => s.names.includes("run"))?.args).toBe("npmScripts");
    expect(findSpec("taskkill", "cmd")?.opts?.find((o) => o.name === "/IM")?.arg).toBe("processes");
  });

  it("todo tiene descripción en español y nombres sin repetir", () => {
    const seen = new Map<string, number>();
    for (const s of CATALOG) {
      expect(s.desc.length, s.names[0]).toBeGreaterThan(3);
      for (const shell of s.shells ?? ["cmd", "ps"]) for (const n of s.names) seen.set(`${shell}:${n}`, (seen.get(`${shell}:${n}`) ?? 0) + 1);
    }
    expect([...seen].filter(([, n]) => n > 1)).toEqual([]);
    expect(CATALOG.length).toBeGreaterThanOrEqual(40);
  });
});
