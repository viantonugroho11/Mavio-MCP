import { Injectable, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import { createHash } from "node:crypto";

export interface McpSessionRecord {
  id: string;
  principalId: string | null;
  transport: "streamable-http" | "sse" | "unknown";
  clientInfo: Record<string, unknown> | null;
  createdAt: number;
  lastSeenAt: number;
  callCount: number;
  errorCount: number;
  bytesIn: number;
  bytesOut: number;
  costUnits: number;
  labels: Record<string, string>;
}

export interface McpSessionLimits {
  maxCalls?: number;
  maxCallsPerMinute?: number;
  maxDuration?: number;
}

export interface McpSessionStoreOptions {
  limits?: McpSessionLimits;
  loopGuard?: {
    enabled: boolean;
    maxN?: number;
    windowMs?: number;
  };
  sessionTtlMs?: number;
}

export const SESSION_LIMIT_ERROR_CODE = -32029;

interface LoopBucket {
  count: number;
  windowStart: number;
}

@Injectable()
export class McpSessionStore implements OnModuleInit, OnModuleDestroy {
  private readonly records = new Map<string, McpSessionRecord>();
  private readonly loopState = new Map<string, Map<string, LoopBucket>>();
  private reaper: NodeJS.Timeout | null = null;

  private readonly limits: McpSessionLimits;
  private readonly loopEnabled: boolean;
  private readonly loopMaxN: number;
  private readonly loopWindowMs: number;
  private readonly sessionTtlMs: number;

  constructor(options: McpSessionStoreOptions = {}) {
    this.limits = options.limits ?? {};
    this.loopEnabled = options.loopGuard?.enabled ?? false;
    this.loopMaxN = options.loopGuard?.maxN ?? 10;
    this.loopWindowMs = options.loopGuard?.windowMs ?? 60_000;
    this.sessionTtlMs = options.sessionTtlMs ?? 24 * 60 * 60 * 1000;
  }

  onModuleInit(): void {
    this.reaper = setInterval(() => this.reapExpired(), 60 * 60 * 1000);
  }

  onModuleDestroy(): void {
    if (this.reaper) clearInterval(this.reaper);
    this.reaper = null;
  }

  register(
    sessionId: string,
    transport: McpSessionRecord["transport"],
    principalId: string | null,
  ): void {
    if (this.records.has(sessionId)) return;
    const now = Date.now();
    this.records.set(sessionId, {
      id: sessionId,
      principalId,
      transport,
      clientInfo: null,
      createdAt: now,
      lastSeenAt: now,
      callCount: 0,
      errorCount: 0,
      bytesIn: 0,
      bytesOut: 0,
      costUnits: 0,
      labels: {},
    });
  }

  setClientInfo(sessionId: string, info: Record<string, unknown>): void {
    const r = this.records.get(sessionId);
    if (r) r.clientInfo = info;
  }

  get(sessionId: string): McpSessionRecord | undefined {
    return this.records.get(sessionId);
  }

  list(): McpSessionRecord[] {
    return Array.from(this.records.values());
  }

  delete(sessionId: string): boolean {
    this.loopState.delete(sessionId);
    return this.records.delete(sessionId);
  }

  /**
   * Must be called BEFORE dispatching. Increments callCount, checks limits and
   * loop guard. Returns allowed=false with code/message if any limit is exceeded.
   */
  preCall(
    sessionId: string,
    toolName: string,
    argsJson: string,
  ): { allowed: true } | { allowed: false; code: number; message: string } {
    const r = this.records.get(sessionId);
    if (!r) return { allowed: true };

    const now = Date.now();
    r.lastSeenAt = now;
    r.callCount++;
    r.bytesIn += argsJson.length;

    if (this.limits.maxCalls !== undefined && r.callCount > this.limits.maxCalls) {
      return {
        allowed: false,
        code: SESSION_LIMIT_ERROR_CODE,
        message: `session call limit exceeded (max=${this.limits.maxCalls})`,
      };
    }
    if (this.limits.maxDuration !== undefined && now - r.createdAt > this.limits.maxDuration) {
      return {
        allowed: false,
        code: SESSION_LIMIT_ERROR_CODE,
        message: "session duration limit exceeded",
      };
    }
    if (this.limits.maxCallsPerMinute !== undefined) {
      const bucket = this._bucket(sessionId, "__rpm__", now, 60_000);
      if (bucket.count > this.limits.maxCallsPerMinute) {
        return {
          allowed: false,
          code: SESSION_LIMIT_ERROR_CODE,
          message: `session rpm limit exceeded (max=${this.limits.maxCallsPerMinute})`,
        };
      }
    }
    if (this.loopEnabled) {
      const hash = createHash("sha1").update(argsJson).digest("hex").slice(0, 8);
      const key = `${toolName}:${hash}`;
      const bucket = this._bucket(sessionId, key, now, this.loopWindowMs);
      if (bucket.count >= this.loopMaxN) {
        return {
          allowed: false,
          code: SESSION_LIMIT_ERROR_CODE,
          message: `loop guard triggered: ${toolName} called ${bucket.count}x with identical args in ${this.loopWindowMs}ms`,
        };
      }
    }
    return { allowed: true };
  }

  /** Called AFTER dispatch to record outcome metrics. */
  recordOutcome(sessionId: string, isError: boolean, bytesOut: number): void {
    const r = this.records.get(sessionId);
    if (!r) return;
    if (isError) r.errorCount++;
    r.bytesOut += bytesOut;
  }

  reapExpired(now = Date.now()): number {
    let n = 0;
    for (const [id, r] of this.records) {
      if (now - r.lastSeenAt > this.sessionTtlMs) {
        this.delete(id);
        n++;
      }
    }
    return n;
  }

  private _bucket(
    sessionId: string,
    key: string,
    now: number,
    windowMs: number,
  ): LoopBucket {
    if (!this.loopState.has(sessionId)) this.loopState.set(sessionId, new Map());
    const sMap = this.loopState.get(sessionId)!;
    let b = sMap.get(key);
    if (!b || now - b.windowStart > windowMs) {
      b = { count: 0, windowStart: now };
      sMap.set(key, b);
    }
    b.count++;
    return b;
  }
}
