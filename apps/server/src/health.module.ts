import { Inject, Injectable, Module, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { request } from "undici";
import pg from "pg";
import type { ServerDescriptor, ServerStatus } from "@mavio/core";
import { Registry } from "@mavio/registry";
import { InvalidationBus } from "@mavio/cache";
import { REGISTRY } from "./registry.module.js";
import { INVALIDATION_BUS } from "./cache.module.js";

const { Pool } = pg;

const PROBE_INTERVAL_MS = 30_000;
const PROBE_TIMEOUT_MS = 5_000;

@Injectable()
export class HealthProber implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(REGISTRY) private readonly registry: Registry,
    @Inject(INVALIDATION_BUS) private readonly bus: InvalidationBus,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.probeAll();
    }, PROBE_INTERVAL_MS);
    setTimeout(() => void this.probeAll(), 3_000);
    console.log(`[health] prober started (every ${PROBE_INTERVAL_MS / 1000}s)`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async probeAll(): Promise<void> {
    const servers = await this.registry.list().catch(() => [] as ServerDescriptor[]);
    await Promise.all(servers.map((s) => this.probe(s)));
  }

  private async probe(server: ServerDescriptor): Promise<void> {
    const status = await this.check(server);
    await this.registry.updateStatus(server.id, status);
    await this.bus.publish({ kind: "server", serverId: server.id });
  }

  private async check(server: ServerDescriptor): Promise<ServerStatus> {
    try {
      const t = server.transport;
      if (t.type === "http") {
        const res = await request(t.baseUrl, {
          method: "HEAD",
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        return res.statusCode < 500 ? "healthy" : "degraded";
      }
      if (t.type === "graphql") {
        const res = await request(t.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: "{ __typename }" }),
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        return res.statusCode < 500 ? "healthy" : "degraded";
      }
      if (t.type === "sql") {
        const pool = new Pool({
          connectionString: t.dsn,
          max: 1,
          connectionTimeoutMillis: PROBE_TIMEOUT_MS,
        });
        try {
          await pool.query("SELECT 1");
          return "healthy";
        } finally {
          await pool.end().catch(() => undefined);
        }
      }
      return "unknown";
    } catch {
      return "down";
    }
  }
}

@Module({ providers: [HealthProber], exports: [HealthProber] })
export class HealthModule {}
