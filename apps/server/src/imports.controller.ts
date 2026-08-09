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

  /**
   * Submit endpoints DO NOT connect to upstream. They persist the raw import
   * spec (kind + body) in metadata.importSpec and land the server row in
   * approval_status='pending' with the transport supplied by the user. The
   * actual blueprint step — which executes stdio commands, opens DB
   * connections, or fetches remote schemas — is deferred to approve time
   * (see approve() below). This closes the "malicious submitter runs upstream
   * code before any admin review" hole from ADR-021.
   */
  @Post("openapi")
  @RequirePermission(Actions.ServerImportSubmit)
  async importOpenapi(
    @Body() body: ImportOpenApiBody,
    @Req() req: Request,
  ): Promise<{ ok: true; approvalStatus: string; snapshotDeferred: true }> {
    return this.trackImport("openapi", req, body.id, async () => {
      const submitted = await this.registry.register({
        id: body.id,
        workspaceId: body.workspaceId,
        projectId: body.projectId,
        name: body.id,
        sourceType: "openapi",
        transport: { type: "http", baseUrl: body.baseUrl ?? "" },
        tags: body.tags,
        metadata: { ...(metadataFor(body) ?? {}), importSpec: { kind: "openapi", body } },
        submittedBy: this.principalOf(req)?.id,
      });
      return {
        ok: true as const,
        approvalStatus: submitted.approvalStatus ?? "pending",
        snapshotDeferred: true as const,
      };
    });
  }

  @Post("sql")
  @RequirePermission(Actions.ServerImportSubmit)
  async importSql(
    @Body() body: ImportSqlBody,
    @Req() req: Request,
  ): Promise<{ ok: true; approvalStatus: string; snapshotDeferred: true }> {
    return this.trackImport("sql", req, body.id, async () => {
      const submitted = await this.registry.register({
        id: body.id,
        workspaceId: body.workspaceId,
        projectId: body.projectId,
        name: body.id,
        sourceType: "sql",
        transport: {
          type: "sql",
          dialect: "postgres",
          dsn: body.dsn,
          allowedTables: body.allowedTables ?? [],
          readOnly: body.readOnly ?? true,
        },
        tags: body.tags,
        metadata: { ...(metadataFor(body) ?? {}), importSpec: { kind: "sql", body } },
        submittedBy: this.principalOf(req)?.id,
      });
      return {
        ok: true as const,
        approvalStatus: submitted.approvalStatus ?? "pending",
        snapshotDeferred: true as const,
      };
    });
  }

  @Post("graphql")
  @RequirePermission(Actions.ServerImportSubmit)
  async importGraphql(
    @Body() body: ImportGraphqlBody,
    @Req() req: Request,
  ): Promise<{ ok: true; approvalStatus: string; snapshotDeferred: true }> {
    return this.trackImport("graphql", req, body.id, async () => {
      const submitted = await this.registry.register({
        id: body.id,
        workspaceId: body.workspaceId,
        projectId: body.projectId,
        name: body.id,
        sourceType: "graphql",
        transport: { type: "graphql", endpoint: body.endpoint, headers: body.headers },
        tags: body.tags,
        metadata: { ...(metadataFor(body) ?? {}), importSpec: { kind: "graphql", body } },
        submittedBy: this.principalOf(req)?.id,
      });
      return {
        ok: true as const,
        approvalStatus: submitted.approvalStatus ?? "pending",
        snapshotDeferred: true as const,
      };
    });
  }

  @Post("mcp")
  @RequirePermission(Actions.ServerImportSubmit)
  async importMcpMirror(
    @Body() body: ImportMcpBody,
    @Req() req: Request,
  ): Promise<{ ok: true; approvalStatus: string; snapshotDeferred: true }> {
    return this.trackImport("mcp", req, body.id, async () => {
      const submitted = await this.registry.register({
        id: body.id,
        workspaceId: body.workspaceId,
        projectId: body.projectId,
        name: body.name ?? body.id,
        sourceType: "mcp",
        transport: body.transport,
        tags: body.tags,
        metadata: { ...(metadataFor(body) ?? {}), importSpec: { kind: "mcp", body } },
        submittedBy: this.principalOf(req)?.id,
      });
      return {
        ok: true as const,
        approvalStatus: submitted.approvalStatus ?? "pending",
        snapshotDeferred: true as const,
      };
    });
  }

  private async runBlueprint(
    kind: string,
    body: ImportOpenApiBody | ImportSqlBody | ImportGraphqlBody | ImportMcpBody,
  ): Promise<{
    serverName: string;
    serverVersion: string;
    transport: TransportDescriptor;
    capabilities: { tools: unknown[]; serverInfo?: { name?: string; version?: string } };
    toolCount: number;
  }> {
    if (kind === "openapi") {
      const b = body as ImportOpenApiBody;
      const doc = await loadOpenApi({ url: b.url, path: b.path });
      const bp = buildBlueprint(doc, b.baseUrl);
      return {
        serverName: bp.serverName,
        serverVersion: bp.serverVersion,
        transport: { type: "http", baseUrl: bp.baseUrl },
        capabilities: {
          tools: bp.tools,
          serverInfo: { name: bp.serverName, version: bp.serverVersion },
        },
        toolCount: bp.tools.length,
      };
    }
    if (kind === "sql") {
      const b = body as ImportSqlBody;
      const bp = await importPostgres({ dsn: b.dsn, allowedTables: b.allowedTables });
      return {
        serverName: bp.serverName,
        serverVersion: bp.serverVersion,
        transport: {
          type: "sql",
          dialect: "postgres",
          dsn: b.dsn,
          allowedTables: bp.allowedTables,
          readOnly: b.readOnly ?? true,
        },
        capabilities: {
          tools: bp.tools,
          serverInfo: { name: bp.serverName, version: bp.serverVersion },
        },
        toolCount: bp.tools.length,
      };
    }
    if (kind === "graphql") {
      const b = body as ImportGraphqlBody;
      const bp = await importGraphql({ endpoint: b.endpoint, headers: b.headers });
      return {
        serverName: bp.serverName,
        serverVersion: bp.serverVersion,
        transport: { type: "graphql", endpoint: bp.endpoint, headers: b.headers },
        capabilities: {
          tools: bp.tools,
          serverInfo: { name: bp.serverName, version: bp.serverVersion },
        },
        toolCount: bp.tools.length,
      };
    }
    if (kind === "mcp") {
      const b = body as ImportMcpBody;
      const bp = await importMcp({
        transport: b.transport,
        name: b.name,
        transports: this.transports,
      });
      return {
        serverName: bp.serverName,
        serverVersion: bp.serverVersion,
        transport: b.transport,
        capabilities: bp.capabilities as never,
        toolCount: bp.tools.length,
      };
    }
    throw new Error(`unknown import kind: ${kind}`);
  }

  @Get("pending")
  @RequirePermission(Actions.ServerApprove)
  async listPending(): Promise<unknown[]> {
    return this.registry.list({ approvalStatus: "pending" });
  }

  @Post(":id/approve")
  @RequirePermission(Actions.ServerApprove)
  async approve(
    @Param("id") id: string,
    @Req() req: Request,
  ): Promise<{ ok: true; toolCount: number; serverName: string }> {
    const approver = this.principalOf(req)?.id ?? "unknown";
    const server = await this.registry.get(id);
    const meta = (server.metadata ?? {}) as { importSpec?: { kind: string; body: unknown } };
    const spec = meta.importSpec;
    if (!spec) {
      throw new Error(`server ${id} has no importSpec — cannot approve (was it registered via /api/servers?)`);
    }

    // Run the blueprint step — this is the FIRST time upstream is touched.
    let result;
    try {
      result = await this.runBlueprint(spec.kind, spec.body as never);
    } catch (err) {
      this.audit.logFromRequest(req as Request & { principal?: Principal }, {
        action: "server.approve",
        resource: { server: id },
        outcome: "error",
        metadata: { phase: "probe", error: (err as Error).message },
      });
      throw err;
    }

    // Persist blueprint output (name/transport/version may differ from user body).
    await this.registry.updateSpec(id, {
      name: result.serverName,
      transport: result.transport,
      version: result.serverVersion,
    });
    await this.registry.snapshotCapabilities(id, result.serverVersion, result.capabilities as never);
    await this.registry.approve(id, approver);
    await this.router.invalidate(id);
    this.audit.logFromRequest(req as Request & { principal?: Principal }, {
      action: "server.approve",
      resource: { server: id },
      outcome: "ok",
      metadata: { toolCount: result.toolCount, kind: spec.kind },
    });
    return { ok: true as const, toolCount: result.toolCount, serverName: result.serverName };
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
