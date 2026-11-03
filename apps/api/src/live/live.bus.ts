import type { LiveNotice } from './rooms.js';

/** In-process fan-out of committed-change notices (sockets, the notification sender). */
export class LiveBus {
  private readonly handlers = new Set<(n: LiveNotice) => void>();

  on(handler: (n: LiveNotice) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emit(n: LiveNotice) {
    for (const h of this.handlers) h(n);
  }
}
