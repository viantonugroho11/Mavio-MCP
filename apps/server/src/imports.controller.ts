import { Body, Controller, Inject, Post, UseGuards } from "@nestjs/common";
import { Registry } from "@mavio/registry";
import { buildBlueprint, loadOpenApi } from "@mavio/import-openapi";
import { REGISTRY } from "./registry.module.js";
import { ApiKeyGuard } from "./auth.guard.js";
import { RouterService } from "./router.service.js";

interface ImportOpenApiBody {
  id: string;
  workspaceId: string;
  projectId: string;
  url?: string;
  path?: string;
  baseUrl?: string;
  tags?: string[];
}

@Controller("api/imports")
@UseGuards(ApiKeyGuard)
export class ImportsController {
  constructor(
    @Inject(REGISTRY) private readonly registry: Registry,
    private readonly router: RouterService,
  ) {}

  @Post("openapi")
  async importOpenapi(@Body() body: ImportOpenApiBody): Promise<{ ok: true; toolCount: number }> {
    const doc = await loadOpenApi({ url: body.url, path: body.path });
    const blueprint = buildBlueprint(doc, body.baseUrl);
    await this.registry.register({
      id: body.id,
      workspaceId: body.workspaceId,
      projectId: body.projectId,
      name: blueprint.serverName,
      sourceType: "openapi",
      transport: { type: "http", baseUrl: blueprint.baseUrl },
      tags: body.tags,
      version: blueprint.serverVersion,
    });
    await this.registry.snapshotCapabilities(body.id, blueprint.serverVersion, {
      tools: blueprint.tools,
      serverInfo: { name: blueprint.serverName, version: blueprint.serverVersion },
    });
    await this.router.invalidate(body.id);
    return { ok: true, toolCount: blueprint.tools.length };
  }
}
