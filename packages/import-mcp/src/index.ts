import type { MCPFrame, ServerCapabilities, ToolDefinition, TransportDescriptor } from "@mavio/core";
import { MavioError } from "@mavio/core";
import { TransportManager } from "@mavio/transport";

export interface McpMirrorBlueprint {
  serverName: string;
  serverVersion: string;
  transport: TransportDescriptor;
  capabilities: ServerCapabilities;
  tools: ToolDefinition[];
}

export interface McpMirrorOptions {
  transport: TransportDescriptor;
  name?: string;
  transports?: TransportManager;
}

const PROTOCOL_VERSION = "2024-11-05";

export async function importMcp(input: McpMirrorOptions): Promise<McpMirrorBlueprint> {
  const manager = input.transports ?? new TransportManager();
  const session = await manager.open(input.transport);
  try {
    const initFrame: MCPFrame = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: "mavio-import-mcp", version: "0.1.0" },
        capabilities: {},
      },
    };
    const initRes = await session.send(initFrame);
    if (initRes.error) {
      throw new MavioError(
        `mcp initialize failed: ${initRes.error.message}`,
        "IMPORT_MCP_INIT",
      );
    }
    const initResult = (initRes.result ?? {}) as {
      serverInfo?: { name?: string; version?: string };
      capabilities?: Record<string, unknown>;
    };

    const listRes = await session.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    if (listRes.error) {
      throw new MavioError(
        `mcp tools/list failed: ${listRes.error.message}`,
        "IMPORT_MCP_LIST",
      );
    }
    const listResult = (listRes.result ?? {}) as { tools?: unknown[] };
    const tools = normalizeTools(listResult.tools ?? []);
    const serverName = input.name ?? initResult.serverInfo?.name ?? deriveName(input.transport);
    const serverVersion = initResult.serverInfo?.version ?? new Date().toISOString();
    const capabilities: ServerCapabilities = {
      tools,
      serverInfo: { name: serverName, version: serverVersion },
    };
    return {
      serverName,
      serverVersion,
      transport: input.transport,
      capabilities,
      tools,
    };
  } finally {
    await session.close().catch(() => undefined);
  }
}

function normalizeTools(input: unknown[]): ToolDefinition[] {
  const out: ToolDefinition[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as { name?: unknown; description?: unknown; inputSchema?: unknown };
    if (typeof t.name !== "string" || !t.name) continue;
    out.push({
      name: t.name,
      description: typeof t.description === "string" ? t.description : undefined,
      inputSchema:
        t.inputSchema && typeof t.inputSchema === "object"
          ? (t.inputSchema as Record<string, unknown>)
          : { type: "object", properties: {} },
    });
  }
  return out;
}

function deriveName(transport: TransportDescriptor): string {
  switch (transport.type) {
    case "stdio":
      return `mcp:${transport.command}`;
    case "http":
      return `mcp:${new URL(transport.baseUrl).hostname}`;
    case "sse":
      return `mcp:${new URL(transport.url).hostname}`;
    default:
      return `mcp:${transport.type}`;
  }
}
