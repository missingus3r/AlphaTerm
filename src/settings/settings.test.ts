import { describe, expect, it } from "vitest";
import { BUILTIN_AGENTS, DEFAULTS, normalize, normalizeAgents } from "./schema";
import { BASE_COLORS, BUILTIN_THEMES, findTheme, importThemes, isDark, luminance, mix, themeId, uiPalette } from "./themes";

const norm = (raw: unknown) => normalize(raw, BASE_COLORS);

describe("normalize", () => {
  it("sin archivo o con basura da los valores de fábrica", () => {
    expect(norm(undefined)).toEqual(DEFAULTS);
    expect(norm(null)).toEqual(DEFAULTS);
    expect(norm("hola")).toEqual(DEFAULTS);
    expect(norm({ appearance: 5, background: [] })).toEqual(DEFAULTS);
  });

  it("recorta números fuera de rango y descarta tipos y opciones inválidos", () => {
    const s = norm({
      appearance: { fontSize: 300, lineHeight: 0.2, cursorStyle: "triangulo", ligatures: "si", fontFamily: "  JetBrains Mono " },
      background: { opacity: 0, effect: "mica" },
      terminal: { scrollback: 12.6 },
    });
    expect(s.appearance.fontSize).toBe(32);
    expect(s.appearance.lineHeight).toBe(1);
    expect(s.appearance.cursorStyle).toBe("block");
    expect(s.appearance.ligatures).toBe(false);
    expect(s.appearance.fontFamily).toBe("JetBrains Mono");
    expect(s.background.opacity).toBe(0.3);
    expect(s.background.effect).toBe("mica");
    expect(s.terminal.scrollback).toBe(500);
  });

  it("conserva claves de otras fases y completa temas propios", () => {
    const s = norm({
      futuro: [{ name: "algo de F9" }],
      customThemes: [
        { id: "mio", name: "Mío", colors: { background: "#101010", red: "rojo" } },
        { id: "mio", name: "Duplicado" },
        { name: "sin id" },
      ],
      shortcuts: { newTab: ["Ctrl+Shift+Y", 4], raro: "x" },
    }) as unknown as Record<string, unknown> & ReturnType<typeof norm>;
    expect(s.futuro).toEqual([{ name: "algo de F9" }]);
    expect(s.customThemes).toHaveLength(1);
    expect(s.customThemes[0].colors.background).toBe("#101010");
    expect(s.customThemes[0].colors.red).toBe(BASE_COLORS.red);
    expect(s.shortcuts).toEqual({ newTab: ["Ctrl+Shift+Y"] });
  });
});

describe("temas", () => {
  it("los de fábrica tienen todos los colores en hex", () => {
    for (const t of BUILTIN_THEMES) {
      for (const [k, v] of Object.entries(t.colors)) expect(v, `${t.id}.${k}`).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
    }
    expect(new Set(BUILTIN_THEMES.map((t) => t.id)).size).toBe(BUILTIN_THEMES.length);
  });

  it("claro u oscuro según el fondo", () => {
    expect(isDark(findTheme("nova-dark", []).colors)).toBe(true);
    expect(isDark(findTheme("nova-light", []).colors)).toBe(false);
    expect(isDark(findTheme("solarized-light", []).colors)).toBe(false);
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#ffffff")).toBeCloseTo(1);
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("un tema que no existe cae en el de fábrica", () => {
    expect(findTheme("borrado", []).id).toBe("nova-dark");
    expect(findTheme("mi-x", [{ id: "mi-x", name: "X", colors: BASE_COLORS }]).builtin).toBe(false);
  });

  it("la paleta de la interfaz respeta la opacidad", () => {
    const p = uiPalette(BASE_COLORS, 0.7);
    expect(p["--bg"]).toBe("rgba(13, 16, 23, 0.7)");
    expect(p["--bg-solid"]).toBe("#0d1017");
    expect(p["color-scheme"]).toBe("dark");
    expect(uiPalette(findTheme("nova-light", []).colors)["color-scheme"]).toBe("light");
  });
});

describe("importar temas", () => {
  it("esquema de Windows Terminal (purple → magenta)", () => {
    const [t] = importThemes(
      JSON.stringify({
        name: "Mi WT", background: "#101010", foreground: "#EEEEEE", cursorColor: "#FF0000",
        black: "#000000", red: "#AA0000", green: "#00AA00", yellow: "#AAAA00", blue: "#0000AA",
        purple: "#AA00AA", cyan: "#00AAAA", white: "#AAAAAA", brightBlack: "#555555", brightRed: "#FF5555",
        brightGreen: "#55FF55", brightYellow: "#FFFF55", brightBlue: "#5555FF", brightPurple: "#FF55FF",
        brightCyan: "#55FFFF", brightWhite: "#FFFFFF", selectionBackground: "#333333",
      }),
    );
    expect(t.name).toBe("Mi WT");
    expect(t.colors.magenta).toBe("#aa00aa");
    expect(t.colors.cursor).toBe("#ff0000");
    expect(t.missing).toEqual([]);
  });

  it("settings.json de Windows Terminal con comentarios y varios esquemas", () => {
    const text = `// comentario\n{ "schemes": [ { "name": "A", "background": "#000000", "foreground": "#ffffff" }, { "name": "B", "background": "#111111", "foreground": "#eeeeee" }, { "name": "roto" } ] }`;
    const ts = importThemes(text, "settings.json");
    expect(ts.map((t) => t.name)).toEqual(["A", "B"]);
    expect(ts[0].missing).toContain("red");
    expect(ts[0].colors.red).toBe(BASE_COLORS.red);
  });

  it("formato propio con colors", () => {
    const [t] = importThemes(JSON.stringify({ name: "Propio", colors: { background: "#202020", foreground: "#e0e0e0", magenta: "#ff00ff" } }));
    expect(t.colors.magenta).toBe("#ff00ff");
  });

  it(".itermcolors de iTerm2", () => {
    const comp = (r: number, g: number, b: number) =>
      `<dict><key>Blue Component</key><real>${b}</real><key>Green Component</key><real>${g}</real><key>Red Component</key><real>${r}</real></dict>`;
    const xml = `<?xml version="1.0"?><plist><dict>
      <key>Ansi 1 Color</key>${comp(1, 0, 0)}
      <key>Background Color</key>${comp(0, 0, 0)}
      <key>Foreground Color</key>${comp(1, 1, 1)}
    </dict></plist>`;
    const [t] = importThemes(xml, "Mi tema.itermcolors");
    expect(t.name).toBe("Mi tema");
    expect(t.colors.red).toBe("#ff0000");
    expect(t.colors.background).toBe("#000000");
  });

  it("errores entendibles", () => {
    expect(() => importThemes("{ no es json")).toThrow(/JSON/);
    expect(() => importThemes('{"name":"x"}')).toThrow(/background/);
  });

  it("ids propios sin choques", () => {
    expect(themeId("Mi Tema Ñandú", new Set())).toBe("mi-mi-tema-nandu");
    expect(themeId("X", new Set(["mi-x"]))).toBe("mi-x-2");
  });
});

describe("catálogo de agentes", () => {
  it("los de fábrica siempre están, con lo que se les cambió", () => {
    const a = normalizeAgents([{ id: "claude", command: "claude --model opus", env: { FOO: "1", "MAL NOMBRE": "x", N: 3 } }]);
    expect(a.map((x) => x.id)).toEqual(BUILTIN_AGENTS.map((x) => x.id));
    expect(a[0].command).toBe("claude --model opus");
    expect(a[0].name).toBe("Claude Code");
    expect(a[0].env).toEqual({ FOO: "1" });
    expect(normalizeAgents(undefined)).toEqual(BUILTIN_AGENTS);
  });

  it("los propios se agregan al final y sin comando no valen", () => {
    const a = normalizeAgents([
      { id: "aider", name: "Aider", command: "aider --no-git" },
      { id: "sin-comando", name: "X" },
      { id: "aider", name: "Duplicado", command: "y" },
      { id: "codex", builtin: false, command: "codex --full-auto" },
    ]);
    expect(a.map((x) => x.id)).toEqual([...BUILTIN_AGENTS.map((x) => x.id), "aider"]);
    expect(a.at(-1)).toMatchObject({ name: "Aider", builtin: false });
    expect(a.find((x) => x.id === "codex")).toMatchObject({ command: "codex --full-auto", builtin: true });
  });

  it("carpetas recientes sin repetir", () => {
    expect(normalize({ recentDirs: ["C:\a", "C:\a", "", 4, "C:\b"] }, BASE_COLORS).recentDirs).toEqual(["C:\a", "C:\b"]);
  });
});
