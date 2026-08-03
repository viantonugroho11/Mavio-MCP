import { Global, Inject, Module, type OnModuleInit } from "@nestjs/common";
import { Registry, createDb, type Database } from "@mavio/registry";
import type { Kysely } from "kysely";
import type { MavioConfig } from "@mavio/config";
import { TransportManager } from "@mavio/transport";
import { MAVIO_CONFIG } from "./config.module.js";

export const REGISTRY = Symbol("REGISTRY");
export const REGISTRY_DB = Symbol("REGISTRY_DB");
export const TRANSPORT_MANAGER = Symbol("TRANSPORT_MANAGER");

@Global()
@Module({
  providers: [
    {
      provide: REGISTRY_DB,
      inject: [MAVIO_CONFIG],
      useFactory: (config: MavioConfig): Kysely<Database> => createDb(config.database.url),
    },
    {
      provide: REGISTRY,
      inject: [REGISTRY_DB],
      useFactory: (db: Kysely<Database>): Registry => new Registry(db),
    },
    {
      provide: TRANSPORT_MANAGER,
      useFactory: (): TransportManager => new TransportManager(),
    },
  ],
  exports: [REGISTRY, REGISTRY_DB, TRANSPORT_MANAGER],
})
export class RegistryModule implements OnModuleInit {
  constructor(
    @Inject(MAVIO_CONFIG) private readonly config: MavioConfig,
    @Inject(REGISTRY) private readonly registry: Registry,
  ) {}

  async onModuleInit(): Promise<void> {
    for (const s of this.config.servers) {
      await this.registry.register({
        id: s.id,
        workspaceId: s.workspace,
        projectId: s.project,
        name: s.name ?? s.id,
        sourceType: s.source?.type ?? "native",
        transport: s.transport,
        tags: s.tags,
      });
    }
    console.log(`[registry] seeded ${this.config.servers.length} servers from config`);
  }
}
