import { createSignal } from "solid-js";

/**
 * Confirmación dentro de la app. `window.confirm` no sirve en AlphaTerm: el complemento de
 * diálogos de Tauri lo reemplaza por una función asíncrona (devuelve una promesa, que siempre
 * cuenta como "sí") y además la app no tiene el permiso para mostrar ese diálogo.
 */
export interface PendingConfirm {
  message: string;
  ok: string;
  resolve: (yes: boolean) => void;
}

const [pending, setPending] = createSignal<PendingConfirm | null>(null);
export const pendingConfirm = pending;

/** Pregunta y espera. Una pregunta nueva cancela (con "no") la que estuviera abierta. */
export function askConfirm(message: string, ok = "Aceptar"): Promise<boolean> {
  pending()?.resolve(false);
  return new Promise((resolve) => setPending({ message, ok, resolve }));
}

export function answerConfirm(yes: boolean): void {
  const p = pending();
  if (!p) return;
  setPending(null);
  p.resolve(yes);
}
