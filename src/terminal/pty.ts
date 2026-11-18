import { Channel, invoke } from "@tauri-apps/api/core";

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

export const termInfo = () => invoke<TermInfo>("term_info");
export const killAll = () => invoke<void>("pty_kill_all");

export interface SpawnOptions {
  profileId: string;
  cwd?: string;
  cols: number;
  rows: number;
  onData: (bytes: Uint8Array) => void;
  onEvent: (ev: PtyEvent) => void;
}

/** Sesión PTY del backend. La salida llega como ArrayBuffer por un canal binario. */
export class PtySession {
  private constructor(readonly info: SpawnInfo) {}

  static async spawn(o: SpawnOptions): Promise<PtySession> {
    const onData = new Channel<ArrayBuffer>();
    onData.onmessage = (buf) => o.onData(new Uint8Array(buf));
    const onEvent = new Channel<PtyEvent>();
    onEvent.onmessage = o.onEvent;
    const info = await invoke<SpawnInfo>("pty_spawn", {
      profileId: o.profileId,
      cwd: o.cwd ?? null,
      cols: o.cols,
      rows: o.rows,
      onData,
      onEvent,
    });
    return new PtySession(info);
  }

  get id() {
    return this.info.id;
  }

  write(data: string) {
    return invoke<void>("pty_write", { id: this.id, data });
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
