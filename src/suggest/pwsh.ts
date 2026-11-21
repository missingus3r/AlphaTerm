/**
 * Mensajes de la sesión de PowerShell para las predicciones (ver `src-tauri/shell/alphaterm.ps1`):
 * - `ESC]7717;ready;<nonce>BEL`: la sesión tiene el atajo escondido registrado.
 * - `ESC]7717;c;<nonce>;<base64 de JSON UTF-8>BEL`: completados de `TabExpansion2` para el buffer.
 * El nonce lo pone AlphaTerm en ALPHATERM_NONCE al lanzar la shell: sin él no se le cree a nadie.
 */

/** F12 (como lo manda xterm) seguido de `e`: el atajo que registra el script. */
export const PS_CHORD = "\x1b[24~e";

export interface PsResult {
  text: string;
  label: string;
  /** `CompletionResultType` de PowerShell: Command, ParameterName, ProviderContainer… */
  kind: string;
  tip: string;
}

export type PsMsg =
  | { type: "ready" }
  | { type: "completions"; buffer: string; cursor: number; index: number; length: number; results: PsResult[] };

function decode(b64: string): unknown {
  try {
    const bin = atob(b64.trim());
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0);

export function parse7717(data: string, nonce: string): PsMsg | null {
  if (!nonce) return null;
  const [kind, got, payload] = data.split(";");
  if (got !== nonce) return null;
  if (kind === "ready") return { type: "ready" };
  if (kind !== "c" || payload === undefined) return null;
  const v = decode(payload);
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  // ConvertTo-Json de PowerShell 5.1 puede dejar un solo resultado como objeto en vez de lista.
  const raw = Array.isArray(o.r) ? o.r : o.r && typeof o.r === "object" ? [o.r] : [];
  const results = raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({ text: str(r.t), label: str(r.s) || str(r.t), kind: str(r.k), tip: str(r.d) }))
    .filter((r) => r.text !== "");
  return { type: "completions", buffer: str(o.b), cursor: int(o.c), index: int(o.i), length: int(o.l), results };
}
