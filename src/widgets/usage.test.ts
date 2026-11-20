import { describe, expect, it } from "vitest";
import { forecast, headline, parseResetText, providerFor, windowMs, type Usage, type UsageWindow } from "./usage";

const w = (label: string, usedPct: number, extra: Partial<UsageWindow> = {}): UsageWindow => ({ label, usedPct, resetsAt: null, resetsText: null, stale: false, detail: false, ...extra });
const usage = (provider: string, windows: UsageWindow[]): Usage => ({
  provider, exact: true, source: "", updatedAt: null, note: null, windows, refreshing: false, plan: null, model: null, extras: [], groups: [], tables: [],
});

describe("consumo del agente activo", () => {
  it("reconoce el agente por id, comando o proceso", () => {
    expect(providerFor("claude")).toBe("claude");
    expect(providerFor(undefined, "codex resume --last")).toBe("codex");
    expect(providerFor(undefined, "C:\\Users\\yo\\AppData\\Local\\agy\\bin\\agy.exe -p hola")).toBe("agy");
    expect(providerFor(undefined, undefined, "claude.exe")).toBe("claude");
    expect(providerFor("opencode", "npm run dev", "node")).toBeNull();
  });

  it("de agy muestra el grupo más usado", () => {
    const h = headline(usage("agy", [w("Gemini · semana", 0), w("Gemini · 5 h", 0), w("Claude and GPT · semana", 7), w("Claude and GPT · 5 h", 0)]));
    expect(h.map((x) => x.label)).toEqual(["Claude and GPT · semana", "Claude and GPT · 5 h"]);
  });

  it("el footer no muestra las ventanas de detalle", () => {
    const h = headline(usage("claude", [w("5 h", 8), w("semana", 58), w("semana · Sonnet", 4, { detail: true }), w("uso extra", 0, { detail: true })]));
    expect(h.map((x) => x.label)).toEqual(["5 h", "semana"]);
  });
});

describe("texto de reinicio", () => {
  // Jueves 20/11/2026 9:40 hora local.
  const at = new Date(2026, 10, 20, 9, 40).getTime();
  const local = (mo: number, d: number, h: number, mi = 0, y = 2026) => new Date(y, mo, d, h, mi).getTime();

  it("lee los formatos de Claude", () => {
    expect(parseResetText("1:30pm (America/Montevideo)", at)).toBe(local(10, 20, 13, 30));
    expect(parseResetText("3am (America/Montevideo)", at)).toBe(local(10, 21, 3));
    expect(parseResetText("Nov 22, 10pm (America/Montevideo)", at)).toBe(local(10, 22, 22));
    expect(parseResetText("Dec 1 (America/Montevideo)", at)).toBe(local(11, 1, 0));
    expect(parseResetText("12pm", at)).toBe(local(10, 20, 12));
    expect(parseResetText("12am", at)).toBe(local(10, 21, 0));
  });

  it("lee los de Codex y las duraciones", () => {
    expect(parseResetText("14:30", at)).toBe(local(10, 20, 14, 30));
    expect(parseResetText("11:34 on 25 Nov", at)).toBe(local(10, 25, 11, 34));
    expect(parseResetText("Jan 3, 9am", at)).toBe(local(0, 3, 9, 0, 2027));
    expect(parseResetText("in 2h 5m", at)).toBe(at + 125 * 60_000);
    expect(parseResetText("3d 4h", at)).toBe(at + (3 * 24 + 4) * 3_600_000);
    expect(parseResetText("pronto", at)).toBeNull();
    expect(parseResetText(null, at)).toBeNull();
  });
});

describe("previsión", () => {
  it("largo de la ventana", () => {
    expect(windowMs("semana")).toBe(7 * 86_400_000);
    expect(windowMs("Gemini Models · semana")).toBe(7 * 86_400_000);
    expect(windowMs("semana · Sonnet")).toBe(7 * 86_400_000);
    expect(windowMs("5 h")).toBe(5 * 3_600_000);
    expect(windowMs("uso extra")).toBeNull();
  });

  it("proyecta al ritmo de ahora", () => {
    const day = 86_400_000;
    const now = 10 * day;
    // Pasaron 3,5 días de 7 con 40 %: al reinicio, 80 %.
    const f = forecast(40, now + 3.5 * day, 7 * day, now)!;
    expect(f.projected).toBeCloseTo(80);
    expect(f.exhaustAt).toBeNull();
    expect(f.ratePerDay).toBeCloseTo(40 / 3.5);
    expect(f.budgetPerDay).toBeCloseTo(60 / 3.5);
    // Con 70 % a mitad de semana se agota antes: le quedan 30 a 20 %/día = 1,5 días.
    const g = forecast(70, now + 3.5 * day, 7 * day, now)!;
    expect(g.projected).toBeCloseTo(140);
    expect(g.exhaustAt).toBeCloseTo(now + 1.5 * day);
    // Recién empezada la ventana no se estima.
    expect(forecast(5, now + 6.9 * day, 7 * day, now)).toBeNull();
  });
});
