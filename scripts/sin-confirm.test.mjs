import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `window.confirm` no pregunta en AlphaTerm (el plugin de diálogos de Tauri lo vuelve asíncrono:
 * devuelve una promesa, que siempre cuenta como "sí"). Todo tiene que pasar por `askConfirm`
 * (src/widgets/confirm.ts).
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function sources(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : [];
  });
}

describe("confirmaciones", () => {
  it("nadie usa confirm() suelto (no pregunta en AlphaTerm): se usa askConfirm", () => {
    const offenders = sources(SRC)
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .map((text, i) => ({ file, line: i + 1, text }))
          .filter((l) => /(^|[^\w.])confirm\(|window\.confirm\(/.test(l.text) && !/^\s*(\/\/|\*)/.test(l.text)),
      )
      .map((l) => `${l.file.slice(SRC.length + 1)}:${l.line}`);
    expect(offenders).toEqual([]);
  });
});
