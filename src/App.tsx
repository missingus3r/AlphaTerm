import { createSignal, For, onMount, Show } from "solid-js";
import { killAll, termInfo, type TermInfo } from "./terminal/pty";
import { TerminalView, type TerminalStatus } from "./terminal/TerminalView";

export function App() {
  const [info, setInfo] = createSignal<TermInfo | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [profile, setProfile] = createSignal("");
  const [generation, setGeneration] = createSignal(0);
  const [status, setStatus] = createSignal<TerminalStatus | null>(null);
  const [title, setTitle] = createSignal("");

  onMount(async () => {
    try {
      // Si la vista se recargó, no dejar shells huérfanas de la carga anterior.
      await killAll();
      const ti = await termInfo();
      setInfo(ti);
      setProfile(ti.defaultProfile);
    } catch (err) {
      setError(String(err));
    }
  });

  // Cambiar de perfil (o reiniciar) vuelve a montar la terminal con una sesión nueva.
  const sessionKey = () => (info() && profile() ? `${profile()}#${generation()}` : "");
  const restart = () => {
    setStatus(null);
    setGeneration((g) => g + 1);
  };

  return (
    <div class="app">
      <header class="topbar">
        <span class="brand">NovaTerm</span>
        <Show when={info()}>
          {(ti) => (
            <select
              class="profile"
              value={profile()}
              onChange={(e) => {
                setTitle("");
                setStatus(null);
                setProfile(e.currentTarget.value);
              }}
            >
              <For each={ti().profiles}>
                {(p) => (
                  <option value={p.id} disabled={!p.available}>
                    {p.name}
                    {p.available ? "" : " (no detectado)"}
                  </option>
                )}
              </For>
            </select>
          )}
        </Show>
        <button class="btn" onClick={restart} title="Reiniciar la sesión">
          ↻
        </button>
        <span class="title" title={title()}>
          {title()}
        </span>
        <Show when={status()}>
          {(s) => (
            <span class="meta">
              {s().renderer === "webgl" ? "WebGL" : "DOM"}
              {s().pid ? ` · PID ${s().pid}` : ""}
              {s().exited ? ` · terminó (${s().exitCode ?? "?"})` : ""}
            </span>
          )}
        </Show>
      </header>
      <main class="term-area">
        <Show when={error()}>
          <div class="error">No se pudo hablar con el backend: {error()}</div>
        </Show>
        <Show when={sessionKey()} keyed>
          {(_key) => (
            <TerminalView
              profileId={profile()}
              windowsBuild={info()!.windowsBuild}
              onStatus={setStatus}
              onTitle={setTitle}
            />
          )}
        </Show>
      </main>
    </div>
  );
}
