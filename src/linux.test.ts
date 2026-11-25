// Linux behaviour of everything that depends on the system: paths, the shell's folder, the location
// bar, quoting for agents and command suggestions in bash/zsh/fish. Each test switches to Linux
// with `setOs` and goes back to Windows (what the rest of the tests assume).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { baseName, isAbsolute, isInside, joinPath, setOs } from "./platform";
import { findPaths, resolvePath } from "./terminal/paths";
import { parseOsc7, parseOsc9 } from "./terminal/integration";
import { pathSegments } from "./widgets/pathSegments";
import { quoteArg, shellKindOf } from "./panels/agentLaunch";
import { folderName } from "./layout/title";
import { analyze, collect, type Sources } from "./suggest/engine";
import { parseLine } from "./suggest/line";
import { insertion } from "./suggest/insert";
import { findSpec } from "./suggest/catalog";
import type { Suggestion } from "./suggest/engine";

beforeEach(() => setOs("linux"));
afterEach(() => setOs("windows"));

describe("platform en Linux", () => {
  it("rutas absolutas, unir, nombre y contención (con mayúsculas distintas)", () => {
    expect(isAbsolute("/home/yo")).toBe(true);
    expect(isAbsolute("C:\\x")).toBe(false);
    expect(joinPath("/home/yo/", "src/a.ts")).toBe("/home/yo/src/a.ts");
    expect(joinPath("/", "etc")).toBe("/etc");
    expect(baseName("/home/yo/web/")).toBe("web");
    expect(isInside("/home/yo/web/src", "/home/yo/web")).toBe(true);
    expect(isInside("/home/yo/webapp", "/home/yo/web")).toBe(false);
    expect(isInside("/home/yo/Web/src", "/home/yo/web")).toBe(false);
  });

  it("en Windows sigue igual", () => {
    setOs("windows");
    expect(isAbsolute("C:\\x")).toBe(true);
    expect(joinPath("C:\\web", "src")).toBe("C:\\web\\src");
    expect(isInside("c:\\WEB\\src", "C:\\web")).toBe(true);
  });
});

describe("rutas en la salida de la terminal", () => {
  const raws = (s: string) => findPaths(s).map((m) => m.raw);

  it("absolutas de Linux, con línea y columna, sin confundir URLs ni fracciones", () => {
    expect(raws("Escribí /home/yo/web/a.ts y listo.")).toEqual(["/home/yo/web/a.ts"]);
    expect(findPaths("error en /home/yo/a.rs:12:5")[0]).toMatchObject({ raw: "/home/yo/a.rs", line: 12, col: 5 });
    expect(raws("ver https://example.com/a/b")).toEqual([]);
    expect(raws("relativa src/main.rs")).toEqual(["src/main.rs"]);
    expect(raws('abrí "/home/yo/Mis cosas/a b.txt" ahora')).toEqual(["/home/yo/Mis cosas/a b.txt"]);
    expect(raws("C:\\Users\\yo no es de acá")).toEqual([]);
  });

  it("resuelve contra la carpeta del panel y normaliza . y ..", () => {
    expect(resolvePath("src/a.ts", "/home/yo/web")).toBe("/home/yo/web/src/a.ts");
    expect(resolvePath("../otro/x.md", "/home/yo/web/app/")).toBe("/home/yo/web/otro/x.md");
    expect(resolvePath("/etc/./hosts")).toBe("/etc/hosts");
    expect(resolvePath("../../..", "/home")).toBe("/");
    expect(resolvePath("a.txt")).toBeNull();
  });
});

describe("carpeta que informa la shell", () => {
  it("OSC 7 y 9;9 quedan como rutas de Linux", () => {
    expect(parseOsc7("file://pc/home/yo/Mis%20cosas")).toBe("/home/yo/Mis cosas");
    expect(parseOsc7("file://pc/")).toBe("/");
    expect(parseOsc7("file://pc/home/yo/")).toBe("/home/yo");
    expect(parseOsc9("9;/srv/app")).toBe("/srv/app");
  });

  it("nombre de la carpeta para el título", () => {
    expect(folderName("/home/yo/web")).toBe("web");
    expect(folderName("/")).toBe("/");
  });
});

describe("barra de ubicación", () => {
  it("cada segmento abre su carpeta, empezando por la raíz", () => {
    expect(pathSegments("/home/yo/web")).toEqual([
      { name: "/", path: "/" },
      { name: "home", path: "/home" },
      { name: "yo", path: "/home/yo" },
      { name: "web", path: "/home/yo/web" },
    ]);
    expect(pathSegments("/")).toEqual([{ name: "/", path: "/" }]);
    expect(pathSegments("")).toEqual([]);
  });

  it("en Windows sigue igual", () => {
    setOs("windows");
    expect(pathSegments("C:\\Users\\x").map((s) => s.path)).toEqual(["C:\\", "C:\\Users", "C:\\Users\\x"]);
  });
});

describe("comandos de agentes según la shell", () => {
  it("bash y zsh como sh; fish con su propio escape; un perfil propio, como sh", () => {
    expect(shellKindOf("bash")).toBe("posix");
    expect(shellKindOf("zsh")).toBe("posix");
    expect(shellKindOf("fish")).toBe("fish");
    expect(shellKindOf("mi-shell")).toBe("posix");
    expect(quoteArg("it's", "posix")).toBe(`'it'\\''s'`);
    expect(quoteArg("it's a\\b", "fish")).toBe(`'it\\'s a\\\\b'`);
    expect(quoteArg("simple", "fish")).toBe("simple");
  });
});

describe("sugerencias en bash, zsh y fish", () => {
  const src = (dirs: Record<string, { name: string; dir: boolean }[]>, history: { command: string; cwd: string | null; at: number; shell: string | null }[] = [], path: string[] = []): Sources => ({
    listDir: async (dir, dirsOnly) => (dirs[dir] ?? []).filter((e) => !dirsOnly || e.dir),
    history: async () => history,
    pathCommands: async () => path,
    gen: async () => [],
  });
  const run = (line: string, s: Sources, cwd = "/home/yo/proy") => collect(analyze(parseLine(line, "sh"), "sh"), { line, cwd, shell: "sh", now: 0 }, s);

  it("carpetas con / al final, también ~ y ..", async () => {
    const s = src({ "": [{ name: "AlphaTerm", dir: true }, { name: "notas.txt", dir: false }] });
    const r = await run("cd ", s);
    expect(r.map((x) => x.label)).toEqual(expect.arrayContaining(["AlphaTerm/", "../", "~/"]));
    expect(r.find((x) => x.label === "AlphaTerm/")?.insert).toBe("AlphaTerm/");
    expect(r.map((x) => x.label)).not.toContain("notas.txt");
  });

  it("baja por carpetas con /", async () => {
    const s = src({ "src/": [{ name: "main.rs", dir: false }, { name: "pty", dir: true }] });
    const r = await run("cat src/m", s);
    expect(r[0]).toMatchObject({ insert: "src/main.rs", kind: "file" });
  });

  it("catálogo de Linux: ls y sus opciones; los de Windows no aparecen", async () => {
    expect(findSpec("ls", "sh")).not.toBeNull();
    expect(findSpec("ipconfig", "sh")).toBeNull();
    expect(findSpec("tasklist", "sh")).toBeNull();
    expect(findSpec("ls", "ps")).toBeNull();
    expect(findSpec("cd", "sh")?.opts?.map((o) => o.name)).toEqual(["-"]);
    const r = await run("ls -", src({}));
    expect(r.map((x) => x.label)).toEqual(expect.arrayContaining(["-l", "-la", "-a"]));
    const p = await run("ping -", src({}));
    expect(p.map((x) => x.label)).toContain("-c");
    expect(p.map((x) => x.label)).not.toContain("-t");
  });

  it("los programas del PATH respetan mayúsculas", async () => {
    const r = await run("Xo", src({}, [], ["Xorg"]));
    expect(r[0]).toMatchObject({ insert: "Xorg" });
  });

  it("el historial es el de las shells de Linux y la carpeta distingue mayúsculas", async () => {
    const hist = [
      { command: "cd docs", cwd: "/home/yo/proy", at: 0, shell: "Bash" },
      { command: "cd Docs", cwd: "/home/yo/Proy", at: 0, shell: "Zsh" },
      { command: "cd win", cwd: "/home/yo/proy", at: 0, shell: "Windows PowerShell" },
    ];
    const r = await run("cd ", src({}, hist));
    const lines = r.filter((x) => x.kind === "history").map((x) => x.insert);
    expect(lines).toEqual(["cd docs"]);
  });

  it("inserta con comillas simples si hace falta; con una comilla adentro, dobles", () => {
    const ins = (line: string, s: Partial<Suggestion>) => insertion(line, { label: "", kind: "folder", score: 0, replace: "word", insert: "", ...s }, parseLine(line, "sh").current, "sh");
    expect(ins("cd mis", { insert: "Mis Documentos/", dir: true })).toBe("\x7f".repeat(3) + "'Mis Documentos/'");
    expect(ins("cat no", { insert: "notas.txt", kind: "file" })).toBe("\x7f".repeat(2) + "notas.txt ");
    expect(ins("cat lo", { insert: "lo de $Ana's.txt", kind: "file" })).toBe("\x7f".repeat(2) + '"lo de \\$Ana\'s.txt" ');
    expect(ins("cd sr", { insert: "src/", dir: true })).toBe("\x7f".repeat(2) + "src/");
  });
});
