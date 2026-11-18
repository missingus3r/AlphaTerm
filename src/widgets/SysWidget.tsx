import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { fmtBytes, fmtPct, level, pushSample, sparkPoints } from "./format";

interface Stats {
  cpu: number;
  memUsed: number;
  memTotal: number;
  cores: number;
}
interface ProcRow {
  pid: number;
  name: string;
  cpu: number;
  mem: number;
}
interface Top {
  topCpu: ProcRow[];
  topMem: ProcRow[];
  trees: Record<string, { cpu: number; mem: number; count: number }>;
}

export interface TabProcs {
  title: string;
  pid: number;
}

/** CPU y RAM en vivo con sparkline de 60 s. Clic: top de procesos y consumo de cada pestaña. */
export function SysWidget(props: { everyMs: number; tabs: TabProcs[]; vertical: boolean }) {
  const [stats, setStats] = createSignal<Stats | null>(null);
  const [cpuHist, setCpuHist] = createSignal<number[]>([]);
  const [memHist, setMemHist] = createSignal<number[]>([]);
  const [open, setOpen] = createSignal(false);
  const [top, setTop] = createSignal<Top | null>(null);
  let root!: HTMLDivElement;

  createEffect(() => {
    const ms = props.everyMs;
    const tick = async () => {
      if (document.hidden) return; // ventana minimizada: no se pregunta
      try {
        const s = await invoke<Stats>("sys_stats");
        setStats(s);
        setCpuHist((h) => pushSample(h, s.cpu));
        setMemHist((h) => pushSample(h, (s.memUsed / s.memTotal) * 100));
      } catch {
        /* la próxima */
      }
    };
    void tick();
    const t = setInterval(tick, ms);
    onCleanup(() => clearInterval(t));
  });

  // Mientras el detalle está abierto, el top se pide cada segundo (la CPU por proceso necesita
  // dos muestras: la primera vuelta viene en 0).
  createEffect(() => {
    if (!open()) return;
    const tick = async () => {
      try {
        setTop(await invoke<Top>("sys_top", { shells: props.tabs.map((t) => t.pid) }));
      } catch {
        /* la próxima */
      }
    };
    void tick();
    const t = setInterval(tick, 1000);
    const away = (e: MouseEvent) => {
      if (!root.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", away);
    onCleanup(() => {
      clearInterval(t);
      window.removeEventListener("mousedown", away);
    });
  });

  const memPct = () => (stats() ? (stats()!.memUsed / stats()!.memTotal) * 100 : 0);

  return (
    <div class="sys-widget" classList={{ vertical: props.vertical }} ref={root}>
      <button class="sys-btn" onClick={() => setOpen(!open())} title="CPU y RAM (clic: procesos)">
        <span class={`sys-val lv-${level(stats()?.cpu ?? 0)}`}>CPU {fmtPct(stats()?.cpu ?? 0)}</span>
        <svg class="spark" width="48" height="16" viewBox="0 0 48 16" aria-hidden="true">
          <polyline points={sparkPoints(cpuHist(), 48, 16)} />
        </svg>
        <span class={`sys-val lv-${level(memPct())}`}>RAM {stats() ? `${fmtBytes(stats()!.memUsed)}` : "–"}</span>
        <svg class="spark mem" width="48" height="16" viewBox="0 0 48 16" aria-hidden="true">
          <polyline points={sparkPoints(memHist(), 48, 16)} />
        </svg>
      </button>
      <Show when={open()}>
        <div class="sys-pop" role="dialog" aria-label="Procesos">
          <div class="sys-head">
            <b>CPU {fmtPct(stats()?.cpu ?? 0)}</b> de {stats()?.cores ?? "?"} núcleos ·{" "}
            <b>RAM {stats() ? `${fmtBytes(stats()!.memUsed)} de ${fmtBytes(stats()!.memTotal)}` : "–"}</b>
          </div>
          <h4>Pestañas de esta ventana</h4>
          <table>
            <tbody>
              <For each={props.tabs}>
                {(t) => {
                  const u = () => top()?.trees[String(t.pid)];
                  return (
                    <tr>
                      <td class="name" title={`PID ${t.pid}`}>
                        {t.title}
                      </td>
                      <td>{u() ? fmtPct(u()!.cpu) : "…"}</td>
                      <td>{u() ? fmtBytes(u()!.mem) : ""}</td>
                      <td class="muted">{u() ? `${u()!.count} proc.` : ""}</td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
          <div class="sys-cols">
            <div>
              <h4>Más CPU</h4>
              <table>
                <tbody>
                  <For each={top()?.topCpu ?? []}>
                    {(p) => (
                      <tr title={`PID ${p.pid}`}>
                        <td class="name">{p.name}</td>
                        <td>{fmtPct(p.cpu)}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
            <div>
              <h4>Más RAM</h4>
              <table>
                <tbody>
                  <For each={top()?.topMem ?? []}>
                    {(p) => (
                      <tr title={`PID ${p.pid}`}>
                        <td class="name">{p.name}</td>
                        <td>{fmtBytes(p.mem)}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
