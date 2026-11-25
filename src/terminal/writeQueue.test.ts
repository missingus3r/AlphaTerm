import { describe, expect, it } from "vitest";
import { WriteQueue } from "./writeQueue";

describe("WriteQueue", () => {
  it("mantiene el orden aunque cada envío tarde distinto", async () => {
    const received: string[] = [];
    // Sends with random delays: without a queue, they would arrive out of order.
    const q = new WriteQueue(
      (d) => new Promise((r) => setTimeout(() => (received.push(d), r(undefined)), Math.random() * 5)),
    );
    const text = "cmd /c exit 3\r";
    for (const ch of text) q.write(ch);
    await new Promise((r) => setTimeout(r, 200));
    expect(received.join("")).toBe(text);
    // What is typed while waiting is gathered: fewer calls than keys.
    expect(received.length).toBeLessThan(text.length);
  });

  it("si un envío falla, sigue con el resto", async () => {
    const received: string[] = [];
    let first = true;
    const q = new WriteQueue(async (d) => {
      if (first) {
        first = false;
        throw new Error("sesión cerrada");
      }
      received.push(d);
    });
    q.write("a");
    q.write("b");
    await new Promise((r) => setTimeout(r, 20));
    expect(received.join("")).toBe("b");
  });
});
