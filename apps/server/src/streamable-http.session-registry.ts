import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import type { MCPFrame } from "@mavio/core";
import { type EventStore, type StoredEvent, GAP_EVENT, MemoryEventStore, parseEventId } from "@mavio/transport";
import type { MavioMetrics } from "@mavio/observability";

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const BUFFER_LIMIT = 100;

interface Session {
  sessionId: string;
  createdAt: number;
  lastSeenAt: number;
  pushStream: Response | null;
  pendingNotifications: Array<{ chunk: string; eventId: string }>;
}

function sseChunk(eventId: string, data: string): string {
  return `id: ${eventId}\nevent: message\ndata: ${data}\n\n`;
}

@Injectable()
export class StreamableHttpSessionRegistry implements OnModuleInit, OnModuleDestroy {
  private readonly sessions = new Map<string, Session>();
  private readonly store: EventStore;
  private reaper: NodeJS.Timeout | null = null;

  /** Push-stream stream ID — fixed per session for notifications. */
  private static readonly PUSH_STREAM = "push";

  private metrics?: MavioMetrics;

  constructor(store?: EventStore) {
    this.store = store ?? new MemoryEventStore();
  }

  /** Called by ObservabilityModule after construction to wire metrics. */
  setMetrics(m: MavioMetrics): void {
    this.metrics = m;
  }

  create(): string {
    const sessionId = randomUUID();
    const now = Date.now();
    this.sessions.set(sessionId, {
      sessionId,
      createdAt: now,
      lastSeenAt: now,
      pushStream: null,
      pendingNotifications: [],
    });
    return sessionId;
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  touch(sessionId: string): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    s.lastSeenAt = Date.now();
    return true;
  }

  async attachPushStream(sessionId: string, res: Response, lastEventId?: string): Promise<boolean> {
    const s = this.sessions.get(sessionId);
    if (!s) return false;

    // Replay from Last-Event-ID if provided (ADR-024)
    if (lastEventId) {
      this.metrics?.streamReplayTotal.inc({ session: sessionId });
      const replayed = await this._replay(sessionId, lastEventId, res);
      if (!replayed) return false;
    } else {
      // Drain pending buffer (no event IDs available — flush as-is)
      for (const { chunk } of s.pendingNotifications) {
        try {
          res.write(chunk);
        } catch {
          s.pushStream = null;
          return false;
        }
      }
      s.pendingNotifications = [];
    }

    s.pushStream = res;
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
        // Send a gap notification before replaying remaining events
        const gapFrame = {
          jsonrpc: "2.0",
          method: "notifications/message",
          params: {
            level: "warning",
            logger: "mavio/event-store",
            data: { code: "mavio/replay_gap", message: "Some events were trimmed; replay is partial." },
          },
        };
        const gapChunk = `event: message\ndata: ${JSON.stringify(gapFrame)}\n\n`;
        try { res.write(gapChunk); } catch { return false; }
        continue;
      }
      const chunk = sseChunk(ev.id, ev.data === "__oversized__"
        ? JSON.stringify({ jsonrpc: "2.0", method: "notifications/message", params: { level: "warning", logger: "mavio/event-store", data: { code: "mavio/oversized_event", message: "Event was too large to store; re-issue the request." } } })
        : ev.data);
      try { res.write(chunk); } catch { return false; }
    }
    return true;
  }

  detachPushStream(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s) s.pushStream = null;
  }

  async pushNotification(sessionId: string, frame: MCPFrame): Promise<boolean> {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    s.lastSeenAt = Date.now();

    const data = JSON.stringify(frame);
    const eventId = await this.store.append(sessionId, StreamableHttpSessionRegistry.PUSH_STREAM, data);
    const chunk = sseChunk(eventId, data);

    if (s.pushStream) {
      try {
        s.pushStream.write(chunk);
        return true;
      } catch {
        s.pushStream = null;
      }
    }
    if (s.pendingNotifications.length >= BUFFER_LIMIT) {
      s.pendingNotifications.shift();
    }
    s.pendingNotifications.push({ chunk, eventId });
    return true;
  }

  /**
   * Write a response-stream SSE event with a stable event ID.
   * Called by RouterController for `POST /mcp` streaming responses.
   * Returns the assigned event ID.
   */
  async writeResponseEvent(sessionId: string, streamId: string, data: string, res: Response): Promise<string> {
    const eventId = await this.store.append(sessionId, streamId, data);
    const chunk = sseChunk(eventId, data);
    res.write(chunk);
    return eventId;
  }

  delete(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s?.pushStream) {
      try { s.pushStream.end(); } catch { /* ignore */ }
    }
    this.sessions.delete(sessionId);
    void this.store.deleteSession(sessionId).catch(() => undefined);
  }

  reapExpired(now: number = Date.now()): number {
    let n = 0;
    for (const [sid, s] of this.sessions) {
      if (now - s.lastSeenAt > SESSION_TTL_MS) {
        this.delete(sid);
        n++;
      }
    }
    return n;
  }

  async trimStore(sessionId: string): Promise<void> {
    await this.store.trim(sessionId);
  }

  onModuleInit(): void {
    this.reaper = setInterval(() => {
      this.reapExpired();
    }, 60 * 60 * 1000);
  }

  onModuleDestroy(): void {
    if (this.reaper) clearInterval(this.reaper);
    this.reaper = null;
    for (const sid of Array.from(this.sessions.keys())) this.delete(sid);
  }
}
