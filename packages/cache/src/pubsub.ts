import type { Redis } from "ioredis";

export interface InvalidationEvent {
  kind: "server" | "servers" | "secret";
  serverId?: string;
  ref?: string;
  origin?: string;
}

const CHANNEL = "mavio:invalidate";

export class InvalidationBus {
  private handlers: Array<(e: InvalidationEvent) => void> = [];

  constructor(
    private readonly publisher: Redis,
    private readonly subscriber: Redis,
    private readonly origin: string,
  ) {
    this.subscriber.subscribe(CHANNEL).catch(() => undefined);
    this.subscriber.on("message", (channel: string, message: string) => {
      if (channel !== CHANNEL) return;
      try {
        const event = JSON.parse(message) as InvalidationEvent;
        if (event.origin === this.origin) return; // ignore own broadcasts
        for (const h of this.handlers) h(event);
      } catch {
        // ignore malformed
      }
    });
  }

  async publish(event: Omit<InvalidationEvent, "origin">): Promise<void> {
    await this.publisher.publish(CHANNEL, JSON.stringify({ ...event, origin: this.origin }));
  }

  onEvent(handler: (e: InvalidationEvent) => void): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  async close(): Promise<void> {
    await this.subscriber.unsubscribe(CHANNEL).catch(() => undefined);
  }
}
