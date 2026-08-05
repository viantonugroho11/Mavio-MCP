import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { MCPFrame, Principal, ServerCapabilities, ServerDescriptor, ToolDefinition } from "@mavio/core";
import { CircuitBreaker, CircuitOpenError, NotFoundError } from "@mavio/core";
import { Actions, type PolicyEngine } from "@mavio/rbac";
import { Registry } from "@mavio/registry";
import { TransportManager, type Session } from "@mavio/transport";
import { CapabilityCache, InvalidationBus, RateLimiter, type Redis } from "@mavio/cache";
import type { MavioConfig } from "@mavio/config";
import {
  BREAKER_STATE_VALUE,
  injectTraceHeaders,
  MavioMetrics,
  SpanKind,
  withSpan,
} from "@mavio/observability";
import { request } from "undici";
import { REGISTRY, TRANSPORT_MANAGER } from "./registry.module.js";
import { CAPABILITY_CACHE, INVALIDATION_BUS, REDIS } from "./cache.module.js";
import { POLICY_ENGINE } from "./rbac.module.js";
import { MAVIO_CONFIG } from "./config.module.js";
import { METRICS } from "./observability.module.js";
import { SqlDispatcher } from "./sql-dispatcher.js";
import { GraphqlDispatcher } from "./graphql-dispatcher.js";
import { AuditService } from "./audit.module.js";

interface DispatchResult {
  result: unknown;
  isError: boolean;
}

@Injectable()
export class RouterService implements OnModuleInit {
  private readonly breaker: CircuitBreaker;
  private readonly limiter: RateLimiter;

  constructor(
    @Inject(REGISTRY) private readonly registry: Registry,
    @Inject(TRANSPORT_MANAGER) private readonly transports: TransportManager,
    @Inject(CAPABILITY_CACHE) private readonly cache: CapabilityCache,
    @Inject(INVALIDATION_BUS) private readonly bus: InvalidationBus,
    @Inject(POLICY_ENGINE) private readonly policy: PolicyEngine,
    @Inject(MAVIO_CONFIG) config: MavioConfig,
    @Inject(REDIS) redis: Redis,
    @Inject(METRICS) private readonly metrics: MavioMetrics,
    private readonly sql: SqlDispatcher,
    private readonly graphql: GraphqlDispatcher,
    private readonly audit: AuditService,
  ) {
    this.breaker = new CircuitBreaker(config.router.circuitBreaker ?? {});
    this.limiter = new RateLimiter(redis);
  }

  onModuleInit(): void {
    this.bus.onEvent((event) => {
      if (event.kind === "servers") {
        void this.cache.invalidate();
      } else if (event.kind === "server" && event.serverId) {
        void this.cache.invalidate(event.serverId);
        this.sql.invalidate(event.serverId);
      }
    });
  }

  async invalidate(serverId?: string): Promise<void> {
    await this.cache.invalidate(serverId);
    if (serverId) this.sql.invalidate(serverId);
    await this.bus.publish(serverId ? { kind: "server", serverId } : { kind: "servers" });
  }

  private async loadServers(): Promise<ServerDescriptor[]> {
    const cached = await this.cache.getServerList();
    if (cached) return this.filterByRegion(cached);
    const list = await this.registry.list();
    await this.cache.setServerList(list);
    return this.filterByRegion(list);
  }

  private filterByRegion(list: ServerDescriptor[]): ServerDescriptor[] {
    const region = process.env.MAVIO_REGION;
    if (!region) return list;
    return list.filter((s) => {
      const tag = (s.metadata as { region?: string } | undefined)?.region;
      return !tag || tag === region;
    });
  }

  private async loadCapabilities(serverId: string): Promise<ServerCapabilities | null> {
    const cached = await this.cache.getCapabilities(serverId);
    if (cached) return cached;
    const fresh = await this.registry.latestCapabilities(serverId);
    if (fresh) await this.cache.setCapabilities(serverId, fresh);
    return fresh;
  }

  async handle(frame: MCPFrame, principal?: Principal): Promise<MCPFrame> {
    if (frame.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id: frame.id ?? null,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "mavio-mcp", version: "0.1.0-mvp" },
          capabilities: { tools: {} },
        },
      };
    }

    if (frame.method === "tools/list") {
      const tools = await this.listAllTools();
      return { jsonrpc: "2.0", id: frame.id ?? null, result: { tools } };
    }

    if (frame.method === "tools/call") {
      const params = (frame.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      if (!params.name) return errorFrame(frame.id, -32602, "missing tool name");
      return this.callTool(frame, params.name, params.arguments ?? {}, principal);
    }

    return errorFrame(frame.id, -32601, `method not supported: ${frame.method ?? "?"}`);
  }

  async invokeAndReturn(
    fqName: string,
    args: Record<string, unknown>,
    principal?: Principal,
  ): Promise<MCPFrame> {
    return this.callTool(
      { jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: fqName, arguments: args } },
      fqName,
      args,
      principal,
    );
  }

  private async listAllTools(): Promise<Array<ToolDefinition & { server: string }>> {
    const servers = await this.loadServers();
    const out: Array<ToolDefinition & { server: string }> = [];
    for (const s of servers) {
      const caps = await this.loadCapabilities(s.id);
      for (const t of caps?.tools ?? []) {
        out.push({ ...t, name: `${s.id}.${t.name}`, server: s.id });
      }
    }
    return out;
  }

  private async callTool(
    frame: MCPFrame,
    fqName: string,
    args: Record<string, unknown>,
    principal?: Principal,
  ): Promise<MCPFrame> {
    const dot = fqName.indexOf(".");
    if (dot < 0) return errorFrame(frame.id, -32602, "tool name must be namespaced: serverId.toolName");
    const serverId = fqName.slice(0, dot);
    const toolName = fqName.slice(dot + 1);

    let descriptor: ServerDescriptor;
    try {
      descriptor = await this.registry.get(serverId);
    } catch (err) {
      if (err instanceof NotFoundError) return errorFrame(frame.id, -32001, err.message);
      throw err;
    }

    if (principal && !principal.scopes.includes("*")) {
      const decision = await this.policy.can(principal, Actions.ToolInvoke, {
        workspace: descriptor.workspaceId,
        project: descriptor.projectId,
        server: serverId,
        tool: toolName,
      });
      if (!decision.allowed) return errorFrame(frame.id, -32003, `authz denied: ${decision.reason}`);
    }

    const caps = await this.loadCapabilities(serverId);
    const tool = caps?.tools?.find((t) => t.name === toolName);
    if (!tool) return errorFrame(frame.id, -32001, `tool ${fqName} not found`);
    const schema = tool.inputSchema as Record<string, unknown>;

    const perServerRpm = Number(
      (descriptor.metadata as { rateLimitRpm?: number } | undefined)?.rateLimitRpm ?? 0,
    );
    if (perServerRpm > 0) {
      const scope = principal ? `${serverId}:${principal.id}` : `${serverId}:anon`;
      const result = await this.limiter.check(scope, perServerRpm, 60);
      if (!result.allowed) {
        this.metrics.rateLimitDenied.inc({ server: serverId, scope });
        return errorFrame(frame.id, -32011, `server rate limit exceeded (resetAt=${result.resetAt})`);
      }
    }

    const started = process.hrtime.bigint();
    let outcome: "ok" | "error" | "circuit_open" = "ok";
    try {
      const dispatched = await withSpan(
        `mavio.router.call ${serverId}.${toolName}`,
        () =>
          this.breaker.execute(serverId, () =>
            this.dispatchByKind(descriptor, toolName, schema, args),
          ),
        {
          kind: SpanKind.SERVER,
          attributes: {
            "mavio.server.id": serverId,
            "mavio.tool.name": toolName,
            "mavio.transport.kind": descriptor.transport.type,
            "mavio.principal.id": principal?.id,
          },
        },
      );
      outcome = dispatched.isError ? "error" : "ok";
      if (dispatched.isError) {
        this.metrics.upstreamErrors.inc({ server: serverId, kind: descriptor.transport.type });
      }
      return {
        jsonrpc: "2.0",
        id: frame.id ?? null,
        result: {
          content: [
            {
              type: "text",
              text:
                typeof dispatched.result === "string"
                  ? dispatched.result
                  : JSON.stringify(dispatched.result),
            },
          ],
          isError: dispatched.isError,
        },
      };
    } catch (err) {
      this.metrics.upstreamErrors.inc({ server: serverId, kind: descriptor.transport.type });
      if (err instanceof CircuitOpenError) {
        outcome = "circuit_open";
        return errorFrame(frame.id, -32010, err.message);
      }
      outcome = "error";
      const message = err instanceof Error ? err.message : String(err);
      return errorFrame(frame.id, -32000, `dispatch failed: ${message}`);
    } finally {
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      this.metrics.routerRequests.inc({ server: serverId, tool: toolName, outcome });
      this.metrics.routerDuration.observe({ server: serverId, tool: toolName, outcome }, seconds);
      this.metrics.breakerState.set(
        { server: serverId },
        BREAKER_STATE_VALUE[this.breaker.snapshot(serverId)],
      );
      this.audit.log({
        actorId: principal?.id ?? null,
        actorType: principal?.type ?? null,
        action: "tool.invoke",
        resource: { server: serverId, tool: toolName },
        outcome: outcome === "ok" ? "ok" : outcome === "circuit_open" ? "error" : "error",
        metadata: { outcome, durationMs: Math.round(seconds * 1000) },
      });
    }
  }

  private async dispatchByKind(
    descriptor: ServerDescriptor,
    toolName: string,
    schema: Record<string, unknown>,
    args: Record<string, unknown>,
  ): Promise<DispatchResult> {
    const httpMeta = schema["x-mavio-http"] as { method: string; path: string } | undefined;
    const sqlMeta = schema["x-mavio-sql"] as
      | { kind: "select" | "count"; schema: string; table: string; columns?: string[]; filterable?: string[] }
      | undefined;
    const graphqlMeta = schema["x-mavio-graphql"] as
      | {
          operation: "query" | "mutation";
          field: string;
          args: Array<{ name: string; gqlType: string }>;
          returnType: string;
          selection?: string;
        }
      | undefined;

    if (descriptor.transport.type === "http" && httpMeta) {
      return this.dispatchOpenApi(descriptor.transport.baseUrl, httpMeta, args);
    }
    if (descriptor.transport.type === "sql" && sqlMeta) {
      const result = await this.sql.dispatch(descriptor.id, descriptor.transport, sqlMeta, args);
      return { result, isError: false };
    }
    if (descriptor.transport.type === "graphql" && graphqlMeta) {
      const result = (await this.graphql.dispatch(descriptor.transport, graphqlMeta, args)) as {
        errors?: unknown[];
      };
      return { result, isError: Array.isArray(result.errors) && result.errors.length > 0 };
    }
    return this.dispatchNativeMcp(descriptor, toolName, args);
  }

  private async dispatchOpenApi(
    baseUrl: string,
    meta: { method: string; path: string },
    args: Record<string, unknown>,
  ): Promise<DispatchResult> {
    let path = meta.path;
    const query = new URLSearchParams();
    const body = args["body"];
    for (const [k, v] of Object.entries(args)) {
      if (k === "body") continue;
      const placeholder = `{${k}}`;
      if (path.includes(placeholder)) {
        path = path.replace(placeholder, encodeURIComponent(String(v)));
      } else {
        query.append(k, String(v));
      }
    }
    const url = `${baseUrl.replace(/\/$/, "")}${path}${query.toString() ? `?${query}` : ""}`;
    const headers: Record<string, string> = body !== undefined ? { "content-type": "application/json" } : {};
    const res = await request(url, {
      method: meta.method as "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
      headers: injectTraceHeaders(headers),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.body.text();
    const parsed = safeJson(text) ?? text;
    return { result: parsed, isError: res.statusCode >= 400 };
  }

  private async dispatchNativeMcp(
    descriptor: ServerDescriptor,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<DispatchResult> {
    let session: Session | undefined;
    try {
      session = await this.transports.open(descriptor.transport);
      const forwarded: MCPFrame = {
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: { name: toolName, arguments: args },
      };
      const response = await session.send(forwarded);
      return { result: response.result ?? response.error, isError: Boolean(response.error) };
    } finally {
      if (session) await session.close().catch(() => undefined);
    }
  }
}

function errorFrame(id: MCPFrame["id"], code: number, message: string): MCPFrame {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function safeJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}
