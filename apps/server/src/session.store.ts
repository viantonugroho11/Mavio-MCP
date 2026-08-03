import { randomBytes } from "node:crypto";
import type { Redis } from "@mavio/cache";

const SESSION_PREFIX = "mavio:sess:";
const STATE_PREFIX = "mavio:oidc:state:";

export interface SessionData {
  principalId: string;
  providerId: string;
  workspaceId: string;
  email?: string;
  displayName?: string;
  createdAt: number;
  expiresAt: number;
}

export interface OidcState {
  providerId: string;
  codeVerifier: string;
  nonce: string;
  state: string;
  returnTo: string;
}

export class SessionStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
  ) {}

  async create(data: Omit<SessionData, "createdAt" | "expiresAt">): Promise<string> {
    const sid = randomBytes(32).toString("base64url");
    const now = Date.now();
    const full: SessionData = {
      ...data,
      createdAt: now,
      expiresAt: now + this.ttlSeconds * 1000,
    };
    await this.redis.set(SESSION_PREFIX + sid, JSON.stringify(full), "EX", this.ttlSeconds);
    return sid;
  }

  async read(sid: string): Promise<SessionData | null> {
    const raw = await this.redis.get(SESSION_PREFIX + sid);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as SessionData;
      if (parsed.expiresAt < Date.now()) {
        await this.destroy(sid);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async destroy(sid: string): Promise<void> {
    await this.redis.del(SESSION_PREFIX + sid);
  }

  async saveState(data: OidcState, ttlSeconds = 600): Promise<void> {
    await this.redis.set(
      STATE_PREFIX + data.state,
      JSON.stringify(data),
      "EX",
      ttlSeconds,
    );
  }

  async consumeState(state: string): Promise<OidcState | null> {
    const key = STATE_PREFIX + state;
    const raw = await this.redis.get(key);
    if (!raw) return null;
    await this.redis.del(key);
    try {
      return JSON.parse(raw) as OidcState;
    } catch {
      return null;
    }
  }
}
