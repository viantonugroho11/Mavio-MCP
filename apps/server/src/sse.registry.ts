import { Injectable } from "@nestjs/common";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import type { MCPFrame } from "@mavio/core";

interface SseSession {
  sid: string;
  res: Response;
  createdAt: number;
}

@Injectable()
export class SseSessionRegistry {
  private readonly sessions = new Map<string, SseSession>();

  register(res: Response): string {
    const sid = randomUUID();
    this.sessions.set(sid, { sid, res, createdAt: Date.now() });
    return sid;
  }

  unregister(sid: string): void {
    this.sessions.delete(sid);
  }

  has(sid: string): boolean {
    return this.sessions.has(sid);
  }

  send(sid: string, frame: MCPFrame): boolean {
    const s = this.sessions.get(sid);
    if (!s) return false;
    try {
      s.res.write(`event: message\ndata: ${JSON.stringify(frame)}\n\n`);
      return true;
    } catch {
      this.sessions.delete(sid);
      return false;
    }
  }
}
