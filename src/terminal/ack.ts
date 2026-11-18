/**
 * Junta las confirmaciones de bytes ya pintados por xterm y las manda al backend de a poco:
 * cuando pasan `threshold` bytes o a los `delayMs`, lo que ocurra primero.
 */
export class AckBatcher {
  private pending = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly flush: (bytes: number) => void,
    private readonly threshold = 256 * 1024,
    private readonly delayMs = 16,
  ) {}

  add(bytes: number) {
    this.pending += bytes;
    if (this.pending >= this.threshold) {
      this.send();
    } else if (this.timer === null) {
      this.timer = setTimeout(() => this.send(), this.delayMs);
    }
  }

  send() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending > 0) {
      const n = this.pending;
      this.pending = 0;
      this.flush(n);
    }
  }

  dispose() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
