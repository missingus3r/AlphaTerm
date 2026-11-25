import { createSignal } from "solid-js";
import { t } from "../i18n";

/**
 * In-app confirmation. `window.confirm` doesn't work in AlphaTerm: the Tauri
 * dialog plugin replaces it with an async function (it returns a promise, which always
 * counts as "yes") and the app also lacks the permission to show that dialog.
 */
export interface PendingConfirm {
  message: string;
  ok: string;
  resolve: (yes: boolean) => void;
}

const [pending, setPending] = createSignal<PendingConfirm | null>(null);
export const pendingConfirm = pending;

/** Asks and waits. A new question cancels (with "no") any that was open. */
export function askConfirm(message: string, ok = t("Aceptar")): Promise<boolean> {
  pending()?.resolve(false);
  return new Promise((resolve) => setPending({ message, ok, resolve }));
}

export function answerConfirm(yes: boolean): void {
  const p = pending();
  if (!p) return;
  setPending(null);
  p.resolve(yes);
}
