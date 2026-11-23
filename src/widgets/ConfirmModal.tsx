import { onCleanup, onMount, Show } from "solid-js";
import { answerConfirm, pendingConfirm } from "./confirm";

/**
 * La pregunta de `askConfirm`. Arranca con el foco en «Cancelar». Mientras está abierta, las
 * teclas no llegan a la terminal ni a los atajos: Esc cancela, Enter aprieta el botón enfocado y
 * Tab pasa de un botón al otro.
 */
export function ConfirmModal() {
  return (
    <Show when={pendingConfirm()}>
      {(p) => {
        let cancel!: HTMLButtonElement;
        onMount(() => {
          queueMicrotask(() => cancel?.focus());
          const key = (e: KeyboardEvent) => {
            if (e.key === "Tab") return;
            e.preventDefault();
            e.stopPropagation();
            if (e.key === "Escape") answerConfirm(false);
            else if (e.key === "Enter" || e.key === " ") (document.activeElement as HTMLElement | null)?.closest?.(".confirm-box button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          };
          window.addEventListener("keydown", key, { capture: true });
          onCleanup(() => window.removeEventListener("keydown", key, { capture: true }));
        });
        return (
          <div class="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && answerConfirm(false)}>
            <div class="confirm-box">
              <p>{p().message}</p>
              <div class="g-actions">
                <button class="btn" ref={cancel} onClick={() => answerConfirm(false)}>
                  Cancelar
                </button>
                <button class="btn danger" onClick={() => answerConfirm(true)}>
                  {p().ok}
                </button>
              </div>
            </div>
          </div>
        );
      }}
    </Show>
  );
}
