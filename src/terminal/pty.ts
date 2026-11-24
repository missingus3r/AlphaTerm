import { Channel, invoke } from "@tauri-apps/api/core";
import { WriteQueue } from "./writeQueue";
import { k, t } from "../i18n";

export interface Profile {
  id: string;
  name: string;
  command: string;
  args: string[];
  available: boolean;
}

export interface TermInfo {
  profiles: Profile[];
  defaultProfile: string;
  windowsBuild: number;
}

export interface SpawnInfo {
  id: number;
  pid: number | null;
  profile: Profile;
}

export type PtyEvent = { type: "exit"; code: number | null };

// El backend nombra a cmd como Windows en castellano ("Símbolo del sistema"); el nombre queda así
// porque el historial lo reconoce por él, y se traduce solo al mostrarlo.
const CMD_NAME = k("Símbolo del sistema");
/** Nombre de un perfil para mostrar. */
export const profileLabel = (name: string) => (name === CMD_NAME ? t(CMD_NAME) : name);

export const termInfo = () => invoke<TermInfo>("term_info");
/** Mata las sesiones de esta ventana (por si la vista se recargó). */
export const killOwned = () => invoke<void>("pty_kill_owned");

export interface Foreground {
  name: string;
  pid: number;
}
/** Proceso en primer plano de cada sesión (clave: id de sesión). */
export const foreground = (ids: number[]) =>
  invoke<Record<string, Foreground | null>>("pty_foreground", { ids });
export const gitBranch = (cwd: string) => invoke<string | null>("git_branch", { cwd });
export const newWindow = (restore?: unknown) => invoke<string>("window_new", { restore: restore ?? null });

export interface SpawnOptions {
  profileId: string;
  cwd?: string;
  env?: Record<string, string>;
  cols: number;
  rows: number;
  onData: (bytes: Uint8Array) => void;
  onEvent: (ev: PtyEvent) => void;
}

/** Sesión PTY del backend. La salida llega como ArrayBuffer por un canal binario. */
export class PtySession {
  private readonly queue: WriteQueue;

  spawnedCols = 0;
  spawnedRows = 0;

  private constructor(readonly info: SpawnInfo) {
    this.queue = new WriteQueue((data) => invoke<void>("pty_write", { id: info.id, data }));
  }

  static async spawn(o: SpawnOptions): Promise<PtySession> {
    const onData = new Channel<ArrayBuffer>();
    onData.onmessage = (buf) => o.onData(new Uint8Array(buf));
    const onEvent = new Channel<PtyEvent>();
    onEvent.onmessage = o.onEvent;
    const info = await invoke<SpawnInfo>("pty_spawn", {
      profileId: o.profileId,
      cwd: o.cwd ?? null,
      env: o.env ?? null,
      cols: o.cols,
      rows: o.rows,
      onData,
      onEvent,
    });
    const s = new PtySession(info);
    s.spawnedCols = o.cols;
    s.spawnedRows = o.rows;
    return s;
  }

  get id() {
    return this.info.id;
  }

  /** Encola: las escrituras llegan a la shell en el mismo orden en que se tipearon. */
  write(data: string) {
    this.queue.write(data);
  }

  resize(cols: number, rows: number) {
    return invoke<void>("pty_resize", { id: this.id, cols, rows });
  }

  ack(bytes: number) {
    return invoke<void>("pty_ack", { id: this.id, bytes });
  }

  kill() {
    return invoke<void>("pty_kill", { id: this.id });
  }
}
