import type { ServerCapabilities, ServerDescriptor, ToolDefinition } from "@mavio/core";
import { annotationsForEffect, resolveToolEffect } from "../tool-effect.js";
import { DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT, type SearchHit, type SearchOptions } from "./search.js";

/** Everything a discovery meta-tool needs, already bound to the calling principal. */
export interface DiscoveryDeps {
  /** Region-filtered server list. */
  listServers(): Promise<ServerDescriptor[]>;
  loadCapabilities(serverId: string): Promise<ServerCapabilities | null>;
  canInvoke(descriptor: ServerDescriptor, toolName: string): Promise<boolean>;
  isConnected(descriptor: ServerDescriptor): Promise<{ connected: boolean; providerId: string | null }>;
  search(query: string, options: SearchOptions): Promise<SearchHit[]>;
}

export class MetaToolArgumentError extends Error {}

export const DISCOVERY_TOOLS = [
  {
    name: "mavio_list_servers",
    description:
      "List the upstream servers you can use, with health and whether you are connected. " +
      "connected=false means calls will ask for upstream consent first.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "mavio_search_tools",
    description:
      'Search available tools by what you want to do, e.g. "create jira issue" or "send email". ' +
      "Matches words in any order, tolerates typos and common synonyms, and returns the best matches " +
      "first with a relevance score and side-effect label (read, write, destructive). Returns the top 10 " +
      "by default; pass limit (max 50) for more, or server to search one server.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, description: "What you want to do, in words" },
        limit: { type: "integer", minimum: 1, maximum: MAX_SEARCH_LIMIT, default: DEFAULT_SEARCH_LIMIT },
        server: { type: "string", description: "Only search this server id" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "mavio_get_tool_schema",
    description:
      "Get the input schema and side-effect label for one tool, by the name mavio_search_tools returned " +
      "(serverId.toolName).",
    inputSchema: {
      type: "object",
      properties: { tool: { type: "string", minLength: 1, description: "Tool name, serverId.toolName" } },
      required: ["tool"],
      additionalProperties: false,
    },
  },
] as const;

export type DiscoveryToolName = (typeof DISCOVERY_TOOLS)[number]["name"];

export function isDiscoveryTool(name: string): name is DiscoveryToolName {
  return DISCOVERY_TOOLS.some((t) => t.name === name);
}

function isApproved(d: ServerDescriptor): boolean {
  return !d.approvalStatus || d.approvalStatus === "approved";
}

function rejectUnknownKeys(args: Record<string, unknown>, allowed: string[]): void {
  const extra = Object.keys(args).filter((k) => !allowed.includes(k));
  if (extra.length > 0) throw new MetaToolArgumentError(`unknown argument(s): ${extra.join(", ")}`);
}

export async function listServers(deps: DiscoveryDeps, args: Record<string, unknown>) {
  rejectUnknownKeys(args, []);
  const servers = (await deps.listServers()).filter(isApproved);
  const out = [];
  for (const s of servers) {
    const caps = await deps.loadCapabilities(s.id);
    let visible = false;
    for (const t of caps?.tools ?? []) {
      if (await deps.canInvoke(s, t.name)) {
        visible = true;
        break;
      }
    }
    if (!visible) continue;
    const { connected, providerId } = await deps.isConnected(s);
    out.push({
      id: s.id,
      name: s.name,
      sourceType: s.sourceType,
      health: s.status ?? "unknown",
      connected,
      ...(providerId ? { upstreamProvider: providerId } : {}),
    });
  }
  return { servers: out };
}

export async function searchTools(deps: DiscoveryDeps, args: Record<string, unknown>) {
  rejectUnknownKeys(args, ["query", "limit", "server"]);
  const { query, limit, server } = args;
  if (typeof query !== "string" || query.trim() === "") {
    throw new MetaToolArgumentError("query must be a non-empty string");
  }
  if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT)) {
    throw new MetaToolArgumentError(`limit must be an integer between 1 and ${MAX_SEARCH_LIMIT}`);
  }
  if (server !== undefined && typeof server !== "string") {
    throw new MetaToolArgumentError("server must be a string");
  }
  const want = (limit as number | undefined) ?? DEFAULT_SEARCH_LIMIT;

  const byId = new Map((await deps.listServers()).filter(isApproved).map((s) => [s.id, s]));
  // Over-fetch, then drop what the caller may not invoke.
  const candidates = await deps.search(query, { limit: MAX_SEARCH_LIMIT, server: server as string | undefined });
  const tools = [];
  for (const hit of candidates) {
    const descriptor = byId.get(hit.server);
    if (!descriptor) continue;
    const bare = hit.name.slice(hit.server.length + 1);
    if (!(await deps.canInvoke(descriptor, bare))) continue;
    tools.push({
      name: hit.name,
      description: hit.description,
      server: hit.server,
      score: hit.score,
      effect: hit.effect,
    });
    if (tools.length >= want) break;
  }
  return { tools };
}

/** Remove Mavio's internal dispatch hints (x-mavio-*) from a published schema. */
export function publicSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (!k.startsWith("x-mavio-")) out[k] = v;
  }
  return out;
}

export async function getToolSchema(deps: DiscoveryDeps, args: Record<string, unknown>) {
  rejectUnknownKeys(args, ["tool"]);
  const { tool } = args;
  if (typeof tool !== "string" || tool === "") throw new MetaToolArgumentError("tool must be a non-empty string");

  const notFound = { error: "TOOL_NOT_FOUND", tool } as const;
  const dot = tool.indexOf(".");
  if (dot <= 0) return notFound;
  const serverId = tool.slice(0, dot);
  const toolName = tool.slice(dot + 1);

  const descriptor = (await deps.listServers()).find((s) => s.id === serverId);
  if (!descriptor || !isApproved(descriptor)) return notFound;
  const caps = await deps.loadCapabilities(serverId);
  const def: ToolDefinition | undefined = caps?.tools?.find((t) => t.name === toolName);
  // A forbidden tool is reported exactly like a missing one, so search and
  // schema never reveal what the caller cannot call.
  if (!def || !(await deps.canInvoke(descriptor, toolName))) return notFound;

  const effect = resolveToolEffect(def, descriptor.metadata);
  return {
    name: tool,
    description: def.description ?? "",
    schema: publicSchema(def.inputSchema ?? {}),
    effect,
    annotations: annotationsForEffect(effect, def.annotations),
  };
}

export async function runDiscoveryTool(
  name: DiscoveryToolName,
  deps: DiscoveryDeps,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "mavio_list_servers":
      return listServers(deps, args);
    case "mavio_search_tools":
      return searchTools(deps, args);
    case "mavio_get_tool_schema":
      return getToolSchema(deps, args);
  }
}
