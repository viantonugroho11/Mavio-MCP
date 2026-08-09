import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { Principal, TransportDescriptor } from "@mavio/core";
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
import { AuditService } from "./audit.module.js";

interface ImportOpenApiBody {
  id: string;
  workspaceId: string;
  projectId: string;
  url?: string;
  path?: string;
  baseUrl?: string;
  tags?: string[];
  /**
   * Optional per-principal upstream OAuth provider id. When set, the router
   * resolves a per-user credential (e.g. RFC 8693 token-exchange to a
   * KrakenD/Keycloak-fronted backend) before every dispatch.
   */
  upstreamOAuthProvider?: string;
}

interface ImportSqlBody {
  id: string;
  workspaceId: string;
  projectId: string;
  dsn: string;
  allowedTables?: string[];
  readOnly?: boolean;
  tags?: string[];
  upstreamOAuthProvider?: string;
}

interface ImportGraphqlBody {
  id: string;
  workspaceId: string;
  projectId: string;
  endpoint: string;
  headers?: Record<string, string>;
  tags?: string[];
  upstreamOAuthProvider?: string;
}

interface ImportMcpBody {
  id: string;
  workspaceId: string;
  projectId: string;
  name?: string;
  transport: TransportDescriptor;
  tags?: string[];
  upstreamOAuthProvider?: string;
}

function metadataFor(body: { upstreamOAuthProvider?: string }): Record<string, unknown> | undefined {
  return body.upstreamOAuthProvider
    ? { upstreamOAuthProvider: body.upstreamOAuthProvider }
    : undefined;
}

@Controller("api/imports")
@UseGuards(ApiKeyGuard, RbacGuard)
export class ImportsController {
  constructor(
    @Inject(REGISTRY) private readonly registry: Registry,
    @Inject(TRANSPORT_MANAGER) private readonly transports: TransportManager,
    @Inject(METRICS) private readonly metrics: MavioMetrics,
    private readonly router: RouterService,
    private readonly audit: AuditService,
  ) {}

  private async trackImport<T>(kind: string, req: Request | undefined, resourceId: string, fn: () => Promise<T>): Promise<T> {
    try {
      const out = await fn();
      this.metrics.importerRuns.inc({ kind, outcome: "ok" });
      if (req) {
        this.audit.logFromRequest(req as Request & { principal?: Principal }, {
          action: "server.import.submit",
          resource: { server: resourceId, kind },
          outcome: "ok",
          metadata: { kind },
        });
      }
      return out;
    } catch (err) {
      this.metrics.importerRuns.inc({ kind, outcome: "error" });
      if (req) {
        this.audit.logFromRequest(req as Request & { principal?: Principal }, {
          action: "server.import.submit",
          resource: { server: resourceId, kind },
          outcome: "error",
          metadata: { kind, error: (err as Error).message },
        });
      }
      throw err;
    }
  }

  private principalOf(req: Request): Principal | undefined {
    return (req as Request & { principal?: Principal }).principal;
  }

  @Post("openapi")
  @RequirePermission(Actions.ServerImportSubmit)
  async importOpenapi(
    @Body() body: ImportOpenApiBody,
    @Req() req: Request,
  ): Promise<{ ok: true; toolCount: number; approvalStatus: string }> {
    return this.trackImport("openapi", req, body.id, async () => {
      const doc = await loadOpenApi({ url: body.url, path: body.path });
      const blueprint = buildBlueprint(doc, body.baseUrl);
      const submitted = await this.registry.register({
        id: body.id,
        workspaceId: body.workspaceId,
        projectId: body.projectId,
        name: blueprint.serverName,
        sourceType: "openapi",
        transport: { type: "http", baseUrl: blueprint.baseUrl },
        tags: body.tags,
        metadata: metadataFor(body),
        version: blueprint.serverVersion,
        submittedBy: this.principalOf(req)?.id,
      });
      await this.registry.snapshotCapabilities(body.id, blueprint.serverVersion, {
        tools: blueprint.tools,
        serverInfo: { name: blueprint.serverName, version: blueprint.serverVersion },
      });
      return { ok: true as const, toolCount: blueprint.tools.length, approvalStatus: submitted.approvalStatus ?? "pending" };
    });
  }

  @Post("sql")
  @RequirePermission(Actions.ServerImportSubmit)
  async importSql(
    @Body() body: ImportSqlBody,
    @Req() req: Request,
  ): Promise<{ ok: true; toolCount: number; tables: string[]; approvalStatus: string }> {
    return this.trackImport("sql", req, body.id, async () => {
    const blueprint = await importPostgres({ dsn: body.dsn, allowedTables: body.allowedTables });
    const submitted = await this.registry.register({
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
      metadata: metadataFor(body),
      version: blueprint.serverVersion,
      submittedBy: this.principalOf(req)?.id,
    });
    await this.registry.snapshotCapabilities(body.id, blueprint.serverVersion, {
      tools: blueprint.tools,
      serverInfo: { name: blueprint.serverName, version: blueprint.serverVersion },
    });
    return { ok: true as const, toolCount: blueprint.tools.length, tables: blueprint.allowedTables, approvalStatus: submitted.approvalStatus ?? "pending" };
    });
  }

  @Post("graphql")
  @RequirePermission(Actions.ServerImportSubmit)
  async importGraphql(
    @Body() body: ImportGraphqlBody,
    @Req() req: Request,
  ): Promise<{ ok: true; toolCount: number; approvalStatus: string }> {
    return this.trackImport("graphql", req, body.id, async () => {
    const blueprint = await importGraphql({ endpoint: body.endpoint, headers: body.headers });
    const submitted = await this.registry.register({
      id: body.id,
      workspaceId: body.workspaceId,
      projectId: body.projectId,
      name: blueprint.serverName,
      sourceType: "graphql",
      transport: { type: "graphql", endpoint: blueprint.endpoint, headers: body.headers },
      tags: body.tags,
      metadata: metadataFor(body),
      version: blueprint.serverVersion,
      submittedBy: this.principalOf(req)?.id,
    });
    await this.registry.snapshotCapabilities(body.id, blueprint.serverVersion, {
      tools: blueprint.tools,
      serverInfo: { name: blueprint.serverName, version: blueprint.serverVersion },
    });
    return { ok: true as const, toolCount: blueprint.tools.length, approvalStatus: submitted.approvalStatus ?? "pending" };
    });
  }

  @Post("mcp")
  @RequirePermission(Actions.ServerImportSubmit)
  async importMcpMirror(
    @Body() body: ImportMcpBody,
    @Req() req: Request,
  ): Promise<{ ok: true; toolCount: number; serverName: string; approvalStatus: string }> {
    return this.trackImport("mcp", req, body.id, async () => {
    const blueprint = await importMcp({
      transport: body.transport,
      name: body.name,
      transports: this.transports,
    });
    const submitted = await this.registry.register({
      id: body.id,
      workspaceId: body.workspaceId,
      projectId: body.projectId,
      name: blueprint.serverName,
      sourceType: "mcp",
      transport: body.transport,
      tags: body.tags,
      metadata: metadataFor(body),
      version: blueprint.serverVersion,
      submittedBy: this.principalOf(req)?.id,
    });
    await this.registry.snapshotCapabilities(body.id, blueprint.serverVersion, blueprint.capabilities);
    return { ok: true as const, toolCount: blueprint.tools.length, serverName: blueprint.serverName, approvalStatus: submitted.approvalStatus ?? "pending" };
    });
  }

  @Get("pending")
  @RequirePermission(Actions.ServerApprove)
  async listPending(): Promise<unknown[]> {
    return this.registry.list({ approvalStatus: "pending" });
  }

  @Post(":id/approve")
  @RequirePermission(Actions.ServerApprove)
  async approve(@Param("id") id: string, @Req() req: Request): Promise<{ ok: true }> {
    const approver = this.principalOf(req)?.id ?? "unknown";
    await this.registry.approve(id, approver);
    await this.router.invalidate(id);
    this.audit.logFromRequest(req as Request & { principal?: Principal }, {
      action: "server.approve",
      resource: { server: id },
      outcome: "ok",
      metadata: {},
    });
    return { ok: true as const };
  }

  @Post(":id/reject")
  @RequirePermission(Actions.ServerApprove)
  async reject(
    @Param("id") id: string,
    @Body() body: { reason?: string },
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    const approver = this.principalOf(req)?.id ?? "unknown";
    await this.registry.reject(id, approver, body.reason ?? "");
    await this.router.invalidate(id);
    this.audit.logFromRequest(req as Request & { principal?: Principal }, {
      action: "server.reject",
      resource: { server: id },
      outcome: "ok",
      metadata: { reason: body.reason ?? "" },
    });
    return { ok: true as const };
  }
}
