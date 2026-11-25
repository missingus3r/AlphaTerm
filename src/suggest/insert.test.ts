import { describe, expect, it } from "vitest";
import { insertion } from "./insert";
import { parseLine } from "./line";
import type { Suggestion } from "./engine";
import type { Shell } from "./types";

const DEL = "\x7f";
const ins = (line: string, s: Partial<Suggestion>, shell: Shell) =>
  insertion(line, { label: "", kind: "folder", score: 0, replace: "word", insert: "", ...s }, parseLine(line, shell).current, shell);

describe("insertion", () => {
  it("reemplaza la palabra actual con retrocesos y deja la carpeta abierta para seguir", () => {
    expect(ins("cd al", { insert: "AlphaTerm\\", dir: true }, "cmd")).toBe(DEL.repeat(2) + "AlphaTerm\\");
  });

  it("después de un espacio no borra nada; lo que no es carpeta termina en espacio", () => {
    expect(ins("ping ", { insert: "8.8.8.8", kind: "value" }, "cmd")).toBe("8.8.8.8 ");
  });

  // Inside quotes, the trailing slash is doubled: with a single one, `\"` escapes the quote for git, node and
  // any external program (verified on this PC); cd and Set-Location accept the double one.
  it("carpetas con espacios: comillas dobles en cmd y simples en PowerShell, barra final doblada", () => {
    expect(ins("cd mis", { insert: "Mis Documentos\\", dir: true }, "cmd")).toBe(DEL.repeat(3) + '"Mis Documentos\\\\"');
    expect(ins("cd mis", { insert: "Mis Documentos\\", dir: true }, "ps")).toBe(DEL.repeat(3) + "'Mis Documentos\\\\'");
  });

  it("archivos con espacios: comillas, sin barra", () => {
    expect(ins("type mi", { insert: "mi archivo.txt", kind: "file" }, "cmd")).toBe(DEL.repeat(2) + '"mi archivo.txt" ');
  });

  it("en PowerShell el apóstrofo se duplica dentro de comillas simples", () => {
    expect(ins("cd b", { insert: "Bruno's\\", dir: true }, "ps")).toBe(DEL + "'Bruno''s\\\\'");
  });

  it("si ya se abrieron comillas, se respetan y se reemplaza todo lo escrito", () => {
    expect(ins('cd "Mis D', { insert: "Mis Documentos\\", dir: true }, "cmd")).toBe(DEL.repeat(6) + '"Mis Documentos\\\\"');
    expect(ins("cd 'Mis Documentos\\\\'", { insert: "Mis Documentos\\Fotos\\", dir: true }, "ps")).toBe(
      DEL.repeat(18) + "'Mis Documentos\\Fotos\\\\'",
    );
  });

  it("un valor que ya trae comillas no se vuelve a entrecomillar", () => {
    expect(ins("tasklist /fi ", { insert: '"IMAGENAME eq chrome.exe"', kind: "value" }, "cmd")).toBe('"IMAGENAME eq chrome.exe" ');
  });

  it("una línea del historial reemplaza la línea entera y no agrega espacio", () => {
    expect(ins("git p", { insert: "git push origin main", replace: "line", kind: "history" }, "ps")).toBe(DEL.repeat(5) + "git push origin main");
  });

  it("un resultado de PowerShell se inserta tal cual desde su índice", () => {
    expect(ins("Get-ChildItem Al", { insert: ".\\Alarma.txt", from: 14, kind: "file" }, "ps")).toBe(DEL.repeat(2) + ".\\Alarma.txt ");
    expect(ins("cd Al", { insert: ".\\AlphaTerm", from: 3, kind: "folder", dir: true }, "ps")).toBe(DEL.repeat(2) + ".\\AlphaTerm\\");
    expect(ins("cd mi", { insert: "'.\\Mis Docs'", from: 3, kind: "folder", dir: true }, "ps")).toBe(DEL.repeat(2) + "'.\\Mis Docs'");
  });
});
