import { describe, it, expect } from "vitest";
import type { ServerCapabilities, ServerDescriptor } from "@mavio/core";
import {
  MetaToolArgumentError,
  getToolSchema,
  isDiscoveryTool,
  listServers,
  publicSchema,
  searchTools,
  type DiscoveryDeps,
} from "./discovery.js";
import { ToolSearchIndex } from "./search.js";
import { resolveToolEffect } from "../tool-effect.js";

const server = (id: string, over: Partial<ServerDescriptor> = {}): ServerDescriptor =>
  ({
    id,
    workspaceId: "w",
    projectId: "p",
    name: id.toUpperCase(),
    transport: { type: "http", url: "https://example.test" },
    sourceType: "openapi",
    status: "healthy",
    ...over,
  }) as ServerDescriptor;

const SERVERS: ServerDescriptor[] = [
  server("jira", { metadata: { upstreamOAuthProvider: "atlassian" } }),
  server("github"),
  server("pending", { approvalStatus: "pending" }),
  server("secret"),
];

const CAPS: Record<string, ServerCapabilities> = {
  jira: {
    tools: [
      { name: "create_issue", description: "Create a Jira issue", inputSchema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], "x-mavio-http": { method: "POST", path: "/issue" } } },
      { name: "delete_issue", description: "Delete a Jira issue", inputSchema: { type: "object" } },
    ],
  },
  github: {
    tools: [{ name: "list_issues", description: "List GitHub issues", inputSchema: { type: "object", "x-mavio-http": { method: "GET", path: "/issues" } }, annotations: { title: "List issues" } }],
  },
  pending: { tools: [{ name: "create_issue", description: "Create a pending issue", inputSchema: { type: "object" } }] },
  secret: { tools: [{ name: "create_issue", description: "Create a secret issue", inputSchema: { type: "object" } }] },
};

function deps(opts: { forbid?: string[]; connected?: Record<string, boolean> } = {}): DiscoveryDeps {
  const forbid = new Set(opts.forbid ?? []);
  const index = new ToolSearchIndex(
    SERVERS.flatMap((s) =>
      (CAPS[s.id]?.tools ?? []).map((t) => ({
        name: `${s.id}.${t.name}`,
        server: s.id,
        description: t.description ?? "",
        effect: resolveToolEffect(t, s.metadata),
      })),
    ),
  );
  return {
    listServers: async () => SERVERS,
    loadCapabilities: async (id) => CAPS[id] ?? null,
    canInvoke: async (d, tool) => !forbid.has(`${d.id}.${tool}`) && !forbid.has(`${d.id}.*`),
    isConnected: async (d) => {
      const providerId = (d.metadata as { upstreamOAuthProvider?: string } | undefined)?.upstreamOAuthProvider ?? null;
      return { connected: opts.connected?.[d.id] ?? true, providerId };
    },
    search: async (q, o) => index.search(q, o),
  };
}

describe("isDiscoveryTool", () => {
  it("recognises only the three discovery tools", () => {
    expect(isDiscoveryTool("mavio_search_tools")).toBe(true);
    expect(isDiscoveryTool("mavio_list_servers")).toBe(true);
    expect(isDiscoveryTool("mavio_get_tool_schema")).toBe(true);
    expect(isDiscoveryTool("mavio_execute_tools")).toBe(false);
  });
});

describe("mavio_list_servers", () => {
  it("lists approved servers the caller can use, with health and connection", async () => {
    const r = await listServers(deps({ forbid: ["secret.*"], connected: { jira: false } }), {});
    expect(r.servers).toEqual([
      { id: "jira", name: "JIRA", sourceType: "openapi", health: "healthy", connected: false, upstreamProvider: "atlassian" },
      { id: "github", name: "GITHUB", sourceType: "openapi", health: "healthy", connected: true },
    ]);
  });

  it("keeps a server when at least one of its tools is allowed", async () => {
    const r = await listServers(deps({ forbid: ["jira.create_issue"] }), {});
    expect(r.servers.map((s) => s.id)).toContain("jira");
  });

  it("rejects arguments", async () => {
    await expect(listServers(deps(), { x: 1 })).rejects.toBeInstanceOf(MetaToolArgumentError);
  });
});

describe("mavio_search_tools", () => {
  it("returns ranked hits with effect, excluding unapproved and forbidden tools", async () => {
    const r = await searchTools(deps({ forbid: ["secret.create_issue"] }), { query: "create issue" });
    const names = r.tools.map((t) => t.name);
    expect(names[0]).toBe("jira.create_issue");
    expect(names).not.toContain("pending.create_issue");
    expect(names).not.toContain("secret.create_issue");
    expect(r.tools[0]).toMatchObject({ server: "jira", effect: "destructive" });
  });

  it("honours limit and server", async () => {
    expect((await searchTools(deps(), { query: "issue", limit: 1 })).tools).toHaveLength(1);
    const gh = await searchTools(deps(), { query: "issue", server: "github" });
    expect(gh.tools.map((t) => t.name)).toEqual(["github.list_issues"]);
  });

  it("validates arguments", async () => {
    for (const bad of [{}, { query: "" }, { query: "  " }, { query: 3 }, { query: "x", limit: 0 }, { query: "x", limit: 51 }, { query: "x", limit: 1.5 }, { query: "x", server: 1 }, { query: "x", extra: true }]) {
      await expect(searchTools(deps(), bad)).rejects.toBeInstanceOf(MetaToolArgumentError);
    }
  });
});

describe("mavio_get_tool_schema", () => {
  it("returns the public schema, effect and annotations", async () => {
    const r = await getToolSchema(deps(), { tool: "jira.create_issue" });
    expect(r).toEqual({
      name: "jira.create_issue",
      description: "Create a Jira issue",
      schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
      effect: "destructive",
      annotations: { readOnlyHint: false, destructiveHint: true },
    });
  });

  it("keeps upstream annotation fields", async () => {
    const r = await getToolSchema(deps(), { tool: "github.list_issues" });
    expect(r).toMatchObject({ effect: "read", annotations: { title: "List issues", readOnlyHint: true, destructiveHint: false } });
  });

  it("reports forbidden, unapproved, unknown and malformed names identically", async () => {
    const d = deps({ forbid: ["jira.delete_issue"] });
    for (const tool of ["jira.delete_issue", "pending.create_issue", "jira.nope", "nope.create_issue", "noDot", ".x"]) {
      expect(await getToolSchema(d, { tool })).toEqual({ error: "TOOL_NOT_FOUND", tool });
    }
  });

  it("validates arguments", async () => {
    await expect(getToolSchema(deps(), {})).rejects.toBeInstanceOf(MetaToolArgumentError);
    await expect(getToolSchema(deps(), { tool: "a.b", x: 1 })).rejects.toBeInstanceOf(MetaToolArgumentError);
  });
});

describe("publicSchema", () => {
  it("drops only top-level x-mavio-* keys", () => {
    expect(publicSchema({ type: "object", "x-mavio-sql": {}, "x-other": 1, properties: { "x-mavio-http": { type: "string" } } })).toEqual({
      type: "object",
      "x-other": 1,
      properties: { "x-mavio-http": { type: "string" } },
    });
  });
});
