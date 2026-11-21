import { describe, expect, it } from "vitest";
import { analyze, collect, type HistEntry, type Sources } from "./engine";
import { parseLine } from "./line";
import type { PsMsg } from "./pwsh";
import type { Shell } from "./types";

const NOW = 1_800_000_000_000;

function sources(o: Partial<{ dirs: Record<string, { name: string; dir: boolean }[]>; history: HistEntry[]; path: string[] }> = {}): Sources & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    listDir: async (dir, dirsOnly) => {
      calls.push(`list:${dir}:${dirsOnly}`);
      const all = o.dirs?.[dir] ?? [];
      return dirsOnly ? all.filter((e) => e.dir) : all;
    },
    history: async () => o.history ?? [],
    pathCommands: async () => o.path ?? [],
    gen: async (name) => {
      calls.push(`gen:${name}`);
      if (name === "hosts") return [{ v: "8.8.8.8", desc: "DNS de Google" }, { v: "192.168.1.1", desc: "tu router" }];
      if (name === "gitBranches") return [{ v: "main" }, { v: "predicciones" }];
      return [];
    },
  };
}

const run = async (line: string, shell: Shell, src: Sources, ps?: PsMsg) =>
  collect(analyze(parseLine(line, shell), shell), { line, cwd: "C:\\proy", shell, now: NOW }, src, ps);

const h = (command: string, cwd: string | null, hoursAgo: number, shell = "Windows PowerShell"): HistEntry => ({
  command,
  cwd,
  at: NOW - hoursAgo * 3_600_000,
  shell,
});

describe("analyze", () => {
  it("cd con espacio: carpetas, aparece solo", () => {
    const a = analyze(parseLine("cd ", "cmd"), "cmd");
    expect(a).toMatchObject({ mode: "arg", source: "folders", auto: true, askPwsh: false });
  });

  it("primera palabra: aparece sola con 2 letras; en PowerShell se le pregunta con 3", () => {
    expect(analyze(parseLine("g", "ps"), "ps").auto).toBe(false);
    expect(analyze(parseLine("gi", "ps"), "ps")).toMatchObject({ mode: "command", auto: true, askPwsh: false });
    expect(analyze(parseLine("Get-Ch", "ps"), "ps")).toMatchObject({ mode: "command", askPwsh: true });
    expect(analyze(parseLine("Get-Ch", "cmd"), "cmd").askPwsh).toBe(false);
  });

  it("comando del catálogo: no se le pregunta a PowerShell; uno desconocido, sí", () => {
    expect(analyze(parseLine("cd x", "ps"), "ps").askPwsh).toBe(false);
    expect(analyze(parseLine("Get-ChildItem -", "ps"), "ps").askPwsh).toBe(true);
  });

  it("nunca para rutas de red", () => {
    expect(analyze(parseLine("Get-Item \\\\srv\\c", "ps"), "ps").askPwsh).toBe(false);
  });

  it("argumento de ruta de un comando cualquiera: aparece con 1 letra, no vacío", () => {
    expect(analyze(parseLine("type ", "cmd"), "cmd").auto).toBe(false);
    expect(analyze(parseLine("type a", "cmd"), "cmd")).toMatchObject({ source: "paths", auto: true });
  });

  it("la opción anterior manda: taskkill /IM → procesos", () => {
    expect(analyze(parseLine("taskkill /IM ", "cmd"), "cmd").source).toBe("processes");
  });
});

describe("collect", () => {
  it("ping: hosts primero, después opciones", async () => {
    const r = await run("ping ", "cmd", sources());
    expect(r[0]).toMatchObject({ insert: "8.8.8.8", desc: "DNS de Google", kind: "value" });
    expect(r.some((s) => s.kind === "option" && s.insert === "-t")).toBe(true);
    expect(r.findIndex((s) => s.insert === "-t")).toBeGreaterThan(r.findIndex((s) => s.insert === "192.168.1.1"));
  });

  it("ping suma los hosts usados antes con ping", async () => {
    const r = await run("ping ", "cmd", sources({ history: [h("ping 10.0.0.5 -t", null, 1, "Símbolo del sistema")] }));
    expect(r.some((s) => s.insert === "10.0.0.5")).toBe(true);
    expect(r.some((s) => s.insert === "-t" && s.kind === "value")).toBe(false);
  });

  it("cd al: solo carpetas, primero las que empiezan con al", async () => {
    const src = sources({
      dirs: {
        "": [
          { name: "aa-disney", dir: true },
          { name: "AlphaTerm", dir: true },
          { name: "notas.txt", dir: false },
          { name: "Mal", dir: true },
        ],
      },
    });
    const r = await run("cd al", "cmd", src);
    expect(src.calls).toContain("list::true");
    expect(r.map((s) => s.label)).toEqual(["AlphaTerm\\", "Mal\\"]);
    expect(r[0]).toMatchObject({ insert: "AlphaTerm\\", dir: true, kind: "folder", hits: [0, 1] });
  });

  it("cd src\\co: lista la subcarpeta y completa con la ruta entera", async () => {
    const src = sources({ dirs: { "src\\": [{ name: "components", dir: true }] } });
    const r = await run("cd src\\co", "ps", src);
    expect(r[0]).toMatchObject({ insert: "src\\components\\", label: "components\\" });
  });

  it("cd vacío ofrece la carpeta de arriba", async () => {
    const r = await run("cd ", "cmd", sources());
    expect(r.some((s) => s.insert === "..\\")).toBe(true);
  });

  it("cd: el historial de otra carpeta no aparece, salvo con rutas absolutas", async () => {
    const src = sources({
      history: [h("cd docs", "C:\\otra", 1), h("cd src", "C:\\proy", 2), h("cd C:\\Windows", "C:\\otra", 3), h("cd ~\\Desktop", "C:\\x", 4)],
    });
    const r = (await run("cd ", "ps", src)).filter((s) => s.kind === "history").map((s) => s.insert);
    expect(r).toEqual(["cd src", "cd C:\\Windows", "cd ~\\Desktop"]);
  });

  it("cd: la carpeta de arriba va primero entre las carpetas", async () => {
    const r = await run("cd ", "cmd", sources({ dirs: { "": [{ name: "AlphaTerm", dir: true }] } }));
    const folders = r.filter((s) => s.kind === "folder").map((s) => s.insert);
    expect(folders[0]).toBe("..\\");
  });

  it("git checkout: ramas", async () => {
    const r = await run("git checkout ", "ps", sources());
    expect(r.map((s) => s.insert).slice(0, 2)).toEqual(["main", "predicciones"]);
  });

  it("git: subcomandos", async () => {
    const r = await run("git che", "ps", sources());
    expect(r[0]).toMatchObject({ insert: "checkout", kind: "command" });
  });

  it("historial: la línea entera, con más peso en la misma carpeta", async () => {
    const src = sources({
      history: [h("git push origin main", "C:\\otra", 1), h("git pull", "C:\\proy", 5), h("git push origin predicciones", "C:\\proy", 30)],
    });
    const r = await run("git p", "ps", src);
    // Misma carpeta primero; entre esas, la más reciente.
    expect(r[0]).toMatchObject({ insert: "git pull", replace: "line", kind: "history" });
    expect(r[1].insert).toBe("git push origin predicciones");
    expect(r.filter((s) => s.kind === "history").map((s) => s.insert)).toContain("git push origin main");
  });

  it("el historial de cmd no aparece en PowerShell (y al revés)", async () => {
    const src = sources({ history: [h("dir /s", null, 1, "Símbolo del sistema"), h("dir -Force", null, 1, "Windows PowerShell")] });
    expect((await run("dir", "ps", src)).map((s) => s.insert)).toEqual(["dir -Force"]);
    expect((await run("dir", "cmd", src)).filter((s) => s.kind === "history").map((s) => s.insert)).toEqual(["dir /s"]);
  });

  it("primera palabra: catálogo y PATH, sin repetir", async () => {
    const r = await run("pin", "cmd", sources({ path: ["PING", "pinta"] }));
    expect(r.map((s) => s.insert)).toEqual(["ping", "pinta"]);
  });

  it("resultados de PowerShell se mezclan sin repetir carpetas locales", async () => {
    const src = sources({ dirs: { "": [{ name: "AlphaTerm", dir: true }] } });
    const ps: PsMsg = {
      type: "completions",
      buffer: "Get-ChildItem Al",
      cursor: 16,
      index: 14,
      length: 2,
      results: [
        { text: ".\\AlphaTerm", label: "AlphaTerm", kind: "ProviderContainer", tip: "" },
        { text: ".\\Alarma.txt", label: "Alarma.txt", kind: "ProviderItem", tip: "" },
      ],
    };
    const r = await run("Get-ChildItem Al", "ps", src, ps);
    expect(r.filter((s) => s.label.toLowerCase().startsWith("alphaterm"))).toHaveLength(1);
    expect(r.find((s) => s.label === "Alarma.txt")).toMatchObject({ insert: ".\\Alarma.txt", from: 14, kind: "file" });
  });

  it("una respuesta de PowerShell vieja (otro buffer) se ignora", async () => {
    const ps: PsMsg = { type: "completions", buffer: "Get-Ch", cursor: 6, index: 0, length: 6, results: [{ text: "Get-ChildItem", label: "Get-ChildItem", kind: "Command", tip: "" }] };
    const r = await run("Get-Co", "ps", sources(), ps);
    expect(r.some((s) => s.insert === "Get-ChildItem")).toBe(false);
  });
});
