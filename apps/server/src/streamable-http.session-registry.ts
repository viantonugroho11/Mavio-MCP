import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import type { MCPFrame } from "@mavio/core";

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const BUFFER_LIMIT = 100;

interface Session {
  sessionId: string;
  createdAt: number;
  lastSeenAt: number;
  pushStream: Response | null;
  pendingNotifications: string[];
}

@Injectable()
export class StreamableHttpSessionRegistry implements OnModuleInit, OnModuleDestroy {
  private readonly sessions = new Map<string, Session>();
  private reaper: NodeJS.Timeout | null = null;

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

  attachPushStream(sessionId: string, res: Response): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    s.pushStream = res;
    for (const chunk of s.pendingNotifications) {
      try {
        res.write(chunk);
      } catch {
        s.pushStream = null;
        return false;
      }
    }
    s.pendingNotifications = [];
    return true;
  }

  detachPushStream(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s) s.pushStream = null;
  }

  pushNotification(sessionId: string, frame: MCPFrame): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    const chunk = `event: message\ndata: ${JSON.stringify(frame)}\n\n`;
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
    s.pendingNotifications.push(chunk);
    return true;
  }

  delete(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s?.pushStream) {
      try {
        s.pushStream.end();
      } catch {
        /* ignore */
      }
    }
    this.sessions.delete(sessionId);
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

  onModuleInit(): void {
    this.reaper = setInterval(() => this.reapExpired(), 60 * 60 * 1000);
  }

  onModuleDestroy(): void {
    if (this.reaper) clearInterval(this.reaper);
    this.reaper = null;
    for (const sid of Array.from(this.sessions.keys())) this.delete(sid);
  }
}
