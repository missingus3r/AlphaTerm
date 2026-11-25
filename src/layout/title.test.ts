import { describe, expect, it } from "vitest";
import { cmdRunningCommand, commandLabel, folderName, heuristicTitle, isShellTitle, preferTyped, tabTitle, type PaneInfo } from "./title";
import { parse133, parse633, parseOsc7, parseOsc9, toWindowsPath, unescape633 } from "../terminal/integration";

const base: PaneInfo = { shellName: "PowerShell", integrated: true, running: false };

describe("título de pestaña", () => {
  it("prioridad: manual > título del programa > heurística", () => {
    const p: PaneInfo = { ...base, cwd: "C:\\x\\Proyecto-Demo", branch: "main", running: true, lastCommand: "claude", agentTitle: "✳ Arreglar login" };
    expect(tabTitle("Mi tarea", p)).toBe("Mi tarea");
    expect(tabTitle(undefined, p)).toBe("✳ Arreglar login");
    expect(tabTitle("  ", { ...p, agentTitle: undefined })).toBe("claude · Proyecto-Demo (main)");
  });

  it("heurística en reposo y con comando", () => {
    expect(heuristicTitle({ ...base, cwd: "C:\\Users\\Br1\\frontend" })).toBe("frontend");
    expect(heuristicTitle({ ...base, cwd: "C:\\a\\frontend", running: true, lastCommand: "npm run dev" })).toBe("npm run dev · frontend");
    expect(heuristicTitle(base)).toBe("PowerShell");
    // Without integration (cmd), the foreground process says whether something is running.
    expect(heuristicTitle({ ...base, integrated: false, cwd: "C:\\a\\api", fgProcess: "node" })).toBe("node · api");
    expect(heuristicTitle({ ...base, integrated: true, cwd: "C:\\a\\api", fgProcess: "node" })).toBe("api");
  });

  it("etiqueta del comando", () => {
    expect(commandLabel("C:\\tools\\node.exe server.js --port 3000")).toBe("node server.js --port");
    expect(commandLabel('& "C:\\Program Files\\Git\\usr\\bin\\vim.exe" a.txt')).toBe("vim a.txt");
    expect(commandLabel("  ")).toBe("");
    expect(commandLabel("cd C:\\Users\\Br1\\Desktop\\AlphaTerm; ping -n 6 127.0.0.1")).toBe("ping -n 6");
    expect(commandLabel("npm ci && npm run dev")).toBe("npm run dev");
    expect(commandLabel("git log --oneline | less")).toBe("git log --oneline");
    expect(commandLabel("x".repeat(50))).toHaveLength(32);
  });

  it("título de cmd con el comando en curso", () => {
    expect(cmdRunningCommand("C:\\WINDOWS\\system32\\cmd.exe - ping -n 8 127.0.0.1")).toBe("ping -n 8 127.0.0.1");
    expect(cmdRunningCommand("C:\\WINDOWS\\system32\\cmd.exe")).toBeNull();
    // cmd adds an extra space to the title: if it's the same command that was typed, the typed one counts.
    expect(preferTyped("ping 8.8.8.8 -n 3", "ping  8.8.8.8 -n 3")).toBe("ping 8.8.8.8 -n 3");
    expect(preferTyped("ping 8.8.8.8", "node server.js")).toBe("node server.js");
    expect(preferTyped(undefined, "ping  x")).toBe("ping  x");
    expect(cmdRunningCommand("✳ Refactor - login")).toBeNull();
    const p: PaneInfo = { ...base, integrated: false, cwd: "C:\\x\\AlphaTerm", branch: "main", lastCommand: "ping -n 8 127.0.0.1" };
    expect(heuristicTitle({ ...p, fgProcess: "PING" })).toBe("ping -n 8 · AlphaTerm (main)");
    expect(heuristicTitle({ ...p, fgProcess: "node" })).toBe("node · AlphaTerm (main)");
  });

  it("carpeta", () => {
    expect(folderName("C:\\")).toBe("C:\\");
    expect(folderName("C:\\Users\\Br1\\")).toBe("Br1");
    expect(folderName(undefined)).toBe("");
  });

  it("detecta títulos de shell", () => {
    for (const t of ["C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "UCRT64:/c/Users/Br1", "bru@pc: ~/x", "Windows PowerShell"]) {
      expect(isShellTitle(t)).toBe(true);
    }
    expect(isShellTitle("✳ Refactor del parser")).toBe(false);
    expect(isShellTitle("vim")).toBe(false);
  });
});

describe("secuencias de shell integration", () => {
  it("OSC 133", () => {
    expect(parse133("A")).toEqual({ type: "promptStart" });
    expect(parse133("C")).toEqual({ type: "commandStart" });
    expect(parse133("D;0")).toEqual({ type: "commandEnd", exitCode: 0 });
    expect(parse133("D;127")).toEqual({ type: "commandEnd", exitCode: 127 });
    expect(parse133("D")).toEqual({ type: "commandEnd", exitCode: null });
    expect(parse133("Z")).toBeNull();
  });

  it("OSC 633;E con escapes", () => {
    expect(unescape633("a\\x3bb\\\\c")).toBe("a;b\\c");
    expect(parse633("E;git commit -m \"x\\x3by\"")).toEqual({ command: 'git commit -m "x;y"' });
    expect(parse633("E;ls;nonce123")).toEqual({ command: "ls" });
    expect(parse633("A")).toBeNull();
  });

  it("OSC 7 y 9;9 a ruta de Windows", () => {
    expect(parseOsc7("file://PC/C:/Users/Br1/Mi%20Carpeta")).toBe("C:\\Users\\Br1\\Mi Carpeta");
    expect(parseOsc7("file://PC/c/Users/Br1")).toBe("C:\\Users\\Br1");
    expect(parseOsc7("file://PC/C:/")).toBe("C:\\");
    expect(parseOsc7("nada")).toBeNull();
    expect(parseOsc9('9;"C:\\Users\\Br1"')).toBe("C:\\Users\\Br1");
    expect(parseOsc9("4;1;50")).toBeNull();
    expect(toWindowsPath("/d")).toBe("D:\\");
  });
});
