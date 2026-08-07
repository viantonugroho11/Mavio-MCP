import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { PrincipalUpstreamCredentialsRepository } from "@mavio/upstream-auth";
import { UPSTREAM_CREDS_REPO } from "./upstream-auth.tokens.js";

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1h
const DEFAULT_BATCH = 100;

/**
 * Background sweep that lazily re-encrypts credentials under the current
 * primary KEK. Optional — skip enabling if you're happy waiting for on-touch
 * rewrap. Enable when compliance requires a hard deadline for full rewrap
 * after a key rotation.
 *
 * Env:
 *   MAVIO_VAULT_REWRAP_ENABLED=1
 *   MAVIO_VAULT_REWRAP_INTERVAL_MS=3600000     # default 1h
 *   MAVIO_VAULT_REWRAP_BATCH=100               # rows per tick
 */
@Injectable()
export class VaultRewrapService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(UPSTREAM_CREDS_REPO)
    private readonly repo: PrincipalUpstreamCredentialsRepository,
  ) {}

  onModuleInit(): void {
    if (process.env.MAVIO_VAULT_REWRAP_ENABLED !== "1") return;
    const interval = Number(process.env.MAVIO_VAULT_REWRAP_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
    const batch = Number(process.env.MAVIO_VAULT_REWRAP_BATCH ?? DEFAULT_BATCH);
    console.log(
      `[vault-rewrap] sweep every ${interval}ms, batch=${batch}`,
    );
    // Fire once shortly after boot to catch any accumulated stale rows.
    setTimeout(() => void this.sweep(batch), 5_000);
    this.timer = setInterval(() => void this.sweep(batch), interval);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async sweep(batch: number): Promise<void> {
    try {
      const { rewrapped, scanned } = await this.repo.rewrapStale(batch);
      if (scanned > 0) {
        console.log(`[vault-rewrap] rewrapped ${rewrapped}/${scanned}`);
      }
    } catch (err) {
      console.warn(`[vault-rewrap] sweep failed:`, (err as Error).message);
    }
  }
}
