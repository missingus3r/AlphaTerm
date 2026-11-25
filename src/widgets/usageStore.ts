/**
 * Usage shared by the window: the footer and the agents panel read the same thing (one query
 * per provider, even if two places show it). The backend notifies with "usage-live" when a live
 * query starts or ends.
 */
import { createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ProviderId, Usage } from "./usage";

const ALL: ProviderId[] = ["claude", "codex", "agy"];
const [data, setData] = createStore<Partial<Record<ProviderId, Usage>>>({});
const [errors, setErrors] = createStore<Partial<Record<ProviderId, string | undefined>>>({});
const [forcing, setForcing] = createStore<Partial<Record<ProviderId, boolean>>>({});

export const usageOf = (p: ProviderId) => data[p];
export const usageError = (p: ProviderId) => errors[p];
/** Querying now (requested here or the backend's round). */
export const usageBusy = (p: ProviderId) => !!forcing[p] || !!data[p]?.refreshing;

const inflight = new Map<ProviderId, Promise<void>>();

/** `force`: live query now (Claude takes about 10 s). */
export function loadUsage(p: ProviderId, force = false): Promise<void> {
  if (!force && inflight.has(p)) return inflight.get(p)!;
  const run = (async () => {
    if (force) setForcing(p, true);
    try {
      setData(p, reconcile(await invoke<Usage>("usage_get", { provider: p, force })));
      setErrors(p, undefined);
    } catch (e) {
      setErrors(p, String(e));
    } finally {
      if (force) setForcing(p, false);
      if (!force) inflight.delete(p);
    }
  })();
  if (!force) inflight.set(p, run);
  return run;
}

let listening = false;
/** Once per window: what the backend reports reloads what was already shown. */
export function listenUsage() {
  if (listening) return;
  listening = true;
  void listen("usage-live", () => {
    for (const p of ALL) if (data[p]) void loadUsage(p);
  });
}

/** Clock for the countdowns (every 30 s). */
const [tick, setTick] = createSignal(Date.now());
setInterval(() => setTick(Date.now()), 30_000);
export const nowTick = tick;
