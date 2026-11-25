import { createMemo, For, Show } from "solid-js";
import { ago, fmtPct, fmtSpan, level } from "./format";
import { forecast, PROVIDER_NAMES, resetOf, windowMs, type ProviderId, type Usage, type UsageWindow } from "./usage";
import { loadUsage, nowTick, usageBusy, usageError, usageOf } from "./usageStore";
import { k, locale, t } from "../i18n";

// Window labels are sent by the backend in Spanish ("5 h", "semana", "semana · Sonnet",
// "Gemini · semana"): they are ids (`windowMs` compares them), translated only when displayed.
const WINDOW_NAMES = new Map<string, string>([
  ["semana", k("semana")],
  ["día", k("día")],
  ["uso extra", k("uso extra")],
]);
/** A part of the label ("semana", "5 h", "Sonnet") in the interface language. */
export const windowName = (part: string) => {
  const es = WINDOW_NAMES.get(part);
  if (es) return t(es);
  const days = /^(\d+) días$/.exec(part);
  return days ? t("{n} días", { n: days[1] }) : part;
};

/** "Sesión (5 h)", "Semana", "Semana · Sonnet", "Uso extra" (in agy, the window within the group). */
export function prettyLabel(label: string): string {
  if (label === "5 h") return t("Sesión (5 h)");
  if (label === "semana") return t("Semana");
  if (label === "uso extra") return t("Uso extra");
  const [a, b] = label.split(" · ");
  if (a === "semana" && b) return t("Semana · {model}", { model: b });
  if (b) return b === "semana" ? t("Semana") : windowName(b);
  return windowName(label);
}

/** "en 2 h 10 min" until `ms`. */
export function untilMs(ms: number, now: number): string {
  const m = Math.ceil((ms - now) / 60_000);
  if (m <= 0) return t("ya se reinició");
  return t("en {time}", { time: fmtSpan(m, true) });
}

/** Time (today) or day and time. */
function when(ms: number, now: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  if (new Date(now).toDateString() === d.toDateString()) return time;
  return `${d.toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" })} ${time}`;
}

/** "2 h 10 min" (duration, without the "en"). */
const dur = (ms: number) => {
  const m = Math.ceil(ms / 60_000);
  return m <= 0 ? t("ya se reinició") : fmtSpan(m, true);
};

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
          if (!r) return props.w.resetsText ? t("reinicia {when}", { when: props.w.resetsText.replace(/\s*\(.*\)$/, "") }) : "";
          if (props.w.usedPct <= 0 && props.u.provider === "agy") return t("sin usar");
          return `${t("reinicia {when}", { when: untilMs(r, nowTick()) })} · ${when(r, nowTick())}`;
        })()}
      </td>
    </tr>
  );
}

/** Forecast for a weekly window (like the System dashboard's). */
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
          ? t("al ritmo de ahora se agota {when} ({time} antes del reinicio).", { when: untilMs(f()!.exhaustAt!, nowTick()), time: dur(f()!.resetAt - f()!.exhaustAt!) })
          : t("al ritmo de ahora llega al reinicio con ≈ {pct}.", { pct: fmtPct(f()!.projected) })}
        <small class="muted">
          {" "}
          {t("Ritmo ≈ {rate}/día · disponible {budget}/día", { rate: fmtPct(f()!.ratePerDay), budget: fmtPct(f()!.budgetPerDay) })}
        </small>
      </div>
    </Show>
  );
}

/** Usage detail of a provider: plan and model, each window with its reset, per model, forecast. */
export function UsageDetail(props: { id: ProviderId; compact?: boolean }) {
  const u = () => usageOf(props.id);
  const err = () => usageError(props.id);
  // agy: windows are grouped by model group.
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
          <span class="chip model" title={t("Modelo por defecto")}>
            {u()!.model}
          </span>
        </Show>
        <span class="grow" />
        <Show when={u()}>
          <span class="badge">{u()!.exact ? t("exacto") : t("estimado")}</span>
        </Show>
        <button class="link small" disabled={usageBusy(props.id)} onClick={() => void loadUsage(props.id, true)} title={t("Consultar en vivo ahora")}>
          {usageBusy(props.id) ? t("Consultando…") : t("Actualizar")}
        </button>
      </div>
      <Show when={err()}>
        <div class="banner">{err()}</div>
      </Show>
      <Show when={u()} fallback={<p class="muted small">{err() ? "" : t("Cargando…")}</p>}>
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
          {(tbl) => (
            <div class="ud-table">
              <div class="ud-group">{tbl.title}</div>
              <table>
                <tbody>
                  <For each={tbl.rows}>
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
          {t("Fuente: {source}", { source: u()!.source })}
          {u()!.updatedAt ? ` · ${ago(u()!.updatedAt!, nowTick())}` : ""}
        </p>
        <Show when={u()!.note}>
          <p class="small">{u()!.note}</p>
        </Show>
      </Show>
    </div>
  );
}
