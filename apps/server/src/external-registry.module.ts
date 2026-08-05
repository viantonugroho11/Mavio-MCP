import { Global, Inject, Injectable, Module, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { ServerDescriptor } from "@mavio/core";
import { Registry } from "@mavio/registry";
import {
  createRegistrySource,
  type ExternalRegistryConfig,
  type ExternalRegistrySource,
} from "@mavio/registry-external";
import type { InvalidationBus } from "@mavio/cache";
import { REGISTRY } from "./registry.module.js";
import { INVALIDATION_BUS } from "./cache.module.js";

const DEFAULT_INTERVAL_MS = 30_000;

/**
 * Reads MAVIO_EXTERNAL_REGISTRY_* env and polls an external KV source
 * (etcd/Consul) on an interval, mirroring ServerDescriptor entries into the
 * Postgres Registry. Postgres remains source of truth for RBAC, snapshots,
 * audit — external source is a service-discovery feed.
 *
 *   MAVIO_EXTERNAL_REGISTRY=etcd|consul
 *   MAVIO_EXTERNAL_REGISTRY_ENDPOINT=http://etcd:2379
 *   MAVIO_EXTERNAL_REGISTRY_PREFIX=/mavio/servers/
 *   MAVIO_EXTERNAL_REGISTRY_TOKEN=<optional>
 *   MAVIO_EXTERNAL_REGISTRY_INTERVAL_MS=30000
 */
@Injectable()
export class ExternalRegistrySync implements OnModuleInit, OnModuleDestroy {
  private source: ExternalRegistrySource | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastFingerprint = new Map<string, string>();

  constructor(
    @Inject(REGISTRY) private readonly registry: Registry,
    @Inject(INVALIDATION_BUS) private readonly bus: InvalidationBus,
  ) {}

  onModuleInit(): void {
    const cfg = readEnvConfig();
    if (!cfg) return;
    this.source = createRegistrySource(cfg);
    const interval = Number(process.env.MAVIO_EXTERNAL_REGISTRY_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
    void this.tick();
    this.timer = setInterval(() => void this.tick(), interval);
    console.log(`[external-registry] ${cfg.kind} polling every ${interval}ms`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.source) await this.source.close();
  }

  private async tick(): Promise<void> {
    if (!this.source) return;
    try {
      const remote = await this.source.list();
      let changed = false;
      for (const desc of remote) {
        const fp = fingerprint(desc);
        if (this.lastFingerprint.get(desc.id) === fp) continue;
        await this.registry.register(desc);
        this.lastFingerprint.set(desc.id, fp);
        changed = true;
      }
      if (changed) await this.bus.publish({ kind: "servers" });
    } catch (err) {
      console.warn(`[external-registry] tick failed:`, (err as Error).message);
    }
  }
}

function readEnvConfig(): ExternalRegistryConfig | null {
  const kind = process.env.MAVIO_EXTERNAL_REGISTRY;
  if (!kind) return null;
  const endpoint = process.env.MAVIO_EXTERNAL_REGISTRY_ENDPOINT;
  if (!endpoint) {
    console.warn("[external-registry] MAVIO_EXTERNAL_REGISTRY set but ENDPOINT missing — disabled");
    return null;
  }
  const prefix = process.env.MAVIO_EXTERNAL_REGISTRY_PREFIX;
  const token = process.env.MAVIO_EXTERNAL_REGISTRY_TOKEN;
  if (kind === "etcd") return { kind: "etcd", endpoint, prefix, token };
  if (kind === "consul") {
    return {
      kind: "consul",
      endpoint,
      prefix,
      token,
      datacenter: process.env.MAVIO_EXTERNAL_REGISTRY_DC,
    };
  }
  console.warn(`[external-registry] unknown kind "${kind}" — disabled`);
  return null;
}

function fingerprint(d: ServerDescriptor): string {
  return JSON.stringify({
    name: d.name,
    transport: d.transport,
    tags: d.tags,
    version: d.version,
    metadata: d.metadata,
  });
}

@Global()
@Module({
  providers: [ExternalRegistrySync],
  exports: [ExternalRegistrySync],
})
export class ExternalRegistryModule {}
