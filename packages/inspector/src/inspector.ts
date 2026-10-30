import type { ServerDescriptor, ToolDefinition } from "@mavio/core";
import { NotFoundError } from "@mavio/core";
import type { Registry } from "@mavio/registry";
import { diffCapabilities, type CapabilityDiff } from "@mavio/registry";
import type {
  PromptDescriptor,
  ResourceDescriptor,
  ServerDescription,
  ToolDetail,
  TransportMeta,
} from "./types.js";

export class InspectorService {
  constructor(private readonly registry: Registry) {}

  async describe(serverId: string): Promise<ServerDescription> {
    const [server, snapshot] = await Promise.all([
      this.registry.get(serverId),
      this.registry.listSnapshots(serverId, 1).then((r) => r[0] ?? null),
    ]);

    const caps = snapshot?.capabilities ?? null;

    return {
      server,
      serverInfo: caps?.serverInfo ?? null,
      transportMeta: buildTransportMeta(server),
      tools: caps?.tools ?? [],
      resources: normalizeResources(caps?.resources ?? []),
      prompts: normalizePrompts(caps?.prompts ?? []),
      snapshotVersion: snapshot?.version ?? null,
      snapshotTakenAt: snapshot?.takenAt ?? null,
    };
  }

  async explainTool(serverId: string, toolName: string): Promise<ToolDetail> {
    const caps = await this.registry.latestCapabilities(serverId);
    const tool = (caps?.tools ?? []).find((t: ToolDefinition) => t.name === toolName);
    if (!tool) throw new NotFoundError(`tool ${toolName} on server ${serverId}`);
    return { ...tool, serverId };
  }

  async diff(snapshotIdA: string, snapshotIdB: string): Promise<CapabilityDiff> {
    const [a, b] = await Promise.all([
      this.registry.getSnapshot(snapshotIdA),
      this.registry.getSnapshot(snapshotIdB),
    ]);
    if (!a) throw new NotFoundError(`snapshot ${snapshotIdA}`);
    if (!b) throw new NotFoundError(`snapshot ${snapshotIdB}`);
    return diffCapabilities(a.capabilities, b.capabilities);
  }
}

function buildTransportMeta(server: ServerDescriptor): TransportMeta {
  const t = server.transport;
  const endpoint =
    "baseUrl" in t ? t.baseUrl :
    "endpoint" in t ? t.endpoint :
    undefined;
  const command = "command" in t ? (t as { command?: string }).command : undefined;
  const tls = typeof endpoint === "string" && endpoint.startsWith("https");
  return { kind: t.type, endpoint, command, tls };
}

function normalizeResources(raw: unknown[]): ResourceDescriptor[] {
  return raw.map((r) => {
    if (typeof r !== "object" || r === null) return { uri: String(r) };
    const obj = r as Record<string, unknown>;
    return {
      uri: typeof obj["uri"] === "string" ? obj["uri"] : "",
      name: typeof obj["name"] === "string" ? obj["name"] : undefined,
      description: typeof obj["description"] === "string" ? obj["description"] : undefined,
      mimeType: typeof obj["mimeType"] === "string" ? obj["mimeType"] : undefined,
    };
  });
}

function normalizePrompts(raw: unknown[]): PromptDescriptor[] {
  return raw.map((p) => {
    if (typeof p !== "object" || p === null) return { name: String(p) };
    const obj = p as Record<string, unknown>;
    const args = Array.isArray(obj["arguments"])
      ? (obj["arguments"] as unknown[]).map((a) => {
          if (typeof a !== "object" || a === null) return { name: String(a) };
          const ao = a as Record<string, unknown>;
          return {
            name: typeof ao["name"] === "string" ? ao["name"] : "",
            description: typeof ao["description"] === "string" ? ao["description"] : undefined,
            required: typeof ao["required"] === "boolean" ? ao["required"] : undefined,
          };
        })
      : undefined;
    return {
      name: typeof obj["name"] === "string" ? obj["name"] : "",
      description: typeof obj["description"] === "string" ? obj["description"] : undefined,
      arguments: args,
    };
  });
}
