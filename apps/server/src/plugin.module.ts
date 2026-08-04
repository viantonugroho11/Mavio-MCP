import { Global, Inject, Module, type OnModuleInit } from "@nestjs/common";
import type { Kysely } from "kysely";
import { type Database, PluginRepository } from "@mavio/registry";
import { PluginManager, type PluginStateStore } from "@mavio/plugin";
import { REGISTRY_DB } from "./registry.module.js";

export const PLUGIN_MANAGER = Symbol("PLUGIN_MANAGER");
export const PLUGIN_REPO = Symbol("PLUGIN_REPO");

class DbStateStore implements PluginStateStore {
  constructor(private readonly repo: PluginRepository) {}
  async load(): Promise<{ name: string; enabled: boolean }[]> {
    const rows = await this.repo.list();
    return rows.map((r) => ({ name: r.name, enabled: r.enabled }));
  }
  async set(name: string, enabled: boolean): Promise<void> {
    await this.repo.setEnabled(name, enabled);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: PLUGIN_REPO,
      inject: [REGISTRY_DB],
      useFactory: (db: Kysely<Database>): PluginRepository => new PluginRepository(db),
    },
    {
      provide: PLUGIN_MANAGER,
      inject: [PLUGIN_REPO],
      useFactory: (repo: PluginRepository): PluginManager =>
        new PluginManager({ store: new DbStateStore(repo) }),
    },
  ],
  exports: [PLUGIN_MANAGER, PLUGIN_REPO],
})
export class PluginModule implements OnModuleInit {
  constructor(
    @Inject(PLUGIN_MANAGER) private readonly manager: PluginManager,
    @Inject(PLUGIN_REPO) private readonly repo: PluginRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    const discovered = await this.manager.discover();
    for (const d of discovered) {
      await this.repo.upsert({ name: d.name, version: d.version, packageDir: d.packageDir });
    }
    const loaded = await this.manager.loadAll();
    console.log(`[plugin] loaded ${loaded.length} plugin(s)`);
  }
}
