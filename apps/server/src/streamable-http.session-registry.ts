import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Response } from "express";
import type { MCPFrame } from "@mavio/core";
import { type EventStore, type StoredEvent, GAP_EVENT, MemoryEventStore, MemoryStreamableSessionStore, type StreamableSessionStore, parseEventId } from "@mavio/transport";
import type { MavioMetrics } from "@mavio/observability";
import type { Redis } from "@mavio/cache";

export const BUFFER_LIMIT = 100;
const PUSH_CHANNEL_PREFIX = "mavio:push:";

interface LocalSessionState {
  pushStream: Response | null;
  pendingNotifications: Array<{ chunk: string; eventId: string }>;
}

function sseChunk(eventId: string, data: string): string {
  return `id: ${eventId}\nevent: message\ndata: ${data}\n\n`;
}

@Injectable()
export class StreamableHttpSessionRegistry implements OnModuleInit, OnModuleDestroy {
  private readonly localState = new Map<string, LocalSessionState>();
  private readonly store: EventStore;
  private readonly sessionStore: StreamableSessionStore;
  private reaper: NodeJS.Timeout | null = null;

  /** Cross-replica pub/sub (ADR-027) — optional, only in Redis mode. */
  private publisher?: Redis;
  private pushSubscriber?: Redis;

  private metrics?: MavioMetrics;

  /** Fixed stream ID for push notifications per session. */
  private static readonly PUSH_STREAM = "push";

  constructor(store?: EventStore, sessionStore?: StreamableSessionStore) {
    this.store = store ?? new MemoryEventStore();
    this.sessionStore = sessionStore ?? new MemoryStreamableSessionStore();
  }

  /** Called by AppBootstrapService after construction to wire metrics. */
  setMetrics(m: MavioMetrics): void {
    this.metrics = m;
  }

  /** Called by AppBootstrapService to wire Redis cross-replica delivery (ADR-027). */
  setPubSub(publisher: Redis, subscriber: Redis): void {
    this.publisher = publisher;
    this.pushSubscriber = subscriber;
  }

  private getOrCreateLocalState(sessionId: string): LocalSessionState {
    let local = this.localState.get(sessionId);
    if (!local) {
      local = { pushStream: null, pendingNotifications: [] };
      this.localState.set(sessionId, local);
    }
    return local;
  }

  async create(): Promise<string> {
    const sessionId = await this.sessionStore.create();
    this.localState.set(sessionId, { pushStream: null, pendingNotifications: [] });
    return sessionId;
  }

  async has(sessionId: string): Promise<boolean> {
    return this.sessionStore.has(sessionId);
  }

  touch(sessionId: string): void {
    void this.sessionStore.touch(sessionId).catch(() => undefined);
  }

  async attachPushStream(sessionId: string, res: Response, lastEventId?: string): Promise<boolean> {
    const exists = await this.sessionStore.has(sessionId);
    if (!exists) return false;

    const local = this.getOrCreateLocalState(sessionId);

    if (lastEventId) {
      this.metrics?.streamReplayTotal.inc({ session: sessionId });
      const replayed = await this._replay(sessionId, lastEventId, res);
      if (!replayed) return false;
    } else {
      for (const { chunk } of local.pendingNotifications) {
        try {
          res.write(chunk);
        } catch {
          local.pushStream = null;
          return false;
        }
      }
      local.pendingNotifications = [];
    }

    local.pushStream = res;
    return true;
  }

  private async _replay(sessionId: string, afterId: string, res: Response): Promise<boolean> {
    let events: StoredEvent[];
    try {
      events = await this.store.readAfter(sessionId, afterId);
    } catch {
      return false;
    }

    for (const ev of events) {
      if (ev.id === GAP_EVENT.id) {
        this.metrics?.streamReplayGapTotal.inc({ session: sessionId });
        const gapFrame = {
          jsonrpc: "2.0",
          method: "notifications/message",
          params: {
            level: "warning",
            logger: "mavio/event-store",
            data: { code: "mavio/replay_gap", message: "Some events were trimmed; replay is partial." },
          },
        };
        try { res.write(`event: message\ndata: ${JSON.stringify(gapFrame)}\n\n`); } catch { return false; }
        continue;
      }
      const chunk = sseChunk(
        ev.id,
        ev.data === "__oversized__"
          ? JSON.stringify({ jsonrpc: "2.0", method: "notifications/message", params: { level: "warning", logger: "mavio/event-store", data: { code: "mavio/oversized_event", message: "Event was too large to store; re-issue the request." } } })
          : ev.data,
      );
      try { res.write(chunk); } catch { return false; }
    }
    return true;
  }

  detachPushStream(sessionId: string): void {
    const local = this.localState.get(sessionId);
    if (local) local.pushStream = null;
  }

  async pushNotification(sessionId: string, frame: MCPFrame): Promise<boolean> {
    const exists = await this.sessionStore.has(sessionId);
    if (!exists) return false;
    void this.sessionStore.touch(sessionId).catch(() => undefined);

    const data = JSON.stringify(frame);
    const eventId = await this.store.append(sessionId, StreamableHttpSessionRegistry.PUSH_STREAM, data);
    const chunk = sseChunk(eventId, data);

    const local = this.getOrCreateLocalState(sessionId);

    if (local.pushStream) {
      try {
        local.pushStream.write(chunk);
        return true;
      } catch {
        local.pushStream = null;
      }
    }

    // No local push stream — try cross-replica delivery (ADR-027)
    if (this.publisher) {
      void this.publisher.publish(`${PUSH_CHANNEL_PREFIX}${sessionId}`, chunk).catch(() => undefined);
      return true;
    }

    if (local.pendingNotifications.length >= BUFFER_LIMIT) {
      local.pendingNotifications.shift();
    }
    local.pendingNotifications.push({ chunk, eventId });
    return true;
  }

  async writeResponseEvent(sessionId: string, streamId: string, data: string, res: Response): Promise<string> {
    const eventId = await this.store.append(sessionId, streamId, data);
    const chunk = sseChunk(eventId, data);
    res.write(chunk);
    return eventId;
  }

  delete(sessionId: string): void {
    const local = this.localState.get(sessionId);
    if (local?.pushStream) {
      try { local.pushStream.end(); } catch { /* ignore */ }
    }
    this.localState.delete(sessionId);
    void this.sessionStore.delete(sessionId).catch(() => undefined);
    void this.store.deleteSession(sessionId).catch(() => undefined);
  }

  async reapExpired(now: number = Date.now()): Promise<number> {
    const n = await this.sessionStore.reapExpired(now);
    // Clean up local state for reaped sessions
    for (const [sid] of this.localState) {
      const exists = await this.sessionStore.has(sid);
      if (!exists) {
        const local = this.localState.get(sid);
        if (local?.pushStream) {
          try { local.pushStream.end(); } catch { /* ignore */ }
        }
        this.localState.delete(sid);
      }
    }
    return n;
  }

  async trimStore(sessionId: string): Promise<void> {
    await this.store.trim(sessionId);
  }

  onModuleInit(): void {
    // Cross-replica push delivery: pattern-subscribe to all push channels
    if (this.pushSubscriber) {
      void this.pushSubscriber.psubscribe(`${PUSH_CHANNEL_PREFIX}*`).catch(() => undefined);
      this.pushSubscriber.on("pmessage", (_pattern: string, channel: string, chunk: string) => {
        const sessionId = channel.slice(PUSH_CHANNEL_PREFIX.length);
        const local = this.localState.get(sessionId);
        if (local?.pushStream) {
          try { local.pushStream.write(chunk); } catch { local.pushStream = null; }
        }
      });
    }

    this.reaper = setInterval(() => {
      void this.reapExpired().catch(() => undefined);
    }, 60 * 60 * 1000);
  }

  onModuleDestroy(): void {
    if (this.reaper) clearInterval(this.reaper);
    this.reaper = null;
    if (this.pushSubscriber) {
      void this.pushSubscriber.punsubscribe(`${PUSH_CHANNEL_PREFIX}*`).catch(() => undefined);
    }
    for (const [sid] of this.localState) this.delete(sid);
  }
}
