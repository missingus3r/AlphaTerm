/**
 * Writes to the shell, in order. Each `invoke` is an independent request and the backend
 * may serve them in any order: with fast typing that swapped letters ("cmd" → "cdm").
 * The queue sends one at a time and gathers what is typed while it waits for the response.
 */
export class WriteQueue {
  private pending = "";
  private sending = false;

  constructor(private readonly send: (data: string) => Promise<unknown>) {}

  write(data: string) {
    this.pending += data;
    if (!this.sending) void this.drain();
  }

  private async drain() {
    this.sending = true;
    try {
      while (this.pending) {
        const chunk = this.pending;
        this.pending = "";
        try {
          await this.send(chunk);
        } catch {
          // The session may have ended: whatever didn't arrive is discarded.
        }
      }
    } finally {
      this.sending = false;
    }
  }
}
