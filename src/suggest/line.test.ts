import { describe, expect, it } from "vitest";
import { parseLine, readInput, type BufLike } from "./line";

/** Buffer falso: cada fila es un string de `cols` columnas; `wrapped[i]` = la fila i continúa la anterior. */
function buf(rows: string[], wrapped: boolean[] = []): BufLike {
  return {
    getLine: (i) =>
      rows[i] === undefined
        ? undefined
        : {
            isWrapped: !!wrapped[i],
            translateToString: (trim, s = 0, e = rows[i].length) => {
              const t = rows[i].slice(s, e);
              return trim ? t.replace(/\s+$/, "") : t;
            },
          },
  };
}

describe("readInput", () => {
  it("lee desde el fin del prompt hasta el cursor, con los espacios tipeados", () => {
    const b = buf(["PS C:\\> cd      "]);
    expect(readInput(b, { line: 0, x: 8 }, { line: 0, x: 11 }, 16)).toBe("cd ");
  });

  it("une las filas envueltas", () => {
    const b = buf(["PS> git commit -", "m hola    "], [false, true]);
    expect(readInput(b, { line: 0, x: 4 }, { line: 1, x: 6 }, 16)).toBe("git commit -m hola");
  });

  it("una fila no envuelta en el medio es otra línea lógica: no hay entrada", () => {
    const b = buf(["PS> if (1) {    ", ">> cd"], [false, false]);
    expect(readInput(b, { line: 0, x: 4 }, { line: 1, x: 5 }, 16)).toBeNull();
  });

  it("cursor antes del fin del prompt: no hay entrada", () => {
    const b = buf(["PS> abc"]);
    expect(readInput(b, { line: 0, x: 4 }, { line: 0, x: 2 }, 16)).toBeNull();
    expect(readInput(b, { line: 1, x: 0 }, { line: 0, x: 6 }, 16)).toBeNull();
  });
});

describe("parseLine", () => {
  it("después de un espacio, la palabra actual está vacía", () => {
    const p = parseLine("cd ", "ps");
    expect(p.words.map((w) => w.value)).toEqual(["cd"]);
    expect(p.index).toBe(1);
    expect(p.current).toEqual({ raw: "", value: "", start: 3, quote: null, closed: false });
  });

  it("línea vacía", () => {
    const p = parseLine("", "cmd");
    expect(p.index).toBe(0);
    expect(p.current.start).toBe(0);
  });

  it("comillas abiertas: la palabra sigue aunque tenga espacios", () => {
    const p = parseLine('cd "Mis Doc', "cmd");
    expect(p.index).toBe(1);
    expect(p.current).toEqual({ raw: '"Mis Doc', value: "Mis Doc", start: 3, quote: '"', closed: false });
  });

  it("comillas simples cerradas en PowerShell", () => {
    const p = parseLine("cd 'a b\\'", "ps");
    expect(p.current).toMatchObject({ value: "a b\\", quote: "'", closed: true, start: 3 });
  });

  it("en cmd el apóstrofo no es comilla", () => {
    const p = parseLine("type Bruno's notas", "cmd");
    expect(p.words.map((w) => w.value)).toEqual(["type", "Bruno's", "notas"]);
    expect(p.current.quote).toBeNull();
  });

  it("varias palabras: la actual es la última", () => {
    const p = parseLine("git checkout ma", "ps");
    expect(p.index).toBe(2);
    expect(p.current).toMatchObject({ value: "ma", start: 13 });
    expect(p.words[0].value).toBe("git");
  });
});
