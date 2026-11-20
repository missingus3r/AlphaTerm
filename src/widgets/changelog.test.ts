import { describe, expect, it } from "vitest";
import { between, cmpVersion, type ChangeVersion } from "./changelog";

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
