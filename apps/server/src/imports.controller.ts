import { Body, Controller, Inject, Post, UseGuards } from "@nestjs/common";
import type { TransportDescriptor } from "@mavio/core";
import { Actions } from "@mavio/rbac";
import { Registry } from "@mavio/registry";
import { TransportManager } from "@mavio/transport";
import { buildBlueprint, loadOpenApi } from "@mavio/import-openapi";
import { importPostgres } from "@mavio/import-sql";
import { importGraphql } from "@mavio/import-graphql";
import { importMcp } from "@mavio/import-mcp";
import { MavioMetrics } from "@mavio/observability";
import { REGISTRY, TRANSPORT_MANAGER } from "./registry.module.js";
import { ApiKeyGuard } from "./auth.guard.js";
import { RbacGuard, RequirePermission } from "./rbac.guard.js";
import { RouterService } from "./router.service.js";
import { METRICS } from "./observability.module.js";

interface ImportOpenApiBody {
  id: string;
  workspaceId: string;
  projectId: string;
  url?: string;
  path?: string;
  baseUrl?: string;
  tags?: string[];
}

interface ImportSqlBody {
  id: string;
  workspaceId: string;
  projectId: string;
  dsn: string;
  allowedTables?: string[];
  readOnly?: boolean;
  tags?: string[];
}

interface ImportGraphqlBody {
  id: string;
  workspaceId: string;
  projectId: string;
  endpoint: string;
  headers?: Record<string, string>;
  tags?: string[];
}

interface ImportMcpBody {
  id: string;
  workspaceId: string;
  projectId: string;
  name?: string;
  transport: TransportDescriptor;
  tags?: string[];
}

@Controller("api/imports")
@UseGuards(ApiKeyGuard, RbacGuard)
export class ImportsController {
  constructor(
    @Inject(REGISTRY) private readonly registry: Registry,
    @Inject(TRANSPORT_MANAGER) private readonly transports: TransportManager,
    @Inject(METRICS) private readonly metrics: MavioMetrics,
    private readonly router: RouterService,
  ) {}

  private async trackImport<T>(kind: string, fn: () => Promise<T>): Promise<T> {
    try {
      const out = await fn();
      this.metrics.importerRuns.inc({ kind, outcome: "ok" });
      return out;
    } catch (err) {
      this.metrics.importerRuns.inc({ kind, outcome: "error" });
      throw err;
    }
  }

  @Post("openapi")
  @RequirePermission(Actions.ServerWrite)
  async importOpenapi(@Body() body: ImportOpenApiBody): Promise<{ ok: true; toolCount: number }> {
    return this.trackImport("openapi", async () => {
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
      return { ok: true as const, toolCount: blueprint.tools.length };
    });
  }

  @Post("sql")
  @RequirePermission(Actions.ServerWrite)
  async importSql(@Body() body: ImportSqlBody): Promise<{ ok: true; toolCount: number; tables: string[] }> {
    return this.trackImport("sql", async () => {
    const blueprint = await importPostgres({ dsn: body.dsn, allowedTables: body.allowedTables });
    await this.registry.register({
      id: body.id,
      workspaceId: body.workspaceId,
      projectId: body.projectId,
      name: blueprint.serverName,
      sourceType: "sql",
      transport: {
        type: "sql",
        dialect: "postgres",
        dsn: body.dsn,
        allowedTables: blueprint.allowedTables,
        readOnly: body.readOnly ?? true,
      },
      tags: body.tags,
      version: blueprint.serverVersion,
    });
    await this.registry.snapshotCapabilities(body.id, blueprint.serverVersion, {
      tools: blueprint.tools,
      serverInfo: { name: blueprint.serverName, version: blueprint.serverVersion },
    });
    await this.router.invalidate(body.id);
    return { ok: true as const, toolCount: blueprint.tools.length, tables: blueprint.allowedTables };
    });
  }

  @Post("graphql")
  @RequirePermission(Actions.ServerWrite)
  async importGraphql(@Body() body: ImportGraphqlBody): Promise<{ ok: true; toolCount: number }> {
    return this.trackImport("graphql", async () => {
    const blueprint = await importGraphql({ endpoint: body.endpoint, headers: body.headers });
    await this.registry.register({
      id: body.id,
      workspaceId: body.workspaceId,
      projectId: body.projectId,
      name: blueprint.serverName,
      sourceType: "graphql",
      transport: { type: "graphql", endpoint: blueprint.endpoint, headers: body.headers },
      tags: body.tags,
      version: blueprint.serverVersion,
    });
    await this.registry.snapshotCapabilities(body.id, blueprint.serverVersion, {
      tools: blueprint.tools,
      serverInfo: { name: blueprint.serverName, version: blueprint.serverVersion },
    });
    await this.router.invalidate(body.id);
    return { ok: true as const, toolCount: blueprint.tools.length };
    });
  }

  @Post("mcp")
  @RequirePermission(Actions.ServerWrite)
  async importMcpMirror(@Body() body: ImportMcpBody): Promise<{ ok: true; toolCount: number; serverName: string }> {
    return this.trackImport("mcp", async () => {
    const blueprint = await importMcp({
      transport: body.transport,
      name: body.name,
      transports: this.transports,
    });
    await this.registry.register({
      id: body.id,
      workspaceId: body.workspaceId,
      projectId: body.projectId,
      name: blueprint.serverName,
      sourceType: "mcp",
      transport: body.transport,
      tags: body.tags,
      version: blueprint.serverVersion,
    });
    await this.registry.snapshotCapabilities(body.id, blueprint.serverVersion, blueprint.capabilities);
    await this.router.invalidate(body.id);
    return { ok: true as const, toolCount: blueprint.tools.length, serverName: blueprint.serverName };
    });
  }
}
