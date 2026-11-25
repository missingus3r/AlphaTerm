import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bumpVersion,
  CHANGELOG_LANGS,
  dictProblems,
  groupByVersion,
  LOG_FORMAT,
  missingTranslations,
  parseLog,
  parseTags,
  translateCommit,
  unusedTranslations,
  withTranslations,
} from "./changelog-lib.mjs";

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

describe("traducciones del changelog", () => {
  const c = (subject, body = "") => ({ hash: subject, short: subject.slice(0, 7), date: "", subject, body });
  const dicts = {
    en: { "Opciones de agentes": { subject: "Agent options", body: "- detail" }, "Sin cuerpo": { subject: "No body", body: "sobra" }, Viejo: { subject: "Old" } },
    pt: { "Opciones de agentes": { subject: "Opções de agentes" }, "Sin cuerpo": { subject: "  " } },
  };

  it("traduce por el asunto en español; body solo si el commit tiene cuerpo", () => {
    expect(translateCommit(c("Opciones de agentes", "- detalle"), "en", dicts.en)).toEqual({ subject: "Agent options", body: "- detail" });
    expect(translateCommit(c("Opciones de agentes", "- detalle"), "pt", dicts.pt)).toEqual({ subject: "Opções de agentes", body: null });
    expect(translateCommit(c("Sin cuerpo"), "en", dicts.en)).toEqual({ subject: "No body", body: "" });
    expect(translateCommit(c("Sin cuerpo"), "pt", dicts.pt)).toEqual({ subject: null, body: "" });
    expect(translateCommit(c("Otro"), "en", undefined)).toEqual({ subject: null, body: "" });
    expect(translateCommit(c("constructor"), "en", {})).toEqual({ subject: null, body: "" });
  });

  it("los «Versión X.Y.Z» de release.mjs se traducen solos", () => {
    const v = c("Versión 0.6.0", "Sube de 0.5.0 a 0.6.0.");
    expect(translateCommit(v, "en", {})).toEqual({ subject: "Version 0.6.0", body: "Bumps from 0.5.0 to 0.6.0." });
    expect(translateCommit(v, "pt", {})).toEqual({ subject: "Versão 0.6.0", body: "Sobe de 0.5.0 para 0.6.0." });
    // A body different from release.mjs's does need translation.
    expect(translateCommit(c("Versión 0.6.0", "Otra cosa."), "en", {}).body).toBeNull();
    expect(translateCommit(c("Versión 0.6"), "en", {}).subject).toBeNull();
  });

  it("el JSON generado lleva en `tr` solo lo traducido", () => {
    const [a, b, d] = withTranslations([c("Opciones de agentes", "- detalle"), c("Sin cuerpo"), c("Otro")], dicts);
    expect(a.tr).toEqual({ en: { subject: "Agent options", body: "- detail" }, pt: { subject: "Opções de agentes" } });
    expect(b.tr).toEqual({ en: { subject: "No body" } });
    expect(d).not.toHaveProperty("tr");
    expect(a.subject).toBe("Opciones de agentes");
  });

  it("lista lo que falta, por idioma y parte", () => {
    const commits = [c("Opciones de agentes", "- detalle"), c("Sin cuerpo"), c("Otro", "cuerpo"), c("Versión 0.3.0", "Sube de 0.2.0 a 0.3.0.")];
    const m = missingTranslations(commits, dicts);
    expect(m.map((x) => [x.commit.subject, x.missing])).toEqual([
      ["Opciones de agentes", { pt: ["cuerpo"] }],
      ["Sin cuerpo", { pt: ["asunto"] }],
      ["Otro", { en: ["asunto", "cuerpo"], pt: ["asunto", "cuerpo"] }],
    ]);
    expect(missingTranslations([c("Versión 0.3.0", "Sube de 0.2.0 a 0.3.0.")], {})).toEqual([]);
  });

  it("avisa lo que sobra y lo mal formado", () => {
    expect(unusedTranslations([c("Opciones de agentes"), c("Sin cuerpo")], dicts)).toEqual([{ lang: "en", subject: "Viejo" }]);
    const bad = { en: { A: "texto suelto", B: { body: "x" }, C: { subject: "C", body: 3 }, D: { subject: "D", cuerpo: "x" }, E: { subject: "E", body: "e" } } };
    expect(dictProblems(bad)).toEqual([
      expect.stringContaining("«A» tiene que ser"),
      expect.stringContaining("«B» no tiene"),
      expect.stringContaining("«C»"),
      expect.stringContaining("«D»"),
    ]);
  });

  it("los diccionarios reales (src/i18n/changelog) son JSON válido y bien formado", () => {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "i18n", "changelog");
    const real = Object.fromEntries(CHANGELOG_LANGS.map((l) => [l, JSON.parse(fs.readFileSync(path.join(dir, `${l}.json`), "utf8"))]));
    expect(dictProblems(real)).toEqual([]);
    // The same subjects in both languages.
    expect(Object.keys(real.pt).sort()).toEqual(Object.keys(real.en).sort());
  });
});
