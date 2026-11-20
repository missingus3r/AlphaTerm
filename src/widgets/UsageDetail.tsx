import { createMemo, For, Show } from "solid-js";
import { ago, fmtPct, level } from "./format";
import { forecast, PROVIDER_NAMES, resetOf, windowMs, type ProviderId, type Usage, type UsageWindow } from "./usage";
import { loadUsage, nowTick, usageBusy, usageError, usageOf } from "./usageStore";

/** "Sesión (5 h)", "Semana", "Semana · Sonnet", "Uso extra" (en agy, la ventana dentro del grupo). */
export function prettyLabel(label: string): string {
  if (label === "5 h") return "Sesión (5 h)";
  if (label === "semana") return "Semana";
  if (label === "uso extra") return "Uso extra";
  const [a, b] = label.split(" · ");
  if (a === "semana" && b) return `Semana · ${b}`;
  if (b) return b === "semana" ? "Semana" : b;
  return label;
}

/** "en 2 h 10 min" hasta `ms`. */
export function untilMs(ms: number, now: number): string {
  const m = Math.ceil((ms - now) / 60_000);
  if (m <= 0) return "ya se reinició";
  if (m < 60) return `en ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `en ${h} h ${m % 60} min` : `en ${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `en ${d} días ${h % 24} h` : `en ${d} días`;
}

/** Hora (hoy) o día y hora. */
function when(ms: number, now: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" });
  if (new Date(now).toDateString() === d.toDateString()) return time;
  return `${d.toLocaleDateString("es-UY", { weekday: "short", day: "numeric", month: "short" })} ${time}`;
}

const dur = (ms: number) => untilMs(Date.now() + ms, Date.now()).replace(/^en /, "");

function Row(props: { w: UsageWindow; u: Usage }) {
  const reset = () => resetOf(props.w, props.u.updatedAt);
  return (
    <tr classList={{ stale: props.w.stale }}>
      <td>{prettyLabel(props.w.label)}</td>
      <td class="bar-cell">
        <span class="usage-bar wide">
          <i class={`lv-${level(props.w.usedPct)}`} style={{ width: `${props.w.stale ? 0 : Math.max(1, props.w.usedPct)}%` }} />
        </span>
      </td>
      <td class="num">{props.w.stale ? "–" : fmtPct(props.w.usedPct)}</td>
      <td class="muted" title={props.w.resetsText ?? ""}>
        {(() => {
          const r = reset();
          if (!r) return props.w.resetsText ? `reinicia ${props.w.resetsText.replace(/\s*\(.*\)$/, "")}` : "";
          if (props.w.usedPct <= 0 && props.u.provider === "agy") return "sin usar";
          return `reinicia ${untilMs(r, nowTick())} · ${when(r, nowTick())}`;
        })()}
      </td>
    </tr>
  );
}

/** Previsión de una ventana semanal (como la del System dashboard). */
function Forecast(props: { w: UsageWindow; u: Usage }) {
  const f = createMemo(() => {
    const r = resetOf(props.w, props.u.updatedAt);
    const len = windowMs(props.w.label);
    return r && len && len >= 86_400_000 ? forecast(props.w.usedPct, r, len, nowTick()) : null;
  });
  return (
    <Show when={f()}>
      <div class="usage-forecast" classList={{ bad: !!f()!.exhaustAt }}>
        <b>{prettyLabel(props.w.label)}:</b>{" "}
        {f()!.exhaustAt
          ? `al ritmo de ahora se agota ${untilMs(f()!.exhaustAt!, nowTick())} (${dur(f()!.resetAt - f()!.exhaustAt!)} antes del reinicio).`
          : `al ritmo de ahora llega al reinicio con ≈ ${fmtPct(f()!.projected)}.`}
        <small class="muted">
          {" "}
          Ritmo ≈ {fmtPct(f()!.ratePerDay)}/día · disponible {fmtPct(f()!.budgetPerDay)}/día
        </small>
      </div>
    </Show>
  );
}

/** Detalle del consumo de un proveedor: plan y modelo, cada ventana con su reinicio, por modelo, previsión. */
export function UsageDetail(props: { id: ProviderId; compact?: boolean }) {
  const u = () => usageOf(props.id);
  const err = () => usageError(props.id);
  // agy: las ventanas van agrupadas por grupo de modelos.
  const groups = createMemo(() => {
    const x = u();
    if (!x) return [];
    if (x.provider !== "agy") return [{ name: null as string | null, models: null as string | null, windows: x.windows }];
    const out: { name: string | null; models: string | null; windows: UsageWindow[] }[] = [];
    for (const w of x.windows) {
      const name = w.label.split(" · ")[0];
      let g = out.find((o) => o.name === name);
      if (!g) {
        g = { name, models: x.groups.find((gr) => gr.name === name)?.models ?? null, windows: [] };
        out.push(g);
      }
      g.windows.push(w);
    }
    return out;
  });
  const weekly = () => (u()?.windows ?? []).filter((w) => !w.stale && (windowMs(w.label) ?? 0) >= 86_400_000);
  return (
    <div class="usage-detail" classList={{ compact: props.compact }}>
      <div class="ud-head">
        <b>{PROVIDER_NAMES[props.id]}</b>
        <Show when={u()?.plan}>
          <span class="chip">{u()!.plan}</span>
        </Show>
        <Show when={u()?.model}>
          <span class="chip model" title="Modelo por defecto">
            {u()!.model}
          </span>
        </Show>
        <span class="grow" />
        <Show when={u()}>
          <span class="badge">{u()!.exact ? "exacto" : "estimado"}</span>
        </Show>
        <button class="link small" disabled={usageBusy(props.id)} onClick={() => void loadUsage(props.id, true)} title="Consultar en vivo ahora">
          {usageBusy(props.id) ? "Consultando…" : "Actualizar"}
        </button>
      </div>
      <Show when={err()}>
        <div class="banner">{err()}</div>
      </Show>
      <Show when={u()} fallback={<p class="muted small">{err() ? "" : "Cargando…"}</p>}>
        <For each={groups()}>
          {(g) => (
            <>
              <Show when={g.name}>
                <div class="ud-group" title={g.models ?? ""}>
                  {g.name}
                  <Show when={g.models}>
                    <small class="muted"> · {g.models}</small>
                  </Show>
                </div>
              </Show>
              <table>
                <tbody>
                  <For each={g.windows}>{(w) => <Row w={w} u={u()!} />}</For>
                </tbody>
              </table>
            </>
          )}
        </For>
        <For each={weekly()}>{(w) => <Forecast w={w} u={u()!} />}</For>
        <Show when={u()!.extras.length}>
          <ul class="ud-extras">
            <For each={u()!.extras}>{(e) => <li>{e}</li>}</For>
          </ul>
        </Show>
        <For each={u()!.tables}>
          {(t) => (
            <div class="ud-table">
              <div class="ud-group">{t.title}</div>
              <table>
                <tbody>
                  <For each={t.rows}>
                    {([name, pct]) => (
                      <tr>
                        <td class="name" title={name}>
                          {name}
                        </td>
                        <td class="bar-cell">
                          <span class="usage-bar">
                            <i class="lv-ok" style={{ width: `${Math.max(1, Math.min(100, pct))}%` }} />
                          </span>
                        </td>
                        <td class="num">{fmtPct(pct)}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          )}
        </For>
        <p class="muted small">
          Fuente: {u()!.source}
          {u()!.updatedAt ? ` · ${ago(u()!.updatedAt!, nowTick())}` : ""}
        </p>
        <Show when={u()!.note}>
          <p class="small">{u()!.note}</p>
        </Show>
      </Show>
    </div>
  );
}
