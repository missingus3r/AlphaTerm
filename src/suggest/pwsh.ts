/**
 * Messages from the PowerShell session for command suggestions (see `src-tauri/shell/alphaterm.ps1`):
 * - `ESC]7717;ready;<nonce>BEL`: the session has the hidden shortcut registered.
 * - `ESC]7717;c;<nonce>;<base64 of UTF-8 JSON>BEL`: `TabExpansion2` completions for the buffer.
 * AlphaTerm sets the nonce in ALPHATERM_NONCE when launching the shell: without it, nobody is trusted.
 */

/** F12 (as xterm sends it) followed by `e`: the shortcut the script registers. */
export const PS_CHORD = "\x1b[24~e";

export interface PsResult {
  text: string;
  label: string;
  /** PowerShell's `CompletionResultType`: Command, ParameterName, ProviderContainer… */
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
  // PowerShell 5.1's ConvertTo-Json can leave a single result as an object instead of a list.
  const raw = Array.isArray(o.r) ? o.r : o.r && typeof o.r === "object" ? [o.r] : [];
  const results = raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({ text: str(r.t), label: str(r.s) || str(r.t), kind: str(r.k), tip: str(r.d) }))
    .filter((r) => r.text !== "");
  return { type: "completions", buffer: str(o.b), cursor: int(o.c), index: int(o.i), length: int(o.l), results };
}
