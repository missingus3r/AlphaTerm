import { describe, expect, it } from "vitest";
import { headline, providerFor } from "./UsageFooter";

describe("consumo del agente activo", () => {
  it("reconoce el agente por id, comando o proceso", () => {
    expect(providerFor("claude")).toBe("claude");
    expect(providerFor(undefined, "codex resume --last")).toBe("codex");
    expect(providerFor(undefined, "C:\Users\yo\AppData\Local\agy\bin\agy.exe -p hola")).toBe("agy");
    expect(providerFor(undefined, undefined, "claude.exe")).toBe("claude");
    expect(providerFor("opencode", "npm run dev", "node")).toBeNull();
  });

  it("de agy muestra el grupo más usado", () => {
    const w = (label: string, usedPct: number) => ({ label, usedPct, resetsAt: null, stale: false });
    const h = headline({
      provider: "agy", exact: true, source: "", updatedAt: null, note: null,
      windows: [w("Gemini · semana", 0), w("Gemini · 5 h", 0), w("Claude and GPT · semana", 7), w("Claude and GPT · 5 h", 0)],
    });
    expect(h.map((x) => x.label)).toEqual(["Claude and GPT · semana", "Claude and GPT · 5 h"]);
  });
});
