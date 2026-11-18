import { createSignal, onMount, Show } from "solid-js";
import { killOwned, termInfo, type TermInfo } from "./terminal/pty";
import { Workspace } from "./layout/Workspace";

// Preferencia provisoria hasta F3 (Settings en %APPDATA%\NovaTerm\settings.json).
const PREF_VERTICAL = "novaterm.tabbar.vertical";
const readPref = () => {
  try {
    return localStorage.getItem(PREF_VERTICAL) === "1";
  } catch {
    return false;
  }
};

export function App() {
  const [info, setInfo] = createSignal<TermInfo | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [vertical, setVertical] = createSignal(readPref());

  const toggleBar = () => {
    const v = !vertical();
    setVertical(v);
    try {
      localStorage.setItem(PREF_VERTICAL, v ? "1" : "0");
    } catch {
      /* sin almacenamiento: queda solo por esta vez */
    }
  };

  onMount(async () => {
    try {
      // Si la vista se recargó, no dejar shells huérfanas de la carga anterior de esta ventana.
      await killOwned();
      setInfo(await termInfo());
    } catch (err) {
      setError(String(err));
    }
  });

  return (
    <div class="app">
      <Show when={error()}>
        <div class="error">No se pudo hablar con el backend: {error()}</div>
      </Show>
      <Show when={info()}>{(ti) => <Workspace info={ti()} vertical={vertical()} onToggleBar={toggleBar} />}</Show>
    </div>
  );
}
