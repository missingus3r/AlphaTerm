import { describe, expect, it } from "vitest";
import { parse7717, PS_CHORD } from "./pwsh";

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

describe("parse7717", () => {
  it("acepta el aviso de listo con el nonce de la sesión", () => {
    expect(parse7717("ready;abc", "abc")).toEqual({ type: "ready" });
  });

  it("ignora mensajes con otro nonce (otra salida imitándolo)", () => {
    expect(parse7717("ready;otro", "abc")).toBeNull();
    expect(parse7717(`c;otro;${b64("{}")}`, "abc")).toBeNull();
  });

  it("ignora base64 o JSON rotos", () => {
    expect(parse7717("c;abc;%%%no-es-base64", "abc")).toBeNull();
    expect(parse7717(`c;abc;${b64("{roto")}`, "abc")).toBeNull();
  });

  it("mapea los completados, con UTF-8", () => {
    const json = JSON.stringify({
      b: "cd Doc",
      c: 6,
      i: 3,
      l: 3,
      r: [
        { t: ".\\Documentos", s: "Documentos", k: "ProviderContainer", d: "C:\\x\\Documentos" },
        { t: "'.\\Año 2026'", s: "Año 2026", k: "ProviderContainer", d: "" },
      ],
    });
    expect(parse7717(`c;abc;${b64(json)}`, "abc")).toEqual({
      type: "completions",
      buffer: "cd Doc",
      cursor: 6,
      index: 3,
      length: 3,
      results: [
        { text: ".\\Documentos", label: "Documentos", kind: "ProviderContainer", tip: "C:\\x\\Documentos" },
        { text: "'.\\Año 2026'", label: "Año 2026", kind: "ProviderContainer", tip: "" },
      ],
    });
  });

  it("un solo resultado puede venir como objeto en vez de lista", () => {
    const json = JSON.stringify({ b: "ipconf", c: 6, i: 0, l: 6, r: { t: "ipconfig.exe", s: "ipconfig.exe", k: "Command", d: "" } });
    const m = parse7717(`c;abc;${b64(json)}`, "abc");
    expect(m?.type === "completions" && m.results.map((r) => r.text)).toEqual(["ipconfig.exe"]);
  });

  it("el atajo es F12 seguido de e", () => {
    expect(PS_CHORD).toBe("\x1b[24~e");
  });
});
