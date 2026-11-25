import { onCleanup, onMount, Show } from "solid-js";
import { answerConfirm, pendingConfirm } from "./confirm";
import { t } from "../i18n";

/**
 * The `askConfirm` question. It starts with focus on «Cancelar». While it is open, keys
 * don't reach the terminal or the shortcuts: Esc cancels, Enter presses the focused button and
 * Tab moves from one button to the other.
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
                  {t("Cancelar")}
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
