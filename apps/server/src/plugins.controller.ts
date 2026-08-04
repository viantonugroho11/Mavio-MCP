import { Controller, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { Actions } from "@mavio/rbac";
import type { PluginManager } from "@mavio/plugin";
import type { PluginRepository } from "@mavio/registry";
import { ApiKeyGuard } from "./auth.guard.js";
import { RbacGuard, RequirePermission } from "./rbac.guard.js";
import { PLUGIN_MANAGER, PLUGIN_REPO } from "./plugin.module.js";

interface PluginView {
  name: string;
  version: string;
  enabled: boolean;
  mavioApi: string;
  contributes: Record<string, unknown>;
  activatedAt: string | null;
}

@Controller("api/plugins")
@UseGuards(ApiKeyGuard, RbacGuard)
export class PluginsController {
  constructor(
    @Inject(PLUGIN_MANAGER) private readonly manager: PluginManager,
    @Inject(PLUGIN_REPO) private readonly repo: PluginRepository,
  ) {}

  @Get()
  @RequirePermission(Actions.PluginInstall)
  async list(): Promise<PluginView[]> {
    const loaded = new Map(this.manager.list().map((p) => [p.manifest.name, p] as const));
    const persisted = await this.repo.list();
    return persisted.map((rec) => {
      const l = loaded.get(rec.name);
      return {
        name: rec.name,
        version: rec.version,
        enabled: l?.enabled ?? rec.enabled,
        mavioApi: l?.manifest.mavioApi ?? "unknown",
        contributes: (l?.manifest.contributes ?? {}) as Record<string, unknown>,
        activatedAt: l?.activatedAt?.toISOString() ?? null,
      };
    });
  }

  @Post(":name/enable")
  @RequirePermission(Actions.PluginInstall)
  async enable(@Param("name") name: string): Promise<{ ok: true; enabled: boolean }> {
    await this.manager.enable(name);
    return { ok: true, enabled: true };
  }

  @Post(":name/disable")
  @RequirePermission(Actions.PluginInstall)
  async disable(@Param("name") name: string): Promise<{ ok: true; enabled: boolean }> {
    await this.manager.disable(name);
    return { ok: true, enabled: false };
  }
}
