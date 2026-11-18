import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AckBatcher } from "./ack";

describe("AckBatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("junta acks chicos y los manda al vencer el plazo", () => {
    const sent: number[] = [];
    const b = new AckBatcher((n) => sent.push(n), 1000, 16);
    b.add(100);
    b.add(200);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(16);
    expect(sent).toEqual([300]);
  });

  it("manda enseguida al pasar el umbral", () => {
    const sent: number[] = [];
    const b = new AckBatcher((n) => sent.push(n), 1000, 16);
    b.add(600);
    b.add(600);
    expect(sent).toEqual([1200]);
    vi.advanceTimersByTime(50);
    expect(sent).toEqual([1200]);
  });

  it("dispose cancela el envío pendiente", () => {
    const sent: number[] = [];
    const b = new AckBatcher((n) => sent.push(n), 1000, 16);
    b.add(10);
    b.dispose();
    vi.advanceTimersByTime(50);
    expect(sent).toEqual([]);
  });
});
