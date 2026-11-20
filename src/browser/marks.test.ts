import { describe, expect, it } from "vitest";
import { intersects, markLabel } from "./marks";

describe("marcas del navegador", () => {
  it("nombre corto: componente si hay, si no etiqueta y clases, con el texto recortado", () => {
    expect(markLabel({ n: 1, tag: "button", classes: ["btn", "primary", "x"], text: "Enviar", selector: "b" })).toBe("button.btn.primary «Enviar»");
    expect(markLabel({ n: 1, tag: "div", id: "hero", selector: "#hero" })).toBe("div#hero");
    expect(markLabel({ n: 1, tag: "a", text: "Un texto bastante largo para el chip", selector: "a", component: { framework: "React", name: "NavLink" } })).toBe(
      "NavLink ‹a› «Un texto bastante largo …»",
    );
  });

  it("superposición de rectángulos", () => {
    const a = { left: 0, top: 0, right: 100, bottom: 100 };
    expect(intersects(a, { left: 50, top: 50, right: 150, bottom: 150 })).toBe(true);
    expect(intersects(a, { left: 100, top: 0, right: 200, bottom: 100 })).toBe(false);
    expect(intersects(a, { left: 10, top: 120, right: 20, bottom: 130 })).toBe(false);
  });
});
