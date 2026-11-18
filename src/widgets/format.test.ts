import { describe, expect, it } from "vitest";
import { ago, fmtBytes, fmtPct, level, pushSample, sparkPoints, until } from "./format";

describe("formatos de widgets", () => {
  it("bytes y porcentajes", () => {
    expect(fmtBytes(31.9 * 1024 ** 3)).toBe("31,9 GB");
    expect(fmtBytes(512 * 1024 ** 2)).toBe("512 MB");
    expect(fmtBytes(900)).toBe("900 B");
    expect(fmtPct(27.6)).toBe("28 %");
  });

  it("tiempo relativo", () => {
    const now = 1_000_000_000_000;
    expect(ago(now - 10_000, now)).toBe("recién");
    expect(ago(now - 3 * 60_000, now)).toBe("hace 3 min");
    expect(ago(now - 5 * 3_600_000, now)).toBe("hace 5 h");
    expect(ago(now - 23 * 86_400_000, now)).toBe("hace 23 días");
    expect(until(now / 1000 + 130 * 60, now)).toBe("en 2 h 10 min");
    expect(until(now / 1000 + 3 * 86400, now)).toBe("en 3 días");
    expect(until(now / 1000 - 5, now)).toBe("ya se reinició");
  });

  it("sparkline alineada a la derecha", () => {
    expect(sparkPoints([], 60, 20)).toBe("");
    const pts = sparkPoints([0, 100], 59, 21, 60).split(" ");
    expect(pts).toEqual(["58.0,20.5", "59.0,0.5"]);
    expect(pushSample([1, 2, 3], 4, 3)).toEqual([2, 3, 4]);
  });

  it("niveles", () => {
    expect(level(10)).toBe("ok");
    expect(level(75)).toBe("warn");
    expect(level(95)).toBe("crit");
  });
});
