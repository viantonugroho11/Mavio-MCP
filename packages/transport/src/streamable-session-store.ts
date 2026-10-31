import { randomUUID } from "node:crypto";

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface StreamableSessionMetadata {
  sessionId: string;
  createdAt: number;
  lastSeenAt: number;
}

export interface StreamableSessionStore {
  create(sessionId?: string): Promise<string>;
  has(sessionId: string): Promise<boolean>;
  touch(sessionId: string): Promise<boolean>;
  get(sessionId: string): Promise<StreamableSessionMetadata | undefined>;
  delete(sessionId: string): Promise<boolean>;
  listAll(): Promise<StreamableSessionMetadata[]>;
  reapExpired(now?: number): Promise<number>;
}

export class MemoryStreamableSessionStore implements StreamableSessionStore {
  private readonly sessions = new Map<string, StreamableSessionMetadata>();

  async create(sessionId?: string): Promise<string> {
    const id = sessionId ?? randomUUID();
    const now = Date.now();
    this.sessions.set(id, { sessionId: id, createdAt: now, lastSeenAt: now });
    return id;
  }

  async has(sessionId: string): Promise<boolean> {
    return this.sessions.has(sessionId);
  }

  async touch(sessionId: string): Promise<boolean> {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    s.lastSeenAt = Date.now();
    return true;
  }

  async get(sessionId: string): Promise<StreamableSessionMetadata | undefined> {
    return this.sessions.get(sessionId);
  }

  async delete(sessionId: string): Promise<boolean> {
    return this.sessions.delete(sessionId);
  }

  async listAll(): Promise<StreamableSessionMetadata[]> {
    return Array.from(this.sessions.values());
  }

  async reapExpired(now: number = Date.now()): Promise<number> {
    let n = 0;
    for (const [id, s] of this.sessions) {
      if (now - s.lastSeenAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
        n++;
      }
    }
    return n;
  }
}
