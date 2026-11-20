import { describe, expect, it } from "vitest";
import { bumpVersion, groupByVersion, LOG_FORMAT, parseLog, parseTags } from "./changelog-lib.mjs";

const US = "\x1f";
const RS = "\x1e";

describe("versiones", () => {
  it("sube patch, minor y major", () => {
    expect(bumpVersion("0.2.0")).toBe("0.2.1");
    expect(bumpVersion("0.2.9", "minor")).toBe("0.3.0");
    expect(bumpVersion("0.9.3", "major")).toBe("1.0.0");
    expect(() => bumpVersion("0.2")).toThrow(/inválida/);
    expect(() => bumpVersion("0.2.0", "otra")).toThrow(/desconocido/);
  });
});

describe("changelog", () => {
  const log = [
    ["h4", "d4", "2026-11-20T12:00:00-03:00", "Versión 0.3.0", ""],
    ["h3", "d3", "2026-11-20T11:00:00-03:00", "Opciones de agentes", "- detalle\n\nCo-Authored-By: Claude <x@y>\nClaude-Session: https://z"],
    ["h2", "d2", "2026-11-20T10:00:00-03:00", "0.2.0: consumo en vivo", "cuerpo"],
    ["h1", "d1", "2026-11-18T09:00:00-03:00", "Colores en Claude Code", ""],
    ["h0", "d0", "2026-11-17T09:00:00-03:00", "F0 y F1", ""],
  ]
    .map((f) => f.join(US) + RS)
    .join("\n");

  it("lee el log y saca las firmas", () => {
    const c = parseLog(log);
    expect(c).toHaveLength(5);
    expect(c[1]).toMatchObject({ short: "d3", subject: "Opciones de agentes", body: "- detalle" });
    expect(LOG_FORMAT).toContain("%H");
  });

  it("tags anotados y livianos, solo vX.Y.Z", () => {
    const t = parseTags(["v0.2.0" + US + "tagobj" + US + "h2", "v0.1.0" + US + "h1" + US, "otro" + US + "h0" + US].join("\n"));
    expect([...t]).toEqual([["h2", "0.2.0"], ["h1", "0.1.0"]]);
  });

  it("agrupa por versión, con la que se está compilando arriba", () => {
    const commits = parseLog(log);
    const tags = new Map([["h2", "0.2.0"], ["h1", "0.1.0"]]);
    const v = groupByVersion(commits, tags, "0.3.0", "AHORA");
    expect(v.map((x) => [x.version, x.commits.map((c) => c.short)])).toEqual([
      ["0.3.0", ["d4", "d3"]],
      ["0.2.0", ["d2"]],
      ["0.1.0", ["d1", "d0"]],
    ]);
    expect(v[0].date).toBe("AHORA");
    expect(v[1].date).toBe("2026-11-20T10:00:00-03:00");
  });

  it("sin versión nueva, lo de arriba del último tag queda sin publicar", () => {
    const commits = parseLog(log);
    const v = groupByVersion(commits, new Map([["h2", "0.2.0"]]), undefined);
    expect(v[0]).toMatchObject({ version: null, released: false });
    expect(v[0].commits).toHaveLength(2);
  });
});
