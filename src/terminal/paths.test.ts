import { describe, expect, it } from "vitest";
import { findPaths, previewKind, resolvePath } from "./paths";

const raws = (t: string) => findPaths(t).map((m) => m.raw);

describe("rutas en la salida", () => {
  it("absolutas de Windows, con barras de los dos tipos", () => {
    expect(raws("Escribí C:\\Users\\yo\\web\\a.ts y listo.")).toEqual(["C:\\Users\\yo\\web\\a.ts"]);
    expect(raws("ver C:/x/y.png, gracias")).toEqual(["C:/x/y.png"]);
    expect(raws("en \\\\nas\\share\\doc.pdf")).toEqual(["\\\\nas\\share\\doc.pdf"]);
  });

  it("relativas con línea y columna", () => {
    const m = findPaths("Error en src/layout/TabBar.tsx:42:7 (tipos)");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ raw: "src/layout/TabBar.tsx", line: 42, col: 7 });
    expect("Error en src/layout/TabBar.tsx:42:7 (tipos)".slice(m[0].start, m[0].end)).toBe("src/layout/TabBar.tsx:42:7");
    expect(raws("./build/out.png y ../otro/x.md")).toEqual(["./build/out.png", "../otro/x.md"]);
  });

  it("entre comillas puede tener espacios", () => {
    expect(raws('abrí "C:\\Program Files\\App\\a b.txt" ahora')).toEqual(["C:\\Program Files\\App\\a b.txt"]);
  });

  it("no confunde URLs, fechas ni palabras sueltas", () => {
    expect(raws("https://github.com/a/b y http://localhost:5173/x")).toEqual([]);
    expect(raws("hoy 18/11/2026 a las 10:00")).toEqual([]);
    expect(raws("nada por acá")).toEqual([]);
  });

  it("resuelve contra la carpeta del panel", () => {
    expect(resolvePath("src/a.ts", "C:\\web")).toBe("C:\\web\\src\\a.ts");
    expect(resolvePath("../otro/x.md", "C:\\web\\app\\")).toBe("C:\\web\\otro\\x.md");
    expect(resolvePath("./a", "C:\\")).toBe("C:\\a");
    expect(resolvePath("C:/x/../y", undefined)).toBe("C:\\y");
    expect(resolvePath("src/a.ts", undefined)).toBeNull();
    expect(resolvePath("\\\\nas\\share\\doc.pdf")).toBe("\\\\nas\\share\\doc.pdf");
  });

  it("qué tipo de vista previa", () => {
    expect(previewKind("C:\\x\\foto.PNG")).toBe("image");
    expect(previewKind("a/b.tsx")).toBe("text");
    expect(previewKind("Makefile")).toBe("text");
    expect(previewKind("x.exe")).toBe("other");
  });
});
