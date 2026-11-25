import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import { between, cmpVersion, commitText, fmtDate, type ChangeCommit, type ChangeVersion } from "./changelog";

const v = (version: string | null): ChangeVersion => ({ version, date: null, released: version !== null, commits: [] });
const list = [v(null), v("0.10.0"), v("0.3.0"), v("0.2.0"), v("0.1.0")];
const names = (l: ChangeVersion[]) => l.map((x) => x.version ?? "sin publicar");

describe("changelog entre versiones", () => {
  it("compara números, no texto", () => {
    expect(cmpVersion("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(cmpVersion("1.0.0", "1.0.0")).toBe(0);
  });

  it("lo que cambió después de una versión hasta otra", () => {
    expect(names(between(list, "0.1.0", "0.3.0"))).toEqual(["0.3.0", "0.2.0"]);
    expect(names(between(list, "0.2.0"))).toEqual(["sin publicar", "0.10.0", "0.3.0"]);
    expect(names(between(list, undefined, "0.2.0"))).toEqual(["0.2.0", "0.1.0"]);
    expect(names(between(list))).toHaveLength(5);
  });
});

describe("changelog en el idioma de la interfaz", () => {
  afterEach(() => setLang("es"));
  const c = (over: Partial<ChangeCommit>): ChangeCommit => ({ hash: "h", short: "h", date: "", subject: "Asunto", body: "Cuerpo", ...over });

  it("asunto y cuerpo traducidos; lo que falta, en español", () => {
    const full = c({ tr: { en: { subject: "Subject", body: "Body" }, pt: { subject: "Assunto" } } });
    expect(commitText(full, "es")).toEqual({ subject: "Asunto", body: "Cuerpo" });
    expect(commitText(full, "en")).toEqual({ subject: "Subject", body: "Body" });
    expect(commitText(full, "pt")).toEqual({ subject: "Assunto", body: "Cuerpo" });
    expect(commitText(c({}), "en")).toEqual({ subject: "Asunto", body: "Cuerpo" });
    // Without a Spanish body, no translated one is shown (it would be from another commit with the same subject).
    expect(commitText(c({ body: "", tr: { en: { subject: "S", body: "B" } } }), "en").body).toBe("");
  });

  it("usa el idioma actual por defecto", () => {
    const x = c({ tr: { en: { subject: "Subject" } } });
    expect(commitText(x).subject).toBe("Asunto");
    setLang("en");
    expect(commitText(x).subject).toBe("Subject");
  });

  it("fechas con el formato del idioma", () => {
    const iso = "2026-11-23T12:00:00Z";
    expect(fmtDate(iso)).toBe("23/11/2026");
    setLang("en");
    expect(fmtDate(iso)).toBe("11/23/2026");
    setLang("pt");
    expect(fmtDate(iso)).toBe("23/11/2026");
    expect(fmtDate(null)).toBe("");
  });
});
