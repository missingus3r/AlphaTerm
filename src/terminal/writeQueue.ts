/**
 * Escrituras hacia la shell en orden. Cada `invoke` es una petición independiente y el backend
 * puede atenderlas en cualquier orden: con teclas rápidas eso invertía letras ("cmd" → "cdm").
 * La cola manda de a una y junta lo que se tipea mientras espera la respuesta.
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
          // La sesión pudo haber terminado: lo que no llegó se descarta.
        }
      }
    } finally {
      this.sending = false;
    }
  }
}
