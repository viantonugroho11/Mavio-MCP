import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { MCPFrame, ServerCapabilities, ServerDescriptor, ToolDefinition } from "@mavio/core";
import { NotFoundError } from "@mavio/core";
import { Registry } from "@mavio/registry";
import { TransportManager, type Session } from "@mavio/transport";
import { CapabilityCache, InvalidationBus } from "@mavio/cache";
import { request } from "undici";
import { REGISTRY, TRANSPORT_MANAGER } from "./registry.module.js";
import { CAPABILITY_CACHE, INVALIDATION_BUS } from "./cache.module.js";

@Injectable()
export class RouterService implements OnModuleInit {
  constructor(
    @Inject(REGISTRY) private readonly registry: Registry,
    @Inject(TRANSPORT_MANAGER) private readonly transports: TransportManager,
    @Inject(CAPABILITY_CACHE) private readonly cache: CapabilityCache,
    @Inject(INVALIDATION_BUS) private readonly bus: InvalidationBus,
  ) {}

  onModuleInit(): void {
    this.bus.onEvent((event) => {
      if (event.kind === "servers") {
        void this.cache.invalidate();
      } else if (event.kind === "server" && event.serverId) {
        void this.cache.invalidate(event.serverId);
      }
    });
  }

  async invalidate(serverId?: string): Promise<void> {
    await this.cache.invalidate(serverId);
    await this.bus.publish(serverId ? { kind: "server", serverId } : { kind: "servers" });
  }

  private async loadServers(): Promise<ServerDescriptor[]> {
    const cached = await this.cache.getServerList();
    if (cached) return cached;
    const list = await this.registry.list();
    await this.cache.setServerList(list);
    return list;
  }

  private async loadCapabilities(serverId: string): Promise<ServerCapabilities | null> {
    const cached = await this.cache.getCapabilities(serverId);
    if (cached) return cached;
    const fresh = await this.registry.latestCapabilities(serverId);
    if (fresh) await this.cache.setCapabilities(serverId, fresh);
    return fresh;
  }

  async handle(frame: MCPFrame): Promise<MCPFrame> {
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
      return this.callTool(frame, params.name, params.arguments ?? {});
    }

    return errorFrame(frame.id, -32601, `method not supported: ${frame.method ?? "?"}`);
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

    const caps = await this.loadCapabilities(serverId);
    const tool = caps?.tools?.find((t) => t.name === toolName);
    if (!tool) return errorFrame(frame.id, -32001, `tool ${fqName} not found`);

    const httpMeta = (tool.inputSchema as Record<string, unknown>)["x-mavio-http"] as
      | { method: string; path: string }
      | undefined;

    if (descriptor.transport.type === "http" && httpMeta) {
      return this.callOpenApiTool(frame, descriptor.transport.baseUrl, httpMeta, args);
    }

    let session: Session | undefined;
    try {
      session = await this.transports.open(descriptor.transport);
      const forwarded: MCPFrame = {
        jsonrpc: "2.0",
        id: frame.id ?? Date.now(),
        method: "tools/call",
        params: { name: toolName, arguments: args },
      };
      const response = await session.send(forwarded);
      return { ...response, id: frame.id ?? null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorFrame(frame.id, -32000, `dispatch failed: ${message}`);
    } finally {
      if (session) await session.close().catch(() => undefined);
    }
  }

  private async callOpenApiTool(
    frame: MCPFrame,
    baseUrl: string,
    meta: { method: string; path: string },
    args: Record<string, unknown>,
  ): Promise<MCPFrame> {
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
    try {
      const res = await request(url, {
        method: meta.method,
        headers: body !== undefined ? { "content-type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await res.body.text();
      const parsed = safeJson(text) ?? text;
      return {
        jsonrpc: "2.0",
        id: frame.id ?? null,
        result: {
          content: [{ type: "text", text: typeof parsed === "string" ? parsed : JSON.stringify(parsed) }],
          isError: res.statusCode >= 400,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorFrame(frame.id, -32000, `http tool failed: ${message}`);
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
