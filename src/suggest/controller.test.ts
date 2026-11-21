import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";
import { createSuggest, type SuggestCtl, type TermLike } from "./controller";
import type { HistEntry, Sources } from "./engine";
import { PS_CHORD } from "./pwsh";
import type { SuggestSettings } from "../settings/schema";
import type { KeyLike } from "../terminal/keys";

/** Terminal de una sola fila con eco: lo que se escribe a la shell aparece en pantalla. */
class FakeTerm implements TermLike {
  cols = 80;
  row = "";
  buffer = {
    active: {
      type: "normal",
      baseY: 0,
      cursorY: 0,
      cursorX: 0,
      getLine: (i: number) =>
        i === 0
          ? { isWrapped: false, translateToString: (trim: boolean, s = 0, e = this.cols) => {
              const t = this.row.padEnd(this.cols).slice(s, e);
              return trim ? t.replace(/\s+$/, "") : t;
            } }
          : undefined,
    },
  };
  registerMarker() {
    return { line: 0, dispose() {} };
  }
  echo(s: string) {
    for (const ch of s) {
      if (ch === "\x7f") this.row = this.row.slice(0, -1);
      else if (ch >= " ") this.row += ch;
    }
    this.buffer.active.cursorX = this.row.length;
  }
}

const key = (k: string, mods: Partial<KeyLike> = {}) =>
  ({ type: "keydown", key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods }) as KeyboardEvent;

const flush = async () => {
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
};

interface Rig {
  ctl: SuggestCtl;
  term: FakeTerm;
  written: string[];
  cmdLines: string[];
  type(s: string): Promise<void>;
  prompt(text: string): void;
  dispose(): void;
}

function rig(profileId: string, o: { settings?: Partial<SuggestSettings>; history?: HistEntry[]; now?: () => number } = {}): Rig {
  const term = new FakeTerm();
  const written: string[] = [];
  const cmdLines: string[] = [];
  const sources: Sources = {
    listDir: async (_dir, dirsOnly) => [{ name: "AlphaTerm", dir: true }, { name: "notas.txt", dir: false }].filter((e) => !dirsOnly || e.dir),
    history: async () => o.history ?? [],
    pathCommands: async () => [],
    gen: async (name) => (name === "hosts" ? [{ v: "8.8.8.8", desc: "DNS de Google" }] : []),
  };
  let ctl!: SuggestCtl;
  let dispose!: () => void;
  createRoot((d) => {
    dispose = d;
    ctl = createSuggest({
      term,
      profileId,
      write: (s) => {
        written.push(s);
        if (s !== PS_CHORD) {
          term.echo(s);
          queueMicrotask(() => ctl.onParsed());
        }
      },
      cwd: () => "C:\\proy",
      settings: () => ({ enabled: true, mode: "auto", pwsh: true, ...o.settings }),
      patchCmdCommand: (l) => cmdLines.push(l),
      sources,
      now: o.now,
    });
  });
  return {
    ctl,
    term,
    written,
    cmdLines,
    dispose,
    prompt(text) {
      term.row = text;
      term.buffer.active.cursorX = text.length;
      ctl.onPromptEnd();
    },
    async type(s) {
      // Lo que hace TerminalView con cada tecla: avisa y la manda a la shell, que hace eco.
      for (const ch of s) {
        ctl.onWrite(ch);
        if (!/[\r\n]/.test(ch)) term.echo(ch);
        ctl.onParsed();
        await flush();
      }
    },
  };
}

describe("controlador de sugerencias", () => {
  let r: Rig;
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    r?.dispose();
    vi.useRealTimers();
  });

  it("cmd: cd + espacio abre el menú con las carpetas", async () => {
    r = rig("cmd");
    r.prompt("C:\\proy>");
    await r.type("cd ");
    const m = r.ctl.menu();
    expect(m?.items.map((i) => i.label)).toContain("AlphaTerm\\");
    expect(m?.items.some((i) => i.label === "notas.txt")).toBe(false);
    expect(m?.col).toBe("C:\\proy>cd ".length);
  });

  it("una salida que llega entre la tecla y su eco no hace perder la tecla", async () => {
    r = rig("cmd");
    r.prompt("C:\\proy>");
    await r.type("p");
    expect(r.ctl.menu()).toBeNull();
    // Como en la app real: xterm avisa de una salida anterior antes de que llegue el eco de la "i".
    r.ctl.onWrite("i");
    r.ctl.onParsed();
    await flush();
    r.term.echo("i");
    r.ctl.onParsed();
    await flush();
    expect(r.ctl.menu()?.items.map((i) => i.insert)).toContain("ping");
  });

  it("↑ con el menú abierto sin navegar no se toma (historial) y cierra", async () => {
    r = rig("cmd");
    r.prompt("C:\\proy>");
    await r.type("cd ");
    expect(r.ctl.key(key("ArrowUp"))).toBe(false);
    expect(r.ctl.menu()).toBeNull();
  });

  it("Tab inserta la primera; el keypress que sigue a una tecla tomada se traga", async () => {
    r = rig("cmd");
    r.prompt("C:\\proy>");
    await r.type("cd al");
    expect(r.ctl.key(key("Tab"))).toBe(true);
    expect(r.ctl.key({ ...key("Tab"), type: "keypress" } as KeyboardEvent)).toBe(true);
    await flush();
    expect(r.written.at(-1)).toBe("\x7f\x7fAlphaTerm\\");
    expect(r.term.row).toBe("C:\\proy>cd AlphaTerm\\");
    // Era una carpeta: el menú se vuelve a abrir para seguir bajando.
    expect(r.ctl.menu()).not.toBeNull();
  });

  it("Enter sin navegar pasa a la shell; en cmd, el comando queda como lastCommand y se apaga el prompt", async () => {
    r = rig("cmd");
    r.prompt("C:\\proy>");
    await r.type("ping ");
    expect(r.ctl.menu()).not.toBeNull();
    expect(r.ctl.key(key("Enter"))).toBe(false);
    await r.type("\r");
    expect(r.cmdLines).toEqual(["ping"]);
    expect(r.ctl.menu()).toBeNull();
    // Lo que se tipee ahora es para el programa que corre: nada de menú.
    await r.type("cd ");
    expect(r.ctl.menu()).toBeNull();
  });

  it("↓ y Enter inserta la elegida sin ejecutar", async () => {
    r = rig("cmd");
    r.prompt("C:\\proy>");
    await r.type("ping ");
    expect(r.ctl.key(key("ArrowDown"))).toBe(true);
    expect(r.ctl.menu()?.navigating).toBe(true);
    expect(r.ctl.key(key("Enter"))).toBe(true);
    expect(r.ctl.key({ ...key("Enter"), type: "keypress" } as KeyboardEvent)).toBe(true);
    await flush();
    expect(r.term.row).toBe("C:\\proy>ping 8.8.8.8 ");
    expect(r.written.join("")).not.toContain("\r");
  });

  it("Esc cierra y no le llega a la shell; después del historial (↑) no se abre solo", async () => {
    r = rig("cmd");
    r.prompt("C:\\proy>");
    await r.type("cd ");
    expect(r.ctl.key(key("Escape"))).toBe(true);
    expect(r.ctl.menu()).toBeNull();
    r.ctl.onWrite("\x1b[A"); // la shell trae una línea del historial
    r.term.row = "C:\\proy>cd AlphaTerm";
    r.term.buffer.active.cursorX = r.term.row.length;
    r.ctl.onParsed();
    await flush();
    expect(r.ctl.menu()).toBeNull();
  });

  it("modo manual: solo con Ctrl+Espacio", async () => {
    r = rig("cmd", { settings: { mode: "manual" } });
    r.prompt("C:\\proy>");
    await r.type("cd ");
    expect(r.ctl.menu()).toBeNull();
    expect(r.ctl.key(key(" ", { ctrlKey: true }))).toBe(true);
    await flush();
    expect(r.ctl.menu()?.items.length).toBeGreaterThan(0);
  });

  it("buffer alternativo (un programa a pantalla completa): nada", async () => {
    r = rig("cmd");
    r.prompt("C:\\proy>");
    r.term.buffer.active.type = "alternate";
    await r.type("cd ");
    expect(r.ctl.menu()).toBeNull();
  });

  it("perfil sin soporte (Git Bash): nada", async () => {
    r = rig("gitbash");
    r.prompt("$ ");
    await r.type("cd ");
    expect(r.ctl.menu()).toBeNull();
    expect(r.ctl.key(key(" ", { ctrlKey: true }))).toBe(false);
  });

  describe("PowerShell", () => {
    const ready = (c: SuggestCtl) => c.onOsc7717(`ready;${c.nonce}`);
    const answer = (c: SuggestCtl, buffer: string, results: { t: string; s: string; k: string }[]) => {
      const json = JSON.stringify({ b: buffer, c: buffer.length, i: 0, l: buffer.length, r: results.map((x) => ({ ...x, d: "" })) });
      return c.onOsc7717(`c;${c.nonce};${btoa(json)}`);
    };

    it("pide los completados tras 150 ms sin teclas y los muestra", async () => {
      r = rig("powershell");
      r.prompt("PS C:\\proy> ");
      expect(ready(r.ctl)).toBe(true);
      await r.type("Get-Ch");
      expect(r.written).not.toContain(PS_CHORD);
      await vi.advanceTimersByTimeAsync(160);
      expect(r.written.filter((w) => w === PS_CHORD)).toHaveLength(1);
      answer(r.ctl, "Get-Ch", [{ t: "Get-ChildItem", s: "Get-ChildItem", k: "Command" }]);
      await flush();
      expect(r.ctl.menu()?.items.map((i) => i.insert)).toContain("Get-ChildItem");
    });

    it("sin el aviso de listo (o con otro nonce) nunca manda el atajo", async () => {
      r = rig("powershell");
      r.prompt("PS C:\\proy> ");
      r.ctl.onOsc7717("ready;otro");
      await r.type("Get-Ch");
      await vi.advanceTimersByTimeAsync(500);
      expect(r.written).not.toContain(PS_CHORD);
    });

    it("no lo manda justo después de Tab (PSReadLine puede estar esperando otra tecla)", async () => {
      r = rig("powershell");
      r.prompt("PS C:\\proy> ");
      ready(r.ctl);
      await r.type("Get-Ch");
      r.ctl.onWrite("\t");
      await vi.advanceTimersByTimeAsync(500);
      expect(r.written).not.toContain(PS_CHORD);
    });

    it("si una respuesta tarda más de 300 ms, la pestaña solo pide con Ctrl+Espacio", async () => {
      let t = 0;
      r = rig("powershell", { now: () => t });
      r.prompt("PS C:\\proy> ");
      ready(r.ctl);
      await r.type("Get-Ch");
      await vi.advanceTimersByTimeAsync(160);
      t += 400;
      answer(r.ctl, "Get-Ch", []);
      await flush();
      await r.type("i");
      await vi.advanceTimersByTimeAsync(500);
      expect(r.written.filter((w) => w === PS_CHORD)).toHaveLength(1);
      r.ctl.key(key(" ", { ctrlKey: true }));
      await vi.advanceTimersByTimeAsync(200);
      expect(r.written.filter((w) => w === PS_CHORD)).toHaveLength(2);
    });

    it("cd es del catálogo: no se le pregunta a PowerShell", async () => {
      r = rig("powershell");
      r.prompt("PS C:\\proy> ");
      ready(r.ctl);
      await r.type("cd al");
      await vi.advanceTimersByTimeAsync(500);
      expect(r.written).not.toContain(PS_CHORD);
      expect(r.ctl.menu()?.items[0].label).toBe("AlphaTerm\\");
    });
  });
});
