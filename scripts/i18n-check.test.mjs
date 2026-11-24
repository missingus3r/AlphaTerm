import { describe, expect, it } from "vitest";
import { check, extract, placeholders } from "./i18n-check.mjs";

describe("i18n-check", () => {
  it("encuentra los textos de t, k y tIn (comillas dobles, simples y plantillas sin variables)", () => {
    const code = [
      'const a = t("Pestaña nueva");',
      "const b = k('Cerrar');",
      "const c = t(`Abrir {n}`, { n });",
      'const d = tIn(lang, "Hola");',
      "const e = foo.t(\"no\"); const f = at(\"no\"); const g = t(`con ${x}`);",
    ].join("\n");
    expect(extract(code).map((x) => x.text)).toEqual(["Pestaña nueva", "Cerrar", "Abrir {n}", "Hola"]);
  });

  it("compara las variables entre llaves", () => {
    expect(placeholders("Cerrar {n} de {total}")).toBe("n,total");
    expect(placeholders("Close {total} of {n}")).toBe("n,total");
  });

  it("todos los textos marcados están traducidos al inglés y al portugués, sin sobrantes", () => {
    expect(check()).toEqual([]);
  });
});
